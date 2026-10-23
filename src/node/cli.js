import { parseArgs } from "node:util";
import { readFile, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { createFilesystemProject } from "./filesystem.js";
import { createSystemFontResolver } from "./fonts.js";
import { createWorkerEngine } from "../core/worker-engine.js";
import { parse, ScadError } from "../core/parser.js";
import { checkAbort } from "../core/project.js";

const HELP = `Usage: openscad-js [options] input.scad

Compile the supported OpenSCAD subset into STL without a browser or native OpenSCAD.

  -o, --output FILE          STL output file; '-' writes stdout (required)
  -D, --define NAME=EXPR     SCAD expression override; repeatable
  -I, --library-path DIR     Authorized library directory; repeatable
      --font-dir DIR        Font directory (.ttf/.otf, recursive); repeatable
      --no-system-fonts     Disable installed-font discovery
      --max-font-bytes N    Total runtime font budget (default: 20000000)
      --root DIR            Project root (default: input directory, or cwd for stdin)
      --export-format TYPE  binstl (default) or asciistl
      --profile NAME        openscad-2026.10.02
	--enable FEATURE      Explicit experimental feature: roof, object-function, import-function, or vector-swizzle
      --time NUMBER         Initial animation time (default: 0)
      --diagnostics TYPE    text (default) or json, always on stderr
      --hardwarnings        Fail compilation on warnings
  -q, --quiet               Suppress echoes/warnings, not errors
      --allow-empty         Permit zero-triangle STL output
      --timeout-ms N        Compile/export operation deadline (default: 30000)
      --max-triangles N     Per-primitive triangle budget (default: 1000000)
      --max-steps N         Evaluator step budget (default: 100000)
      --max-depth N         Evaluator call-depth budget (default: 128)
      --max-files N         Unique dependency file budget (default: 128)
      --max-include-depth N Include/use depth budget (default: 64)
      --max-project-bytes N Loaded source budget (default: 5000000)
	--max-file-bytes N    Individual source budget (default: 1000000)
	--max-asset-bytes N   Geometry asset budget (default: 20000000)

Interference audit (parts wrapped in audit_part("name") { ... }):
      --audit               Check named parts pairwise instead of exporting STL;
                            -o becomes optional (report file, .json/.txt or '-')
      --audit-format TYPE   text (default) or json report on stdout/-o
      --audit-samples N     Sample $t evenly from 0 to 1 (2-1000 frames)
      --audit-times LIST    Comma-separated $t values, e.g. 0,0.5,1
      --audit-pose DEFS     Extra NAME=EXPR overrides for one pose, separated by
                            ';' (e.g. "curl=0; spread=1"); repeatable, and
                            combined with every sampled $t
      --audit-epsilon MM3   Ignore overlaps at or below this volume (default 0.0001)
      --audit-clearance MM  Also report non-overlapping pairs closer than this
                            gap (default 0: only overlaps and touching faces)

  -h, --help                Show this help
  -v, --version             Show engine version/profile/backend

Use input '-' for stdin. '--' ends option parsing.
Exit codes: 0 success; 1 SCAD/export failure; 2 invocation/I/O failure;
3 deadline cancellation; 4 audit found interference; 130 SIGINT; 143 SIGTERM.
`;

const optionSchema = {
	output: { type: "string", short: "o", multiple: true }, define: { type: "string", short: "D", multiple: true },
	"library-path": { type: "string", short: "I", multiple: true }, root: { type: "string" },
	"font-dir": { type: "string", multiple: true }, "no-system-fonts": { type: "boolean" }, "max-font-bytes": { type: "string" },
	"export-format": { type: "string", default: "binstl" }, profile: { type: "string", default: "openscad-2026.10.02" },
	enable: { type: "string", multiple: true },
	time: { type: "string", default: "0" }, diagnostics: { type: "string", default: "text" },
	hardwarnings: { type: "boolean" }, quiet: { type: "boolean", short: "q" }, "allow-empty": { type: "boolean" },
	help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
	audit: { type: "boolean" }, "audit-format": { type: "string" }, "audit-samples": { type: "string" },
	"audit-times": { type: "string" }, "audit-pose": { type: "string", multiple: true },
	"audit-epsilon": { type: "string" }, "audit-clearance": { type: "string" },
	...Object.fromEntries(["timeout-ms", "max-triangles", "max-steps", "max-depth", "max-files", "max-include-depth", "max-project-bytes", "max-file-bytes", "max-asset-bytes"].map((name) => [name, { type: "string" }])),
};

function positive(value, fallback, name) {
	if (value === undefined) return fallback;
	const number = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`);
	return number;
}

function parseDefines(inputs = []) {
	if (inputs.length > 128) throw new TypeError("At most 128 -D definitions are supported");
	for (const input of inputs) {
		const parsed = parse(input + ";", { file: "<command-line>" }).filter((statement) => statement.type !== "deprecation");
		if (parsed.length !== 1 || parsed[0].type !== "assignment") throw new TypeError("-D must be exactly NAME=SCAD_EXPRESSION");
	}
	return [...inputs];
}

// Split "a=1; b=[1,2]; c=\"x;y\"" on top-level semicolons.
function splitAssignments(text) {
	const parts = [];
	let depth = 0, quoted = false, start = 0;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (quoted) { if (character === "\\") index++; else if (character === '"') quoted = false; continue; }
		if (character === '"') quoted = true;
		else if ("([{".includes(character)) depth++;
		else if (")]}".includes(character)) depth--;
		else if (character === ";" && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
	}
	parts.push(text.slice(start));
	return parts.map((part) => part.trim()).filter(Boolean);
}

function finiteOption(value, name, { min = 0, max = Infinity } = {}) {
	const number = Number(value);
	if (!String(value).trim() || !Number.isFinite(number) || number < min || number > max) throw new TypeError(`${name} must be a number from ${min} to ${max}`);
	return number;
}

function auditFrames(values, time) {
	if (values["audit-samples"] !== undefined && values["audit-times"] !== undefined) throw new TypeError("Use either --audit-samples or --audit-times, not both");
	let times = [time];
	if (values["audit-samples"] !== undefined) {
		const samples = positive(values["audit-samples"], 0, "--audit-samples");
		if (samples < 2) throw new TypeError("--audit-samples must be at least 2");
		times = Array.from({ length: samples }, (_, index) => index / (samples - 1));
	} else if (values["audit-times"] !== undefined) {
		times = values["audit-times"].split(",").map((entry) => finiteOption(entry, "--audit-times entries", { min: -Infinity }));
	}
	const poses = (values["audit-pose"] ?? [""]).map((text) => {
		const defines = splitAssignments(text);
		parseDefines(defines);
		return { label: defines.join("; "), defines };
	});
	if (times.length * poses.length > 1000) throw new TypeError("An audit is limited to 1000 frames (poses x times)");
	return poses.flatMap((pose) => times.map((frameTime) => ({ time: frameTime, pose: pose.label, defines: pose.defines })));
}

function frameLabel(frame) {
	const time = `$t=${Number(frame.time.toFixed(6))}`;
	return frame.pose ? `${time}; ${frame.pose}` : time;
}

function summarizeAudit(frames) {
	const pairs = new Map();
	const finding = (kind, parts) => {
		const key = `${kind}\u0000${parts.join("\u0000")}`;
		if (!pairs.has(key)) pairs.set(key, { kind, parts: [...parts], frames: [] });
		return pairs.get(key);
	};
	frames.forEach((frame, index) => {
		for (const overlap of frame.interferences) {
			const entry = finding("interference", overlap.parts);
			entry.frames.push(index);
			if (!(entry.maxVolume >= overlap.volume)) Object.assign(entry, { maxVolume: overlap.volume, worstFrame: index, bounds: overlap.bounds });
		}
		for (const contact of frame.contacts) finding("contact", contact.parts).frames.push(index);
		for (const near of frame.clearances) {
			const entry = finding("clearance", near.parts);
			entry.frames.push(index);
			if (!(entry.minGap <= near.gap)) Object.assign(entry, { minGap: near.gap, worstFrame: index });
		}
	});
	const order = { interference: 0, clearance: 1, contact: 2 };
	return [...pairs.values()].sort((a, b) => order[a.kind] - order[b.kind] || (b.maxVolume ?? 0) - (a.maxVolume ?? 0) || (a.minGap ?? 0) - (b.minGap ?? 0) || a.parts.join().localeCompare(b.parts.join()));
}

function auditText(report) {
	const round = (value, digits = 4) => Number(value.toFixed(digits));
	const point = (vector) => `[${vector.map((value) => round(value, 3)).join(", ")}]`;
	const frames = (finding) => finding.frames.length === report.frames.length ? `all ${report.frames.length} frames` : `${finding.frames.length}/${report.frames.length} frames (${finding.frames.join(", ")})`;
	const lines = [`Interference audit of ${report.input}: ${report.frames.length} frame${report.frames.length === 1 ? "" : "s"}, ${report.components.length} parts (${report.components.join(", ")})`];
	report.frames.forEach((frame, index) => lines.push(`  frame ${index}: ${frameLabel(frame)}`));
	for (const finding of report.findings) {
		const pair = finding.parts.join(" <-> ");
		const worst = finding.worstFrame === undefined ? "" : ` at frame ${finding.worstFrame}`;
		if (finding.kind === "interference") lines.push(`INTERFERENCE ${pair}: max ${round(finding.maxVolume)} mm^3${worst}, bounds ${point(finding.bounds[0])}..${point(finding.bounds[1])}; ${frames(finding)}`);
		else if (finding.kind === "clearance") lines.push(`CLEARANCE    ${pair}: min gap ${round(finding.minGap)} mm${worst} (< ${report.clearance}); ${frames(finding)}`);
		else lines.push(`CONTACT      ${pair}: touching (gap <= ${report.contactTolerance} mm, no overlap above ${report.epsilon} mm^3); ${frames(finding)}`);
	}
	const count = (kind) => report.findings.filter((finding) => finding.kind === kind).length;
	lines.push(`Result: ${count("interference")} interfering, ${count("clearance")} under clearance, ${count("contact")} touching pair(s). Sampled poses only; motion between frames is not checked.`);
	return lines.join("\n") + "\n";
}

function writeStream(stream, data) {
	return new Promise((resolve, reject) => stream.write(data, (error) => error ? reject(error) : resolve()));
}

async function stdinSource(stream, limit, signal) {
	const chunks = [];
	let bytes = 0;
	const cancel = () => stream.destroy(new ScadError("Input cancelled", undefined, "cancelled"));
	signal.addEventListener("abort", cancel, { once: true });
	try {
		checkAbort(signal);
		for await (const chunk of stream) {
			bytes += Buffer.byteLength(chunk);
			if (bytes > limit) throw new ScadError("Stdin source size limit exceeded", undefined, "resource-limit");
			chunks.push(Buffer.from(chunk));
			checkAbort(signal);
		}
		return Buffer.concat(chunks).toString("utf8");
	} finally { signal.removeEventListener("abort", cancel); }
}

async function atomicWrite(target, bytes, signal) {
	const absolute = path.resolve(target);
	const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${randomUUID()}.tmp`);
	let file;
	try {
		checkAbort(signal);
		file = await open(temporary, "wx", 0o666);
		await file.writeFile(bytes);
		await file.sync();
		await file.close(); file = undefined;
		checkAbort(signal);
		await rename(temporary, absolute);
	} finally {
		await file?.close();
		try { await unlink(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
	}
}

function exitCode(code) {
	if (["cancelled", "timeout"].includes(code)) return 3;
	if (code === "invalid-component") return 1;
	if (["missing-file", "restricted-path", "io-error", "invalid-request", "disposed", "worker-error"].includes(code) || /^E[A-Z]+$/.test(code ?? "")) return 2;
	return 1;
}

async function runAudit({ stdout, engine, project, files, defineExpressions, limits, values, frames, epsilon, clearance, input, output, emit, signal, interrupted }) {
	const results = [];
	const diagnostics = new Map();
	const echoes = [];
	for (const [index, frame] of frames.entries()) {
		const result = await engine.compile({
			...project, files, defineExpressions: [...defineExpressions, ...frame.defines], ...limits, experimental: values.enable ?? [],
			mode: "render", context: { time: frame.time }, hardWarnings: values.hardwarnings, signal,
			auditComponents: true, auditOnly: true, maxAuditComponents: 64, interferenceEpsilon: epsilon, auditClearance: clearance,
		});
		if (result.status !== "success") {
			const failed = result.diagnostics.map((diagnostic) => diagnostic.severity === "error" ? { ...diagnostic, message: `${diagnostic.message} (audit frame ${index}: ${frameLabel(frame)})` } : diagnostic);
			await emit(failed, result);
			const stop = interrupted();
			return stop ? stop === "SIGINT" ? 130 : 143 : exitCode(result.diagnostics.at(-1)?.code);
		}
		for (const diagnostic of result.diagnostics) {
			const where = diagnostic.location ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.column}` : "";
			diagnostics.set(`${diagnostic.code}|${diagnostic.message}|${where}`, diagnostic);
		}
		for (const echo of result.echoes) echoes.push(frames.length > 1 ? `[frame ${index}] ${echo}` : echo);
		const report = result.componentAudit;
		if (report.components.length < 2) {
			await emit([{ severity: "error", code: "invalid-component", message: `Interference audit needs at least two audit_part("name") parts; frame ${index} (${frameLabel(frame)}) has ${report.components.length}` }], result);
			return 1;
		}
		results.push({ time: frame.time, pose: frame.pose, components: report.components.map((component) => component.name), interferences: report.interferences, contacts: report.contacts, clearances: report.clearances });
		if (index === 0) results.meta = { epsilon: report.epsilon, clearance: report.clearance, contactTolerance: report.contactTolerance };
	}
	const names = [...new Set(results.flatMap((frame) => frame.components))];
	const findings = summarizeAudit(results);
	const report = { status: "success", input, components: names, ...results.meta, frames: results, findings };
	const text = values["audit-format"] === "json" ? JSON.stringify(report, null, 2) + "\n" : auditText(report);
	if (output === "-") { checkAbort(signal); await writeStream(stdout, text); }
	else await atomicWrite(output, text, signal);
	await emit([...diagnostics.values()], { echoes, dependencies: [] }, "success");
	return findings.some((finding) => finding.kind === "interference") ? 4 : 0;
}

export async function runCli(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
	const controller = new AbortController();
	let interrupted;
	const interrupt = (signal) => { interrupted = signal; controller.abort(); };
	const sigint = () => interrupt("SIGINT");
	const sigterm = () => interrupt("SIGTERM");
	process.on("SIGINT", sigint); process.on("SIGTERM", sigterm);
	let engine;
	let values;
	let compileResult;
	const fontWarnings = [];
	let diagnosticMode = "text";
	try { diagnosticMode = parseArgs({ args, options: optionSchema, allowPositionals: true, strict: false }).values.diagnostics; } catch {}
	let stage = "invocation";
	const emit = async (diagnostics, result, status = result?.status ?? "error") => {
		diagnostics = [...fontWarnings.splice(0), ...diagnostics];
		if (diagnosticMode === "json") {
			await writeStream(stderr, JSON.stringify({ status, diagnostics: values?.quiet ? diagnostics.filter((diagnostic) => diagnostic.severity === "error") : diagnostics, echoes: values?.quiet ? [] : result?.echoes ?? [], dependencies: result?.dependencies ?? [], ...(result ? { id: result.id, profile: result.profile, backend: result.backend, timings: result.timings } : {}) }) + "\n");
		} else {
			for (const diagnostic of diagnostics) {
				if (values?.quiet && diagnostic.severity !== "error") continue;
				const location = diagnostic.location;
				await writeStream(stderr, `${location ? `${location.file}:${location.line}:${location.column}: ` : ""}${diagnostic.severity.toUpperCase()} [${diagnostic.code}]: ${diagnostic.message}\n`);
			}
			if (!values?.quiet) for (const echo of result?.echoes ?? []) await writeStream(stderr, echo + "\n");
		}
	};
	try {
		const parsed = parseArgs({ args, options: optionSchema, allowPositionals: true, strict: true });
		values = parsed.values;
		diagnosticMode = values.diagnostics;
		if (!["text", "json"].includes(diagnosticMode)) throw new TypeError("--diagnostics must be text or json");
		if (values.help) { await writeStream(stdout, HELP); return 0; }
		if (values.version) {
			if (values.profile !== "openscad-2026.10.02") throw new TypeError("Unsupported --profile");
			const metadata = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
			await writeStream(stdout, `OpenSCAD.js ${metadata.version} (API 1; ${values.profile}; manifold-3d@3.5.4)\n`);
			return 0;
		}
		const audit = values.audit === true;
		if (!audit && Object.keys(values).some((name) => name.startsWith("audit-"))) throw new TypeError("--audit-* options require --audit");
		if (parsed.positionals.length !== 1 || (audit ? (values.output?.length ?? 0) > 1 : values.output?.length !== 1)) throw new TypeError(audit ? "Exactly one input and at most one -o report are required; see --help" : "Exactly one input and one -o output are required; see --help");
		if (!["text", "json"].includes(values["audit-format"] ?? "text")) throw new TypeError("--audit-format must be text or json");
		if (!["binstl", "asciistl"].includes(values["export-format"])) throw new TypeError("--export-format must be binstl or asciistl");
		if (values.profile !== "openscad-2026.10.02") throw new TypeError("Unsupported --profile");
		if (values.enable?.some((feature) => !["roof", "object-function", "import-function", "vector-swizzle"].includes(feature))) throw new TypeError("Unknown experimental feature");
		const time = Number(values.time);
		if (!values.time.trim() || !Number.isFinite(time)) throw new TypeError("--time must be finite");
		const limits = {
			maxTriangles: positive(values["max-triangles"], 1_000_000, "--max-triangles"), maxSteps: positive(values["max-steps"], 100_000, "--max-steps"),
			maxDepth: positive(values["max-depth"], 128, "--max-depth"), maxFiles: positive(values["max-files"], 128, "--max-files"),
			maxIncludeDepth: positive(values["max-include-depth"], 64, "--max-include-depth"), maxProjectBytes: positive(values["max-project-bytes"], 5_000_000, "--max-project-bytes"),
			maxAssetBytes: positive(values["max-asset-bytes"],20_000_000,"--max-asset-bytes"),
			maxFontBytes: positive(values["max-font-bytes"],20_000_000,"--max-font-bytes"),
		};
		const timeout = positive(values["timeout-ms"], 30_000, "--timeout-ms");
		const maxFileBytes = positive(values["max-file-bytes"], 1_000_000, "--max-file-bytes");
		const defineExpressions = parseDefines(values.define);
		const input = parsed.positionals[0];
		const output = values.output?.[0] ?? "-";
		if (output !== "-" && input !== "-" && path.resolve(input) === path.resolve(output)) throw new TypeError("Input and output paths must differ");
		if (!audit && output !== "-" && path.extname(output).toLowerCase() !== ".stl") throw new TypeError("Output must have .stl extension or be '-'");
		if (audit && output !== "-" && ![".json", ".txt"].includes(path.extname(output).toLowerCase())) throw new TypeError("Audit report must have .json or .txt extension or be '-'");
		const frames = audit ? auditFrames(values, time) : undefined;
		const epsilon = audit ? finiteOption(values["audit-epsilon"] ?? "0.0001", "--audit-epsilon", { max: 1e6 }) : undefined;
		const clearance = audit ? finiteOption(values["audit-clearance"] ?? "0", "--audit-clearance", { max: 100 }) : undefined;
		stage = "io";
		const project = await createFilesystemProject({ input: input === "-" ? undefined : input, root: values.root, libraryPaths: values["library-path"], maxFileBytes, maxAssetBytes:limits.maxAssetBytes });
		const files = input === "-" ? { [project.entry]: await stdinSource(stdin, maxFileBytes, controller.signal) } : {};
		project.fontResolver = createSystemFontResolver({
			fontDirectories: values["font-dir"] ?? [], systemFonts: !values["no-system-fonts"], maxFontBytes: limits.maxFontBytes,
			onWarning: (message) => {
				if (values.hardwarnings) throw new ScadError(`Font discovery warning promoted to compilation failure: ${message}`, undefined, "hard-warning");
				fontWarnings.push({ severity: "warning", code: "font-discovery", message });
			},
		});
		checkAbort(controller.signal);
		engine = await createWorkerEngine({ profile: values.profile, timeoutMs: timeout, startupTimeoutMs: timeout, workerFactory: (url) => {
			const worker = new Worker(url, { execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")) });
			const cancel = () => { void worker.terminate(); };
			worker.once("exit", () => controller.signal.removeEventListener("abort", cancel));
			controller.signal.addEventListener("abort", cancel, { once: true });
			if (controller.signal.aborted) cancel();
			return worker;
		} });
		stage = "compile";
		if (audit) return await runAudit({ stdout, engine, project, files, defineExpressions, limits, values, frames, epsilon, clearance, input, output, emit, signal: controller.signal, interrupted: () => interrupted });
		compileResult = await engine.compile({ ...project, files, defineExpressions, ...limits, experimental: values.enable ?? [], mode: "render", context: { time }, hardWarnings: values.hardwarnings, signal: controller.signal });
		if (compileResult.status !== "success") {
			await emit(compileResult.diagnostics, compileResult);
			return interrupted ? interrupted === "SIGINT" ? 130 : 143 : exitCode(compileResult.diagnostics.at(-1)?.code);
		}
		const bytes = await engine.export(compileResult, { encoding: values["export-format"] === "asciistl" ? "ascii" : "binary", allowEmpty: values["allow-empty"] ?? false, signal: controller.signal });
		stage = "io";
		if (output === "-") { checkAbort(controller.signal); await writeStream(stdout, bytes); }
		else await atomicWrite(output, bytes, controller.signal);
		await emit(compileResult.diagnostics, compileResult, "success");
		return 0;
	} catch (error) {
		const code = interrupted ? "cancelled" : error.code ?? (stage === "compile" ? "compilation-error" : stage === "io" ? "io-error" : "invalid-arguments");
		await emit([{ severity: "error", code, message: error.message, location: error.location }], compileResult, interrupted || ["cancelled", "timeout"].includes(code) ? "cancelled" : "error");
		return interrupted ? interrupted === "SIGINT" ? 130 : 143 : stage === "invocation" ? 2 : exitCode(code);
	} finally {
		if (compileResult?.status === "success") compileResult.dispose();
		await engine?.dispose();
		process.removeListener("SIGINT", sigint); process.removeListener("SIGTERM", sigterm);
	}
}