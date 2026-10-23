import { readFile } from "node:fs/promises";
import { parseFontData } from "../../src/geometry/font-data.js";

export async function runtimeFont(style = "Regular") {
	const filename = style.replaceAll(" ", "");
	const source = await readFile(new URL(`../../references/openscad/fonts/Liberation-2.00.1/ttf/LiberationSans-${filename}.ttf`, import.meta.url));
	const font = parseFontData(source);
	for (const key of ["fontFamily", "preferredFamily"]) font.names[key] = { en: "Runtime Test Sans" };
	for (const key of ["fontSubfamily", "preferredSubfamily"]) font.names[key] = { en: style };
	font.names.fullName = { en: `Runtime Test Sans ${style}` };
	font.names.postScriptName = { en: `RuntimeTestSans-${filename}` };
	// The test fixture needs only outlines; opentype.js cannot serialize all Liberation GSUB scripts.
	delete font.tables.gsub;
	return new Uint8Array(font.toArrayBuffer());
}
