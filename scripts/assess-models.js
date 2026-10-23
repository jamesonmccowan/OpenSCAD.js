import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { createHash } from "node:crypto";
import { createFilesystemProject } from "../src/node/filesystem.js";
import { resolveProject } from "../src/core/project.js";
import { CAPABILITIES, evaluate } from "../src/core/evaluator.js";
import { createWorkerEngine } from "../src/index.js";
import { decodeStl } from "../src/geometry/import-stl.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const samples = path.join(root, "references/scad sample files");
const oracle = path.join(root, "references/openscad/build/openscad");
const { values: options } = parseArgs({ options: { compile: { type: "boolean" }, baseline: { type: "boolean" }, enable: { type: "string", multiple: true }, model: { type: "string", multiple: true }, output: { type: "string" } } });
const compileModels = options.compile || options.baseline;
const experimental = options.enable ?? [];
if (experimental.some((feature) => !["roof", "object-function"].includes(feature))) throw new Error("Unknown experimental feature");
const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-assessment-"));
const engine=compileModels?await createWorkerEngine({timeoutMs:15_000}):undefined;
const knownModules = new Set([...CAPABILITIES.geometry.map((name) => name.split(":")[0]), "color", "echo", "assert", "children", "let", "render"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contextFlags = (mode) => [...experimental.map((feature) => `--enable=${feature}`), "-D", "$t=0", "-D", `$preview=${mode === "preview"}`];

function meshMetrics(data) {
	const { vertProperties: positions, triVerts: triangles } = decodeStl(data);
	const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
	for (let index = 0; index < positions.length; index++) {
		const axis = index % 3; minimum[axis] = Math.min(minimum[axis], positions[index]); maximum[axis] = Math.max(maximum[axis], positions[index]);
	}
	let signedVolume = 0;
	for (let index = 0; index < triangles.length; index += 3) {
		const first = triangles[index] * 3, second = triangles[index + 1] * 3, third = triangles[index + 2] * 3;
		signedVolume += (positions[first] * (positions[second + 1] * positions[third + 2] - positions[second + 2] * positions[third + 1]) + positions[first + 1] * (positions[second + 2] * positions[third] - positions[second] * positions[third + 2]) + positions[first + 2] * (positions[second] * positions[third + 1] - positions[second + 1] * positions[third])) / 6;
	}
	return { volume: Math.abs(signedVolume), bounds: positions.length ? [minimum, maximum] : null, triangles: triangles.length / 3, stlSha256: hash(data), bytes: data.byteLength };
}

async function nativeRender(input, output) {
	try {
		const result = await exec(oracle, [...contextFlags("render"), "--backend=Manifold", "--export-format=binstl", "-o", output, input], { timeout: 15_000, maxBuffer: 1_000_000 });
		const diagnostics = result.stderr.split(/\r?\n/).filter((line) => /WARNING:|ERROR:|DEPRECATED:/.test(line));
		return { status: diagnostics.some((line) => /ERROR:/.test(line)) ? "error" : "success", diagnostics, ...meshMetrics(await readFile(output)) };
	} catch (error) {
		const diagnostics = (error.stderr || error.message).trim().slice(0, 3000);
		return { status: error.killed ? "timeout" : /Current top level object is empty/.test(diagnostics) && !/ERROR:/.test(diagnostics) ? "empty" : "error", diagnostics, exitCode: error.code };
	}
}

async function compile(project, mode) {
	const result = await engine.compile({ ...project, mode, experimental, context: { time: 0 } });
	try {
		const report = { status: result.status, empty: result.empty, volume: result.volume, bounds: result.bounds, dependencies: result.dependencies, diagnostics: result.diagnostics, echoes: result.echoes };
		if (result.status === "success") {
			report.triangles = result.getMesh().triVerts.length / 3;
			const overlays = result.getOverlays();
			report.overlays = { background: overlays.filter((overlay) => overlay.kind === "background").length, debug: overlays.filter((overlay) => overlay.kind === "debug").length };
			if (mode === "render" && !result.empty) report.export = meshMetrics(await engine.export(result));
		}
		return report;
	} catch (error) { return { status: "export-error", code: error.code, message: error.message }; }
	finally { result.dispose?.(); }
}

function inventory(statements, file) {
	const calls = [];
	const definitions = new Set();
	const imports = [];
	const visit = (value) => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) { value.forEach(visit); return; }
		if (value.type === "module") definitions.add(value.name);
		if (value.type === "call") {
			calls.push({ name: value.name, location: value.location });
			if (value.name === "import") {
				const argument = value.args.find((arg) => arg.name === "file") ?? value.args.find((arg) => arg.name === null);
				if (argument?.expression.type === "literal" && typeof argument.expression.value === "string") imports.push({ file: argument.expression.value, source: value.location?.file ?? file });
			}
		}
		Object.values(value).forEach(visit);
	};
	visit(statements);
	return { modules: [...new Set(calls.map((call) => call.name))].sort(), unsupportedModules: [...new Set(calls.filter((call) => !definitions.has(call.name) && !knownModules.has(call.name)).map((call) => call.name))].sort(), imports };
}

