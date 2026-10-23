import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";

const cli = fileURLToPath(new URL("../bin/openscad-js.js", import.meta.url));
const exec = promisify(execFile);

function command(args, { input, cwd, signalAfterMs } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
		const stdout = []; const stderr = [];
		child.stdout.on("data", (data) => stdout.push(data)); child.stderr.on("data", (data) => stderr.push(data));
		child.on("error", reject);
		const timer = signalAfterMs ? setTimeout(() => child.kill("SIGINT"), signalAfterMs) : undefined;
		child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") }); });
		if (input !== undefined) child.stdin.end(input); else child.stdin.end();
	});
}

test("CLI reports implemented help/version and validates invocation", async () => {
	const help = await exec(process.execPath, [cli, "--help"]);
	assert.match(help.stdout, /Usage: openscad-js/);
	assert.match(help.stdout, /object-function/);
	assert.match(help.stdout, /import-function/);
	assert.match((await exec(process.execPath, [cli, "--version"])).stdout, /OpenSCAD.js 0\.1\.0/);
	await assert.rejects(exec(process.execPath, [cli]), (error) => error.code === 2 && /required/.test(error.stderr));
	await assert.rejects(exec(process.execPath, [cli, "--unknown"]), (error) => error.code === 2);
	const json = await command(["--unknown", "--diagnostics", "json"]);
	assert.equal(json.code, 2); assert.equal(JSON.parse(json.stderr).status, "error");
	const profile = await command(["--version", "--profile=unknown"]);
	assert.equal(profile.code, 2); assert.equal(profile.stdout.length, 0);
});

test("CLI enables experimental object functions explicitly", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cli-object-"));
	try {
		const input = path.join(directory, "model.scad"), output = path.join(directory, "model.stl");
		await writeFile(input, 'shape=object(size=2); cube(shape.size);');
		await assert.rejects(exec(process.execPath, [cli, input, "-o", output]), (error) => error.code === 1 && /experimental-disabled/.test(error.stderr));
		const result = await exec(process.execPath, [cli, input, "--enable=object-function", "-o", output]);
		assert.equal(result.stdout, "");
		assert.ok(Math.abs(measureMesh(decodeBinaryStl(await readFile(output))).volume - 8) < 1e-9);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI imports JSON data from the authorized project root when enabled", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cli-json-import-"));
	try {
		const input = path.join(directory, "model.scad"), output = path.join(directory, "model.stl");
		await writeFile(input, 'data=import("data.json"); cube(data.size);');
		await writeFile(path.join(directory, "data.json"), '{"size":3}');
		await assert.rejects(exec(process.execPath, [cli, input, "-o", output]), (error) => error.code === 1 && /experimental-disabled/.test(error.stderr));
		const result = await exec(process.execPath, [cli, input, "--enable=import-function", "-o", output]);
		assert.equal(result.stdout, "");
		assert.ok(Math.abs(measureMesh(decodeBinaryStl(await readFile(output))).volume - 27) < 1e-9);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI compiles .scad with expression overrides and writes final binary STL", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cli-"));
	try {
		const input = path.join(directory, "model.scad");
		const output = path.join(directory, "model.stl");
		await writeFile(input, "size=2; echo(size); cube(size); %cube(100);");
		const result = await exec(process.execPath, [cli, input, "-D", "size=1+2", "-o", output]);
		assert.equal(result.stdout, ""); assert.match(result.stderr, /ECHO: 3/);
		const mesh = measureMesh(decodeBinaryStl(await readFile(output)));
		assert.ok(Math.abs(mesh.volume - 27) < 1e-9); assert.equal(mesh.closed, true);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("stdin/stdout carry artifacts only and JSON diagnostics stay on stderr", async () => {
	const result = await command(["-", "-o", "-", "--diagnostics=json", "-Dsize=2", "-Dsize=3"], { input: "echo(size); cube(size);" });
	assert.equal(result.code, 0);
	assert.ok(Math.abs(measureMesh(decodeBinaryStl(result.stdout)).volume - 27) < 1e-9);
	const report = JSON.parse(result.stderr);
	assert.equal(report.status, "success"); assert.deepEqual(report.echoes, ["ECHO: 3"]);
	const ascii = await command(["-", "-o", "-", "--export-format=asciistl", "--time=0.5"], { input: "echo($t); translate([10*$t,0,0]) cube();" });
	assert.equal(ascii.code, 0); assert.match(ascii.stdout.toString(), /^solid openscad_js/); assert.match(ascii.stderr, /ECHO: 0.5/);
});

test("CLI -D metric overrides prepare the bundled font", async () => {
	const result = await command(["-", "-o", "-", "--diagnostics=json", "-D", 'metrics=fontmetrics(font="Liberation Sans")'], { input: 'metrics=undef;echo(metrics.font.family);cube(2);' });
	assert.equal(result.code, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stderr).echoes, ['ECHO: "Liberation Sans"']);
	assert.ok(Math.abs(measureMesh(decodeBinaryStl(result.stdout)).volume - 8) < 1e-9);
});

