import { fontName, parseFontData, DEFAULT_MAX_FONT_BYTES } from "../geometry/font-data.js";
import { loadFont, resolveFontFace } from "../geometry/text.js";
import { ScadError } from "./parser.js";
import { checkAbort } from "./project.js";

export function createFontRegistry({ fonts = {}, fontResolver, maxFontBytes = DEFAULT_MAX_FONT_BYTES, signal } = {}) {
	if (!Number.isSafeInteger(maxFontBytes) || maxFontBytes < 1) throw new TypeError("maxFontBytes must be a positive safe integer");
	if (fontResolver !== undefined && typeof fontResolver !== "function") throw new TypeError("fontResolver must be a function");
	if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) throw new TypeError("fonts must be a font-name to byte-data map");
	const supplied = new Map();
	const entries = fonts instanceof Map ? [...fonts] : Object.entries(fonts);
	if (entries.length > 128) throw new ScadError("Font face limit exceeded", undefined, "resource-limit");
	let total = 0;
	for (const [name, bytes] of entries) {
		if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new TypeError("Font data must be a Uint8Array or ArrayBuffer");
		total += bytes.byteLength;
		if (total > maxFontBytes) throw new ScadError("Font byte limit exceeded", undefined, "resource-limit");
		const key = fontName(name).key;
		if (supplied.has(key)) throw new TypeError(`Duplicate font '${name}'`);
		supplied.set(key, bytes);
	}
	const loaded = new Map();
	return {
		loaded,
		get(name) {
			const key = fontName(name).key;
			if (!loaded.has(key)) {
				const error = new ScadError(`Font '${name || "Liberation Sans"}' requires loading`, undefined, "unresolved-font");
				error.fontRequest = name ?? "";
				throw error;
			}
			return loaded.get(key);
		},
		async load(name, location) {
			try {
				checkAbort(signal);
				const { key } = fontName(name);
				if (loaded.has(key)) return loaded.get(key);
				if (loaded.size >= 128) throw new ScadError("Font face limit exceeded", location, "resource-limit");
				let bytes = supplied.get(key);
				let font;
				if (bytes === undefined && resolveFontFace(name)) font = await loadFont(name);
				else if (bytes === undefined) {
					bytes = await fontResolver?.(name, { signal });
					checkAbort(signal);
					if (bytes === undefined) throw new ScadError(`Font '${name}' was not found; install it, configure a font directory, or load a font file`, location, "missing-font");
					if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new TypeError("Font resolver must return a Uint8Array or ArrayBuffer");
					total += bytes.byteLength;
					if (total > maxFontBytes) throw new ScadError("Font byte limit exceeded", location, "resource-limit");
				}
				font ??= parseFontData(bytes, maxFontBytes);
				checkAbort(signal);
				loaded.set(key, font);
				return font;
			} catch (error) {
				if (error instanceof ScadError) { error.location ??= location; throw error; }
				if (typeof error.code === "string" && error.code !== "resolver-error") throw new ScadError(error.message, error.location ?? location, error.code);
				throw new ScadError(`Cannot load font '${name || "Liberation Sans"}': ${error.message}`, location, "invalid-font");
			}
		},
	};
}
