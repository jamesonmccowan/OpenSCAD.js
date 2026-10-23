import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { clean, generatedPaths } from "../scripts/clean.js";
const exec = promisify(execFile);

test("clean removes only enumerated generated outputs and is repeatable", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-clean-test-"));
	const base = pathToFileURL(directory + path.sep);
	try {
		for (const name of generatedPaths) {
			assert.ok(!name.startsWith("/") && !name.includes(".."));
			await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
			if (/\.(?:js|txt|md)$/.test(name) || name.endsWith("/LICENSE")) await writeFile(path.join(directory, name), "generated");
			else {
				await mkdir(path.join(directory, name), { recursive: true });
				await writeFile(path.join(directory, name, "generated"), "generated");
			}
		}
		const preserved = [
			"src/index.js", "node_modules/installed", "extension/node_modules/installed",
			"extension/.occt-cache/source", "extension/OCCT-SOURCES.txt",
			"references/openscad/build/openscad", "references/scad sample files/hand.scad",
			"src/geometry/roof-voronoi-wasm.wasm", ".release-check/report.json", "robot/local",
		];
		for (const name of preserved) {
			await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
			await writeFile(path.join(directory, name), "preserve");
		}
		await clean(base);
		await clean(base);
		for (const name of generatedPaths) await assert.rejects(stat(path.join(directory, name)), { code: "ENOENT" });
		for (const name of preserved) assert.equal(await readFile(path.join(directory, name), "utf8"), "preserve", name);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("release gate fails closed on missing dependencies, clears stale success and preserves source/build inputs", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-gate-test-"));
	try {
		await mkdir(path.join(directory, "scripts"));
		await mkdir(path.join(directory, ".release-check"));
		await mkdir(path.join(directory, "dist"));
		await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
		for (const name of ["release-check.js", "clean.js"]) {
			await copyFile(new URL(`../scripts/${name}`, import.meta.url), path.join(directory, "scripts", name));
		}
		for (const name of ["SHA256SUMS", "extension.vsix", "openscad-js-studio-0.1.0.tgz", "old-stage.log"]) {
			await writeFile(path.join(directory, ".release-check", name), "stale");
		}
		await writeFile(path.join(directory, "dist/preserved-until-preflight"), "preserve");
		await assert.rejects(exec(process.execPath, ["scripts/release-check.js"], { cwd: directory }), error => {
			assert.equal(error.code, 1);
			assert.match(error.stderr, /Release gate FAILED/);
			return true;
		});
		const report = JSON.parse(await readFile(path.join(directory, ".release-check/report.json"), "utf8"));
		assert.equal(report.status, "failed");
		assert.match(report.error, /Missing node_modules\/esbuild|Use Node 22/);
		assert.deepEqual(report.stages, []);
		for (const name of ["SHA256SUMS", "extension.vsix", "openscad-js-studio-0.1.0.tgz", "old-stage.log", "running.lock"]) {
			await assert.rejects(stat(path.join(directory, ".release-check", name)), { code: "ENOENT" });
		}
		assert.equal(await readFile(path.join(directory, "dist/preserved-until-preflight"), "utf8"), "preserve");
		await writeFile(path.join(directory, ".release-check/running.lock"), "existing-owner");
		await assert.rejects(exec(process.execPath, ["scripts/release-check.js"], { cwd: directory }));
		assert.equal(await readFile(path.join(directory, ".release-check/running.lock"), "utf8"), "existing-owner");
		assert.deepEqual(JSON.parse(await readFile(path.join(directory, ".release-check/report.json"), "utf8")), report);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
