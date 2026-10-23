import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createEngine, createWorkerEngine, evaluate } from "../src/index.js";
import { createSystemFontResolver } from "../src/node/fonts.js";
import { createBrowserFonts } from "../src/studio/fonts.js";
import { fontIdentity, parseFontData } from "../src/geometry/font-data.js";
import { runtimeFont } from "./helpers/fonts.js";

const name = "Runtime Test Sans:style=Bold Italic";
const bytes = await runtimeFont("Bold Italic");
const source = `tm=textmetrics("Arial",font="${name}"); fm=fontmetrics(font="${name}"); echo([tm.size,fm.font]); linear_extrude(1) text("Arial",font="${name}");`;

test("metric font preparation does not consume the shared random stream", async () => {
	evaluate("echo(rands(0,1,1,123));");
	const expected = evaluate("echo(rands(0,1,1));").echoes;
	const next = evaluate("echo(rands(0,1,1));").echoes;
	evaluate("echo(rands(0,1,1,123));");
	const engine = await createEngine();
	try {
		const result = await engine.compile({ files: { "main.scad": 'echo(rands(0,1,1)); echo(fontmetrics().font); cube(1);' } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try { assert.equal(result.echoes[0], expected[0]); } finally { result.dispose(); }
		assert.deepEqual(evaluate("echo(rands(0,1,1));").echoes, next);
	} finally { engine.dispose(); }
});

for (const [kind, factory] of [["direct", createEngine], ["worker", createWorkerEngine]]) {
	test(`${kind} runtime fonts resolve geometry and metrics consistently without bundling`, async () => {
		const engine = await factory();
		try {
			for (const supplied of [true, false]) {
				let calls = 0;
				const result = await engine.compile({ files: { "main.scad": source }, ...(supplied ? { fonts: { [name]: bytes } } : { fontResolver: async (requested, { signal }) => {
					assert.equal(requested, name);
					assert.equal(signal.aborted, false);
					calls++;
					return bytes;
				} }) });
				assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
				try {
					assert.equal(result.diagnostics.length, 0);
					assert.ok(result.volume > 0);
					assert.match(result.echoes[0], /Runtime Test Sans/);
					assert.match(result.echoes[0], /Bold Italic/);
					assert.equal(calls, supplied ? 0 : 1);
				} finally { result.dispose(); }
			}
			const absent = await engine.compile({ files: { "main.scad": source } });
			assert.equal(absent.status, "error");
			assert.equal(absent.diagnostics.at(-1).code, "missing-font", "fonts must not leak across compilations");
			assert.equal(absent.diagnostics.at(-1).location.line, 1);
		} finally { await engine.dispose(); }
	});
	test(`${kind} runtime fonts reject missing, malformed, oversized data and resolver errors`, async () => {
		const engine = await factory();
		try {
			for (const [options, code, message] of [
				[{ fontResolver: () => undefined }, "missing-font", /was not found/],
				[{ fonts: { [name]: new Uint8Array([1, 2, 3]) } }, "invalid-font", /Cannot load font/],
				[{ fonts: { [name]: bytes }, maxFontBytes: 1 }, "resource-limit", /Font byte limit/],
				[{ fontResolver: () => bytes, maxFontBytes: 1 }, "resource-limit", /Font byte limit/],
				[{ fonts: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`Font ${index}`, bytes])) }, "resource-limit", /Font face limit/],
				[{ fontResolver: () => { throw new Error("Font permission denied"); } }, "invalid-font", /permission denied/],
			]) {
				const result = await engine.compile({ files: { "main.scad": source }, ...options });
				assert.equal(result.status, "error");
				assert.equal(result.diagnostics.at(-1).code, code);
				assert.match(result.diagnostics.at(-1).message, message);
			}
		} finally { await engine.dispose(); }
	});

	test("worker cancellation aborts a pending runtime font lookup", async () => {
		const engine = await createWorkerEngine();
		const controller = new AbortController();
		let started;
		const ready = new Promise(resolve => { started = resolve; });
		let aborted = false;
		try {
			const pending = engine.compile({ files: { "main.scad": source }, signal: controller.signal, fontResolver: (name, { signal }) => new Promise((resolve, reject) => {
				signal.addEventListener("abort", () => { aborted = true; reject(new Error("Font lookup cancelled")); }, { once: true });
				started();
			}) });
			await ready;
			controller.abort();
			const result = await pending;
			assert.equal(result.status, "cancelled");
			assert.equal(aborted, true);
		} finally { await engine.dispose(); }
	});
}

