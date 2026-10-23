import { CAPABILITIES, evaluate, randomCheckpoint } from "./evaluator.js";
import { compileGeometry } from "./compiler.js";
import { checkAbort, resolveProject } from "./project.js";
import { ScadError } from "./parser.js";
import { exportStl } from "../geometry/stl.js";
import { resolveAssets, resolveDataImport, resolveDxfData } from "./assets.js";
import { fontMetrics, textMetrics } from "../geometry/text.js";
import { createFontRegistry } from "./fonts.js";
import { loadRoofBackend } from "../geometry/roof.js";

export const SERVICE_API_VERSION = 1;
export const BACKEND = "manifold-3d@3.5.4";

function errorDiagnostic(error) {
	return Object.freeze({ severity: "error", code: error.code ?? "invalid-request", message: error.message, location: error.location });
}

function snapshotBindings(bindings = {}) {
	if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) throw new TypeError("Bindings must be an object");
	let count = 0;
	const copy = (value, depth = 0) => {
		if (++count > 100_000 || depth > 64) throw new ScadError("Binding value limit exceeded", undefined, "resource-limit");
		if (Array.isArray(value)) {
			if (value.length > 100_000 - count) throw new ScadError("Binding value limit exceeded", undefined, "resource-limit");
			return Array.from(value, (entry) => copy(entry, depth + 1));
		}
		if (value === undefined || ["number", "boolean", "string"].includes(typeof value)) return value;
		if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
			const result = Object.create(null);
			for (const [key, entry] of Object.entries(value)) result[key] = copy(entry, depth + 1);
			return result;
		}
		throw new TypeError("Bindings must contain SCAD scalar or vector values");
	};
	const result = Object.create(null);
	for (const [name, value] of Object.entries(bindings)) {
		if (!/^(?:[A-Za-z_$]|\d+[A-Za-z_$])[A-Za-z0-9_$]*$/.test(name) || /^\d+(?:[eE]\d+)?$/.test(name)) throw new TypeError(`Invalid binding name '${name}'`);
		result[name] = copy(value);
	}
	return result;
}

