import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import createModule from "manifold-3d";
import { createEngine, SERVICE_API_VERSION } from "../src/index.js";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";
import { exportStl } from "../src/geometry/stl.js";
import { malformedBoundaryCases, validBindingBoundaries } from "./fixtures/boundary-cases.js";

const module = await createModule();
module.setup();

function cubeVolume(bytes) {
	assert.ok(Math.abs(measureMesh(decodeBinaryStl(bytes)).volume - 8) < 1e-9);
}

test("service compiles a virtual project and exports independent binary and ASCII bytes", async () => {
	const engine = await createEngine({ module });
	try {
		const result = await engine.compile({ mode: "render", files: { "main.scad": "use <shape.scad> shape();", "shape.scad": "module shape() { cube(2); }" } });
		assert.equal(result.apiVersion, SERVICE_API_VERSION);
		assert.ok(Object.isFrozen(result.layers.background));
		assert.equal(result.status, "success");
		assert.equal(result.volume, 8);
		assert.deepEqual(result.bounds, [[0, 0, 0], [2, 2, 2]]);
		assert.deepEqual(result.dependencies, ["main.scad", "shape.scad"]);
		const binary = await engine.export(result);
		cubeVolume(binary);
		const ascii = new TextDecoder().decode(await engine.export(result, { encoding: "ascii" }));
		assert.match(ascii, /^solid openscad_js\n/);
		assert.equal((ascii.match(/facet normal/g) ?? []).length, 12);
		const mesh = result.getMesh();
		mesh.vertProperties.fill(100);
		cubeVolume(await engine.export(result));
		result.dispose(); result.dispose();
		assert.throws(() => result.getMesh(), /disposed/);
		await assert.rejects(engine.export(result), /live successful/);
	} finally { engine.dispose(); }
});

