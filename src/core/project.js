import { parse, ScadError } from "./parser.js";

export function checkAbort(signal) {
	if (signal?.aborted) throw new ScadError("Compilation cancelled", undefined, "cancelled");
}

export function awaitWithAbort(promise, signal) {
	checkAbort(signal);
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const cancel = () => reject(new ScadError("Compilation cancelled", undefined, "cancelled"));
		signal.addEventListener("abort", cancel, { once: true });
		Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
	});
}

export function normalizePath(path, base = "") {
	if (typeof path !== "string" || !path || /[\\\x00-\x1f]/.test(path) || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) throw new ScadError(`Disallowed project path '${path}'`, undefined, "restricted-path");
	const parts = [];
	for (const part of `${base}/${path}`.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (!parts.length) throw new ScadError(`Path escapes project root: '${path}'`, undefined, "restricted-path");
			parts.pop();
		} else parts.push(part);
	}
	if (!parts.length) throw new ScadError("Expected a project file path", undefined, "restricted-path");
	return parts.join("/");
}

export async function resolveProject({ entry = "main.scad", files = {}, libraryPaths = [], resolver, signal, maxFiles = 128, maxIncludeDepth = 64, maxProjectBytes = 5_000_000, maxStatements = 100_000 } = {}) {
	if (![maxFiles, maxIncludeDepth, maxProjectBytes, maxStatements].every((value) => Number.isSafeInteger(value) && value > 0)) throw new TypeError("Project limits must be positive safe integers");
	if (resolver !== undefined && typeof resolver !== "function") throw new TypeError("resolver must be a function");
	const inputs = files instanceof Map ? [...files] : Object.entries(files);
	const sources = new Map();
	for (const [path, content] of inputs) {
		const normalized = normalizePath(path);
		if (sources.has(normalized)) throw new ScadError(`Duplicate normalized file '${normalized}'`, undefined, "duplicate-file");
		if (typeof content !== "string") throw new TypeError(`Source '${normalized}' must be a string`);
		sources.set(normalized, content);
	}
	const roots = libraryPaths.map((path) => normalizePath(path));
	const parsed = new Map();
	const dependencies = [];
	let bytes = 0;
	let statementCount = 0;
	const read = async (path) => {
		checkAbort(signal);
		if (sources.has(path)) return sources.get(path);
		const content = resolver ? await awaitWithAbort(resolver(path, { signal }), signal) : undefined;
		checkAbort(signal);
		if (content !== undefined && typeof content !== "string") throw new TypeError(`Resolver returned non-text source for '${path}'`);
		if (content !== undefined) sources.set(path, content);
		return content;
	};
	const locate = async (request, from, location) => {
		const directory = from.split("/").slice(0, -1).join("/");
		let relative;
		try { relative = normalizePath(request, directory); }
		catch (error) { error.location = location; throw error; }
		if (await read(relative) !== undefined) return relative;
		for (const root of roots) {
			let candidate;
			try { candidate = normalizePath(request, root); }
			catch (error) { if (error.code === "restricted-path") continue; throw error; }
			if (candidate !== relative && await read(candidate) !== undefined) return candidate;
		}
		throw new ScadError(`Cannot resolve '${request}' from '${from}'`, location, "missing-file");
	};
	const load = async (path, stack = [], location) => {
		checkAbort(signal);
		if (stack.includes(path)) throw new ScadError(`File dependency cycle: ${[...stack, path].join(" -> ")}`, location, "dependency-cycle");
		if (stack.length >= maxIncludeDepth) throw new ScadError("File dependency depth limit exceeded", location, "resource-limit");
		if (!parsed.has(path)) {
			const source = await read(path);
			if (source === undefined) throw new ScadError(`Missing entry file '${path}'`, location, "missing-file");
			bytes += new TextEncoder().encode(source).length;
			if (parsed.size >= maxFiles || bytes > maxProjectBytes) throw new ScadError("Project file/byte limit exceeded", location, "resource-limit");
			dependencies.push(path);
			parsed.set(path, parse(source, { file: path }));
		}
		const expand = async (statements) => {
			const result = [];
			for (const statement of statements) {
				checkAbort(signal);
				if (++statementCount > maxStatements) throw new ScadError("Expanded statement limit exceeded", statement.location, "resource-limit");
				if (statement.type === "include" || statement.type === "use") {
					const target = await locate(statement.path, path, statement.location);
					const children = await load(target, [...stack, path], statement.location);
					if (statement.type === "include") result.push(...children);
					else result.push({ type: "library", path: target, children, modifiers: [], location: statement.location });
				} else {
					const node = { ...statement };
					if (node.children) node.children = await expand(node.children);
					if (node.alternate) node.alternate = await expand(node.alternate);
					result.push(node);
				}
			}
			return result;
		};
		return expand(parsed.get(path));
	};
	const normalizedEntry = normalizePath(entry);
	try {
		const statements = await load(normalizedEntry);
		return { entry: normalizedEntry, statements, dependencies: Object.freeze(dependencies), sourceBytes: bytes };
	} catch (error) {
		error.dependencies = Object.freeze([...dependencies]);
		throw error;
	}
}