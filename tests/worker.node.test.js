import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWorkerEngine } from "../src/index.js";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";
import { malformedBoundaryCases, validBindingBoundaries } from "./fixtures/boundary-cases.js";
import { measureResources } from "../scripts/measure-resources.js";

test("worker engine compiles virtual projects and exports transferred STL", async () => {
	const engine = await createWorkerEngine();
	try {
		const result = await engine.compile({ mode: "render", files: { "main.scad": "use <shape.scad> shape();", "shape.scad": "module shape() { cube(2); }" } });
		assert.equal(result.status, "success");
		assert.equal(result.volume, 8);
		assert.deepEqual(result.dependencies, ["main.scad", "shape.scad"]);
		const bytes = await engine.export(result);
		assert.ok(Math.abs(measureMesh(decodeBinaryStl(bytes)).volume - 8) < 1e-9);
		const mesh = result.getMesh(); mesh.vertProperties.fill(0);
		assert.equal(result.getMesh().vertProperties.some((value) => value === 2), true);
		result.dispose(); result.dispose();
		assert.throws(() => result.getMesh(), /no longer live/);
		await assert.rejects(engine.export(result), /live result/);
	} finally { await engine.dispose(); }
});

test("host source resolvers are bridged without sending functions to the worker", async () => {
	const engine = await createWorkerEngine();
	try {
		const paths = [];
		const result = await engine.compile({ mode: "render", resolver: async (path) => {
			paths.push(path);
			return path === "main.scad" ? "cube(3);" : undefined;
		} });
		assert.equal(result.status, "success"); assert.equal(result.volume, 27);
		assert.deepEqual(paths, ["main.scad"]);
	} finally { await engine.dispose(); }
});

test("bounded queue and queued cancellation preserve the active worker result", async () => {
	const engine = await createWorkerEngine({ maxPendingJobs: 2 });
	let started;
	const ready = new Promise((resolve) => { started = resolve; });
	let finish;
	try {
		const first = engine.compile({ mode: "render", resolver: () => { started(); return new Promise((resolve) => { finish = resolve; }); } });
		await ready;
		const controller = new AbortController();
		const queued = engine.compile({ signal: controller.signal, files: { "main.scad": "cube(2);" } });
		const overflow = await engine.compile({ files: { "main.scad": "cube();" } });
		assert.equal(overflow.diagnostics[0].code, "resource-limit");
		controller.abort();
		assert.equal((await queued).status, "cancelled");
		finish("cube(3);");
		const result = await first;
		assert.equal(result.volume, 27);
		assert.ok((await engine.export(result)).length > 84);
	} finally { await engine.dispose(); }
});

test("full worker queues reject before copying request payloads", async () => {
	const engine = await createWorkerEngine({ maxPendingJobs: 1 });
	let ready, finish;
	const started = new Promise((resolve) => { ready = resolve; });
	try {
		const active = engine.compile({ resolver: () => { ready(); return new Promise((resolve) => { finish = resolve; }); } });
		await started;
		let reads = 0;
		const files = Object.create(null);
		Object.defineProperty(files, "main.scad", { enumerable: true, get() { reads++; return "cube(100);"; } });
		const rejected = await engine.compile({ files });
		assert.equal(rejected.diagnostics[0].code, "resource-limit"); assert.equal(reads, 0);
		finish("cube(2);");
		const result = await active; assert.equal(result.status, "success"); assert.equal(result.volume, 8); result.dispose();
	} finally { await engine.dispose(); }
});

test("latest compilation supersedes an active read and ignores late resolver replies", async () => {
	const engine = await createWorkerEngine();
	let started;
	const ready = new Promise((resolve) => { started = resolve; });
	let finish;
	let hostSignal;
	try {
		const first = engine.compileLatest({ resolver: (path, { signal }) => { hostSignal = signal; started(); return new Promise((resolve) => { finish = resolve; }); } });
		await ready;
		const latest = engine.compileLatest({ mode: "render", files: { "main.scad": "cube(2);" } });
		const old = await first;
		assert.equal(old.status, "cancelled");
		assert.equal(old.diagnostics[0].code, "superseded");
		assert.equal(hostSignal.aborted, true);
		finish("cube(100);");
		const current = await latest;
		assert.equal(current.status, "success"); assert.equal(current.volume, 8);
		assert.ok((await engine.export(current)).length > 84);
	} finally { await engine.dispose(); }
});