test("CLI vector built-ins support expression overrides and structured warning policy", async () => {
	const result = await command(["-", "-o", "-", "--diagnostics=json", "-Dwidth=norm([3,4])", "-Dheight=-cross([2,3],[4,5])"], { input: 'echo(cross([1,2],[3,"4"]),str(norm([1e200])));cube([width,width,height]);' });
	assert.equal(result.code, 0, result.stderr);
	assert.ok(Math.abs(measureMesh(decodeBinaryStl(result.stdout)).volume - 50) < 1e-9);
	assert.deepEqual(JSON.parse(result.stderr).echoes, ['ECHO: -6, "inf"']);
	const input = 'echo(norm([3,"4"]),cross([1,2,3],[4,true,6]));cube(2);';
	const warning = await command(["-", "-o", "-", "--diagnostics=json"], { input });
	assert.equal(warning.code, 0, warning.stderr);
	assert.ok(Math.abs(measureMesh(decodeBinaryStl(warning.stdout)).volume - 8) < 1e-9);
	const diagnostics = JSON.parse(warning.stderr).diagnostics;
	assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.code), ["norm-arguments", "cross-arguments"]);
	assert.ok(diagnostics.every((diagnostic) => diagnostic.severity === "warning" && diagnostic.location));
	const strict = await command(["-", "-o", "-", "--diagnostics=json", "--hardwarnings"], { input });
	assert.equal(strict.code, 1);
	assert.equal(strict.stdout.length, 0);
	assert.equal(JSON.parse(strict.stderr).status, "error");
});

