import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWorkerEngine } from "../src/index.js";

const workloads = [
	{ name: "cube", source: "cube(3);" },
	{ name: "sphere-csg", source: "$fn=64;difference(){sphere(12);translate([5,0,0])cube([10,10,40],center=true);}" },
	{ name: "holed-extrusion", source: "$fn=96;linear_extrude(height=12,slices=16)difference(){circle(10);circle(4);}" },
];

function summary(values) {
	const ordered = [...values].sort((first, second) => first - second);
	return { samples: ordered.length, medianMs: ordered[Math.floor(ordered.length / 2)], p95Ms: ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)], maxMs: ordered.at(-1) };
}

export async function measureResources({ cycles = 30 } = {}) {
	if (!Number.isInteger(cycles) || cycles < 3 || cycles > 100) throw new RangeError("Measurement cycles must be 3-100");
	const workers = [], compileTimes = [], exportTimes = [], phaseTimes = [], memorySamples = [];
	let engine, busy = false, busyTimer, busyAbortTime, busyController;
	const collectMemory = () => memorySamples.push({ ...process.memoryUsage(), elapsedMs: performance.now() - started });
	const started = performance.now(), memoryBefore = process.memoryUsage();
	const timer = setInterval(collectMemory, 10);
	const compile = async (source) => {
		const start = performance.now();
		const result = await engine.compile({ mode: "render", maxTriangles: 100000, files: { "main.scad": source } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try {
			compileTimes.push(performance.now() - start);
			phaseTimes.push(result.timings);
			const exportStart = performance.now(), bytes = await engine.export(result);
			exportTimes.push(performance.now() - exportStart);
			assert.ok(bytes.byteLength > 84);
		} finally { result.dispose(); }
	};
	try {
		const initStart = performance.now();
		engine = await createWorkerEngine({ maxPendingJobs: 2, timeoutMs: 5000, startupTimeoutMs: 10000, workerFactory: (url) => {
			const record = { worker: new Worker(url, { execArgv: [] }), exited: false };
			record.worker.once("exit", () => { record.exited = true; record.exitedAt = performance.now(); }); workers.push(record);
			return record.worker;
		}, onProgress: (event) => {
			if (busy && event.operation === "compile" && event.phase === "started") busyTimer = setTimeout(() => { busyAbortTime = performance.now(); busyController.abort(); }, 75);
		} });
		const startupMs = performance.now() - initStart;
		for (const workload of workloads) await compile(workload.source);
		compileTimes.length = exportTimes.length = phaseTimes.length = 0;
		globalThis.gc?.(); collectMemory();
		const memoryAfterWarmup = process.memoryUsage();
		for (let cycle = 0; cycle < cycles; cycle++) {
			await compile(workloads[cycle % workloads.length].source);
			if (cycle % 5 === 0) {
				const failed = await engine.compile({ files: { "main.scad": "cube(;" } });
				assert.equal(failed.status, "error");
			}
			await new Promise((resolve) => setImmediate(resolve)); globalThis.gc?.(); collectMemory();
		}
		const memoryAfterCycles = process.memoryUsage();
		let readReady, releaseRead, sourceSignal;
		const sourceReady = new Promise((resolve) => { readReady = resolve; });
		const sourceController = new AbortController();
		const pending = engine.compile({ signal: sourceController.signal, resolver: (name, { signal }) => {
			sourceSignal = signal; readReady(); return new Promise((resolve) => { releaseRead = resolve; });
		} });
		await sourceReady;
		const queuedController = new AbortController();
		const queued = engine.compile({ signal: queuedController.signal, files: { "main.scad": "cube(2);" } });
		const overflow = await engine.compile({ files: { "main.scad": "cube();" } });
		assert.equal(overflow.diagnostics[0].code, "resource-limit");
		const queuedStart = performance.now(); queuedController.abort();
		assert.equal((await queued).status, "cancelled");
		const queuedCancellationMs = performance.now() - queuedStart;
		const sourceWorker = workers.at(-1), cancelStart = performance.now(); sourceController.abort();
		assert.equal((await pending).status, "cancelled"); assert.equal(sourceSignal.aborted, true);
		const resolverCancellationMs = performance.now() - cancelStart;
		releaseRead("cube(100);");
		const restartStart = performance.now();
		const live = await engine.compile({ mode: "render", files: { "main.scad": "cube(3);" } });
		assert.equal(live.status, "success"); assert.equal(live.volume, 27);
		const restartMs = performance.now() - restartStart, copiedMesh = live.getMesh();
		const busyWorker = workers.at(-1);
		busy = true; busyController = new AbortController();
		const busyStart = performance.now();
		const interrupted = await engine.compile({ signal: busyController.signal, files: { "main.scad": "sphere(10,$fn=800);" } });
		busy = false; clearTimeout(busyTimer);
		const busyReport = { status: interrupted.status, jobMs: performance.now() - busyStart, abortToSettlementMs: busyAbortTime === undefined ? null : performance.now() - busyAbortTime };
		if (interrupted.status === "cancelled") assert.throws(() => live.getMesh(), (error) => error.code === "worker-reset");
		else { assert.equal(interrupted.status, "success"); interrupted.dispose(); live.dispose(); }
		assert.ok(copiedMesh.triVerts.length > 0);
		const budgetRejected = await engine.compile({ maxTriangles: 10, files: { "main.scad": "linear_extrude(height=5,slices=10)square(2);" } });
		assert.equal(budgetRejected.diagnostics.at(-1).code, "resource-limit");
		let activeReady, activeRelease, activeSignal;
		const disposalReady = new Promise((resolve) => { activeReady = resolve; });
		const activeJob = engine.compile({ resolver: (name, { signal }) => { activeSignal = signal; activeReady(); return new Promise((resolve) => { activeRelease = resolve; }); } });
		await disposalReady;
		const queuedJob = engine.compile({ files: { "main.scad": "cube(2);" } });
		const disposalStart = performance.now();
		await engine.dispose();
		const settled = await Promise.all([activeJob, queuedJob]);
		assert.ok(settled.every((result) => result.diagnostics[0].code === "disposed"));
		assert.equal(activeSignal.aborted, true); activeRelease("cube(100);");
		assert.equal((await engine.compile()).diagnostics[0].code, "disposed");
		const disposalMs = performance.now() - disposalStart;
		assert.ok(workers.every((record) => record.exited && record.worker.threadId === -1));
		globalThis.gc?.(); collectMemory();
		return {
			schemaVersion: 1, runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, gcExposed: typeof globalThis.gc === "function" },
			backend: "manifold-3d@3.5.4", settings: { cycles, warmupJobs: workloads.length, maxPendingJobs: 2, timeoutMs: 5000, maxTriangles: 100000, busyMaxTriangles: 1000000, busyCancelFn: 800, busyAbortDelayMs: 75 }, workloads,
			startupMs, compile: summary(compileTimes), export: summary(exportTimes), phases: { resolve: summary(phaseTimes.map((times) => times.resolveMs)), evaluate: summary(phaseTimes.map((times) => times.evaluateMs)), geometry: summary(phaseTimes.map((times) => times.geometryMs)) },
			memory: { scope: "process RSS includes workers; JS heap/external/arrayBuffers are main-thread only", peakRssObserved: Math.max(memoryBefore.rss, ...memorySamples.map((sample) => sample.rss)), sampleIntervalMs: 10, before: memoryBefore, afterWarmup: memoryAfterWarmup, afterCycles: memoryAfterCycles, afterDispose: process.memoryUsage(), cycleRssDelta: memoryAfterCycles.rss - memoryAfterWarmup.rss, cycleHeapDelta: memoryAfterCycles.heapUsed - memoryAfterWarmup.heapUsed },
			lifecycle: { queueOverflowCode: overflow.diagnostics[0].code, queuedCancellationMs, resolverCancellationMs, resolverAbortToWorkerExitMs: sourceWorker.exitedAt - cancelStart, restartMs, busy: { ...busyReport, abortToWorkerExitMs: interrupted.status === "cancelled" ? busyWorker.exitedAt - busyAbortTime : null }, disposalMs, workersSpawned: workers.length, workersExited: workers.filter((record) => record.exited).length, pendingJobsSettled: settled.length, copiedMeshSurvived: true, extrusionBudgetCode: budgetRejected.diagnostics.at(-1).code },
			caveats: "Observed process samples are not a WASM heap meter or proof of leak freedom. Busy work may complete before abort on faster hosts. Resolver promises are host-owned; they were released after cancellation/disposal. No universal memory or timing guarantees.",
		};
	} finally { clearInterval(timer); clearTimeout(busyTimer); await engine?.dispose(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({ options: { cycles: { type: "string", default: "30" }, output: { type: "string" } } });
	const report = await measureResources({ cycles: Number(values.cycles) });
	const root = fileURLToPath(new URL("../", import.meta.url));
	const revision = await promisify(execFile)("git", ["-C", root, "rev-parse", "HEAD"]);
	const patch = await promisify(execFile)("git", ["-C", root, "diff", "HEAD", "--", "src"]);
	const sourceHash = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
	const serialized = JSON.stringify({ ...report, projectRevision: revision.stdout.trim(), implementationPatchSha256: createHash("sha256").update(patch.stdout).digest("hex"), implementationDirty: Boolean(patch.stdout), measurementScriptSha256: sourceHash }, null, 2) + "\n";
	if (values.output) await writeFile(path.resolve(values.output), serialized);
	console.log(serialized.trimEnd());
}