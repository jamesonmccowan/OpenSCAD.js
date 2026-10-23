import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createFilesystemProject } from "../src/node/filesystem.js";
import { resolveProject } from "../src/core/project.js";
import { evaluate } from "../src/core/evaluator.js";

test("filesystem roots and explicit libraries resolve through the virtual project contract", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-fs-"));
	try {
		const root = path.join(directory, "project");
		const library = path.join(directory, "library");
		await mkdir(path.join(root, "parts"), { recursive: true }); await mkdir(library);
		await writeFile(path.join(root, "parts/main.scad"), "include <../settings.scad> use <shape.scad> echo(size, value()); shape();");
		await writeFile(path.join(root, "settings.scad"), "size=3;");
		await writeFile(path.join(library, "shape.scad"), "function value()=2; module shape() { cube(2); }");
		const project = await createFilesystemProject({ input: path.join(root, "parts/main.scad"), root, libraryPaths: [library] });
		const resolved = await resolveProject(project);
		assert.deepEqual(evaluate(resolved.statements).echoes, ["ECHO: 3, 2"]);
		assert.equal(project.entry, "parts/main.scad");
		assert.equal(await project.resolver("missing.scad"), undefined);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("filesystem adapter rejects root escape, symlink escape and oversized sources", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-fs-"));
	try {
		const root = path.join(directory, "project"); await mkdir(root);
		await writeFile(path.join(directory, "outside.scad"), "cube(100);");
		await writeFile(path.join(root, "main.scad"), "cube(2);");
		await symlink(path.join(directory, "outside.scad"), path.join(root, "escape.scad"));
		const project = await createFilesystemProject({ input: path.join(root, "main.scad"), maxFileBytes: 4 });
		await assert.rejects(project.resolver("../outside.scad"), (error) => error.code === "restricted-path");
		await assert.rejects(project.resolver("escape.scad"), (error) => error.code === "restricted-path");
		await assert.rejects(project.resolver("main.scad"), (error) => error.code === "resource-limit");
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("authorized directory symlinks work but special source files fail without blocking", { skip: process.platform !== "linux" }, async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-fs-"));
	try {
		const root = path.join(directory, "project"); await mkdir(root);
		await writeFile(path.join(root, "main.scad"), "cube(2);");
		await symlink(root, path.join(directory, "alias"));
		const project = await createFilesystemProject({ input: path.join(directory, "alias/main.scad") });
		assert.equal(await project.resolver(project.entry), "cube(2);");
		await promisify(execFile)("mkfifo", [path.join(root, "pipe.scad")]);
		await assert.rejects(project.resolver("pipe.scad"), (error) => error.code === "io-error");
		const entry = await import("openscad-js-studio/node");
		assert.equal(entry.createFilesystemProject, createFilesystemProject);
	} finally { await rm(directory, { recursive: true, force: true }); }
});