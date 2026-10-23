import { fontName, fontIdentity, parseFontData, DEFAULT_MAX_FONT_BYTES } from "../geometry/font-data.js";

export function createBrowserFonts({ maxFontBytes = DEFAULT_MAX_FONT_BYTES } = {}) {
	const files = new Map();
	const local = new Map();
	let total = 0;
	return {
		get count() { return files.size; },
		get localCount() { return local.size; },
		async addFiles(selected) {
			const additions = new Map();
			let nextTotal = total;
			for (const file of selected) {
				if (!/\.(ttf|otf)$/i.test(file.name)) throw new TypeError(`Unsupported font file '${file.name}'; select .ttf or .otf`);
				if (!file.size || file.size > maxFontBytes) throw new RangeError(`Font '${file.name}' exceeds the font byte limit or is empty`);
				const bytes = new Uint8Array(await file.arrayBuffer());
				const info = fontIdentity(parseFontData(bytes, maxFontBytes));
				const key = fontName(info.name).key;
				nextTotal += bytes.byteLength - (additions.get(key)?.byteLength ?? files.get(key)?.byteLength ?? 0);
				additions.set(key, bytes);
				if (nextTotal > maxFontBytes || new Set([...files.keys(), ...additions.keys()]).size > 128) throw new RangeError("Loaded fonts exceed the font byte/face limit");
			}
			for (const [key, bytes] of additions) files.set(key, bytes);
			total = nextTotal;
		},
		async enableLocalFonts(query = globalThis.queryLocalFonts?.bind(globalThis)) {
			if (!query) throw new Error("This browser does not support local font access; use Load font files instead");
			const fonts = await query();
			if (fonts.length > 4096) throw new RangeError("Local font enumeration limit exceeded");
			const next = new Map();
			for (const font of fonts) next.set(fontName(`${font.family}:style=${font.style}`).key, font);
			local.clear();
			for (const [key, font] of next) local.set(key, font);
		},
		async resolve(name, { signal } = {}) {
			signal?.throwIfAborted();
			const key = fontName(name).key;
			if (files.has(key)) return files.get(key);
			const font = local.get(key);
			if (!font) return undefined;
			const blob = await font.blob();
			signal?.throwIfAborted();
			if (!blob.size || total + blob.size > maxFontBytes || files.size >= 128) throw new RangeError("Local font exceeds the font byte/face limit");
			const bytes = new Uint8Array(await blob.arrayBuffer());
			parseFontData(bytes, maxFontBytes);
			signal?.throwIfAborted();
			files.set(key, bytes);
			total += bytes.byteLength;
			return bytes;
		},
	};
}
