import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fontName, fontIdentity, parseFontData, DEFAULT_MAX_FONT_BYTES } from "../geometry/font-data.js";
import { checkAbort } from "../core/project.js";
import { FONT_FACES } from "../geometry/font-faces.js";

const exec = promisify(execFile);

async function readFont(file, maxBytes, signal) {
	checkAbort(signal);
	const handle = await open(file, "r");
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new RangeError(`Invalid or oversized font file: ${file}`);
		const bytes = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < bytes.length) {
			checkAbort(signal);
			const read = await handle.read(bytes, length, bytes.length - length, null);
			if (!read.bytesRead) break;
			length += read.bytesRead;
		}
		if (length !== stat.size) throw new Error(`Font changed while reading: ${file}`);
		return new Uint8Array(bytes.subarray(0, length));
	} finally { await handle.close(); }
}

function systemDirectories() {
	if (process.platform === "win32") return [
		path.join(process.env.WINDIR || "C:\\Windows", "Fonts"),
		...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts")] : []),
	];
	if (process.platform === "darwin") return [path.join(os.homedir(), "Library/Fonts"), "/Library/Fonts", "/System/Library/Fonts"];
	return [path.join(os.homedir(), ".local/share/fonts"), path.join(os.homedir(), ".fonts"), "/usr/local/share/fonts", "/usr/share/fonts"];
}

export function createSystemFontResolver({ fontDirectories = [], systemFonts = true, maxFontBytes = DEFAULT_MAX_FONT_BYTES, onWarning = (message) => process.emitWarning(message) } = {}) {
	if (!Array.isArray(fontDirectories) || fontDirectories.some((directory) => typeof directory !== "string" || !directory)) throw new TypeError("fontDirectories must be an array of directory paths");
	if (typeof systemFonts !== "boolean") throw new TypeError("systemFonts must be a boolean");
	if (!Number.isSafeInteger(maxFontBytes) || maxFontBytes < 1) throw new TypeError("maxFontBytes must be a positive safe integer");
	const metadata = new Map();
	const directories = fontDirectories.map((directory) => ({ directory: path.resolve(directory), optional: false }));
	if (systemFonts && process.platform !== "linux") directories.push(...systemDirectories().map((directory) => ({ directory, optional: true })));
	let useFontconfig = systemFonts && process.platform === "linux";
	let files;
	const fileSources = new Map();
	const listedFiles = new Map();
	async function discover(signal) {
		const found = [];
		let visited = 0;
		const walk = async (directory, optional, depth = 0) => {
			checkAbort(signal);
			if (++visited > 4096 || depth > 16) throw new RangeError("Font directory scan limit exceeded");
			let entries;
			try { entries = await readdir(directory, { withFileTypes: true }); }
			catch (error) { if (optional && error.code === "ENOENT") return; throw error; }
			for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
				const file = path.join(directory, entry.name);
				if (entry.isDirectory()) await walk(file, optional, depth + 1);
				else if (entry.isFile() && /\.(ttf|otf)$/i.test(entry.name)) {
					if (found.length >= 4096) throw new RangeError("Font file scan limit exceeded");
					found.push(file);
					if (!fileSources.has(file)) fileSources.set(file, optional ? "system" : "directory");
				}
			}
		};
		for (const { directory, optional } of directories) await walk(directory, optional);
		return found;
	}
	const identity = (file, bytes) => {
		if (!metadata.has(file)) {
			try { metadata.set(file, fontIdentity(parseFontData(bytes, maxFontBytes))); }
			catch (error) {
				onWarning(`Cannot inspect font '${file}': ${error.message}`);
				metadata.set(file, null);
			}
		}
		return metadata.get(file);
	};
	const findFile = async (requested, signal) => {
		for (const file of files) {
			const known = metadata.get(file);
			if (known === null) continue;
			if (known && fontName(known.name).key !== requested.key) continue;
			const bytes = await readFont(file, maxFontBytes, signal);
			const info = identity(file, bytes);
			if (info && fontName(info.name).key === requested.key) return bytes;
		}
		return undefined;
	};
	const resolve = async (name, { signal } = {}) => {
		const requested = fontName(name);
		checkAbort(signal);
		if (listedFiles.has(requested.key)) return readFont(listedFiles.get(requested.key), maxFontBytes, signal);
		files ??= await discover(signal);
		const found = await findFile(requested, signal);
		if (found) return found;
		if (useFontconfig) {
			const escape = (text) => text.replace(/[\\,:=-]/g, "\\$&");
			let output;
			try {
				output = await exec("fc-match", ["--format=%{file}", `:family=${escape(requested.family)}:style=${escape(requested.style)}`], { signal, timeout: 5000, maxBuffer: 65536 });
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				useFontconfig = false;
				onWarning("System font discovery requires fontconfig (fc-match); searching standard font directories instead.");
				for (const directory of systemDirectories()) directories.push({ directory, optional: true });
				files = await discover(signal);
				return findFile(requested, signal);
			}
			const file = output.stdout;
			if (file) {
				const bytes = await readFont(file, maxFontBytes, signal);
				const info = identity(file, bytes);
				if (info && fontName(info.name).key === requested.key) return bytes;
			}
		}
		return undefined;
	};
	resolve.listFonts = async ({ signal } = {}) => {
		checkAbort(signal);
		const bundled = FONT_FACES.map(({ family, style }) => ({ family, style, name: `${family}:style=${style}`, source: "bundled" }));
		const faces = new Map(bundled.map(face => [fontName(face.name).key, face]));
		files ??= await discover(signal);
		const candidates = new Map(files.map(file => [file, fileSources.get(file)]));
		if (useFontconfig) {
			try {
				const { stdout } = await exec("fc-list", ["--format=%{file}\\n"], { signal, timeout: 5000, maxBuffer: 2_000_000 });
				for (const file of stdout.split("\n").filter(file => /\.(ttf|otf)$/i.test(file)).sort()) {
					if (!candidates.has(file)) candidates.set(file, "system");
					if (candidates.size > 4096) throw new RangeError("Font file scan limit exceeded");
				}
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				onWarning("System font enumeration requires fontconfig (fc-list); searching standard font directories instead.");
				for (const directory of systemDirectories()) {
					if (!directories.some(entry => entry.directory === directory)) directories.push({ directory, optional: true });
				}
				files = await discover(signal);
				for (const file of files) if (!candidates.has(file)) candidates.set(file, "system");
			}
		}
		const nextFiles = new Map();
		for (const [file, source] of candidates) {
			checkAbort(signal);
			const bytes = await readFont(file, maxFontBytes, signal);
			const info = identity(file, bytes);
			if (!info) continue;
			const key = fontName(info.name).key;
			if (faces.has(key)) continue;
			faces.set(key, { ...info, source });
			nextFiles.set(key, file);
		}
		checkAbort(signal);
		listedFiles.clear();
		for (const [key, file] of nextFiles) listedFiles.set(key, file);
		return [...faces.values()].sort((a, b) => a.name.localeCompare(b.name));
	};
	return resolve;
}
