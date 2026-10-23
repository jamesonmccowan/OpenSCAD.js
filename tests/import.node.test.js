import assert from "node:assert/strict";
import { test } from "node:test";
import createModule from "manifold-3d";
import { createEngine, createWorkerEngine } from "../src/index.js";
import { exportStl } from "../src/geometry/stl.js";
import { createFilesystemProject } from "../src/node/filesystem.js";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";

const module = await createModule(); module.setup();
const cube = module.Manifold.cube(2);
const binary = exportStl(cube.getMesh());
const ascii = exportStl(cube.getMesh(), { encoding: "ascii" }); cube.delete();

test("ASCII/binary STL assets resolve relative to library source and transform/CSG normally", async () => {
	const engine = await createEngine({ module });
	try {
		for (const bytes of [binary, ascii]) {
			const result = await engine.compile({ mode: "render", files: { "main.scad": "use <lib/shape.scad> shape();", "lib/shape.scad": 'module shape() { translate([3,0,0]) import("../assets/cube.stl"); }' }, assets: { "assets/cube.stl": bytes } });
			assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
			assert.equal(result.volume, 8); assert.deepEqual(result.bounds, [[3,0,0],[5,2,2]]);
			assert.ok(result.dependencies.includes("assets/cube.stl")); result.dispose();
		}
	} finally { engine.dispose(); }
});

test("original import fixture matches its source, dimensions and volume", async () => {
	const engine = await createEngine({ module });
	try {
		const source = await readFile(new URL("./fixtures/import-base.scad", import.meta.url), "utf8");
		const asset = await readFile(new URL("../references/scad sample files/import-base.stl", import.meta.url));
		for (const request of [
			{ files: { "main.scad": source } },
			{ files: { "main.scad": 'import("import-base.stl");' }, assets: { "import-base.stl": asset } },
		]) {
			const result = await engine.compile({ ...request, mode: "render" });
			assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
			try {
				assert.ok(Math.abs(result.volume - 1472) < 1e-9);
				assert.deepEqual(result.bounds, [[0, 0, 0], [24, 16, 6]]);
				const mesh = measureMesh(decodeBinaryStl(await engine.export(result)));
				assert.ok(Math.abs(mesh.volume - 1472) < 1e-9);
				assert.equal(mesh.degenerateTriangles, 0);
				assert.equal(mesh.closed, true);
			} finally { result.dispose(); }
		}
	} finally { engine.dispose(); }
});