test("busy compilation is off-thread, cancellable and replaceable", async () => {
	const controller = new AbortController();
	let heavy;
	let ticks = 0;
	const timer = setInterval(() => ticks++, 5);
	const engine = await createWorkerEngine({ onProgress: (event) => {
		if (event.phase === "started" && heavy) setTimeout(() => controller.abort(), 75);
	} });
	try {
		const previous = await engine.compile({ mode: "render", files: { "main.scad": "cube(2);" } });
		const borrowedMesh = previous.getMesh();
		heavy = true;
		const start = performance.now();
		const result = await engine.compile({ signal: controller.signal, files: { "main.scad": "sphere(r=10,$fn=800);" } });
		heavy = false;
		assert.equal(result.status, "cancelled");
		assert.ok(performance.now() - start < 2000);
		assert.ok(ticks > 5);
		assert.throws(() => previous.getMesh(), (error) => error.code === "worker-reset");
		assert.ok(borrowedMesh.triVerts.length > 0);
		const replacement = await engine.compile({ mode: "render", files: { "main.scad": "cube(3);" } });
		assert.equal(replacement.volume, 27);
	} finally { clearInterval(timer); await engine.dispose(); }
});

test("worker crash settles active work and the next request restarts", async () => {
	const workers = [];
	const engine = await createWorkerEngine({ workerFactory: (url) => {
		const worker = new Worker(url); workers.push(worker); return worker;
	} });
	let started;
	const ready = new Promise((resolve) => { started = resolve; });
	try {
		const pending = engine.compile({ resolver: () => { started(); return new Promise(() => {}); } });
		await ready;
		await workers[0].terminate();
		assert.equal((await pending).diagnostics[0].code, "worker-error");
		const next = await engine.compile({ files: { "main.scad": "cube(2);" } });
		assert.equal(next.volume, 8); assert.equal(workers.length, 2);
	} finally { await engine.dispose(); }
});

test("job timeout and startup failure are bounded", async () => {
	await assert.rejects(createWorkerEngine({ workerFactory: () => new Promise(() => {}), startupTimeoutMs: 30 }), /startup timed out/);
	const engine = await createWorkerEngine({ timeoutMs: 30 });
	try {
		const result = await engine.compile({ resolver: () => new Promise(() => {}) });
		assert.equal(result.status, "cancelled"); assert.equal(result.diagnostics[0].code, "timeout");
		const next = await engine.compile({ files: { "main.scad": "cube();" } });
		assert.equal(next.status, "success");
	} finally { await engine.dispose(); }
});

test("ownership, preview export, invalid requests and disposal are explicit", async () => {
	const engine = await createWorkerEngine();
	const other = await createWorkerEngine();
	try {
		const preview = await engine.compile({ files: { "main.scad": "cube(2);" } });
		await assert.rejects(engine.export(preview), (error) => error.code === "invalid-mode");
		await assert.rejects(other.export(preview), (error) => error.code === "invalid-result");
		assert.equal((await engine.compile({ signal: {} })).status, "error");
		assert.equal((await engine.compile({ defines: { value: () => 1 } })).diagnostics[0].code, "invalid-request");
		assert.equal((await engine.compile({ files: { "main.scad": "cube(" } })).status, "error");
		await engine.dispose();
		assert.equal((await engine.compile()).diagnostics[0].code, "disposed");
		assert.throws(() => preview.getMesh(), /no longer live/);
	} finally { await engine.dispose(); await other.dispose(); }
});

test("export work is cancellable and replacement does not silently recompile old results", async () => {
	const controller = new AbortController();
	const engine = await createWorkerEngine({ onProgress: (event) => {
		if (event.operation === "export" && event.phase === "started") controller.abort();
	} });
	try {
		const result = await engine.compile({ mode: "render", files: { "main.scad": "sphere(r=5,$fn=64);" } });
		await assert.rejects(engine.export(result, { signal: controller.signal }), (error) => error.code === "cancelled");
		await assert.rejects(engine.export(result), (error) => error.code === "invalid-result");
		const next = await engine.compile({ files: { "main.scad": "cube(2);" } });
		assert.equal(next.volume, 8);
	} finally { await engine.dispose(); }
});