export async function createEngine({ module, loadModule, profile = CAPABILITIES.profile, maxPendingJobs = 16 } = {}) {
	if (profile !== CAPABILITIES.profile) throw new TypeError(`Unsupported profile '${profile}'`);
	if (!Number.isSafeInteger(maxPendingJobs) || maxPendingJobs < 1) throw new TypeError("maxPendingJobs must be a positive safe integer");
	if (!module) {
		const factory = loadModule ?? (async () => (await import("manifold-3d")).default());
		module = await factory();
		module.setup();
	}
	if (!module.Manifold || !module.Mesh) throw new TypeError("Expected an initialized Manifold module");
	let closed = false;
	let nextId = 0;
	const handles = new WeakMap();
	const live = new Set();
	const pending = new Set();
	const ensureOpen = () => { if (closed) throw new ScadError("Engine is disposed", undefined, "disposed"); };
	const engine = {
		apiVersion: SERVICE_API_VERSION, profile, backend: BACKEND, capabilities: CAPABILITIES,
		async compile(request = {}) {
			const id = ++nextId;
			const started = performance.now();
			const timings = { resolveMs: 0, evaluateMs: 0, geometryMs: 0, totalMs: 0 };
			let project;
			let evaluation;
			let compiled;
			const mode = request?.mode ?? "preview";
			const controller = new AbortController();
			const cancel = () => controller.abort();
			let subscribed = false;
			try {
				ensureOpen();
				if (!request || typeof request !== "object" || Array.isArray(request)) throw new TypeError("Compile request must be an object");
				checkAbort(request.signal);
				if (request.signal && (typeof request.signal.addEventListener !== "function" || typeof request.signal.removeEventListener !== "function")) throw new TypeError("signal must be an AbortSignal");
				if (pending.size >= maxPendingJobs) throw new ScadError("Pending compilation limit exceeded", undefined, "resource-limit");
				request.signal?.addEventListener("abort", cancel, { once: true });
				subscribed = Boolean(request.signal);
				pending.add(controller);
				const time = request.context?.time ?? request.time ?? 0;
				if (typeof time !== "number" || !Number.isFinite(time)) throw new TypeError("Context time must be finite");
				if (request.defineExpressions !== undefined && (!Array.isArray(request.defineExpressions) || request.defineExpressions.length > 128 || request.defineExpressions.some((value) => typeof value !== "string"))) throw new TypeError("defineExpressions must be a bounded string array");
				if (request.auditComponents !== undefined && typeof request.auditComponents !== "boolean") throw new TypeError("auditComponents must be a boolean");
				if (request.auditOnly !== undefined && typeof request.auditOnly !== "boolean") throw new TypeError("auditOnly must be a boolean");
				if (request.auditOnly && !request.auditComponents) throw new TypeError("auditOnly requires auditComponents=true");
				if (request.maxAuditComponents !== undefined && (!Number.isSafeInteger(request.maxAuditComponents) || request.maxAuditComponents < 2 || request.maxAuditComponents > 64)) throw new TypeError("maxAuditComponents must be an integer from 2 to 64");
				if (request.auditClearance !== undefined && (!Number.isFinite(request.auditClearance) || request.auditClearance < 0 || request.auditClearance > 100)) throw new TypeError("auditClearance must be a finite distance from 0 to 100");
				if (request.interferenceEpsilon !== undefined && (!Number.isFinite(request.interferenceEpsilon) || request.interferenceEpsilon < 0)) throw new TypeError("interferenceEpsilon must be a nonnegative finite volume");
				const viewport = snapshotBindings(request.context?.viewport);
				if (Object.keys(viewport).some((name) => !["$vpr", "$vpt", "$vpd", "$vpf"].includes(name))) throw new TypeError("Viewport context accepts only $vp* bindings");
				const job = { ...request, mode, time, fonts: structuredClone(request.fonts ?? {}), assets: structuredClone(request.assets ?? {}), experimental: [...(request.experimental ?? [])], defineExpressions: [...(request.defineExpressions ?? [])], defines: snapshotBindings(request.defines), specialVariables: { ...viewport, ...snapshotBindings(request.specialVariables) }, signal: controller.signal };
				const fontRegistry = createFontRegistry(job);
				if (!["preview", "render"].includes(mode)) throw new TypeError("mode must be preview or render");
				if (request.profile !== undefined && request.profile !== profile) throw new TypeError("Request profile differs from engine profile");
				let phase = performance.now();
				project = await resolveProject(job);
				timings.resolveMs = performance.now() - phase;
				checkAbort(job.signal); ensureOpen();
				phase = performance.now();
				const importedData = new Map();
				const dxfData = new Map();
				let importedDataBytes = 0;
				let dxfDataBytes = 0;
				const importedDependencies = [];
				for (let imports = 0; ;) {
					const restoreRandom = randomCheckpoint();
					try {
						evaluation = evaluate(project.statements, { ...job, importedData, dxfData, measureTextMetrics: (args) => textMetrics(args, fontRegistry.get(args.font)), measureFontMetrics: (args) => fontMetrics(args, fontRegistry.get(args.font)) });
						break;
					} catch (error) {
						if (error.code === "unresolved-font" && error.fontRequest !== undefined) {
							restoreRandom();
							await fontRegistry.load(error.fontRequest, error.location);
							continue;
						}
						if (imports++ >= 128) throw new ScadError("Data import count limit exceeded", error.location, "resource-limit");
						if (error.code === "unresolved-data-import") {
							const resolved = await resolveDataImport(error.importRequest.path, { ...job, importLocation: error.location });
							importedDataBytes += resolved.byteLength;
							const limit = job.maxAssetBytes ?? 20_000_000;
							if (importedDataBytes + dxfDataBytes > limit) throw new ScadError("Imported data byte limit exceeded", error.location, "resource-limit");
							importedData.set(error.importRequest.path, resolved);
							if (!resolved.missing) importedDependencies.push(error.importRequest.path);
						} else if (error.code === "unresolved-dxf-file") {
							const resolved = await resolveDxfData(error.dxfRequest.path, { ...job, importLocation: error.location });
							dxfDataBytes += resolved.byteLength;
							const limit = job.maxAssetBytes ?? 20_000_000;
							if (importedDataBytes + dxfDataBytes > limit) throw new ScadError("Imported data byte limit exceeded", error.location, "resource-limit");
							dxfData.set(error.dxfRequest.path, resolved);
							if (!resolved.missing) importedDependencies.push(error.dxfRequest.path);
						} else throw error;
					}
				}
				timings.evaluateMs = performance.now() - phase;
				const imported = await resolveAssets(evaluation, { ...job, initialAssetBytes: importedDataBytes + dxfDataBytes });
				project = { ...project, dependencies: Object.freeze([...project.dependencies, ...importedDependencies, ...imported.dependencies]) };
				checkAbort(job.signal);
				phase = performance.now();
				const textFaces = new Map();
				const collectTextFaces = (node) => {
					if (node.kind === "primitive" && node.name === "text") {
						if (!textFaces.has(node.args.font)) textFaces.set(node.args.font, node.location);
					}
					node.children.forEach(collectTextFaces);
				};
				collectTextFaces(evaluation.tree);
				for (const [name, location] of textFaces) await fontRegistry.load(name, location);
				const needsRoof = (node) => (node.kind === "roof" && node.args.method !== "straight") || node.children.some(needsRoof);
				const roofBackend = needsRoof(evaluation.tree) ? await loadRoofBackend() : undefined;
				checkAbort(job.signal); ensureOpen();
				compiled = compileGeometry(evaluation, module, { ...job, assets: imported.loaded, fonts: fontRegistry.loaded, roofBackend });
				timings.geometryMs = performance.now() - phase;
				checkAbort(job.signal); ensureOpen();
				if (job.hardWarnings && compiled.diagnostics.some((diagnostic) => diagnostic.severity === "warning")) throw new ScadError("Warnings promoted to compilation failure", undefined, "hard-warning");
				timings.totalMs = performance.now() - started;
				const empty = compiled.solid.isEmpty();
				const box = empty ? null : compiled.solid.boundingBox();
				const metadata = {
					apiVersion: SERVICE_API_VERSION, id, status: "success", mode, profile, backend: BACKEND, auditOnly: job.auditOnly === true,
					diagnostics: Object.freeze(compiled.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))),
					echoes: evaluation.echoes, dependencies: project.dependencies,
					timings: Object.freeze(timings), tree: evaluation.tree, layers: Object.freeze({ background: Object.freeze([...compiled.layers.background]), debug: Object.freeze([...compiled.layers.debug]) }),
					bounds: box ? Object.freeze([Object.freeze([...box.min]), Object.freeze([...box.max])]) : null,
					volume: compiled.solid.volume(), empty,
					materials: Object.freeze(compiled.materials),
					componentAudit: compiled.componentAudit,
					view: evaluation.view,
				};
				const record = { compiled, disposed: false };
				const result = Object.freeze({ ...metadata,
					getMesh() {
						if (record.disposed) throw new ScadError("Result is disposed", undefined, "disposed");
						const mesh = compiled.getMesh();
						return { numProp: mesh.numProp, vertProperties: new Float32Array(mesh.vertProperties), triVerts: new Uint32Array(mesh.triVerts), runIndex: new Uint32Array(mesh.runIndex), runOriginalID: new Uint32Array(mesh.runOriginalID) };
					},
					getOverlays() {
						if (record.disposed) throw new ScadError("Result is disposed", undefined, "disposed");
						return compiled.overlays.map((overlay) => ({ ...overlay, mesh: { numProp: overlay.mesh.numProp, vertProperties: new Float32Array(overlay.mesh.vertProperties), triVerts: new Uint32Array(overlay.mesh.triVerts) } }));
					},
					dispose() { if (!record.disposed) { record.compiled.dispose(); record.disposed = true; live.delete(record); } },
				});
				handles.set(result, record);
				live.add(record);
				return result;
			} catch (error) {
				compiled?.dispose();
				timings.totalMs = performance.now() - started;
				return Object.freeze({
					apiVersion: SERVICE_API_VERSION, id, status: error.code === "cancelled" ? "cancelled" : "error", mode, profile, backend: BACKEND,
					diagnostics: Object.freeze([...(compiled?.diagnostics ?? evaluation?.diagnostics ?? []), errorDiagnostic(error)]), echoes: evaluation?.echoes ?? Object.freeze([]),
					dependencies: project?.dependencies ?? error.dependencies ?? Object.freeze([]), timings: Object.freeze(timings),
				});
			} finally {
				if (subscribed) request.signal.removeEventListener("abort", cancel);
				pending.delete(controller);
			}
		},
		async export(result, { format = "stl", encoding = "binary", allowEmpty = false, signal } = {}) {
			ensureOpen(); checkAbort(signal);
			const record = handles.get(result);
			if (!record || record.disposed) throw new ScadError("Expected a live successful result from this engine", undefined, "invalid-result");
			if (result.mode !== "render") throw new ScadError("STL export requires a render-mode result", undefined, "invalid-mode");
			if (format !== "stl") throw new ScadError(`Unsupported export format '${format}'`, undefined, "unsupported-format");
			if (!["ascii", "binary"].includes(encoding)) throw new ScadError("STL encoding must be binary or ascii", undefined, "invalid-encoding");
			if (typeof allowEmpty !== "boolean") throw new ScadError("allowEmpty must be a boolean", undefined, "invalid-arguments");
			if (result.empty && !allowEmpty) throw new ScadError("Cannot export empty geometry without allowEmpty=true", undefined, "empty-geometry");
			try {
				const bytes = exportStl(result.getMesh(), { encoding, allowEmpty, omitDegenerate: true });
				checkAbort(signal);
				return bytes;
			} catch (error) {
				if (error instanceof ScadError) throw error;
				throw new ScadError(error.message, undefined, "export-error");
			}
		},
		dispose() {
			if (closed) return;
			closed = true;
			for (const controller of pending) controller.abort();
			for (const record of live) { record.compiled.dispose(); record.disposed = true; }
			live.clear();
		},
	};
	return Object.freeze(engine);
}