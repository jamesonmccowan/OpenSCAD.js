import { fragmentCount } from "./tessellation.js";
import { fontName, fontIdentity, parseFontData } from "./font-data.js";
import { FONT_FACES } from "./font-faces.js";
export { FONT_FACES } from "./font-faces.js";
const fontDirectory = new URL("../../references/openscad/fonts/Liberation-2.00.1/ttf/", import.meta.url);
const fontPromises = new Map();

export function resolveFontFace(name) {
	if (name === undefined || name === "") return FONT_FACES[0];
	if (typeof name !== "string") return undefined;
	const match = /^\s*(Liberation Sans|Liberation Serif|Liberation Mono)(?::style=([^:]+))?\s*$/i.exec(name);
	if (!match) return undefined;
	const family = match[1].toLowerCase(), style = (match[2] ?? "Regular").trim().toLowerCase();
	return FONT_FACES.find((face) => face.family.toLowerCase() === family && face.style.toLowerCase() === style);
}

export async function loadFont(name) {
	const face = resolveFontFace(name);
	if (!face) throw new TypeError(`Unsupported font '${String(name)}'; bundled Liberation Sans, Serif, and Mono faces are supported`);
	let promise = fontPromises.get(face.key);
	if (!promise) {
		promise = (async () => {
			const url = new URL(face.filename, fontDirectory);
			const bytes = url.protocol === "file:" ? new Uint8Array(await (await import("node:fs/promises")).readFile(url)) : new Uint8Array(await (await fetch(url)).arrayBuffer());
			return parseFontData(bytes);
		})();
		fontPromises.set(face.key, promise);
	}
	return promise;
}

export async function loadDefaultFont() {
	return loadFont();
}

function metricFont(args, font) {
	if (!font) return undefined;
	if (args.em !== undefined && (typeof args.em !== "number" || !Number.isFinite(args.em) || args.em <= 0)) return undefined;
	if (args.size !== undefined && (typeof args.size !== "number" || !Number.isFinite(args.size) || args.size <= 0)) return undefined;
	return args.em ?? (args.size ?? 10) * 25 / 18;
}

export function fontMetrics(args, font) {
	const size = metricFont(args, font);
	if (!size) return undefined;
	const factor = size / font.unitsPerEm;
	const { family, style } = fontIdentity(font);
	const head = font.tables.head, hhea = font.tables.hhea;
	return {
		nominal: { ascent: font.ascender * factor, descent: font.descender * factor },
		max: { ascent: head.yMax * factor, descent: head.yMin * factor },
		interline: (font.ascender - font.descender + hhea.lineGap) * factor,
		font: { family, style },
	};
}

export function textMetrics(args, font) {
	const size = metricFont(args, font);
	if (!size || typeof args.text !== "string" || /[^\x20-\x7e]/.test(args.text)) return undefined;
	if (args.spacing !== undefined && (typeof args.spacing !== "number" || !Number.isFinite(args.spacing))) return undefined;
	if (args.direction !== undefined && !["", "ltr"].includes(args.direction)) return undefined;
	if (args.language !== undefined && !["", "en"].includes(args.language)) return undefined;
	if (args.script !== undefined && !["", "latin", "Latn"].includes(args.script)) return undefined;
	const horizontal = args.halign ?? "default", vertical = args.valign ?? "default";
	if (!(["default", "left", "right", "center"].includes(horizontal) && ["default", "baseline", "bottom", "top", "center"].includes(vertical))) return undefined;
	const factor = size / font.unitsPerEm, spacing = args.spacing ?? 1, glyphs = font.stringToGlyphs(args.text);
	let advance = 0, left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity, ascent = -Infinity, descent = Infinity;
	for (let index = 0; index < glyphs.length; index++) {
		const glyph = glyphs[index], bounds = glyph.getBoundingBox();
		if (bounds.x2 > bounds.x1 && bounds.y2 > bounds.y1) {
			const xMin = advance + bounds.x1 * factor, xMax = advance + bounds.x2 * factor;
			const yMin = bounds.y1 * factor, yMax = bounds.y2 * factor;
			left = Math.min(left, xMin); right = Math.max(right, xMax);
			bottom = Math.min(bottom, yMin); top = Math.max(top, yMax);
			ascent = Math.max(ascent, bounds.y2 * factor); descent = Math.min(descent, bounds.y1 * factor);
		}
		advance += (glyph.advanceWidth + (index + 1 < glyphs.length ? font.getKerningValue(glyph, glyphs[index + 1]) : 0)) * factor * spacing;
	}
	if (!(right >= left)) { left = right = top = bottom = ascent = descent = 0; }
	let xOffset = horizontal === "right" ? -advance : horizontal === "center" ? -advance / 2 : 0;
	let yOffset = vertical === "top" ? -ascent : vertical === "bottom" ? -descent : vertical === "center" ? -(ascent - descent) / 2 - descent : 0;
	return {
		position: [xOffset + left, yOffset + bottom],
		size: [right - left, top - bottom],
		ascent,
		descent,
		offset: [xOffset, yOffset],
		advance: [advance, 0],
	};
}

