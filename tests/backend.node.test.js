import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import createModule from "manifold-3d";
import { geometryCases, languageCases } from "./fixtures/backend-cases.js";
import { copyMesh, decodeBinaryStl, encodeBinaryStl, measureMesh, runGeometryCase, withResources } from "./helpers/backend.js";
import { GeometryAdapter } from "../src/geometry/manifold.js";
import { fragmentCount, tessellateCylinder, tessellateSphere } from "../src/geometry/tessellation.js";
import { compileScad } from "../src/core/compiler.js";

const exec = promisify(execFile);
const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-conformance-"));
const module = await createModule();
module.setup();
after(() => rm(directory, { recursive: true, force: true }));

function near(actual, expected, tolerance = 0.0001) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
}

test('named audit parts report pairwise solid overlap while preserving regular union output', () => {
	const source = 'audit_part("base") cube(10); translate([5,0,0]) audit_part("slider") cube(10);';
	const compiled = compileScad(source, module, { mode: "render", auditComponents: true });
	try {
		assert.equal(compiled.solid.volume(), 1500);
		assert.deepEqual(compiled.componentAudit.components.map(({ name }) => name), ["base", "slider"]);
		assert.equal(compiled.componentAudit.interferences.length, 1);
		assert.deepEqual(compiled.componentAudit.interferences[0].parts, ["base", "slider"]);
		near(compiled.componentAudit.interferences[0].volume, 500);
		assert.deepEqual(compiled.componentAudit.interferences[0].bounds, [[5, 0, 0], [10, 10, 10]]);
	} finally { compiled.dispose(); }

	const touching = compileScad('audit_part("left") cube(10); translate([10,0,0]) audit_part("right") cube(10);', module, { mode: "render", auditComponents: true });
	try { assert.equal(touching.componentAudit.interferences.length, 0); } finally { touching.dispose(); }
	const separated = compileScad('audit_part("left") cube(10); translate([10.1,0,0]) audit_part("right") cube(10);', module, { mode: "render", auditComponents: true });
	try { assert.equal(separated.componentAudit.interferences.length, 0); } finally { separated.dispose(); }
});

test('audit reports touching parts as contacts and close parts against a clearance', () => {
	const source = 'audit_part("base") cube(10); translate([10,0,0]) audit_part("touch") cube(10); translate([0,0,10.1]) audit_part("near") cube(4); translate([30,0,13]) audit_part("far") cube(1);';
	const compiled = compileScad(source, module, { mode: "render", auditComponents: true, auditClearance: 0.2 });
	try {
		const audit = compiled.componentAudit;
		assert.equal(audit.interferences.length, 0);
		assert.deepEqual(audit.contacts.map(({ parts }) => parts), [["base", "touch"]]);
		assert.deepEqual(audit.clearances.map(({ parts }) => parts), [["base", "near"]]);
		near(audit.clearances[0].gap, 0.1);
		assert.equal(audit.clearance, 0.2);
	} finally { compiled.dispose(); }
	const defaults = compileScad(source, module, { mode: "render", auditComponents: true });
	try { assert.equal(defaults.componentAudit.contacts.length, 1); assert.equal(defaults.componentAudit.clearances.length, 0); } finally { defaults.dispose(); }
	assert.throws(() => compileScad(source, module, { mode: "render", auditComponents: true, auditClearance: -1 }), /auditClearance/);
});

test('audit_part names and hierarchy are validated and auditing stays opt-in', () => {
	assert.throws(() => compileScad('audit_part("same") cube(1); audit_part("same") translate([2,0,0]) cube(1);', module, { mode: "render", auditComponents: true }), (error) => error.code === "invalid-component");
	assert.throws(() => compileScad('audit_part("outer") audit_part("inner") cube(1);', module, { mode: "render", auditComponents: true }), (error) => error.code === "invalid-component");
	const regular = compileScad('audit_part("part") cube(1);', module, { mode: "render" });
	try { assert.equal(regular.componentAudit, undefined); assert.equal(regular.solid.volume(), 1); } finally { regular.dispose(); }
	const uninstrumented = compileScad('audit_part("same") cube(1); translate([2,0,0]) audit_part("same") cube(1);', module, { mode: "render" });
	try { assert.equal(uninstrumented.solid.volume(), 2); assert.equal(uninstrumented.componentAudit, undefined); } finally { uninstrumented.dispose(); }
});

