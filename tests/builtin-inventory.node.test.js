import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const inventory = await readFile(new URL("references/BUILTIN_FUNCTIONS.md", root), "utf8");
const nativeCore = await readFile(new URL("references/openscad/src/core/builtin_functions.cc", root), "utf8");
const nativeDxf = await readFile(new URL("references/openscad/src/io/dxfdim.cc", root), "utf8");
const evaluator = await readFile(new URL("src/core/evaluator.js", root), "utf8");

test("built-in inventory matches pinned native registrations and JS dispatch", () => {
	const nativeNames = [...`${nativeCore}\n${nativeDxf}`.matchAll(/Builtins::init\(\s*"([^"]+)"/g)].map((match) => match[1]).sort();
	const inventoryNames = [...inventory.matchAll(/^\| [^|]+ \| ([^|]+) \|/gm)]
		.flatMap((match) => [...match[1].matchAll(/`([^`]+)`/g)].map((name) => name[1])).sort();
	assert.deepEqual(inventoryNames, nativeNames);
	assert.equal(nativeNames.length, 46);

	const dispatch = evaluator.slice(evaluator.indexOf("const functions = {"), evaluator.indexOf("\n\t\t};", evaluator.indexOf("const functions = {")));
	const dispatchNames = new Set([...dispatch.matchAll(/(?:^|[,\n]\s*)([A-Za-z_$][\w$]*):/g)].map((match) => match[1]));
	const dedicated = new Set(["textmetrics", "fontmetrics", "object", "has_key", "import", "search", "dxf_dim", "dxf_cross", "is_undef", "is_list", "is_num", "is_bool", "is_string", "is_function", "is_object"]);
	const nativeOnly = nativeNames.filter((name) => !dispatchNames.has(name) && !dedicated.has(name));
	assert.deepEqual(nativeOnly, []);
	for (const name of dedicated) assert.ok(nativeNames.includes(name), `Dedicated handler is not registered natively: ${name}`);
});