async function native(input, output, flags = []) {
	let invocation;
	try {
		invocation = await exec(oracle, [...flags, input, "-o", output], { timeout: 15_000, maxBuffer: 1_000_000 });
	} catch (error) {
		let redirected = "";
		try { redirected = await readFile(output, "utf8"); } catch {}
		return { status: error.killed ? "timeout" : "error", exitCode: error.code, diagnostics: [redirected, error.stderr, error.stdout].filter(Boolean).join("\n").trim().slice(0, 3000) || error.message };
	}
	const echo = await readFile(output, "utf8");
	const diagnostics = [...echo.split(/\r?\n/), invocation.stderr].filter((line) => /WARNING:|ERROR:|DEPRECATED:/.test(line)).join("\n").trim().slice(0, 3000);
	return { operation: "echo-evaluation", status: /ERROR:/.test(diagnostics) ? "error" : diagnostics ? "diagnostics" : "success", diagnostics, echoes: echo.split(/\r?\n/).filter((line) => line.startsWith("ECHO:")) };
}

try {
	const version = await exec(oracle, ["--version"]);
	const oracleVersion = (version.stdout + version.stderr).trim();
	if (!/OpenSCAD version 2026\.10\.02/.test(oracleVersion)) throw new Error(`Unexpected oracle: ${oracleVersion}`);
	const revision = (await exec("git", ["-C", path.join(root, "references/openscad"), "rev-parse", "HEAD"])).stdout.trim();
	if (revision !== "7d44e5796cd489bcbfb8cef0720abe4db60ce35e") throw new Error(`Unexpected oracle revision: ${revision}`);
	const projectRevision = (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
	const trackedChanges = (await exec("git", ["-C", root, "diff", "HEAD", "--", "src", "scripts/assess-models.js", "package.json"])).stdout;
	const models = [];
	const names = (await readdir(samples)).filter((name) => name.endsWith(".scad")).sort();
	if (options.model?.some((name) => !names.includes(name))) throw new Error("Unknown corpus model");
	for (const name of names.filter((name) => !options.model || options.model.includes(name))) {
		const input = path.join(samples, name);
		const record = { file: `references/scad sample files/${name}`, sourceSha256: hash(await readFile(input)), inputs: [] };
		const project = await createFilesystemProject({ input });
		const track = (resolver, kind) => async (name, context) => {
			const value = await resolver(name, context);
			if (value !== undefined) {
				const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
				const sha256 = hash(bytes), previous = record.inputs.find((entry) => entry.path === name && entry.kind === kind);
				if (kind === "source" && name === project.entry && sha256 !== record.sourceSha256) throw new Error(`Entry changed during assessment: ${name}`);
				if (previous && previous.sha256 !== sha256) throw new Error(`Input changed during assessment: ${name}`);
				if (!previous) record.inputs.push({ path: name, kind, bytes: bytes.byteLength, sha256 });
			}
			return value;
		};
		project.resolver = track(project.resolver, "source"); project.assetResolver = track(project.assetResolver, "asset");
		try {
			const resolved = await resolveProject(project);
			record.dependencies = resolved.dependencies;
			Object.assign(record, inventory(resolved.statements, name));
			for (const imported of record.imports) {
				try { await access(path.resolve(samples, path.dirname(imported.source), imported.file)); imported.exists = true; }
				catch { imported.exists = false; }
			}
			try {
				const evaluated = evaluate(resolved.statements, { mode: "preview", time: 0, experimental });
				record.javascript = { status: "evaluated", warnings: evaluated.diagnostics.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message, location: diagnostic.location })) };
			} catch (error) {
				record.javascript = { status: "blocked", code: error.code, message: error.message, location: error.location };
			}
		} catch (error) {
			record.javascript = { status: "blocked", code: error.code, message: error.message, location: error.location };
		}
		if (engine) record.render = await compile(project, "render");
		record.native = await native(input, path.join(directory, `${models.length}.echo`), contextFlags("preview"));
		if (!options.baseline && record.modules?.includes("roof") && !experimental.includes("roof")) record.nativeRoofEnabled = { context: { mode: "preview", time: 0, experimental: ["roof"] }, ...await native(input, path.join(directory, `${models.length}-roof.echo`), ["--enable=roof", "-D", "$t=0", "-D", "$preview=true"]) };
		if (options.baseline) {
			record.preview = await compile(project, "preview");
			record.nativeRenderEvaluation = await native(input, path.join(directory, `${models.length}-render.echo`), contextFlags("render"));
			record.nativeRender = await nativeRender(input, path.join(directory, `${models.length}.stl`));
			const actual = record.render.export, expected = record.nativeRender;
			if (actual && expected.status === "success") record.comparison = { volumeAbsoluteDifference: Math.abs(actual.volume - expected.volume), volumeRelativeDifference: expected.volume ? Math.abs(actual.volume - expected.volume) / expected.volume : null, maxBoundsDifference: Math.max(...actual.bounds.flat().map((value, index) => Math.abs(value - expected.bounds.flat()[index]))), shapeEquivalence: "not-assessed" };
		}
		record.inputs.sort((first, second) => first.path.localeCompare(second.path) || first.kind.localeCompare(second.kind));
		models.push(record);
	}
	const report = { schemaVersion: 1, oracleVersion, oracleRevision: revision, projectRevision, implementationPatchSha256: hash(trackedChanges), implementationDirty: Boolean(trackedChanges), runtime: { node: process.version, platform: process.platform, arch: process.arch }, backend: "manifold-3d@3.5.4", nativeBackend: options.baseline ? "Manifold" : undefined, capabilities: CAPABILITIES, phase: options.baseline ? "preview-render-and-native-stl-baseline" : compileModels ? "source-evaluation-and-final-compilation" : "source-resolution-and-evaluation", context: { modes: compileModels ? ["preview", "render"] : ["preview"], time: 0, experimental, defines: {}, sourceRoot: "references/scad sample files", assetPolicy: "authorized filesystem resolver; no synthesized assets" }, limits: { timeoutMs: 15_000, maxSteps: 100_000, maxTriangles: 1_000_000 }, warning: "Inventory includes inactive definitions; native preview is echo evaluation only. Bounds and volume do not establish shape equivalence or printability.", models };
	const serialized = JSON.stringify(report, null, 2).replaceAll(directory, "<assessment>").replaceAll(root, "<repo>/") + "\n";
	if (options.output) await writeFile(path.resolve(options.output), serialized);
	console.log(serialized.trimEnd());
} finally { await engine?.dispose(); await rm(directory, { recursive: true, force: true }); }