import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createEngine } from "../src/index.js";
import { decodeBinaryStl,measureMesh } from "./helpers/backend.js";
import createModule from "manifold-3d";
import { loadDefaultFont, textContours } from "../src/geometry/text.js";

const kernel = await createModule();
kernel.setup();

function shapeDifference(first, second) {
	const resources = [];
	const own = (value) => { resources.push(value); return value; };
	const solid = (mesh) => {
		const input = new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles });
		input.merge();
		const result = own(new kernel.Manifold(input));
		assert.equal(result.status(), "NoError");
		return result;
	};
	try {
		const native = solid(first), candidate = solid(second);
		return own(native.subtract(candidate)).volume() + own(candidate.subtract(native)).volume();
	} finally { resources.reverse().forEach((resource) => resource.delete()); }
}

const oracle=fileURLToPath(new URL("../references/openscad/build/openscad",import.meta.url));
const exec=promisify(execFile);

for(const [name,source,experimental,tolerance] of [
	["square roof","roof() square([4,4]);",["roof"],0.0001],
	["rectangular roof","roof(method=\"straight\") square([4,8]);",["roof"],0.0001],
	["concave Voronoi roof",'roof() polygon([[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]]);',["roof"],0.001],
	["holed Voronoi roof",'roof() difference(){square(6);translate([2,2])square(2);}',["roof"],0.04],
	["refined holed Voronoi roof",'$fa=1;$fs=0.1;roof() difference(){square(6);translate([2,2])square(2);}',["roof"],0.001],
	["concave straight roof",'roof(method="straight") polygon([[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]]);',["roof"],0.001],
	["holed straight roof",'roof(method="straight") difference(){square(6);translate([2,2])square(2);}',["roof"],0.001],
	...["voronoi", "straight"].flatMap((method) => [
		[`disconnected ${method} roof`, `roof(method="${method}") { square(4); translate([8,0]) square(2); }`, ["roof"], 0.001],
		[`multiple-hole ${method} roof`, `$fa=1;$fs=0.1;roof(method="${method}") difference(){square([10,6]);translate([2,2])square(2);translate([6,2])square(2);}`, ["roof"], 0.002],
	]),
	["text numeral","linear_extrude(1) text(\"5\",size=4,font=\"Liberation Sans\");",[],0.02],
	["resolved text numeral","$fn=24; linear_extrude(1) text(\"0\",size=4,font=\"Liberation Sans\");",[],0.02],
	["bold Sans text",'linear_extrude(1) text("OpenSCAD",size=4,font="Liberation Sans:style=Bold");',[],0.02],
	["italic Serif text",'linear_extrude(1) text("OpenSCAD",size=4,font="Liberation Serif:style=Italic");',[],0.02],
	["bold italic Mono text",'linear_extrude(1) text("OpenSCAD",size=4,font="Liberation Mono:style=Bold Italic");',[],0.02],
]) test(`native ${name} conformance`,async()=>{
	const directory=await mkdtemp(path.join(tmpdir(),"openscad-js-text-roof-"));const engine=await createEngine();
	try{
		const input=path.join(directory,"main.scad"),output=path.join(directory,"native.stl");await writeFile(input,source);
		await exec(oracle,[input,"--backend=Manifold","--export-format=binstl",...(experimental.length?["--enable=roof"]:[]),"-o",output]);
		const nativeMesh=decodeBinaryStl(await readFile(output));
		const native=measureMesh(nativeMesh);
		const result=await engine.compile({mode:"render",experimental,files:{"main.scad":source}});
		assert.equal(result.status,"success",JSON.stringify(result.diagnostics));
		try{
			const candidateMesh=decodeBinaryStl(await engine.export(result));
			const mesh=measureMesh(candidateMesh);
			assert.ok(Math.abs(mesh.volume-native.volume)<tolerance,`${mesh.volume} versus ${native.volume}`);
			mesh.bounds.flat().forEach((value,index)=>assert.ok(Math.abs(value-native.bounds.flat()[index])<Math.min(tolerance,0.001)));assert.equal(mesh.closed,true);
			const difference = shapeDifference(nativeMesh, candidateMesh);
			assert.ok(difference < tolerance * 2, `shape difference ${difference} exceeds ${tolerance * 2}`);
		}finally{result.dispose();}
	}finally{engine.dispose();await rm(directory,{recursive:true,force:true});}
});

