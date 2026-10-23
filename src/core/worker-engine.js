import { BACKEND, SERVICE_API_VERSION } from "./service.js";
import { CAPABILITIES } from "./evaluator.js";
import { ScadError } from "./parser.js";

export const WORKER_PROTOCOL_VERSION = 1;

function frozen(value) {
	if (value && typeof value === "object" && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
		Object.values(value).forEach(frozen);
		Object.freeze(value);
	}
	return value;
}

function copyMesh(mesh) {
	return { numProp: mesh.numProp, vertProperties: new Float32Array(mesh.vertProperties), triVerts: new Uint32Array(mesh.triVerts), ...(mesh.runIndex ? { runIndex: new Uint32Array(mesh.runIndex), runOriginalID: new Uint32Array(mesh.runOriginalID) } : {}) };
}

export async function createWorkerEngine({
	profile = CAPABILITIES.profile, workerUrl = new URL("./worker-entry.js", import.meta.url), workerFactory,
	manifoldModuleUrl = typeof Worker !== "undefined" ? new URL("../../node_modules/manifold-3d/manifold.js", import.meta.url) : undefined,
	wasmUrl, maxPendingJobs = 16, timeoutMs = 30_000, startupTimeoutMs = 30_000, onProgress,
} = {}) {
	if (profile !== CAPABILITIES.profile) throw new TypeError(`Unsupported profile '${profile}'`);
	for (const value of [maxPendingJobs, timeoutMs, startupTimeoutMs]) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Worker limits must be positive safe integers");
	const url = new URL(workerUrl, import.meta.url);
	const moduleUrl = manifoldModuleUrl ? new URL(manifoldModuleUrl, import.meta.url).href : undefined;
	const binaryUrl = wasmUrl ? new URL(wasmUrl, import.meta.url).href : undefined;
	const factory = workerFactory ?? (async (url) => {
		if (typeof Worker !== "undefined") {
			if (!moduleUrl) throw new TypeError("Browser workers require manifoldModuleUrl or a configured workerFactory");
			return new Worker(url, { type: "module" });
		}
		const { Worker: NodeWorker } = await import("node:worker_threads");
		return new NodeWorker(url, { execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")) });
	});
	let worker;
	let generation = 0;
	let startup;
	let abortStartup;
	let closed = false;
	let active;
	let nextId = 0;
	const queue = [];
	const handles = new WeakMap();
	const live = new Set();
	const terminations = new Set();
	const progress = (job, phase) => {
		try { onProgress?.(Object.freeze({ id: job?.id, operation: job?.operation, phase })); } catch {}
	};
	const failure = (job, code, message) => frozen({
		apiVersion: SERVICE_API_VERSION, id: job.id, status: ["cancelled", "superseded", "timeout"].includes(code) ? "cancelled" : "error",
		mode: job.request?.mode ?? "preview", profile, backend: BACKEND,
		diagnostics: [{ severity: "error", code, message }], echoes: [], dependencies: [],
		timings: { resolveMs: 0, evaluateMs: 0, geometryMs: 0, totalMs: performance.now() - job.started },
	});
	const finish = (job, value, error) => {
		if (job.settled) return;
		job.settled = true;
		clearTimeout(job.timer);
		if (job.cancel && typeof job.signal?.removeEventListener === "function") job.signal.removeEventListener("abort", job.cancel);
		job.readController.abort();
		const normalized = error && (error instanceof ScadError ? error : new ScadError(error.message ?? String(error), error.location, typeof error.code === "string" ? error.code : "worker-error"));
		if (job.operation === "compile") job.resolve(normalized ? failure(job, normalized.code, normalized.message) : value);
		else if (normalized) job.reject(normalized);
		else job.resolve(value);
		progress(job, "finished");
	};
	const invalidate = (code) => {
		for (const record of live) { record.invalid = code; record.mesh = null; record.overlays = null; }
		live.clear();
	};
	const stop = (reason = "worker-reset") => {
		generation++;
		const previous = worker;
		worker = undefined;
		startup = undefined;
		const abort = abortStartup; abortStartup = undefined;
		abort?.();
		invalidate(reason);
		if (previous) {
			try {
				const termination = Promise.resolve(previous.terminate()).catch(() => {});
				terminations.add(termination);
				void termination.then(() => terminations.delete(termination));
			} catch {}
		}
	};
	const failActive = (error) => {
		const job = active;
		active = undefined;
		stop();
		if (job) finish(job, undefined, error);
		void pump();
	};
	const send = (message) => worker.postMessage({ version: WORKER_PROTOCOL_VERSION, ...message });
	const read = async (message, current, epoch) => {
		const job = active;
		const resolver = message.kind === "font" ? job?.fontResolver : message.kind === "asset" ? job?.assetResolver : job?.resolver;
		if (!job || job.id !== message.id || !resolver) return;
		try {
			const source = await resolver(message.path, { signal: job.readController.signal });
			if (worker === current && generation === epoch && active === job && !job.settled) send({ type: "read-result", readId: message.readId, source });
		} catch (error) {
			if (worker === current && generation === epoch && active === job && !job.settled) send({ type: "read-result", readId: message.readId, error: { message: error.message ?? String(error), code: error.code ?? "resolver-error" } });
		}
	};
	const makeResult = (message, job) => {
		const metadata = frozen({ ...message.result, id: job.id });
		if (metadata.status !== "success") return metadata;
		if (metadata.auditOnly) return metadata;
		const record = { handle: message.handle, generation, mesh: message.mesh, overlays: message.overlays ?? [], invalid: null };
		const result = Object.freeze({ ...metadata,
			getMesh() { if (record.invalid) throw new ScadError("Worker result is no longer live", undefined, record.invalid); return copyMesh(record.mesh); },
			getOverlays() { if (record.invalid) throw new ScadError("Worker result is no longer live", undefined, record.invalid); return record.overlays.map((overlay) => ({ ...overlay, mesh: copyMesh(overlay.mesh) })); },
			dispose() {
				if (record.invalid) return;
				record.invalid = "disposed"; record.mesh = null; record.overlays = null; live.delete(record);
				if (worker && record.generation === generation) {
					try { send({ type: "release", handle: record.handle }); } catch {}
				}
			},
		});
		handles.set(result, record); live.add(record);
		return result;
	};
	const spawn = () => {
		if (startup) return startup;
		const epoch = ++generation;
		const initialization = (async () => {
			const current = await factory(url);
			if (closed || epoch !== generation) { await current.terminate(); throw new ScadError("Worker startup cancelled", undefined, "cancelled"); }
			worker = current;
			return new Promise((resolve, reject) => {
				let ready = false;
				const broken = (error) => {
					if (worker !== current || generation !== epoch) return;
					const failure = error instanceof Error ? error : new Error(error.message ?? "Worker failed");
					if (!ready) reject(failure);
					else failActive(new ScadError(failure.message, undefined, "worker-error"));
				};
				const receive = (message) => {
					if (worker !== current || generation !== epoch) return;
					if (!message || typeof message !== "object") { broken(new Error("Malformed worker response")); return; }
					if (message.version !== WORKER_PROTOCOL_VERSION) { broken(new Error("Worker protocol mismatch")); return; }
					if (message.type === "ready") {
						if (message.apiVersion !== SERVICE_API_VERSION || message.profile !== profile || message.backend !== BACKEND) { broken(new Error("Worker engine metadata mismatch")); return; }
						ready = true; resolve(); progress(undefined, "worker-ready"); return;
					}
					if (message.type === "fatal") { broken(new Error(message.error.message)); return; }
					if (message.type === "read") { void read(message, current, epoch); return; }
					const job = active;
					if (!job || job.id !== message.id || job.settled) return;
					if (message.type === "progress") { progress(job, message.phase); return; }
					try {
						if (message.type === "error") finish(job, undefined, new ScadError(message.error.message, message.error.location, message.error.code));
						else if (message.type === "compiled") finish(job, makeResult(message, job));
						else if (message.type === "exported") {
							if (job.record.invalid) finish(job, undefined, new ScadError("Worker result is no longer live", undefined, job.record.invalid));
							else finish(job, message.bytes);
						} else throw new Error(`Unknown worker response '${message.type}'`);
						active = undefined;
						void pump();
					} catch (error) { failActive(error); }
				};
				if (typeof current.addEventListener === "function") {
					current.addEventListener("message", (event) => receive(event.data));
					current.addEventListener("error", broken);
					current.addEventListener("messageerror", broken);
				} else {
					current.on("message", receive); current.on("error", broken);
					current.on("exit", (code) => broken(new Error(`Worker exited (${code})`)));
				}
				try { send({ type: "init", profile, manifoldModuleUrl: moduleUrl, wasmUrl: binaryUrl }); } catch (error) { broken(error); }
			});
		})();
		let timer;
		let cancelStartup;
		const deadline = new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new ScadError("Worker startup timed out", undefined, "timeout")), startupTimeoutMs);
			cancelStartup = () => reject(new ScadError("Worker startup cancelled", undefined, "cancelled"));
			abortStartup = cancelStartup;
		});
		startup = Promise.race([initialization, deadline]).finally(() => {
			clearTimeout(timer);
			if (abortStartup === cancelStartup) abortStartup = undefined;
		});
		return startup;
	};
	async function pump() {
		if (closed || active || !queue.length) return;
		const job = queue.shift();
		if (job.settled) { void pump(); return; }
		active = job;
		try {
			await spawn();
			if (active !== job || job.settled || closed) return;
			if (job.record?.invalid) throw new ScadError("Worker result is no longer live", undefined, job.record.invalid);
			job.timer = setTimeout(() => cancel(job, "timeout", "Worker job timed out"), timeoutMs);
			send(job.operation === "compile" ? { type: "compile", id: job.id, request: job.request, hasResolver: Boolean(job.resolver), hasAssetResolver: Boolean(job.assetResolver), hasFontResolver: Boolean(job.fontResolver) } : { type: "export", id: job.id, handle: job.record.handle, options: job.options });
		} catch (error) {
			if (active === job) { active = undefined; if (!job.record?.invalid) stop(); finish(job, undefined, error); void pump(); }
		}
	}
	function cancel(job, code = "cancelled", message = "Worker job cancelled") {
		if (job.settled) return;
		const index = queue.indexOf(job);
		if (index >= 0) queue.splice(index, 1);
		if (active === job) { active = undefined; stop(); }
		finish(job, undefined, new ScadError(message, undefined, code));
		void pump();
	}
	const enqueue = (operation, request, options, key) => new Promise((resolve, reject) => {
		const job = { id: ++nextId, operation, request, options, key, resolve, reject, started: performance.now(), readController: new AbortController() };
		try {
			if (closed) throw new ScadError("Engine is disposed", undefined, "disposed");
			if (queue.length + Number(Boolean(active)) >= maxPendingJobs) throw new ScadError("Worker queue limit exceeded", undefined, "resource-limit");
			if (operation === "compile") {
				if (!request || typeof request !== "object" || Array.isArray(request)) throw new TypeError("Compile request must be an object");
				job.signal = request.signal; job.resolver = request.resolver; job.assetResolver = request.assetResolver;
				job.fontResolver = request.fontResolver;
				if (job.resolver !== undefined && typeof job.resolver !== "function") throw new TypeError("resolver must be a function");
				if (job.assetResolver !== undefined && typeof job.assetResolver !== "function") throw new TypeError("assetResolver must be a function");
				if (job.fontResolver !== undefined && typeof job.fontResolver !== "function") throw new TypeError("fontResolver must be a function");
				const { signal, resolver, assetResolver, fontResolver, ...serializable } = request;
				job.request = structuredClone(serializable);
			} else {
				job.record = handles.get(request);
				if (!job.record || job.record.invalid) throw new ScadError("Expected a live result from this worker engine", undefined, "invalid-result");
				job.signal = options?.signal;
				const { signal, ...serializable } = options ?? {};
				job.options = structuredClone(serializable);
			}
			if (job.signal && (typeof job.signal.addEventListener !== "function" || typeof job.signal.removeEventListener !== "function")) throw new TypeError("signal must be an AbortSignal");
			if (job.signal?.aborted) throw new ScadError("Worker job cancelled", undefined, "cancelled");
			if (queue.length + Number(Boolean(active)) >= maxPendingJobs) throw new ScadError("Worker queue limit exceeded", undefined, "resource-limit");
			job.cancel = () => cancel(job);
			job.signal?.addEventListener("abort", job.cancel, { once: true });
			queue.push(job); progress(job, "queued"); void pump();
		} catch (error) { finish(job, undefined, error instanceof ScadError ? error : new ScadError(error.message, undefined, "invalid-request")); }
	});
	const engine = Object.freeze({
		apiVersion: SERVICE_API_VERSION, profile, backend: BACKEND, capabilities: CAPABILITIES,
		compile(request = {}) { return enqueue("compile", request); },
		compileLatest(request = {}, key = "default") {
			if (typeof key !== "string") throw new TypeError("Latest-job key must be a string");
			for (const job of [...queue, ...(active ? [active] : [])]) if (job.operation === "compile" && job.key === key) cancel(job, "superseded", "Superseded by a newer compilation");
			return enqueue("compile", request, undefined, key);
		},
		export(result, options) { return enqueue("export", result, options); },
		async dispose() {
			if (!closed) {
				closed = true;
				const jobs = [...queue, ...(active ? [active] : [])]; queue.length = 0; active = undefined;
				stop("disposed");
				for (const job of jobs) finish(job, undefined, new ScadError("Engine is disposed", undefined, "disposed"));
			}
			await Promise.all([...terminations]);
		},
	});
	try { await spawn(); return engine; }
	catch (error) { await engine.dispose(); throw error; }
}