test("explicit roots and library paths support includes without granting arbitrary file access", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cli-"));
	try {
		await mkdir(path.join(directory, "project/parts"), { recursive: true }); await mkdir(path.join(directory, "library"));
		const input = path.join(directory, "project/parts/main.scad"); const output = path.join(directory, "model.stl");
		await writeFile(input, "include <../settings.scad> use <shape.scad> shape(size);");
		await writeFile(path.join(directory, "project/settings.scad"), "size=3;");
		await writeFile(path.join(directory, "library/shape.scad"), "module shape(size) { cube(size); }");
		const good = await command([input, "--root", path.join(directory, "project"), "-I", path.join(directory, "library"), "-o", output]);
		assert.equal(good.code, 0); assert.ok(Math.abs(measureMesh(decodeBinaryStl(await readFile(output))).volume - 27) < 1e-9);
		const denied = await command([input, "-I", path.join(directory, "library"), "-o", output]);
		assert.equal(denied.code, 2); assert.match(denied.stderr, /restricted-path/);
		await symlink(path.join(directory, "library/shape.scad"), path.join(directory, "project/escape.scad"));
		await writeFile(input, "include <../escape.scad>");
		const symlinked = await command([input, "--root", path.join(directory, "project"), "-o", output]);
		assert.equal(symlinked.code, 2); assert.match(symlinked.stderr, /Symlink escapes/);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("failures preserve existing output and do not leave temporary or partial artifacts", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cli-"));
	try {
		const input = path.join(directory, "main.scad"); const output = path.join(directory, "model.stl");
		await writeFile(input, "cube("); await writeFile(output, "existing artifact");
		const failed = await command([input, "-o", output, "--diagnostics=json"]);
		assert.equal(failed.code, 1); assert.equal(JSON.parse(failed.stderr).status, "error");
		assert.equal(await readFile(output, "utf8"), "existing artifact");
		await writeFile(input, "sphere(r=1,d=2);");
		const warning = await command([input, "-o", output, "--hardwarnings"]);
		assert.equal(warning.code, 1); assert.match(warning.stderr, /hard-warning/);
		const quiet = await command([input, "-o", output, "-q", "--diagnostics=json"]);
		assert.equal(quiet.code, 0); assert.deepEqual(JSON.parse(quiet.stderr).diagnostics, []);
		assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
		const io = await command([input, "-o", path.join(directory, "missing/out.stl")]);
		assert.equal(io.code, 2);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("limits, empty output policy, malformed defines and output validation are enforced", async () => {
	const limit = await command(["-", "-o", "-", "--max-triangles=10"], { input: "sphere($fn=32);" });
	assert.equal(limit.code, 1); assert.equal(limit.stdout.length, 0);
	const empty = await command(["-", "-o", "-"], { input: "cube(0);" });
	assert.equal(empty.code, 1); assert.match(empty.stderr, /empty-geometry/); assert.equal(empty.stdout.length, 0);
	const permitted = await command(["-", "-o", "-", "--allow-empty"], { input: "cube(0);" });
	assert.equal(permitted.code, 0); assert.equal(permitted.stdout.length, 84);
	const invalid = await command(["-", "-o", "-", "-Dsize=2; cube(100)"], { input: "cube();" });
	assert.equal(invalid.code, 2); assert.equal(invalid.stdout.length, 0);
	const extension = await command(["-", "-o", "model.3mf"], { input: "cube();" });
	assert.equal(extension.code, 2);
	const missing = await command(["not-present.scad", "-o", "-"]);
	assert.equal(missing.code, 2);
});

test("worker deadlines and SIGINT stop busy compilation without output", async () => {
	const timeout = await command(["-", "-o", "-", "--timeout-ms=50"], { input: "sphere(r=10,$fn=800);" });
	assert.equal(timeout.code, 3); assert.equal(timeout.stdout.length, 0);
	const cancelled = await command(["-", "-o", "-"], { input: "sphere(r=10,$fn=800);", signalAfterMs: 300 });
	assert.equal(cancelled.code, 130); assert.equal(cancelled.stdout.length, 0);
});

test("-D expressions resolve script variables, ranges and last overrides like native OpenSCAD", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cli-defines-"));
	const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));
	try {
		const input = path.join(directory, "main.scad");
		await writeFile(input, "base=2; size=1; echo(size); cube(size);");
		const output = path.join(directory, "output.stl");
		const ours = await command([input, "-o", output, "-Dsize=3", "-Dsize=base+2", "--hardwarnings"]);
		assert.equal(ours.code, 0); assert.match(ours.stderr, /ECHO: 4/);
		assert.ok(Math.abs(measureMesh(decodeBinaryStl(await readFile(output))).volume - 64) < 1e-9);
		const native = path.join(directory, "native.echo");
		await exec(oracle, [input, "-o", native, "-D", "size=3", "-D", "size=base+2"]);
		assert.equal((await readFile(native, "utf8")).trim(), "ECHO: 4");
		const ranged = await command(["-", "-o", "-", "-Dpositions=[0:2]"], { input: "for(index=positions) translate([index,0,0]) cube();" });
		assert.equal(ranged.code, 0); assert.ok(Math.abs(measureMesh(decodeBinaryStl(ranged.stdout)).volume - 3) < 1e-9);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
test("CLI audits named parts across sampled times and -D poses", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-audit-"));
	try {
		await writeFile(path.join(directory, "parts.scad"), 'gap = 1; audit_part("base") cube(10); translate([10 + gap, 0, 0]) audit_part("arm") cube(10); translate([0, 0, 10 - 2*$t]) audit_part("lid") cube(4);');
		const text = await command(["--audit", "parts.scad", "--audit-samples", "3"], { cwd: directory });
		assert.equal(text.code, 4, text.stderr);
		assert.match(text.stdout.toString(), /INTERFERENCE base <-> lid: max 32 mm\^3 at frame 2/);
		assert.match(text.stdout.toString(), /CONTACT +base <-> lid: .*1\/3 frames \(0\)/);

		const json = await command(["--audit", "parts.scad", "--audit-times", "0", "--audit-pose", "gap=0", "--audit-pose", "gap = 0.1; unused = [1, 2]", "--audit-clearance", "0.5", "--audit-format", "json", "-o", "report.json"], { cwd: directory });
		assert.equal(json.code, 0, json.stderr);
		assert.equal(json.stdout.length, 0);
		const report = JSON.parse(await readFile(path.join(directory, "report.json"), "utf8"));
		assert.deepEqual(report.components, ["base", "arm", "lid"]);
		assert.deepEqual(report.frames.map(({ pose }) => pose), ["gap=0", "gap = 0.1; unused = [1, 2]"]);
		assert.deepEqual(report.findings.map(({ kind, parts, frames }) => [kind, parts.join(":"), frames]), [["clearance", "base:arm", [1]], ["contact", "base:arm", [0]], ["contact", "base:lid", [0, 1]]]);

		await writeFile(path.join(directory, "single.scad"), 'audit_part("only") cube(1);');
		const single = await command(["--audit", "single.scad", "--diagnostics", "json"], { cwd: directory });
		assert.equal(single.code, 1); assert.match(JSON.parse(single.stderr).diagnostics[0].message, /at least two/);
		const misuse = await command(["parts.scad", "-o", "out.stl", "--audit-samples", "2"], { cwd: directory });
		assert.equal(misuse.code, 2); assert.match(misuse.stderr, /require --audit/);
		const conflict = await command(["--audit", "parts.scad", "--audit-samples", "2", "--audit-times", "0"], { cwd: directory });
		assert.equal(conflict.code, 2);
		const badPose = await command(["--audit", "parts.scad", "--audit-pose", "gap="], { cwd: directory });
		assert.equal(badPose.code, 2);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