test("service accepts bounded structured object bindings", async () => {
	const engine = await createEngine({ module });
	try {
		const result = await engine.compile({ experimental: ["object-function"], files: { "main.scad": 'echo(is_object(config),config.dimensions.width,has_key(config,"enabled")); cube(config.dimensions.width);' }, defines: { config: { dimensions: { width: 2 }, enabled: true } } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		assert.deepEqual(result.echoes, ["ECHO: true, 2, true"]);
		assert.equal(result.volume, 8);
	} finally { engine.dispose(); }
});

test("service returns named component overlap audit metadata", async () => {
	const engine = await createEngine({ module });
	try {
		const result = await engine.compile({
			mode: "render", auditComponents: true,
			files: { "main.scad": 'audit_part("base") cube([10,10,10]); translate([5,0,0]) audit_part("slider") cube([10,10,10]);' },
		});
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		assert.deepEqual(result.componentAudit.components.map((part) => part.name), ["base", "slider"]);
		assert.equal(result.componentAudit.interferences.length, 1);
		assert.equal(result.componentAudit.interferences[0].volume, 500);
		const auditOnly = await engine.compile({ auditComponents: true, auditOnly: true, files: { "main.scad": 'audit_part("only") cube(2);' } });
		assert.equal(auditOnly.status, "success");
		assert.equal(auditOnly.auditOnly, true);
		assert.equal(auditOnly.componentAudit.components.length, 1);
	} finally { engine.dispose(); }
});

test("rands stream continues across service compilations and engine instances", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-service-rands-stream-"));
	const source = "echo(rands(0,1,4,42));echo(rands(0,1,4));echo(rands(0,1,4));";
	let firstEngine, secondEngine;
	try {
		const input = path.join(directory, "rands-stream.scad"), output = path.join(directory, "rands-stream.echo");
		await writeFile(input, source);
		const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));
		await promisify(execFile)(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line.slice("ECHO: ".length)));
		firstEngine = await createEngine({ module });
		const first = await firstEngine.compile({ files: { "main.scad": "echo(rands(0,1,4,42));" } });
		assert.equal(first.status, "success");
		const firstValues = JSON.parse(first.echoes[0].slice("ECHO: ".length));
		first.dispose?.();
		firstEngine.dispose(); firstEngine = null;
		secondEngine = await createEngine({ module });
		const second = await secondEngine.compile({ files: { "main.scad": "echo(rands(0,1,4));" } });
		const third = await secondEngine.compile({ files: { "main.scad": "echo(rands(0,1,4));" } });
		assert.equal(second.status, "success"); assert.equal(third.status, "success");
		const actual = [firstValues, JSON.parse(second.echoes[0].slice("ECHO: ".length)), JSON.parse(third.echoes[0].slice("ECHO: ".length))];
		for (let batch = 0; batch < native.length; batch++) for (let index = 0; index < native[batch].length; index++) {
			assert.ok(Math.abs(actual[batch][index] - native[batch][index]) <= Math.max(1e-6, Math.abs(native[batch][index]) * 5.1e-6));
		}
		assert.notDeepEqual(actual[1], actual[2]);
		second.dispose?.(); third.dispose?.();
	} finally { firstEngine?.dispose(); secondEngine?.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("service randomSeed repeats unseeded rands across compilations", async () => {
	const engine = await createEngine({ module });
	try {
		const request = { randomSeed: 42, files: { "main.scad": "echo(rands(0,1,5),rands(0,1,3));" } };
		const first = await engine.compile(request);
		const repeated = await engine.compile(request);
		const different = await engine.compile({ ...request, randomSeed: 43 });
		assert.equal(first.status, "success"); assert.equal(repeated.status, "success"); assert.equal(different.status, "success");
		assert.deepEqual(first.echoes, repeated.echoes);
		assert.notDeepEqual(first.echoes, different.echoes);
		assert.deepEqual(first.echoes, ["ECHO: [0.796542984287846, 0.18343478789336848, 0.7796909976126613, 0.5968501615800565, 0.44583275754843343], [0.09997492054384075, 0.45924888785418205, 0.3337086115186513]"]);
		first.dispose?.(); repeated.dispose?.(); different.dispose?.();
	} finally { engine.dispose(); }
});

test("oversized sparse bindings fail before copying and preserve service usability", async () => {
	const engine = await createEngine({ module });
	try {
		const oversized = await engine.compile({ defines: { payload: new Array(100001) }, files: { "main.scad": "echo(len(payload));" } });
		assert.equal(oversized.status, "error");
		assert.equal(oversized.diagnostics.at(-1).code, "resource-limit");
		const valid = await engine.compile({ defines: { payload: new Array(2) }, files: { "main.scad": "echo(payload); cube(2);" } });
		assert.equal(valid.status, "success", JSON.stringify(valid.diagnostics));
		assert.deepEqual(valid.echoes, ["ECHO: [undef, undef]"]);
		assert.equal(valid.volume, 8); valid.dispose();
	} finally { engine.dispose(); }
});

test("callable-shaped data stays an object and cannot invoke evaluator internals", async () => {
	const engine = await createEngine({ module });
	const defines = { payload: { anonymous: true, statement: {}, scope: {} } };
	try {
		const result = await engine.compile({ defines, files: { "main.scad": "fn=function(x) x+1;echo(is_object(payload),is_function(payload),is_function(fn),fn(2));" } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		assert.deepEqual(result.echoes, ["ECHO: true, false, true, 3"]); result.dispose();
		const rejected = await engine.compile({ defines, files: { "main.scad": "echo(payload());" } });
		assert.equal(rejected.status, "error");
		assert.equal(rejected.diagnostics.at(-1).code, "not-callable");
	} finally { engine.dispose(); }
});

test("failed and cancelled jobs are structured and do not replace successful handles", async () => {
	const engine = await createEngine({ module });
	try {
		const good = await engine.compile({ mode: "render", files: { "main.scad": "cube(2);" } });
		const bad = await engine.compile({ files: { "main.scad": "include <bad.scad>", "bad.scad": "cube(" } });
		assert.equal(bad.status, "error");
		assert.equal(bad.diagnostics.at(-1).location.file, "bad.scad");
		assert.deepEqual(bad.dependencies, ["main.scad", "bad.scad"]);
		const controller = new AbortController(); controller.abort();
		const cancelled = await engine.compile({ signal: controller.signal });
		assert.equal(cancelled.status, "cancelled");
		await assert.rejects(engine.export(bad), /live successful/);
		cubeVolume(await engine.export(good));
	} finally { engine.dispose(); }
});

test("exports enforce final mode, ownership, supported formats and empty policy", async () => {
	const engine = await createEngine({ module });
	const other = await createEngine({ module });
	try {
		const preview = await engine.compile({ files: { "main.scad": "$preview ? cube(2) : cube(3);" } });
		assert.equal(preview.status, "error");
		const validPreview = await engine.compile({ files: { "main.scad": "if($preview) cube(2); else cube(3);" } });
		await assert.rejects(engine.export(validPreview), /render-mode/);
		const rendered = await engine.compile({ mode: "render", files: { "main.scad": "if($preview) cube(2); else cube(3);" } });
		assert.equal(rendered.volume, 27);
		await assert.rejects(other.export(rendered), /this engine/);
		await assert.rejects(engine.export(rendered, { format: "3mf" }), /Unsupported export/);
		const empty = await engine.compile({ mode: "render", files: { "main.scad": "cube(0);" } });
		assert.equal(empty.empty, true);
		await assert.rejects(engine.export(empty), /empty geometry/);
		assert.equal((await engine.export(empty, { allowEmpty: true })).length, 84);
	} finally { engine.dispose(); other.dispose(); }
});

test("engine disposal invalidates all handles and further compilation", async () => {
	const engine = await createEngine({ module });
	const result = await engine.compile({ mode: "render", files: { "main.scad": "cube();" } });
	engine.dispose(); engine.dispose();
	assert.throws(() => result.getMesh(), /disposed/);
	assert.equal((await engine.compile()).diagnostics[0].code, "disposed");
	await assert.rejects(engine.export(result), /disposed/);
});

test("define overrides are scoped, deterministic and separate from dynamic context", async () => {
	const engine = await createEngine({ module });
	try {
		const first = await engine.compile({ mode: "render", context: { time: 0.5 }, defines: { size: 3 }, files: { "main.scad": "size=2; echo(size,$t); cube(size);" } });
		assert.equal(first.volume, 27);
		assert.deepEqual(first.echoes, ["ECHO: 3, 0.5"]);
		const second = await engine.compile({ mode: "render", files: { "main.scad": "size=2; cube(size);" } });
		assert.equal(second.volume, 8);
		let finish;
		const defines = { size: 2 };
		const context = { time: 0.5 };
		const pending = engine.compile({ mode: "render", defines, context, resolver: () => new Promise((resolve) => { finish = resolve; }) });
		defines.size = 9; context.time = 1;
		finish("echo($t); cube(size);");
		const snapshot = await pending;
		assert.equal(snapshot.volume, 8);
		assert.deepEqual(snapshot.echoes, ["ECHO: 0.5"]);
	} finally { engine.dispose(); }
});

test("pending reads abort immediately and engine disposal settles outstanding jobs", async () => {
	const engine = await createEngine({ module, maxPendingJobs: 1 });
	let notify;
	const ready = new Promise((resolve) => { notify = resolve; });
	const pending = engine.compile({ resolver: () => { notify(); return new Promise(() => {}); } });
	await ready;
	const rejected = await engine.compile({ files: { "main.scad": "cube();" } });
	assert.equal(rejected.diagnostics.at(-1).code, "resource-limit");
	engine.dispose();
	assert.equal((await pending).status, "cancelled");
});

test("invalid requests, warning promotion and export cancellation are explicit", async () => {
	const engine = await createEngine({ module });
	try {
		assert.equal((await engine.compile(null)).status, "error");
		const warning = await engine.compile({ hardWarnings: true, files: { "main.scad": "sphere(r=1,d=2);" } });
		assert.equal(warning.status, "error");
		assert.equal(warning.diagnostics.at(-1).code, "hard-warning");
		assert.ok(warning.diagnostics.some((item) => item.code === "diameter-precedence"));
		const good = await engine.compile({ mode: "render", files: { "main.scad": "cube();" } });
		const controller = new AbortController(); controller.abort();
		await assert.rejects(engine.export(good, { signal: controller.signal }), (error) => error.code === "cancelled");
		await assert.rejects(engine.export(good, { encoding: "other" }), /encoding/);
		assert.equal((await engine.compile({ files: { "main.scad": "cube();" }, defines: { size: () => 2 } })).status, "error");
	} finally { engine.dispose(); }
});

test("deterministic malformed and boundary cases preserve direct service handles", async () => {
	const engine = await createEngine({ module });
	try {
		const preserved = await engine.compile({ mode: "render", files: { "main.scad": "cube(3);" } });
		assert.equal(preserved.status, "success");
		for (const fixture of malformedBoundaryCases()) {
			const result = await engine.compile(fixture.request);
			assert.equal(result.status, "error", fixture.name);
			const diagnostic = result.diagnostics.at(-1);
			assert.equal(diagnostic.code, fixture.code, fixture.name);
			if (fixture.located) assert.equal(diagnostic.location?.file, "main.scad", fixture.name);
			await assert.rejects(engine.export(result), /live successful/, fixture.name);
			const recovery = await engine.compile({ files: { "main.scad": "cube(2);" } });
			assert.equal(recovery.status, "success", fixture.name); assert.equal(recovery.volume, 8); recovery.dispose();
		}
		for (const fixture of validBindingBoundaries()) {
			const result = await engine.compile({ defines: fixture.defines, files: { "main.scad": fixture.source } });
			assert.equal(result.status, "success", `${fixture.name}: ${JSON.stringify(result.diagnostics)}`);
			assert.deepEqual(result.echoes, [fixture.echo], fixture.name); result.dispose();
		}
		assert.ok(Math.abs(measureMesh(decodeBinaryStl(await engine.export(preserved))).volume - 27) < 1e-9); preserved.dispose();
	} finally { engine.dispose(); }
});

test("extrusion subdivision budgets reject before kernel allocation and accept exact bounds", async () => {
	const engine = await createEngine({ module });
	try {
		for (const [source, maxTriangles] of [
			["linear_extrude(height=5,slices=10)square(2);", 10],
			["linear_extrude(height=5,slices=1000000)square(2);", 1000000],
		]) {
			const result = await engine.compile({ maxTriangles, files: { "main.scad": source } });
			assert.equal(result.status, "error");
			assert.equal(result.diagnostics.at(-1).code, "resource-limit");
			assert.match(result.diagnostics.at(-1).message, /triangle estimate/);
		}
		for (const [source, maxTriangles] of [
			["linear_extrude(1)square(2);", 12],
			["linear_extrude(1)difference(){square(6);translate([2,2])square(2);}", 32],
		]) {
			const result = await engine.compile({ maxTriangles, files: { "main.scad": source } });
			assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
			assert.ok(result.getMesh().triVerts.length / 3 <= maxTriangles); result.dispose();
		}
	} finally { engine.dispose(); }
});

test("public package entry is DOM-free and default module initialization works", async () => {
	const entry = await import("openscad-js-studio");
	assert.equal(entry.createEngine, createEngine);
	const engine = await entry.createEngine();
	try { assert.equal((await engine.compile({ files: { "main.scad": "cube(2);" } })).volume, 8); }
	finally { engine.dispose(); }
});

test("native OpenSCAD reimports both service STL encodings as the same final solid", async () => {
	const engine = await createEngine({ module });
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-export-"));
	const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));
	try {
		const result = await engine.compile({ mode: "render", files: { "main.scad": "translate([3,4,5]) cube(2); %cube(100);" } });
		assert.equal(result.status, "success");
		for (const encoding of ["ascii", "binary"]) {
			await writeFile(path.join(directory, "input.stl"), await engine.export(result, { encoding }));
			await writeFile(path.join(directory, "main.scad"), 'import("input.stl");');
			const output = path.join(directory, "output.stl");
			await promisify(execFile)(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", output, path.join(directory, "main.scad")], { timeout: 30_000 });
			const mesh = measureMesh(decodeBinaryStl(await readFile(output)));
			assert.ok(Math.abs(mesh.volume - 8) < 1e-9);
			assert.equal(mesh.closed, true);
			assert.deepEqual(mesh.bounds, [[3, 4, 5], [5, 6, 7]]);
		}
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("preview mesh provenance and overlays are owned copies and dispose cleanly", async () => {
	const engine = await createEngine({ module });
	try {
		const result = await engine.compile({ files: { "main.scad": 'color("red") cube(2); %translate([5,0,0]) cube(2);' } });
		assert.equal(result.status, "success");
		assert.ok(result.getMesh().runOriginalID.length > 0);
		const overlays = result.getOverlays();
		assert.equal(overlays[0].kind, "background");
		const expected = overlays[0].mesh.vertProperties[0];
		overlays[0].mesh.vertProperties[0] = 99;
		assert.equal(result.getOverlays()[0].mesh.vertProperties[0], expected);
		result.dispose();
		assert.throws(() => result.getOverlays(), /disposed/);
		assert.equal(overlays[0].mesh.vertProperties[0], 99);
	} finally { engine.dispose(); }
});

test("hand model exports collapsed Float32 facets and reimports like native geometry", async () => {
	const engine = await createEngine({ module });
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-hand-"));
	const source = await readFile(new URL("../references/scad sample files/hand.scad", import.meta.url), "utf8");
	const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));
	try {
		const result = await engine.compile({ mode: "render", files: { "hand.scad": source }, entry: "hand.scad" });
		assert.equal(result.status, "success");
		const bytes = await engine.export(result);
		const ascii = new TextDecoder().decode(await engine.export(result, { encoding: "ascii" }));
		const decoded = decodeBinaryStl(bytes);
		const mesh = measureMesh(decoded);
		assert.equal((ascii.match(/facet normal/g) ?? []).length, mesh.triangles);
		assert.equal(mesh.degenerateTriangles, 0);
		assert.ok(Math.abs(mesh.volume - result.volume) < 0.01);
		const reconstructed = new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: decoded.positions, triVerts: decoded.triangles }));
		try { assert.equal(reconstructed.status(), "NoError"); }
		finally { reconstructed.delete(); }
		await writeFile(path.join(directory, "hand.stl"), bytes);
		await writeFile(path.join(directory, "main.scad"), 'import("hand.stl");');
		await promisify(execFile)(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", path.join(directory, "native.stl"), path.join(directory, "main.scad")], { timeout: 30_000 });
		const imported = measureMesh(decodeBinaryStl(await readFile(path.join(directory, "native.stl"))));
		assert.ok(Math.abs(imported.volume - result.volume) < 0.01);
		assert.deepEqual(imported.bounds, mesh.bounds);
		await writeFile(path.join(directory, "reference.scad"), source);
		await promisify(execFile)(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", path.join(directory, "reference.stl"), path.join(directory, "reference.scad")], { timeout: 30_000 });
		const reference = measureMesh(decodeBinaryStl(await readFile(path.join(directory, "reference.stl"))));
		assert.ok(Math.abs(reference.volume - mesh.volume) < 0.01);
		assert.deepEqual(reference.bounds, mesh.bounds);
		assert.equal(mesh.closed, reference.closed);
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("STL drops repeated-position facets but still rejects distinct collinear or invalid vertices", () => {
	const mesh = {
		numProp: 3,
		vertProperties: new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,0, 2,0,0]),
		triVerts: new Uint32Array([0,1,2, 0,3,1]),
	};
	const binary = decodeBinaryStl(exportStl(mesh));
	assert.equal(binary.triangles.length / 3, 1);
	const ascii = new TextDecoder().decode(exportStl(mesh, { encoding: "ascii" }));
	assert.equal((ascii.match(/facet normal/g) ?? []).length, 1);
	assert.throws(() => exportStl({ ...mesh, triVerts: new Uint32Array([0,1,4]) }), /degenerate/);
	assert.throws(() => exportStl({ ...mesh, triVerts: new Uint32Array([0,1,99]) }), /vertex index/);
	const invalid = { ...mesh, vertProperties: new Float32Array([NaN,0,0, 1,0,0, 0,1,0]), triVerts: new Uint32Array([0,1,2]) };
	assert.throws(() => exportStl(invalid), /finite/);
	const collapsed = { ...mesh, triVerts: new Uint32Array([0,3,1]) };
	assert.throws(() => exportStl(collapsed), /empty geometry/);
	assert.equal(exportStl(collapsed, { allowEmpty: true }).length, 84);
});