import * as loaded from "../../node_modules/opentype.js/dist/opentype.js";
const opentype = loaded.default ?? globalThis.opentype;

export const DEFAULT_MAX_FONT_BYTES = 20_000_000;

export function fontName(name = "") {
	if (typeof name !== "string") throw new TypeError("Font name must be a string");
	const match = /^\s*([^:]+?)(?::style=([^:]+?))?\s*$/.exec(name || "Liberation Sans");
	if (!match) throw new TypeError(`Invalid font name '${name}'; use Family:style=Style`);
	const family = match[1].trim(), style = (match[2] ?? "Regular").trim();
	return { family, style, key: `${family.toLowerCase()}|${style.toLowerCase()}` };
}

export function parseFontData(bytes, maxBytes = DEFAULT_MAX_FONT_BYTES) {
	if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new TypeError("Font data must be a Uint8Array or ArrayBuffer");
	if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new RangeError(`Font data must contain 1 to ${maxBytes} bytes`);
	const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
	if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0 || !font.glyphs?.length) throw new TypeError("Font has invalid metrics or no glyphs");
	return font;
}

export function fontIdentity(font) {
	const family = font.getEnglishName("preferredFamily") || font.getEnglishName("fontFamily");
	const style = font.getEnglishName("preferredSubfamily") || font.getEnglishName("fontSubfamily") || "Regular";
	if (!family) throw new TypeError("Font has no family name");
	return { family, style, name: `${family}:style=${style}` };
}