test("disposing a queued export result does not reset unrelated live results", async () => {
	const engine = await createWorkerEngine();
	try {
		const preserved = await engine.compile({ mode: "render", files: { "main.scad": "cube(3);" } });
		const discarded = await engine.compile({ mode: "render", files: { "main.scad": "cube(2);" } });
		let started;
		const ready = new Promise((resolve) => { started = resolve; });
		let finish;
		const blocker = engine.compile({ resolver: () => { started(); return new Promise((resolve) => { finish = resolve; }); } });
		await ready;
		const pendingExport = engine.export(discarded);
		const rejected = assert.rejects(pendingExport, (error) => error.code === "disposed");
		discarded.dispose();
		finish("cube();");
		assert.equal((await blocker).status, "success");
		await rejected;
		assert.ok((await engine.export(preserved)).length > 84);
	} finally { await engine.dispose(); }
});

test("deterministic malformed and boundary cases preserve worker handles", async () => {
	const engine = await createWorkerEngine();
	try {
		const preserved = await engine.compile({ mode: "render", files: { "main.scad": "cube(3);" } });
		assert.equal(preserved.status, "success");
		for (const fixture of malformedBoundaryCases()) {
			const result = await engine.compile(fixture.request);
			assert.equal(result.status, "error", fixture.name);
			const diagnostic = result.diagnostics.at(-1);
			assert.equal(diagnostic.code, fixture.code, fixture.name);
			if (fixture.located) assert.equal(diagnostic.location?.file, "main.scad", fixture.name);
			await assert.rejects(engine.export(result), /live result/, fixture.name);
			const recovery = await engine.compile({ files: { "main.scad": "cube(2);" } });
			assert.equal(recovery.status, "success", fixture.name); assert.equal(recovery.volume, 8); recovery.dispose();
		}
		for (const fixture of validBindingBoundaries()) {
			const result = await engine.compile({ defines: fixture.defines, files: { "main.scad": fixture.source } });
			assert.equal(result.status, "success", `${fixture.name}: ${JSON.stringify(result.diagnostics)}`);
			assert.deepEqual(result.echoes, [fixture.echo], fixture.name); result.dispose();
		}
		assert.ok(Math.abs(measureMesh(decodeBinaryStl(await engine.export(preserved))).volume - 27) < 1e-9); preserved.dispose();
	} finally { await engine.dispose(); }
});

test("resource measurement settles pending jobs and observes worker exits", async () => {
	const report = await measureResources({ cycles: 6 });
	assert.equal(report.compile.samples, 6); assert.equal(report.export.samples, 6);
	assert.equal(report.lifecycle.queueOverflowCode, "resource-limit");
	assert.equal(report.lifecycle.extrusionBudgetCode, "resource-limit");
	assert.equal(report.lifecycle.workersSpawned, report.lifecycle.workersExited);
	assert.equal(report.lifecycle.pendingJobsSettled, 2);
	assert.equal(report.lifecycle.copiedMeshSurvived, true);
	assert.ok(report.lifecycle.resolverAbortToWorkerExitMs >= 0);
	if (report.lifecycle.busy.status === "cancelled") assert.ok(report.lifecycle.busy.abortToWorkerExitMs >= 0);
	assert.ok(["cancelled", "success"].includes(report.lifecycle.busy.status));
	assert.ok(report.memory.peakRssObserved > 0);
});

test("default Node worker can initialize from inline ESM scripts", async () => {
	const entry = new URL("../src/index.js", import.meta.url).href;
	const source = `import {createWorkerEngine} from ${JSON.stringify(entry)}; const engine=await createWorkerEngine(); try { console.log((await engine.compile({files:{"main.scad":"cube(2);"}})).volume); } finally { await engine.dispose(); }`;
	const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", source], { timeout: 5000 });
	assert.equal(result.stdout.trim(), "8");
});