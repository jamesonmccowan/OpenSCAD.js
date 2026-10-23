import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { checkAbort, normalizePath } from "../core/project.js";
import { ScadError } from "../core/parser.js";

const mountPrefix = "__openscad_libraries__";

function contained(root, target) {
	const relative = path.relative(root, target);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function createFilesystemProject({ input, root, libraryPaths = [], maxFileBytes = 1_000_000, maxAssetBytes = 20_000_000 } = {}) {
	if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new TypeError("maxFileBytes must be a positive safe integer");
	const absoluteInput = input ? path.resolve(input) : undefined;
	const projectRoot = await realpath(path.resolve(root ?? (absoluteInput ? path.dirname(absoluteInput) : process.cwd())));
	const libraries = [];
	for (const directory of libraryPaths) libraries.push(await realpath(path.resolve(directory)));
	const canonicalInputDirectory = absoluteInput ? await realpath(path.dirname(absoluteInput)) : undefined;
	const relative = absoluteInput ? path.relative(projectRoot, path.join(canonicalInputDirectory, path.basename(absoluteInput))).split(path.sep).join("/") : "stdin.scad";
	const entry = normalizePath(relative);
	if (entry.split("/")[0] === mountPrefix) throw new ScadError("Input uses reserved library mount namespace", undefined, "restricted-path");
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1) throw new TypeError("maxAssetBytes must be a positive safe integer");
	const read = async (logicalPath, { signal } = {}, binary = false) => {
		const limit = binary ? maxAssetBytes : maxFileBytes;
		checkAbort(signal);
		const normalized = normalizePath(logicalPath);
		let allowedRoot = projectRoot;
		let relativePath = normalized;
		if (normalized.startsWith(`${mountPrefix}/`)) {
			const parts = normalized.split("/");
			if (!/^\d+$/.test(parts[1]) || !libraries[Number(parts[1])] || parts.length < 3) throw new ScadError("Unknown library mount", undefined, "restricted-path");
			allowedRoot = libraries[Number(parts[1])];
			relativePath = parts.slice(2).join("/");
		}
		const candidate = path.resolve(allowedRoot, relativePath);
		if (!contained(allowedRoot, candidate)) throw new ScadError("File escapes authorized root", undefined, "restricted-path");
		let target;
		try { target = await realpath(candidate); }
		catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return undefined; throw error; }
		if (!contained(allowedRoot, target)) throw new ScadError(`Symlink escapes authorized root: '${logicalPath}'`, undefined, "restricted-path");
		checkAbort(signal);
		const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
		try {
			const stat = await file.stat();
			if (!stat.isFile()) throw new ScadError(`Not a regular source file: '${logicalPath}'`, undefined, "io-error");
			if (stat.size > limit) throw new ScadError(`File exceeds ${limit} bytes: '${logicalPath}'`, undefined, "resource-limit");
			const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
			let length = 0;
			while (length < buffer.length) {
				checkAbort(signal);
				const read = await file.read(buffer, length, buffer.length - length, null);
				if (!read.bytesRead) break;
				length += read.bytesRead;
			}
			if (length > stat.size || length > limit) throw new ScadError("File grew during bounded read", undefined, "resource-limit");
			checkAbort(signal);
			return binary ? new Uint8Array(buffer.subarray(0, length)) : buffer.subarray(0, length).toString("utf8");
		} finally { await file.close(); }
	};
	return { entry, resolver: (name, context) => read(name, context), assetResolver: (name, context) => read(name, context, true), libraryPaths: libraries.map((_, index) => `${mountPrefix}/${index}`), root: projectRoot };
}