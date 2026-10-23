import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import createModule from "manifold-3d";
import { compileGeometry } from "../src/core/compiler.js";
import { projectCases } from "./fixtures/project-cases.js";
import { resolveProject } from "../src/core/project.js";
import { evaluate } from "../src/core/evaluator.js";

const exec = promisify(execFile);
const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));
const module = await createModule();
module.setup();

for (const fixture of projectCases) {
	test(`native project conformance: ${fixture.id}`, async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-project-"));
		try {
			for (const [name, source] of Object.entries(fixture.files)) {
				const target = path.join(directory, name);
				await mkdir(path.dirname(target), { recursive: true });
				await writeFile(target, source);
			}
			const output = path.join(directory, "result.echo");
			await exec(oracle, ["-o", output, path.join(directory, fixture.entry)], { timeout: 30_000, env: { ...process.env, OPENSCADPATH: (fixture.libraryPaths ?? []).map((root) => path.join(directory, root)).join(path.delimiter) } });
			const lines = (await readFile(output, "utf8")).trim().split(/\r?\n/);
			assert.deepEqual(lines, fixture.echoes);
			const project = await resolveProject(fixture);
			const evaluation = evaluate(project.statements);
			assert.deepEqual(evaluation.echoes, fixture.echoes);
			const result = compileGeometry(evaluation, module);
			try { assert.ok(Math.abs(result.solid.volume() - fixture.volume) < 0.0001); }
			finally { result.dispose(); }
		} finally { await rm(directory, { recursive: true, force: true }); }
	});
}

test("include shares the scope and executes top-level statements", async () => {
	const project = await resolveProject({ files: {
		"main.scad": "include <lib/settings.scad> echo(size); shape();",
		"lib/settings.scad": "size=3; echo(size); module shape() { cube(size); }",
	} });
	const result = evaluate(project.statements);
	assert.deepEqual(result.echoes, ["ECHO: 3", "ECHO: 3"]);
	assert.equal(result.tree.children.at(-1).children[0].args.size, 3);
	assert.deepEqual(project.dependencies, ["main.scad", "lib/settings.scad"]);
});

test("use captures library bindings without exporting assignments or executing geometry", async () => {
	const project = await resolveProject({ files: {
		"main.scad": "use <lib.scad> size=9; echo(size, value()); shape();",
		"lib.scad": "size=3; echo(999); cube(100); function value()=size; module shape() { cube(size); }",
	} });
	const result = evaluate(project.statements);
	assert.deepEqual(result.echoes, ["ECHO: 9, 3"]);
	assert.equal(result.tree.children.at(-1).children[0].args.size, 3);
	assert.equal(result.diagnostics.length, 0);
});

test("relative lookup precedes ordered library roots and locations follow included files", async () => {
	const project = await resolveProject({ entry: "parts/main.scad", libraryPaths: ["libraries"], files: {
		"parts/main.scad": "include <../settings.scad> use <shape.scad> shape();",
		"settings.scad": "size=2;",
		"libraries/shape.scad": "module shape() { sphere(r=2); }",
	} });
	const result = evaluate(project.statements);
	assert.equal(result.tree.children[0].children[0].location.file, "libraries/shape.scad");
	assert.deepEqual(project.dependencies, ["parts/main.scad", "settings.scad", "libraries/shape.scad"]);
});

test("missing files, traversal, cycles and aggregate limits fail explicitly", async () => {
	await assert.rejects(resolveProject({ files: { "main.scad": "include <missing.scad>" } }), (error) => error.code === "missing-file" && error.location.file === "main.scad");
	await assert.rejects(resolveProject({ files: { "main.scad": "include <../escape.scad>" } }), (error) => error.code === "restricted-path");
	await assert.rejects(resolveProject({ files: { "main.scad": "use <https://example.com/lib.scad>" } }), (error) => error.code === "restricted-path");
	await assert.rejects(resolveProject({ files: { "main.scad": "include <main.scad>" } }), (error) => error.code === "dependency-cycle");
	await assert.rejects(resolveProject({ files: { "main.scad": "cube();" }, maxProjectBytes: 2 }), /limit/);
	await assert.rejects(resolveProject({ files: { "main.scad": "cube(); cube();" }, maxStatements: 1 }), /limit/);
});

test("explicit asynchronous host resolution is cancellable", async () => {
	const controller = new AbortController();
	let finish;
	const pending = resolveProject({ signal: controller.signal, resolver: () => new Promise((resolve) => { finish = resolve; }) });
	controller.abort();
	finish("cube();");
	await assert.rejects(pending, (error) => error.code === "cancelled");
});

test("cancellation does not wait for a host resolver that never completes", async () => {
	const controller = new AbortController();
	const pending = resolveProject({ signal: controller.signal, resolver: () => new Promise(() => {}) });
	controller.abort();
	await assert.rejects(pending, (error) => error.code === "cancelled");
});