test("font directories match embedded names/styles, not filenames, and do not substitute", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "openscad-js-fonts-"));
	try {
		await mkdir(path.join(directory, "nested"));
		await writeFile(path.join(directory, "nested", "arbitrary.ttf"), bytes);
		await writeFile(path.join(directory, "broken.ttf"), "invalid");
		const warnings = [];
		const resolver = createSystemFontResolver({ fontDirectories: [directory], systemFonts: false, onWarning: message => warnings.push(message) });
		assert.deepEqual(await resolver(name), bytes);
		assert.match(warnings[0], /Cannot inspect font.*broken.ttf/);
		assert.deepEqual(await resolver("runtime test sans:style=bold italic"), bytes);
		assert.equal(await resolver("Arial:style=Bold Italic"), undefined);
		assert.equal(await resolver("Runtime Test Sans:style=Regular"), undefined);
		const faces = await resolver.listFonts();
		assert.equal(faces.filter(face => face.source === "bundled").length, 12);
		assert.deepEqual(faces.filter(face => face.source !== "bundled"), [{ family: "Runtime Test Sans", style: "Bold Italic", name, source: "directory" }]);
		assert.deepEqual(await resolver(faces.find(face => face.source === "directory").name), bytes);
		assert.equal((await createSystemFontResolver({ systemFonts: false }).listFonts()).length, 12);
		const input = path.join(directory, "text.scad"), output = path.join(directory, "text.stl");
		await writeFile(input, source);
		const cli = fileURLToPath(new URL("../bin/openscad-js.js", import.meta.url));
		const exec = promisify(execFile);
		const success = await exec(process.execPath, [cli, input, "-o", output, "--font-dir", directory, "--no-system-fonts"]);
		assert.match(success.stderr, /Runtime Test Sans/);
		const json = await exec(process.execPath, [cli, input, "-o", output, "--font-dir", directory, "--no-system-fonts", "--diagnostics=json"]);
		assert.equal(JSON.parse(json.stderr).diagnostics[0].code, "font-discovery");
		await assert.rejects(exec(process.execPath, [cli, input, "-o", output, "--font-dir", directory, "--no-system-fonts", "--hardwarnings"]), (error) => error.code === 1 && /hard-warning/.test(error.stderr));
		await assert.rejects(exec(process.execPath, [cli, input, "-o", output, "--no-system-fonts"]), (error) => error.code === 1 && /missing-font/.test(error.stderr));
		await assert.rejects(createSystemFontResolver({ fontDirectories: [path.join(directory, "missing")], systemFonts: false })(name), /ENOENT/);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(resolver(name, { signal: controller.signal }), /cancel/i);
		await assert.rejects(resolver.listFonts({ signal: controller.signal }), /cancel/i);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("browser font files register atomically and local font data loads lazily", async () => {
	const fonts = createBrowserFonts();
	const file = { name: "custom.ttf", size: bytes.length, arrayBuffer: async () => bytes.buffer };
	await fonts.addFiles([file]);
	assert.equal(fonts.count, 1);
	assert.deepEqual(await fonts.resolve(name), bytes);
	assert.equal(await fonts.resolve("Absent"), undefined);
	await assert.rejects(fonts.addFiles([{ ...file, name: "wrong.woff2" }]), /Unsupported font file/);
	await assert.rejects(fonts.addFiles([{ ...file, size: 1, arrayBuffer: async () => new ArrayBuffer(1) }]));
	assert.equal(fonts.count, 1);
	assert.deepEqual(fontIdentity(parseFontData(await fonts.resolve(name))).family, "Runtime Test Sans");

	const local = createBrowserFonts();
	let reads = 0;
	await local.enableLocalFonts(async () => [{ family: "Runtime Test Sans", style: "Bold Italic", blob: async () => {
		reads++;
		return new Blob([bytes]);
	} }]);
	assert.equal(reads, 0);
	assert.equal(local.localCount, 1);
	assert.deepEqual(await local.resolve(name), bytes);
	assert.deepEqual(await local.resolve(name), bytes);
	assert.equal(reads, 1);
	await assert.rejects(local.enableLocalFonts(async () => { throw new Error("Permission denied"); }), /Permission denied/);
	await assert.rejects(local.enableLocalFonts(null), /does not support local font access/);
	await assert.rejects(createBrowserFonts({ maxFontBytes: 1 }).addFiles([file]), /byte limit/);
});
