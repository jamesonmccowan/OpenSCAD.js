import { createEngine } from "./service.js";

const protocol = 1;
const browser = typeof self !== "undefined" && typeof self.postMessage === "function";
const port = browser ? self : (await import("node:worker_threads")).parentPort;
if (!port) throw new Error("Worker entry must run inside a worker");
const send = (message, transfer = []) => port.postMessage({ version: protocol, ...message }, transfer);
let engine;
const results = new Map();
const reads = new Map();
let nextRead = 0;

function serializedError(error) {
	return { message: error.message ?? String(error), code: error.code ?? "worker-error", location: error.location };
}

async function receive(message) {
	if (message.version !== protocol) throw new Error("Unsupported worker protocol");
	if (message.type === "init") {
		const options = { profile: message.profile };
		if (message.manifoldModuleUrl) options.loadModule = async () => {
			const factory = (await import(message.manifoldModuleUrl)).default;
			return factory({ locateFile: (file) => file.endsWith(".wasm") && message.wasmUrl ? message.wasmUrl : new URL(file, message.manifoldModuleUrl).href });
		};
		engine = await createEngine(options);
		send({ type: "ready", apiVersion: engine.apiVersion, profile: engine.profile, backend: engine.backend });
		return;
	}
	if (message.type === "read-result") {
		const pending = reads.get(message.readId);
		if (pending) {
			reads.delete(message.readId);
			if (message.error) pending.reject(Object.assign(new Error(message.error.message), message.error));
			else pending.resolve(message.source);
		}
		return;
	}
	if (!engine) throw new Error("Worker is not initialized");
	if (message.type === "release") {
		results.get(message.handle)?.dispose();
		results.delete(message.handle);
		return;
	}
	send({ type: "progress", id: message.id, phase: "started" });
	if (message.type === "compile") {
		const request = message.request;
		const resolver = (kind) => (path) => new Promise((resolve, reject) => {
			const readId = ++nextRead;
			reads.set(readId, { resolve, reject });
			send({ type: "read", id: message.id, readId, path, kind });
		});
		if (message.hasResolver) request.resolver = resolver("source");
		if (message.hasAssetResolver) request.assetResolver = resolver("asset");
		if (message.hasFontResolver) request.fontResolver = resolver("font");
		const result = await engine.compile(request);
		if (result.status !== "success") { send({ type: "compiled", id: message.id, result }); return; }
		if (request.auditOnly) {
			const { getMesh, getOverlays, dispose, ...metadata } = result;
			result.dispose();
			send({ type: "compiled", id: message.id, result: metadata });
			return;
		}
		try {
			const mesh = result.getMesh();
			const overlays = result.getOverlays();
			const { getMesh, getOverlays, dispose, ...metadata } = result;
			results.set(result.id, result);
			const transfer = [mesh.vertProperties.buffer, mesh.triVerts.buffer, mesh.runIndex.buffer, mesh.runOriginalID.buffer, ...overlays.flatMap((overlay) => [overlay.mesh.vertProperties.buffer, overlay.mesh.triVerts.buffer])];
			send({ type: "compiled", id: message.id, result: metadata, handle: result.id, mesh, overlays }, transfer);
		} catch (error) {
			results.delete(result.id);
			result.dispose();
			throw error;
		}
	} else if (message.type === "export") {
		const bytes = await engine.export(results.get(message.handle), message.options);
		send({ type: "exported", id: message.id, bytes }, [bytes.buffer]);
	} else throw new Error(`Unknown worker request '${message.type}'`);
}

const handler = (message) => receive(message).catch((error) => send({ type: message.type === "init" ? "fatal" : "error", id: message.id, error: serializedError(error) }));
if (browser) port.addEventListener("message", (event) => handler(event.data));
else port.on("message", handler);