test("worker bridges the original binary fixture and compiles the pico import example", async () => {
	const project = await createFilesystemProject({ input: fileURLToPath(new URL("../references/scad sample files/pico.scad", import.meta.url)) });
	const engine = await createWorkerEngine();
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-pico-"));
	try {
		const result = await engine.compile({ ...project, mode: "render" });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		assert.ok(result.volume > 1472); assert.ok(result.dependencies.includes("import-base.stl"));
		const bytes = await engine.export(result);
		const decoded = decodeBinaryStl(bytes); const measured = measureMesh(decoded);
		assert.equal(measured.degenerateTriangles, 0);
		assert.ok(Math.abs(measured.volume - result.volume) < 0.01);
		const reconstructedMesh = new module.Mesh({ numProp: 3, vertProperties: decoded.positions, triVerts: decoded.triangles }); reconstructedMesh.merge();
		const reconstructed = new module.Manifold(reconstructedMesh);
		try { assert.equal(reconstructed.status(), "NoError"); } finally { reconstructed.delete(); }
		await writeFile(path.join(directory, "pico.stl"), bytes);
		await writeFile(path.join(directory, "main.scad"), 'import("pico.stl");');
		await promisify(execFile)(fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url)), ["--backend=Manifold", "--export-format=binstl", "-o", path.join(directory, "reimport.stl"), path.join(directory, "main.scad")], { timeout: 30_000 });
		const imported = measureMesh(decodeBinaryStl(await readFile(path.join(directory, "reimport.stl"))));
		assert.ok(Math.abs(imported.volume - result.volume) < 0.01); result.dispose();
	} finally { await engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("missing, malformed, escaping and oversized assets fail explicitly", async () => {
	const engine = await createEngine({ module });
	try {
		for (const [file, assets, limit, code] of [["missing.stl", {}, 1000, "missing-asset"], ["../escape.stl", {}, 1000, "restricted-path"], ["bad.stl", { "bad.stl": "not STL" }, 1000, "geometry-error"], ["cube.stl", { "cube.stl": binary }, 10, "resource-limit"]]) {
			const result = await engine.compile({ files: { "main.scad": `import("${file}");` }, assets, maxAssetBytes: limit });
			assert.equal(result.status, "error"); assert.equal(result.diagnostics.at(-1).code, code);
		}
	} finally { engine.dispose(); }
});

test("experimental JSON data imports resolve relative paths and match native values", async () => {
	const engine = await createEngine({ module });
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-json-import-"));
	const data = '{"string":"hello","numbers":[0,1,2],"array-string":["one","two"],"object":{"name":"widget","nested":{"value":42}},"nullable":null}';
	const source = 'filename="data.json"; data=import(filename); echo(data.string,data.numbers,data["array-string"],data.object.nested.value,is_undef(data.nullable));';
	try {
		const input = path.join(directory, "main.scad"), nativeOutput = path.join(directory, "native.echo");
		await writeFile(input, source);
		await writeFile(path.join(directory, "data.json"), data);
		await promisify(execFile)(fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url)), ["--enable=import-function", input, "-o", nativeOutput], { timeout: 30_000 });
		const native = (await readFile(nativeOutput, "utf8")).trim().split(/\r?\n/);
		const result = await engine.compile({ experimental: ["import-function"], files: { "main.scad": source, "data.json": data } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(native, ['ECHO: "hello", [0, 1, 2], ["one", "two"], 42, true']);
		assert.ok(result.dependencies.includes("data.json"));
		result.dispose();
		const gated = await engine.compile({ files: { "main.scad": 'echo(import("data.json"));', "data.json": data } });
		assert.equal(gated.status, "error");
		assert.equal(gated.diagnostics.at(-1).code, "experimental-disabled");
		const malformed = await engine.compile({ experimental: ["import-function"], files: { "main.scad": 'echo(import("bad.json"));', "bad.json": "{" } });
		assert.equal(malformed.status, "success");
		assert.deepEqual(malformed.echoes, ["ECHO: undef"]);
		assert.equal(malformed.diagnostics.at(-1).code, "invalid-json-import");
		malformed.dispose();
		const missing = await engine.compile({ experimental: ["import-function"], files: { "main.scad": 'echo(import("missing.json"));' } });
		assert.equal(missing.status, "success");
		assert.deepEqual(missing.echoes, ["ECHO: undef"]);
		assert.equal(missing.diagnostics.at(-1).code, "invalid-json-import");
		missing.dispose();
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("malformed STL buffers and exact import limits preserve direct and worker usability", async () => {
	const wrongCount = binary.slice(), nonfinite = binary.slice();
	new DataView(wrongCount.buffer, wrongCount.byteOffset, wrongCount.byteLength).setUint32(80, 0xffffffff, true);
	new DataView(nonfinite.buffer, nonfinite.byteOffset, nonfinite.byteLength).setFloat32(96, NaN, true);
	for (const [host, factory] of [["direct", () => createEngine({ module })], ["worker", () => createWorkerEngine()]]) {
		const engine = await factory();
		try {
			for (const [name, data, options, code] of [
				["truncated header", binary.slice(0, 83), {}, "geometry-error"],
				["truncated triangle", binary.slice(0, -1), {}, "geometry-error"],
				["inconsistent triangle count", wrongCount, {}, "geometry-error"],
				["nonfinite coordinate", nonfinite, {}, "geometry-error"],
				["missing ASCII facet terminator", new TextDecoder().decode(ascii).replace("endfacet", ""), {}, "geometry-error"],
				["asset byte limit minus one", binary, { maxAssetBytes: binary.byteLength - 1 }, "resource-limit"],
				["triangle limit minus one", binary, { maxTriangles: 11 }, "geometry-error"],
			]) {
				const result = await engine.compile({ ...options, mode: "render", files: { "main.scad": 'import("cube.stl");' }, assets: { "cube.stl": data } });
				assert.equal(result.status, "error", `${host}: ${name}`);
				assert.equal(result.diagnostics.at(-1).code, code, `${host}: ${name}`);
				await assert.rejects(engine.export(result), /live|successful/, `${host}: ${name}`);
			}
			const valid = await engine.compile({ mode: "render", maxAssetBytes: binary.byteLength, maxTriangles: 12, files: { "main.scad": 'import("cube.stl");' }, assets: { "cube.stl": binary } });
			assert.equal(valid.status, "success", `${host}: ${JSON.stringify(valid.diagnostics)}`);
			assert.ok(Math.abs(measureMesh(decodeBinaryStl(await engine.export(valid))).volume - 8) < 1e-9);
			valid.dispose();
		} finally { await engine.dispose(); }
	}
});