import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createEngine, createWorkerEngine } from "../src/index.js";
import { createFilesystemProject } from "../src/node/filesystem.js";

const exec = promisify(execFile);
const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));

const dxf = `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nCROSS\n10\n0\n20\n0\n11\n10\n21\n10\n0\nLINE\n8\nCROSS\n10\n0\n20\n10\n11\n10\n21\n0\n0\nLINE\n8\nOTHER\n10\n50\n20\n50\n11\n60\n21\n60\n0\nDIMENSION\n8\nDIMS\n1\nwidth\n70\n1\n13\n1\n23\n2\n14\n5\n24\n6\n0\nDIMENSION\n8\nDIMS\n1\nrotated\n70\n0\n50\n0\n13\n0\n23\n0\n14\n10\n24\n4\n0\nDIMENSION\n8\nDIMS\n1\nangular\n70\n2\n10\n2\n20\n0\n15\n0\n25\n0\n13\n0\n23\n0\n14\n0\n24\n1\n0\nDIMENSION\n8\nDIMS\n1\nradius\n70\n4\n10\n1\n20\n1\n15\n4\n25\n5\n0\nDIMENSION\n8\nDIMS\n1\nordinate\n70\n70\n13\n12\n23\n3\n0\nENDSEC\n0\nEOF\n`;
const source = `echo(dxf_dim(file="model.dxf",layer="DIMS",name="width"));
echo(dxf_dim(file="model.dxf",layer="DIMS",name="width",origin=[1,2],scale=2));
echo(dxf_dim(file="model.dxf",layer="DIMS",name="rotated"));
echo(dxf_dim(file="model.dxf",layer="DIMS",name="angular"));
echo(dxf_dim(file="model.dxf",layer="DIMS",name="radius"));
echo(dxf_dim(file="model.dxf",layer="DIMS",name="ordinate"));
echo(dxf_cross(file="model.dxf",layer="CROSS"));`;

function compareValues(expected, actual, label = "value") {
	if (Array.isArray(expected)) {
		assert.ok(Array.isArray(actual), `${label} should be a vector`);
		assert.equal(actual.length, expected.length, label);
		expected.forEach((value, index) => compareValues(value, actual[index], `${label}[${index}]`));
	} else assert.ok(Math.abs(expected - actual) < 1e-5, `${label}: ${actual} differs from ${expected}`);
}

function parseEcho(line) {
	const value = line.slice("ECHO: ".length);
	try { return JSON.parse(value); }
	catch { return Number(value); }
}

test("dxf_dim and dxf_cross match native dimensions, transforms, and layer-filtered line intersections", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-dxf-builtins-"));
	try {
		const input = path.join(directory, "main.scad"), nativeOutput = path.join(directory, "native.echo");
		await writeFile(input, source);
		await writeFile(path.join(directory, "model.dxf"), dxf);
		await exec(oracle, [input, "-o", nativeOutput], { timeout: 30_000 });
		const native = (await readFile(nativeOutput, "utf8")).trim().split(/\r?\n/).map(parseEcho);
		assert.equal(native.length, 7);
		for (const factory of [() => createEngine(), () => createWorkerEngine()]) {
			const engine = await factory();
			try {
				const result = await engine.compile({ files: { "main.scad": source }, assets: { "model.dxf": dxf } });
				assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
				assert.deepEqual(result.diagnostics, []);
				const actual = result.echoes.map(parseEcho);
				actual.forEach((value, index) => compareValues(native[index], value, `case ${index}`));
				assert.ok(result.dependencies.includes("model.dxf"));
				result.dispose();
			} finally { await engine.dispose(); }
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("DXF assets resolve through the authorized filesystem resolver in Node workers", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-dxf-filesystem-"));
	const engine = await createWorkerEngine();
	try {
		await writeFile(path.join(directory, "main.scad"), 'echo(dxf_dim(file="model.dxf",layer="DIMS",name="width"));echo(dxf_cross(file="model.dxf",layer="CROSS"));cube(1);');
		await writeFile(path.join(directory, "model.dxf"), dxf);
		const project = await createFilesystemProject({ input: path.join(directory, "main.scad") });
		const result = await engine.compile(project);
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		compareValues(Math.sqrt(32), parseEcho(result.echoes[0]));
		assert.deepEqual(parseEcho(result.echoes[1]), [5, 5]);
		assert.ok(result.dependencies.includes("model.dxf"));
		result.dispose();
		const cli = fileURLToPath(new URL("../bin/openscad-js.js", import.meta.url));
		const cliOutput = path.join(directory, "cli.stl");
		await exec(process.execPath, [cli, path.join(directory, "main.scad"), "-o", cliOutput], { cwd: directory, timeout: 30_000 });
		assert.ok((await readFile(cliOutput)).byteLength > 84);
	} finally { await engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("DXF built-ins keep missing paths, lookup failures, and resource limits structured", async () => {
	const engine = await createEngine();
	try {
		const missing = await engine.compile({ files: { "main.scad": 'echo(dxf_cross(file="missing.dxf"));' } });
		assert.equal(missing.status, "success");
		assert.deepEqual(missing.echoes, ["ECHO: undef"]);
		assert.equal(missing.diagnostics.at(-1).code, "missing-dxf");
		missing.dispose();

		const noDimension = await engine.compile({ files: { "main.scad": 'echo(dxf_dim(file="model.dxf",name="missing"));' }, assets: { "model.dxf": dxf } });
		assert.equal(noDimension.status, "success");
		assert.deepEqual(noDimension.echoes, ["ECHO: undef"]);
		assert.equal(noDimension.diagnostics.at(-1).code, "dxf-lookup");
		noDimension.dispose();

		const tooLarge = await engine.compile({ maxAssetBytes: dxf.length - 1, files: { "main.scad": 'echo(dxf_cross(file="model.dxf"));' }, assets: { "model.dxf": dxf } });
		assert.equal(tooLarge.status, "error");
		assert.equal(tooLarge.diagnostics.at(-1).code, "resource-limit");
	} finally { await engine.dispose(); }
});