function checkMetrics(actual, fixture) {
	near(actual.volume, fixture.volume);
	assert.equal(actual.closed, true, fixture.id);
	assert.equal(actual.degenerateTriangles, 0, fixture.id);
	if (fixture.bounds === null) assert.equal(actual.bounds, null);
	else actual.bounds.flat().forEach((coordinate, index) => near(coordinate, fixture.bounds.flat()[index]));
}

test("primary oracle is the pinned 2026 build", async () => {
	const result = await exec(oracle, ["--version"], { timeout: 30_000 });
	assert.match(result.stdout + result.stderr, /OpenSCAD version 2026\.10\.02/);
	const revision = await exec("git", ["-C", path.dirname(path.dirname(oracle)), "rev-parse", "HEAD"]);
	assert.equal(revision.stdout.trim(), "7d44e5796cd489bcbfb8cef0720abe4db60ce35e");
});

test("OpenSCAD hull preserves 2D and 3D convex-envelope geometry", async () => {
	for (const [id, source, expectedVolume] of [
		["solid", "hull() { translate([-2,0,0]) cube(1); translate([2,0,0]) cube(1); }", 5],
		["profile", "linear_extrude(2) hull() { translate([-2,0]) square(1); translate([2,0]) square(1); }", 10],
	]) {
		const input = path.join(directory, `hull-${id}.scad`), output = path.join(directory, `hull-${id}.stl`);
		await writeFile(input, source);
		await exec(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", output, input], { timeout: 30_000 });
		const mesh = decodeBinaryStl(await readFile(output));
		const compiled = compileScad(source, module, { mode: "render" });
		try {
			near(compiled.solid.volume(), expectedVolume);
			withResources((own) => {
				const native = own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
				assert.equal(native.status(), "NoError");
				near(own(native.subtract(compiled.solid)).volume() + own(compiled.solid.subtract(native)).volume(), 0, 0.0001);
			});
		} finally { compiled.dispose(); }
	}
});

test("OpenSCAD linear_extrude defaults, aliases and positional parameters match native", async () => {
	for (const [id, source] of [
		["default", "linear_extrude() square([2,3]);"],
		["height-alias", "linear_extrude(h=7) square([2,3]);"],
		["height-precedence", "linear_extrude(height=3,h=7) square([2,3]);"],
		["positional-scale-center", "linear_extrude(5,undef,2,true) square([2,3]);"],
		["named-center", "linear_extrude(height=4,center=true,scale=[2,2]) square([2,3]);"],
	]) {
		const input = path.join(directory, `linear-parameters-${id}.scad`), output = path.join(directory, `linear-parameters-${id}.stl`);
		await writeFile(input, source);
		await exec(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", output, input], { timeout: 30_000 });
		const mesh = decodeBinaryStl(await readFile(output));
		const compiled = compileScad(source, module, { mode: "render" });
		try {
			const actual = measureMesh(copyMesh(compiled.getMesh())), expected = measureMesh(mesh);
			near(actual.volume, expected.volume);
			actual.bounds.flat().forEach((value, index) => near(value, expected.bounds.flat()[index]));
			withResources((own) => {
				const native = own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
				assert.equal(native.status(), "NoError", id);
				near(own(native.subtract(compiled.solid)).volume() + own(compiled.solid.subtract(native)).volume(), 0, 0.001);
			});
		} finally { compiled.dispose(); }
	}
	for (const height of [0, -3]) {
		const compiled = compileScad(`linear_extrude(${height}) square(2);`, module, { mode: "render" });
		try { assert.equal(compiled.solid.isEmpty(), true); } finally { compiled.dispose(); }
	}
	for (const source of ["linear_extrude(v=[1,0,1]) square();", "linear_extrude(segments=12) square();"]) assert.throws(() => compileScad(source, module), (error) => error.code === "unsupported-feature");
});

test("OpenSCAD rotate_extrude matches native full, partial and reflected profiles", async () => {
	for (const [id, source] of [
		["full", "rotate_extrude($fn=32) translate([2,0]) square([1,2]);"],
		["partial", "rotate_extrude(angle=90,start=30,$fn=32) translate([2,0]) square([1,2]);"],
		["negative-profile", "rotate_extrude(angle=90,$fn=32) translate([-3,0]) square([1,2]);"],
		["negative-angle", "rotate_extrude(angle=-90,start=30,$fn=32) translate([2,0]) square([1,2]);"],
	]) {
		const input = path.join(directory, `rotate-${id}.scad`), output = path.join(directory, `rotate-${id}.stl`);
		await writeFile(input, source);
		await exec(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", output, input], { timeout: 30_000 });
		const mesh = decodeBinaryStl(await readFile(output));
		const compiled = compileScad(source, module, { mode: "render" });
		try {
			withResources((own) => {
				const native = own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
				assert.equal(native.status(), "NoError", id);
				near(own(native.subtract(compiled.solid)).volume() + own(compiled.solid.subtract(native)).volume(), 0, 0.001);
			});
		} finally { compiled.dispose(); }
	}
});

test("OpenSCAD projection outline/cut and 3D minkowski match native shapes", async () => {
	for (const [id, source] of [
		["projection-outline", "linear_extrude(1) projection() union() { cube([2,3,4]); translate([4,0,2]) cube([2,3,4]); }"],
		["projection-cut", "linear_extrude(1) projection(cut=true) cylinder(h=4,r1=1,r2=3,center=true,$fn=32);"],
		["minkowski", "minkowski() { cube(2); translate([2,0,0]) cube(1); }"],
		["minkowski-three", "minkowski() { cube(1); translate([2,0,0]) cube(1); translate([0,2,0]) cube(1); }"],
		["minkowski-hollow", "minkowski() { difference() { cube(4,center=true); cube(2,center=true); } cube(1,center=true); }"]
	]) {
		const input = path.join(directory, `operation-${id}.scad`), output = path.join(directory, `operation-${id}.stl`);
		await writeFile(input, source);
		await exec(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", output, input], { timeout: 30_000 });
		const mesh = decodeBinaryStl(await readFile(output));
		const compiled = compileScad(source, module, { mode: "render" });
		try {
			withResources((own) => {
				const native = own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
				assert.equal(native.status(), "NoError", id);
				near(own(native.subtract(compiled.solid)).volume() + own(compiled.solid.subtract(native)).volume(), 0, 0.002);
			});
		} finally { compiled.dispose(); }
	}
});

test("OpenSCAD offset, fill, and resize match native 2D/3D geometry", async () => {
	for (const [id, source] of [
		["offset-round", "linear_extrude(2) offset(r=1,$fn=24) square([4,4]);"],
		["offset-miter", "linear_extrude(2) offset(delta=1) square([4,4]);"],
		["offset-chamfer", "linear_extrude(2) offset(delta=1,chamfer=true) square([4,4]);"],
		["fill-hole", "linear_extrude(2) fill() difference(){square(6);translate([2,2])square(2);}"],
		["fill-nested-island", "linear_extrude(1) fill(){difference(){square(10);translate([2,2])square(6);}translate([4,4])square(2);}"],
		["fill-disconnected-islands", "linear_extrude(1) fill(){difference(){square(10);translate([2,2])square(6);}translate([4,4])square(2);translate([20,0])difference(){square(4);translate([1,1])square(2);}}"],
		["fill-deep-nesting", "linear_extrude(1) fill(){difference(){square(20);translate([2,2])square(16);}translate([4,4])difference(){square(12);translate([2,2])square(8);}translate([8,8])square(4);}"],
		["resize-2d-auto", "linear_extrude(2) resize([10,0],auto=true) square([2,4]);"],
		["resize-3d-auto", "resize([10,0,0],auto=true) cube([2,4,6]);"],
		["resize-3d-partial", "resize([10,0,5]) cube([2,4,6]);"],
	]) {
		const input = path.join(directory, `shape-op-${id}.scad`), output = path.join(directory, `shape-op-${id}.stl`);
		await writeFile(input, source);
		await exec(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", output, input], { timeout: 30_000 });
		const mesh = decodeBinaryStl(await readFile(output));
		const compiled = compileScad(source, module, { mode: "render" });
		try {
			const fillVolumes = { "fill-nested-island": 100, "fill-disconnected-islands": 116, "fill-deep-nesting": 400 };
			if (Object.hasOwn(fillVolumes, id)) near(compiled.solid.volume(), fillVolumes[id]);
			withResources((own) => {
				const native = own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
				assert.equal(native.status(), "NoError", id);
				near(own(native.subtract(compiled.solid)).volume() + own(compiled.solid.subtract(native)).volume(), 0, id.startsWith("offset-round") ? 0.01 : 0.001);
			});
		} finally { compiled.dispose(); }
	}
});

for (const fixture of geometryCases) {
	test(`SCAD evaluator to Manifold: ${fixture.id}`, () => {
		const compiled = compileScad(fixture.source, module, { mode: "render" });
		try { checkMetrics(measureMesh(copyMesh(compiled.getMesh())), fixture); }
		finally { compiled.dispose(); }
	});

	test(`headless WASM and binary STL: ${fixture.id}`, () => {
		assert.equal(typeof document, "undefined");
		const result = runGeometryCase(module, fixture);
		checkMetrics(result, fixture);
		checkMetrics(result.roundTrip, fixture);
		assert.equal(result.bytes, 84 + result.triangles * 50);
	});

	test(`OpenSCAD geometry conformance: ${fixture.id}`, async () => {
		const sourcePath = path.join(directory, `${fixture.id}.scad`);
		const outputPath = path.join(directory, `${fixture.id}.stl`);
		await writeFile(sourcePath, fixture.source);
		let output;
		try {
			output = await exec(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", outputPath, sourcePath], { timeout: 30_000 });
		} catch (error) {
			if (fixture.volume !== 0 || !/Current top level object is empty/.test(error.stderr ?? "")) throw error;
			assert.equal(runGeometryCase(module, fixture).triangles, 0);
			return;
		}
		assert.doesNotMatch(output.stderr, /ERROR:/);
		const warnings = output.stderr.split(/\r?\n/).filter((line) => line.startsWith("WARNING:"));
		assert.equal(warnings.length, (fixture.warnings ?? []).length);
		(fixture.warnings ?? []).forEach((pattern, index) => assert.match(warnings[index], new RegExp(pattern)));
		const mesh = decodeBinaryStl(await readFile(outputPath));
		checkMetrics(measureMesh(mesh), fixture);
		withResources((own) => {
			const native = own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
			assert.equal(native.status(), "NoError");
			const candidate = fixture.build(module, own);
			const missing = own(native.subtract(candidate));
			const extra = own(candidate.subtract(native));
			near(missing.volume() + extra.volume(), 0, 0.001);
			const compiled = compileScad(fixture.source, module, { mode: "render" });
			try {
				near(own(native.subtract(compiled.solid)).volume() + own(compiled.solid.subtract(native)).volume(), 0, 0.001);
			} finally { compiled.dispose(); }
		});
	});
}

for (const fixture of languageCases) {
	test(`OpenSCAD language reference: ${fixture.id}`, async () => {
		const sourcePath = path.join(directory, `${fixture.id}.scad`);
		const outputPath = path.join(directory, `${fixture.id}.echo`);
		await writeFile(sourcePath, fixture.source);
		await exec(oracle, ["-o", outputPath, sourcePath], { timeout: 30_000 });
		const output = (await readFile(outputPath, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(output.filter((line) => line.startsWith("ECHO:")), fixture.echoes);
		assert.deepEqual(output.filter((line) => !line.startsWith("ECHO:")), fixture.diagnostics ?? []);
	});
}

test("rejects invalid mesh input and truncated STL", () => {
	withResources((own) => {
		assert.throws(() => {
			const invalid = own(new module.Manifold(new module.Mesh({
				numProp: 3,
				vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
				triVerts: new Uint32Array([0, 1, 2]),
			})));
			if (invalid.status() !== "NoError") throw new Error(invalid.status());
		});
	});
	assert.throws(() => decodeBinaryStl(new Uint8Array(20)), /Truncated/);
	const mesh = withResources((own) => copyMesh(own(module.Manifold.cube(1)).getMesh()));
	const bytes = encodeBinaryStl(mesh);
	assert.throws(() => decodeBinaryStl(bytes.subarray(0, bytes.length - 1)), /length/);
});

test("repeated build/export/dispose cycles remain usable", (context) => {
	geometryCases.forEach((fixture) => runGeometryCase(module, fixture));
	const durations = [];
	for (let cycle = 0; cycle < 100; cycle++) {
		const fixture = geometryCases[cycle % geometryCases.length];
		const started = performance.now();
		checkMetrics(runGeometryCase(module, fixture), fixture);
		durations.push(performance.now() - started);
	}
	durations.sort((first, second) => first - second);
	context.diagnostic(JSON.stringify({
		backend: "manifold-3d@3.5.4", node: process.version, cpu: cpus()[0]?.model,
		cycles: durations.length, medianMs: durations[50], p95Ms: durations[95],
	}));
});

test("SCAD adapter closes the raw Manifold sphere incompatibility", async (context) => {
	const sourcePath = path.join(directory, "sphere-tessellation.scad");
	const outputPath = path.join(directory, "sphere-tessellation.stl");
	await writeFile(sourcePath, "$fn=32; sphere(r=5);");
	await exec(oracle, ["--backend=Manifold", "--export-format=binstl", "-o", outputPath, sourcePath], { timeout: 30_000 });
	const mesh = decodeBinaryStl(await readFile(outputPath));
	withResources((own) => {
		const native = own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
		assert.equal(native.status(), "NoError");
		const candidate = own(module.Manifold.sphere(5, 32));
		const difference = own(native.subtract(candidate)).volume() + own(candidate.subtract(native)).volume();
		assert.ok(difference > 0.01, "Revisit this recorded incompatibility if the pinned constructors become equivalent");
		const compatible = own(new GeometryAdapter(module).sphere({ r: 5, $fn: 32 }));
		const adapterDifference = own(native.subtract(compatible)).volume() + own(compatible.subtract(native)).volume();
		near(adapterDifference, 0, 0.001);
		context.diagnostic(JSON.stringify({ fixture: "sphere(r=5, $fn=32)", rawKernelDifference: difference, adapterDifference, nativeVolume: native.volume(), adapterVolume: compatible.volume() }));
	});
});

test("fragment resolution uses fixed counts, adaptive minimums, and native clamps", () => {
	assert.equal(fragmentCount(5), 16);
	assert.equal(fragmentCount(5, { $fa: 45, $fs: 0.1 }), 8);
	assert.equal(fragmentCount(5, { $fa: 1, $fs: 4 }), 8);
	assert.equal(fragmentCount(5, { $fn: 3.1 }), 4);
	assert.equal(fragmentCount(5, { $fn: 1 }), 3);
	assert.equal(fragmentCount(0.01), 5);
	assert.equal(fragmentCount(1e-7, { $fn: 32 }), 3);
	const diagnostics = [];
	assert.equal(fragmentCount(2, { $fn: -1, $fa: 0, $fs: 0 }, (warning) => diagnostics.push(warning)), 1257);
	assert.deepEqual(diagnostics.map((warning) => warning.code), ["negative-fn", "clamped-fa", "clamped-fs"]);
});

test("scopes and primitive-local special variables cannot leak", () => {
	const parent = new GeometryAdapter(module, { specialVariables: { $fn: 6 } });
	const child = parent.withSpecialVariables({ $fn: 8 });
	withResources((own) => {
		assert.equal(copyMesh(own(parent.sphere({ r: 2 })).getMesh()).triangles.length / 3, 32);
		assert.equal(copyMesh(own(child.sphere({ r: 2 })).getMesh()).triangles.length / 3, 60);
		assert.equal(copyMesh(own(child.sphere({ r: 2, $fn: 7 }, { $fn: 9 })).getMesh()).triangles.length / 3, 52);
		assert.equal(copyMesh(own(parent.sphere({ r: 2 })).getMesh()).triangles.length / 3, 32);
	});
	assert.deepEqual(parent.specialVariables, { $fn: 6, $fa: 12, $fs: 2 });
	assert.equal(child.specialVariables.$fn, 8);
	assert.ok(Object.isFrozen(parent.specialVariables));
});

test("adapter diagnostics, finite input contract, and preallocation limits", () => {
	const diagnostics = [];
	const adapter = new GeometryAdapter(module, { maxTriangles: 1000, onDiagnostic: (warning) => diagnostics.push(warning) });
	withResources((own) => {
		own(adapter.sphere({ r: 9, d: 4, $fn: -1 }));
		assert.deepEqual(diagnostics.map((warning) => warning.code), ["diameter-precedence", "negative-fn"]);
	});
	assert.throws(() => adapter.sphere({ $fn: 1e9 }), /triangle limit/);
	assert.throws(() => adapter.cylinder({ $fn: 1e9 }), /triangle limit/);
	assert.throws(() => adapter.sphere({ r: NaN }), /finite number/);
	assert.throws(() => adapter.cylinder({ center: 1 }), /boolean/);
	assert.throws(() => adapter.sphere({ style: "octa" }), /Only sphere style/);
	assert.throws(() => fragmentCount(5, { $fs: Infinity }), /finite number/);
	assert.throws(() => new GeometryAdapter(module, { maxTriangles: -1 }), /nonnegative/);
	assert.equal(tessellateSphere({ r: 2 }, { $fn: 7 }).vertProperties.length / 3, 28);
	assert.equal(tessellateCylinder({ r1: 0, r2: 2 }, { $fn: 7 }).vertProperties.length / 3, 8);
});