export function textContours(args, font, maxPoints = 100_000, resolution = {}) {
	if (typeof args.text !== "string") throw new TypeError(`Text requires a string; received ${args.text === undefined ? "undef" : Array.isArray(args.text) ? "a list" : typeof args.text}`);
	if (/[^\x20-\x7e]/.test(args.text)) throw new TypeError("Text currently supports printable Latin ASCII strings");
	fontName(args.font);
	if (!font) throw new TypeError(`Font '${String(args.font)}' has not been loaded`);
	if (args.direction !== undefined && args.direction !== "ltr") throw new TypeError("Only left-to-right text is supported");
	if (args.script !== undefined && !["latin","Latn"].includes(args.script)) throw new TypeError("Only Latin text script is supported");
	if (args.language !== undefined && !["en",""].includes(args.language)) throw new TypeError("Only English/default language text is supported");
	const size = args.size ?? 10; const spacing = args.spacing ?? 1;
	if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(spacing) || spacing <= 0) throw new TypeError("Text size and spacing must be positive");
	const fontSize = size * 25 / 18;
	const segments = Math.max(2, Math.floor(fragmentCount(size, resolution) / 8) + 1);
	const contours = [];
	let contour = [];
	let previous = [0, 0];
	let pen = 0;
	let pointCount = 0;
	const add = (point) => { if (++pointCount > maxPoints) throw new RangeError("Text contour limit exceeded"); contour.push([point[0], -point[1]]); previous = point; };
	const glyphs = font.stringToGlyphs(args.text);
	for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex++) {
		const glyph = glyphs[glyphIndex];
		for (const command of glyph.getPath(pen, 0, fontSize).commands) {
			if (command.type === "M") { if (contour.length) contours.push(contour); contour = []; add([command.x, command.y]); }
			else if (command.type === "L") add([command.x, command.y]);
			else if (["Q", "C"].includes(command.type)) {
				const start = previous;
				for (let step = 1; step <= segments; step++) {
					const time = step / segments; const inverse = 1 - time;
					const point = ["x", "y"].map((axis, index) => command.type === "Q" ? inverse*inverse*start[index]+2*inverse*time*command[axis+"1"]+time*time*command[axis] : inverse**3*start[index]+3*inverse*inverse*time*command[axis+"1"]+3*inverse*time*time*command[axis+"2"]+time**3*command[axis]);
					add(point);
				}
			} else if (command.type === "Z") { if (contour.length) contours.push(contour); contour = []; }
		}
		pen += (glyph.advanceWidth + (glyphIndex + 1 < glyphs.length ? font.getKerningValue(glyph, glyphs[glyphIndex + 1]) : 0)) * fontSize / font.unitsPerEm * spacing;
	}
	if (contour.length) contours.push(contour);
	const coordinates = contours.flat();
	if (!coordinates.length) return [];
	const minimum = [0, 1].map((axis) => Math.min(...coordinates.map((point) => point[axis])));
	const maximum = [0, 1].map((axis) => Math.max(...coordinates.map((point) => point[axis])));
	const halign = args.halign ?? "left"; const valign = args.valign ?? "baseline";
	if (!["left", "center", "right"].includes(halign) || !["baseline", "bottom", "center", "top"].includes(valign)) throw new TypeError("Unsupported text alignment");
	const horizontal = halign === "left" ? 0 : halign === "center" ? -pen / 2 : -pen;
	const vertical = valign === "baseline" ? 0 : valign === "bottom" ? -minimum[1] : valign === "top" ? -maximum[1] : -(minimum[1] + maximum[1]) / 2;
	return contours.map((ring) => ring.map((point) => [point[0] + horizontal, point[1] + vertical]));
}