test("text and font metrics select the requested bundled family and style", async () => {
	const cases = [
		["Liberation Sans:style=Bold", "Liberation Sans", "Bold"],
		["Liberation Serif:style=Italic", "Liberation Serif", "Italic"],
		["Liberation Mono:style=Bold Italic", "Liberation Mono", "Bold Italic"],
	];
	const engine = await createEngine();
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-font-metrics-"));
	try {
		for (const [font, family, style] of cases) {
			const source = `tm=textmetrics("OpenSCAD",size=12,font="${font}");fm=fontmetrics(size=12,font="${font}");echo([tm.size,tm.advance,fm.font.family,fm.font.style]);`;
			const input = path.join(directory, "metrics.scad"), output = path.join(directory, "native.echo");
			await writeFile(input, source);
			await exec(oracle, [input, "-o", output], { timeout: 30_000 });
			const native = JSON.parse((await readFile(output, "utf8")).trim().slice("ECHO: ".length));
			const result = await engine.compile({ files: { "main.scad": source } });
			assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
			try {
				const actual = JSON.parse(result.echoes[0].slice("ECHO: ".length));
				for (let index = 0; index < 2; index++) actual[index].forEach((value, component) => assert.ok(Math.abs(value - native[index][component]) < 0.02));
				assert.deepEqual(actual.slice(2), [family, style]);
			} finally { result.dispose(); }
		}
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("numeral stencil export matches the native solid within text-outline tolerance", async (context) => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-stencil-"));
	const engine = await createEngine();
	try {
		const input = fileURLToPath(new URL("../references/scad sample files/numbers_stencil.scad", import.meta.url));
		const output = path.join(directory, "native.stl");
		await exec(oracle, [input, "--enable=roof", "--backend=Manifold", "--export-format=binstl", "-o", output], { timeout: 30_000 });
		const native = decodeBinaryStl(await readFile(output));
		const source = await readFile(input, "utf8");
		const flatSource = source.replace(/\broof\(\)/g, "linear_extrude(100)");
		const flatInput = path.join(directory, "flat.scad"), flatOutput = path.join(directory, "flat.stl");
		await writeFile(flatInput, flatSource);
		await exec(oracle, [flatInput, "--backend=Manifold", "--export-format=binstl", "-o", flatOutput], { timeout: 30_000 });
		const flatNative = decodeBinaryStl(await readFile(flatOutput));
		const flat = await engine.compile({ mode: "render", files: { "main.scad": flatSource } });
		assert.equal(flat.status, "success", JSON.stringify(flat.diagnostics));
		let flatDifference;
		try { flatDifference = shapeDifference(flatNative, decodeBinaryStl(await engine.export(flat))) / measureMesh(flatNative).volume; }
		finally { flat.dispose(); }
		const result = await engine.compile({ mode: "render", experimental: ["roof"], files: { "main.scad": source } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try {
			const candidate = decodeBinaryStl(await engine.export(result));
			const expected = measureMesh(native), actual = measureMesh(candidate);
			const difference = shapeDifference(native, candidate);
			assert.equal(actual.closed, true);
			assert.equal(actual.degenerateTriangles, 0);
			assert.ok(difference / expected.volume < 0.01, `relative shape difference ${difference / expected.volume}`);
			assert.ok(flatDifference < 0.01, `flat text shape difference ${flatDifference}`);
			actual.bounds.flat().forEach((value, index) => assert.ok(Math.abs(value - expected.bounds.flat()[index]) < 0.1));
			context.diagnostic(JSON.stringify({ relativeShapeDifference: difference / expected.volume, flatTextShapeDifference: flatDifference, relativeVolumeDifference: Math.abs(actual.volume - expected.volume) / expected.volume }));
		} finally { result.dispose(); }
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("curved numeral roof agrees with native on an identical polygon profile", async () => {
	const rings = textContours({ text: "5", size: 118, valign: "bottom" }, await loadDefaultFont(), 100_000, { $fa: 1, $fs: 0.5 });
	const points = rings.flat();
	let offset = 0;
	const paths = rings.map((ring) => ring.map(() => offset++));
	const source = `$fa=1;$fs=0.5; intersection(){cube([82.55,114.3,12.7]);translate([-7.2,0,0])scale([1.065,1,4])roof()polygon(points=${JSON.stringify(points)},paths=${JSON.stringify(paths)});}`;
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-roof-profile-"));
	const engine = await createEngine();
	try {
		const input = path.join(directory, "main.scad"), output = path.join(directory, "native.stl");
		await writeFile(input, source);
		await exec(oracle, [input, "--enable=roof", "--backend=Manifold", "--export-format=binstl", "-o", output], { timeout: 30_000 });
		const native = decodeBinaryStl(await readFile(output));
		const result = await engine.compile({ mode: "render", experimental: ["roof"], files: { "main.scad": source } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try {
			const difference = shapeDifference(native, decodeBinaryStl(await engine.export(result))) / measureMesh(native).volume;
			assert.ok(difference < 0.001, `identical-profile roof shape difference ${difference}`);
		} finally { result.dispose(); }
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("roof stays opt-in and unsupported methods/fonts fail rather than substituting geometry",async()=>{
	const engine=await createEngine();try{
		assert.equal((await engine.compile({files:{"main.scad":"roof() square(4);"}})).diagnostics.at(-1).code,"experimental-disabled");
		for(const source of ['roof(method="unknown") square(4);',"linear_extrude(1) text(\"5\",font=\"Unknown Font\");"]){
			assert.equal((await engine.compile({experimental:["roof"],files:{"main.scad":source}})).status,"error");
		}
		const empty=await engine.compile({experimental:["roof"],files:{"main.scad":"roof() square(0);"}});assert.equal(empty.status,"success");assert.equal(empty.empty,true);empty.dispose();
	}finally{engine.dispose();}
});

test("text diagnostics distinguish non-string values from unsupported characters", async () => {
	const engine = await createEngine();
	try {
		for (const [value, type] of [["undef", "undef"], ["42", "number"], ["true", "boolean"], ['["label"]', "a list"]]) {
			const result = await engine.compile({ files: { "main.scad": `linear_extrude(1)\ntext(${value});` } });
			assert.equal(result.status, "error");
			const diagnostic = result.diagnostics.at(-1);
			assert.equal(diagnostic.message, `Text requires a string; received ${type}`);
			assert.equal(diagnostic.location.line, 2);
			assert.equal(diagnostic.location.column, 1);
		}
		const outOfRange = await engine.compile({ files: { "main.scad": 'labels=["Rotschy","Inc."];for(i=[0:len(labels)]) linear_extrude(1) text(labels[i]);' } });
		assert.equal(outOfRange.status, "error");
		assert.equal(outOfRange.diagnostics.at(-1).message, "Text requires a string; received undef");
		for (const value of ['"\\u00e9"', '"\\n"']) {
			const result = await engine.compile({ files: { "main.scad": `linear_extrude(1) text(${value});` } });
			assert.equal(result.status, "error");
			assert.equal(result.diagnostics.at(-1).message, "Text currently supports printable Latin ASCII strings");
		}
		assert.deepEqual(textContours({ text: "" }, await loadDefaultFont()), []);
	} finally { engine.dispose(); }
});

test("fidget cube sample renders with bundled bold italic labels", async () => {
	const source = await readFile(new URL("../references/scad sample files/fidget_cube.scad", import.meta.url), "utf8");
	const engine = await createEngine();
	try {
		const result = await engine.compile({ mode: "render", files: { "main.scad": source } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try {
			assert.deepEqual(result.diagnostics, []);
			assert.equal(result.empty, false);
			const mesh = measureMesh(decodeBinaryStl(await engine.export(result)));
			assert.equal(mesh.closed, true);
			assert.ok(mesh.volume > 0);
			assert.equal(mesh.degenerateTriangles, 0);
		} finally { result.dispose(); }
	} finally { engine.dispose(); }
});