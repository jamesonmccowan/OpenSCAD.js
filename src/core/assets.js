import { awaitWithAbort, checkAbort, normalizePath } from "./project.js";
import { ScadError } from "./parser.js";

export async function resolveAssets(evaluation, request) {
	const input = request.assets instanceof Map ? new Map(request.assets) : new Map(Object.entries(request.assets ?? {}));
	const loaded = new Map();
	const dependencies = [];
	let total = request.initialAssetBytes ?? 0;
	const limit = request.maxAssetBytes ?? 20_000_000;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("maxAssetBytes must be a positive safe integer");
	if (!Number.isSafeInteger(total) || total < 0 || total > limit) throw new ScadError("Geometry asset byte limit exceeded", undefined, "resource-limit");
	const visit = async (node) => {
		checkAbort(request.signal);
		if (evaluation.mode === "render" && node.kind === "modifier" && node.modifiers.includes("%")) return;
		if (node.kind === "primitive" && node.name === "import") {
			try {
				if (typeof node.args.file !== "string") throw new TypeError("import requires a file path");
				const directory = node.location.file.split("/").slice(0, -1).join("/");
				const path = normalizePath(node.args.file, directory);
				if (!/\.stl$/i.test(path)) throw new ScadError("Only STL imports are supported", node.location, "unsupported-feature");
				if (!loaded.has(path)) {
					const asset = input.has(path) ? input.get(path) : request.assetResolver ? await awaitWithAbort(request.assetResolver(path, { signal: request.signal }), request.signal) : undefined;
					if (asset === undefined) throw new ScadError(`Missing geometry asset '${path}'`, node.location, "missing-asset");
					const bytes = typeof asset === "string" ? new TextEncoder().encode(asset) : asset instanceof ArrayBuffer ? new Uint8Array(asset) : asset;
					if (!(bytes instanceof Uint8Array)) throw new TypeError("Asset resolver must return text or bytes");
					total += bytes.byteLength;
					if (total > limit) throw new ScadError("Geometry asset byte limit exceeded", node.location, "resource-limit");
					loaded.set(path, new Uint8Array(bytes)); dependencies.push(path);
				}
			} catch (error) { error.location ??= node.location; throw error; }
		}
		for (const child of node.children) await visit(child);
	};
	await visit(evaluation.tree);
	return { loaded, dependencies };
}

export async function resolveDataImport(path, request) {
	const find = (source) => source instanceof Map ? source.get(path) : source?.[path];
	let asset = find(request.assets) ?? find(request.files);
	if (asset === undefined && request.assetResolver) asset = await awaitWithAbort(request.assetResolver(path, { signal: request.signal }), request.signal);
	if (asset === undefined && request.resolver) asset = await awaitWithAbort(request.resolver(path, { signal: request.signal }), request.signal);
	checkAbort(request.signal);
	if (asset === undefined) return { value: undefined, warning: `Could not read JSON data file '${path}'`, byteLength: 0, missing: true };
	const bytes = typeof asset === "string" ? new TextEncoder().encode(asset) : asset instanceof ArrayBuffer ? new Uint8Array(asset) : asset;
	if (!(bytes instanceof Uint8Array)) throw new TypeError("JSON data resolver must return text or bytes");
	const limit = request.maxAssetBytes ?? 20_000_000;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("maxAssetBytes must be a positive safe integer");
	if (bytes.byteLength > limit) throw new ScadError("Imported JSON byte limit exceeded", request.importLocation, "resource-limit");
	let value;
	let warning;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		warning = `Failed to parse JSON data file '${path}': ${error.message}`;
	}
	const normalize = (entry) => {
		if (entry === null) return undefined;
		if (Array.isArray(entry)) return entry.map(normalize);
		if (entry && typeof entry === "object") return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
		return entry;
	};
	return { value: normalize(value), warning, byteLength: bytes.byteLength };
}

export async function resolveDxfData(path, request) {
	const find = (source) => source instanceof Map ? source.get(path) : source?.[path];
	let asset = find(request.assets) ?? find(request.files);
	if (asset === undefined && request.assetResolver) asset = await awaitWithAbort(request.assetResolver(path, { signal: request.signal }), request.signal);
	if (asset === undefined && request.resolver) asset = await awaitWithAbort(request.resolver(path, { signal: request.signal }), request.signal);
	checkAbort(request.signal);
	if (asset === undefined) return { text: undefined, warning: `Can't open DXF file '${path}'`, byteLength: 0, missing: true };
	const bytes = typeof asset === "string" ? new TextEncoder().encode(asset) : asset instanceof ArrayBuffer ? new Uint8Array(asset) : asset;
	if (!(bytes instanceof Uint8Array)) throw new TypeError("DXF resolver must return text or bytes");
	const limit = request.maxAssetBytes ?? 20_000_000;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("maxAssetBytes must be a positive safe integer");
	if (bytes.byteLength > limit) throw new ScadError("Imported DXF byte limit exceeded", request.importLocation, "resource-limit");
	let text;
	try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
	catch { throw new ScadError(`DXF file '${path}' is not valid UTF-8 text`, request.importLocation, "invalid-dxf"); }
	return { text, byteLength: bytes.byteLength };
}