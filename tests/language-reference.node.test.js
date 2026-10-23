import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CAPABILITIES, evaluate } from "../src/core/evaluator.js";
import { resolveProject } from "../src/core/project.js";
import { createEngine } from "../src/index.js";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";

const sourceUrl = new URL("../references/language_features.scad", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const oracle = fileURLToPath(new URL("../references/openscad/build/openscad", import.meta.url));
const exec = promisify(execFile);

test("capability audit covers every advertised family and links existing evidence", async () => {
	const auditUrl = new URL("../references/CAPABILITY_AUDIT.md", import.meta.url);
	const audit = await readFile(auditUrl, "utf8");
	for (const name of [...CAPABILITIES.syntax, ...CAPABILITIES.geometry]) assert.ok(audit.includes(`\`${name}\``), `Missing audit entry for ${name}`);
	const links = [...audit.matchAll(/\]\((\.\.\/tests\/[^)]+)\)/g)].map((match) => match[1]);
	assert.ok(links.length > 0);
	for (const link of new Set(links)) await readFile(new URL(link, auditUrl));
});

test("captured corpus baselines have explicit configurations and current input hashes", async () => {
	for (const [filename, experimental, expectedCount] of [["corpus-baseline.json", [], 13], ["corpus-roof-baseline.json", ["roof"], 1]]) {
		const report = JSON.parse(await readFile(new URL(`../references/${filename}`, import.meta.url), "utf8"));
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.phase, "preview-render-and-native-stl-baseline");
		assert.equal(report.oracleRevision, "7d44e5796cd489bcbfb8cef0720abe4db60ce35e");
		assert.deepEqual(report.context.experimental, experimental);
		assert.equal(report.context.time, 0);
		assert.equal(report.models.length, expectedCount);
		for (const model of report.models) {
			const bytes = await readFile(new URL(`../${model.file}`, import.meta.url));
			assert.equal(createHash("sha256").update(bytes).digest("hex"), model.sourceSha256, `Stale corpus source: ${model.file}`);
			for (const input of model.inputs) {
				const bytes = await readFile(new URL(`../references/scad sample files/${input.path}`, import.meta.url));
				assert.equal(bytes.byteLength, input.bytes);
				assert.equal(createHash("sha256").update(bytes).digest("hex"), input.sha256, `Stale corpus dependency: ${input.path}`);
			}
			assert.ok(model.preview && model.render && model.nativeRender);
			if (model.comparison) assert.equal(model.comparison.shapeEquivalence, "not-assessed");
		}
	}
});

test("corpus baseline records provenance and distinct preview/render results", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-corpus-baseline-"));
	try {
		const output = path.join(directory, "baseline.json");
		await exec(process.execPath, [fileURLToPath(new URL("../scripts/assess-models.js", import.meta.url)), "--baseline", "--model=caster mount.scad", `--output=${output}`], { timeout: 30_000, maxBuffer: 1_000_000 });
		const report = JSON.parse(await readFile(output, "utf8"));
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.oracleRevision, "7d44e5796cd489bcbfb8cef0720abe4db60ce35e");
		assert.deepEqual(report.context.modes, ["preview", "render"]);
		assert.deepEqual(report.context.experimental, []);
		assert.equal(report.models.length, 1);
		const model = report.models[0];
		assert.match(model.sourceSha256, /^[a-f0-9]{64}$/);
		assert.equal(model.inputs[0].sha256, model.sourceSha256);
		assert.equal(model.preview.status, "success");
		assert.equal(model.render.status, "success");
		assert.equal(model.native.operation, "echo-evaluation");
		assert.equal(model.nativeRender.status, "success");
		assert.ok(model.preview.overlays.background > 0);
		assert.equal(model.render.overlays.background, 0);
		assert.match(model.render.export.stlSha256, /^[a-f0-9]{64}$/);
		assert.equal(model.comparison.shapeEquivalence, "not-assessed");
		assert.ok(model.comparison.volumeRelativeDifference < 1e-6);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

const expected = [
	[],
	['ECHO: "expressions", 14, 8, [0, 1, 1]'],
	['ECHO: "values", [false, 0, "", [], undef], [true, "value", [0]]'],
	['ECHO: "vectors", [4, 6], [2, 4], [[19, 22], [43, 50]]', 'ECHO: "indexing", 3, 4, "b"'],
	['ECHO: "functions", 120, 5, 9'],
	['ECHO: "scoping", 7, 8'],
	['ECHO: "range", 3', 'ECHO: "range", 2', 'ECHO: "range", 1', 'ECHO: "dependent loop", 1, 1', 'ECHO: "dependent loop", 2, 2'],
	['ECHO: "forward lookup", 6'],
	['ECHO: "context", false, 0'],
	['ECHO: "builtins", -2, 5, "AB", 65, true, [1]'],
	['ECHO: "experimental roof", 4'],
	['ECHO: "text extrusion", 5'],
	['ECHO: "JSON import", "reference", 2, [1, 2, 3]'],
];
expected[0] = expected.slice(1, 10).flat();

const referenceData = await readFile(new URL("../references/language_features_data.json", import.meta.url), "utf8");

for (const mode of ["preview", "render"]) for (let caseId = 0; caseId <= 12; caseId++) {
	test(`language reference case ${caseId} in ${mode} matches explicit and native expectations`, async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-language-"));
		try {
			const output = path.join(directory, "reference.echo");
			const nativeFlags = caseId === 10 ? ["--enable=roof"] : caseId === 12 ? ["--enable=import-function"] : [];
			await exec(oracle, [...nativeFlags, fileURLToPath(sourceUrl), "-D", `case_id=${caseId}`, "-D", `$preview=${mode === "preview"}`, "-o", output], { timeout: 30_000 });
			const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
			const echoes = expected[caseId].map((line) => line === 'ECHO: "context", false, 0' && mode === "preview" ? 'ECHO: "context", true, 0' : line);
			assert.deepEqual(native, echoes);
			if (caseId === 12) {
				const engine = await createEngine();
			try {
				const result = await engine.compile({ mode, entry: "language_features.scad", defines: { case_id: caseId }, experimental: ["import-function"], files: { "language_features.scad": source, "language_features_data.json": referenceData } });
				assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
				try {
					assert.deepEqual(result.echoes, echoes);
					assert.deepEqual(result.diagnostics, []);
				} finally { result.dispose(); }
			} finally { engine.dispose(); }
			} else {
				const result = evaluate(source, { mode, defines: { case_id: caseId }, experimental: caseId === 10 ? ["roof"] : [], file: "language_features.scad" });
				assert.deepEqual(result.echoes, echoes);
				assert.deepEqual(result.diagnostics, []);
			}
		} finally { await rm(directory, { recursive: true, force: true }); }
	});
}

test("prototype-like parameter names bind normally in the native and JavaScript evaluators", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-prototype-parameters-"));
	const source = "function read(__proto__,constructor)=[__proto__,constructor];echo(read(7,8));";
	try {
		const input = path.join(directory, "parameters.scad"), output = path.join(directory, "parameters.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(native, ["ECHO: [7, 8]"]);
		assert.deepEqual(evaluate(source).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("named built-in function labels preserve native argument value order", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-named-builtins-"));
	const text = "echo(pow(y=3,x=2),pow(x=2,y=3),atan2(x=1,y=0),max(b=2,a=5),concat(b=[2],a=[1]),sqrt(missing=9));";
	try {
		const input = path.join(directory, "named.scad"), output = path.join(directory, "named.echo");
		await writeFile(input, text);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(native, ["ECHO: 9, 8, 90, 5, [2, 1], 3"]);
		assert.deepEqual(evaluate(text).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("concat preserves native one-level vector expansion and argument order", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-concat-"));
	const source = 'echo(concat());echo(concat([1,2],[3,4]));echo(concat([[1,2],[3]],[4]));echo(concat(1,"a",[2],true,undef));echo(concat("ab","cd"));echo(concat(b=[2],a=[1]));';
	try {
		const input = path.join(directory, "concat.scad"), output = path.join(directory, "concat.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(native, [
			"ECHO: []",
			"ECHO: [1, 2, 3, 4]",
			"ECHO: [[1, 2], [3], 4]",
			'ECHO: [1, "a", 2, true, undef]',
			'ECHO: ["ab", "cd"]',
			"ECHO: [2, 1]",
		]);
		assert.deepEqual(evaluate(source).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("str formats native scalar, container, range, and function values", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-str-"));
	const source = 'echo(str()=="");echo(str("abc",true,false,undef)=="abctruefalseundef");echo(str(1e-10,1e-6,1e-5,1e-4,1e6,1e15,1e16,1e20,1e21,1.2345678901234567,-0)=="1e-101e-60.000010.00011e+61e+151e+161e+201e+211.234570");echo(str([1,"abc",true,undef,[2,"z"]])=="[1, \\"abc\\", true, undef, [2, \\"z\\"]]");echo(str([1:3],[3:-1:1])=="[1 : 1 : 3][3 : -1 : 1]");obj=object(z=1,a="q");echo(str(obj)=="{ z = 1; a = \\"q\\"; }");f=function(x=2)x+1;echo(str(f,str(function(a,b=3)a*b))=="function(x = 2) (x + 1)function(a, b = 3) (a * b)");';
	try {
		const input = path.join(directory, "str.scad"), output = path.join(directory, "str.echo");
		await writeFile(input, source);
		await exec(oracle, ["--enable=object-function", input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		const result = evaluate(source, { experimental: ["object-function"] });
		assert.deepEqual(native, Array(7).fill("ECHO: true"));
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(result.diagnostics, []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("type predicates match native classifications, quiet undefined lookup, and arity warnings", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-predicates-"));
	const source = 'echo("numbers",is_num(0/0),is_num(1/0),is_num(-1/0),is_num("1"));echo("undef",is_undef(no_such_variable),is_undef(undef),is_undef(0));echo("types",is_list([1]),is_list([1:3]),is_bool(true),is_bool(1),is_string(""),is_string(1));echo("callables",is_function(function(x)x),is_function(1),is_object(object(a=1)),is_object([1]),is_function(object(run=function(x)x).run));echo("arity",is_undef(1,2),is_list(),is_num(1,2),is_bool(),is_string(1,2),is_function(),is_object(1,2));';
	try {
		const input = path.join(directory, "predicates.scad"), output = path.join(directory, "predicates.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, ["--enable=object-function", input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarnings = lines.filter((line) => line.startsWith("WARNING:")).map((line) => line.replace(/^WARNING: /, "").replace(/ in file .*$/, "").replace(/\s+/g, " ").trim());
		const result = evaluate(source, { experimental: ["object-function"], file: "predicates.scad" });
		assert.deepEqual(result.echoes, nativeEchoes);
		assert.deepEqual(nativeEchoes, [
			'ECHO: "numbers", false, true, true, false',
			'ECHO: "undef", true, true, false',
			'ECHO: "types", true, false, true, false, true, false',
			'ECHO: "callables", true, false, true, false, true',
			'ECHO: "arity", undef, undef, undef, undef, undef, undef, undef',
		]);
		assert.deepEqual(result.diagnostics.map(({ message }) => message), nativeWarnings);
		assert.deepEqual(result.diagnostics.map(({ code }) => code), ["is-undef-arguments", "is-list-arguments", "is-num-arguments", "is-bool-arguments", "is-string-arguments", "is-function-arguments", "is-object-arguments"]);
		const shadowSource = 'function is_num(x)=true;echo(is_num("x"));';
		await writeFile(input, shadowSource);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		assert.deepEqual((await readFile(output, "utf8")).trim().split(/\r?\n/), ["ECHO: true"]);
		assert.deepEqual(evaluate(shadowSource).echoes, ["ECHO: true"]);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("version and version_num match native defaults and date-vector conversion", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-version-"));
	const source = 'echo(version()==[2026,10,2],version_num()==20261002);echo(version_num([2024,3])==20240300,version_num([2024,3,4])==20240304);echo(is_undef(version_num(undef)),is_undef(version_num(1)),is_undef(version_num([1])),is_undef(version_num([1,2,3,4])));echo(is_num(version_num([2024,3,1/0])),is_num(version_num([2024,3,0/0])),version_num([2024,3,1/0])>0);echo(version_num([2024,3,4],[1,2,3])==20240304);';
	try {
		const input = path.join(directory, "version.scad"), output = path.join(directory, "version.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		const result = evaluate(source, { file: "version.scad" });
		assert.deepEqual(native, ["ECHO: true, true", "ECHO: true, true", "ECHO: true, true, true, true", "ECHO: true, false, true", "ECHO: true"]);
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(result.diagnostics, []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("anonymous closures and added vector built-ins match the native oracle", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-anonymous-functions-"));
	const text = "$fn=6; dynamic_fn=function() $fn; module dynamic_scope() { $fn=9; echo(dynamic_fn()); } dynamic_scope(); echo(dynamic_fn()); base=3; square_fn=function(x) x*x; scale_fn=function(x,factor=2) x*factor; captured=function(x) x+base; base=9; function apply(fn,x)=fn(x); echo(square_fn(4),scale_fn(3),scale_fn(factor=4,x=3),captured(2),apply(square_fn,5),cross([1,2,3],[4,5,6]),lookup(2,[[0,0],[4,8]]),lookup(5,[]));";
	try {
		const input = path.join(directory, "anonymous.scad"), output = path.join(directory, "anonymous.echo");
		await writeFile(input, text);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).filter((line) => line.startsWith("ECHO:"));
		assert.deepEqual(native, ["ECHO: 9", "ECHO: 6", "ECHO: 16, 6, 12, 11, 25, [-3, 6, -3], 4, undef"]);
		assert.deepEqual(evaluate(text).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("control-flow forms and callable expressions match the native oracle", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-control-calls-"));
	const code = 'function apply(fn,x)=fn(x); values=[function(x) x+1]; double_fn=function(x) x*2; record=object(run=function(x) x+4); for(i=[0:2]) echo(i); echo((function(x) x*3)(2),values[0](4),apply(double_fn,5),record.run(2),record["run"](3));';
	try {
		const input = path.join(directory, "control.scad"), output = path.join(directory, "control.echo");
		await writeFile(input, code);
		await exec(oracle, ["--enable=object-function", input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(native, ["ECHO: 0", "ECHO: 1", "ECHO: 2", "ECHO: 6, 5, 10, 6, 7"]);
		assert.deepEqual(evaluate(code, { experimental: ["object-function"] }).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("intersection_for geometry matches the native Manifold oracle", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-intersection-for-"));
	const engine = await createEngine();
	const code = "intersection_for(i=[0:1]) translate([i,0,0]) cube(2);";
	try {
		const input = path.join(directory, "main.scad"), output = path.join(directory, "native.stl");
		await writeFile(input, code);
		await exec(oracle, [input, "--backend=Manifold", "--export-format=binstl", "-o", output], { timeout: 30_000 });
		const native = measureMesh(decodeBinaryStl(await readFile(output)));
		const result = await engine.compile({ mode: "render", files: { "main.scad": code } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try {
			const candidate = measureMesh(decodeBinaryStl(await engine.export(result)));
			assert.ok(Math.abs(candidate.volume - native.volume) < 0.00001);
			assert.deepEqual(candidate.bounds, native.bounds);
		} finally { result.dispose(); }
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("cross handles native 2D determinants, conversions and invalid 3D vectors", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cross-vectors-"));
	const text = 'echo(cross([1,0],[0,1]),cross([0,1],[1,0]),cross([2,3],[4,5]),cross([2,3],[4,5,6])); echo(cross([1,2,3],[4,5,6]),cross([1,2,"3"],[4,5,6]),cross([1,true,3],[4,5,6]),cross([1,2,undef],[4,5,6]),cross([1,[2],3],[4,5,6])); echo(cross([1,2],[3,"4"]),cross([1,true],[3,4]),cross([1,2,3,4],[5,6,7,8]),cross("ab",[1,2]),cross([1,2])); echo(cross([1,2,1/0],[4,5,6]),cross([1,2,0/0],[4,5,6]),cross([1,undef],[3,4]),cross([1,[2]],[3,4]),cross([1,2],[3,4],9));';
	try {
		const input = path.join(directory, "cross.scad"), output = path.join(directory, "cross.echo");
		await writeFile(input, text);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const native = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarnings = lines.filter((line) => line.startsWith("WARNING:")).map((line) => line.replace(/^WARNING: /, "").replace(/ in file .*$/, "").replace(/\s+/g, " ").trim());
		assert.deepEqual(native, ["ECHO: 1, -1, -2, undef", "ECHO: [-3, 6, -3], undef, undef, undef, undef", "ECHO: -6, 4, undef, undef, undef", "ECHO: undef, undef, 4, 4, undef"]);
		const evaluated = evaluate(text);
		assert.deepEqual(evaluated.echoes, native);
		assert.deepEqual(evaluated.diagnostics.map(({ message }) => message), nativeWarnings);
		assert.ok(evaluated.diagnostics.every((diagnostic) => diagnostic.code === "cross-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("cross preserves native overflow, underflow, and cancellation arithmetic", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-cross-boundaries-"));
	const source = 'echo(cross([1e308,0],[0,1e308]),cross([1e-200,0],[0,1e-200]),cross([1e200,1e200],[1e200,1e200]));echo(cross([1e308,0,0],[0,1e308,0])[2],cross([1e-200,0,0],[0,1e-200,0])[2],cross([1e200,1e200,0],[1e200,1e200,0])[2]);';
	try {
		const input = path.join(directory, "cross-boundaries.scad"), output = path.join(directory, "cross-boundaries.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(native, ["ECHO: inf, 0, nan", "ECHO: inf, 0, nan"]);
		const result = evaluate(source, { file: "cross-boundaries.scad" });
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(result.diagnostics, []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("norm matches native vector validation, empty vectors and nonfinite arithmetic", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-norm-vectors-"));
	const text = 'echo(norm([3,4]),norm([]),norm([2,3,6]),norm([1,2,2,4])); echo(norm([3,"4"]),norm([3,true]),norm([3,undef]),norm([[3],4]),norm("34"),norm(undef),norm()); echo(norm([1/0]),norm([0/0]),norm([1e200]),norm([1/0,0/0]),norm([3,4],0)); echo(str(norm([1/0])),str(-1/0),[0/0,1/0,-1/0]);';
	try {
		const input = path.join(directory, "norm.scad"), output = path.join(directory, "norm.echo");
		await writeFile(input, text);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const native = lines.filter((line) => line.startsWith("ECHO:"));
		assert.deepEqual(native, ["ECHO: 5, 0, 7, 5", "ECHO: undef, undef, undef, undef, undef, undef, undef", "ECHO: inf, nan, inf, nan, undef", 'ECHO: "inf", "-inf", [nan, inf, -inf]']);
		const evaluated = evaluate(text);
		assert.deepEqual(evaluated.echoes, native);
		assert.equal(evaluated.diagnostics.length, lines.filter((line) => line.startsWith("WARNING:")).length);
		assert.ok(evaluated.diagnostics.every((diagnostic) => diagnostic.code === "norm-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("norm preserves native square overflow and underflow behavior", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-norm-boundaries-"));
	const source = 'echo(norm([1e154]),norm([1.4e154]),norm([1.5e154]),norm([1e-154]),norm([1e-160]),norm([1e-162]),norm([1e-200]));echo(norm([1e154,1e154]),norm([1e-160,1e-160]),norm([-0]));';
	try {
		const input = path.join(directory, "norm-boundaries.scad"), output = path.join(directory, "norm-boundaries.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(native, ["ECHO: 1e+154, inf, inf, 1e-154, 9.99994e-161, 0, 0", "ECHO: inf, 1.41421e-160, 0"]);
		const result = evaluate(source, { file: "norm-boundaries.scad" });
		const parse = (line) => line.slice("ECHO: ".length).split(", ").map((value) => value === "nan" ? NaN : value === "inf" ? Infinity : value === "-inf" ? -Infinity : Number(value));
		const nativeValues = native.map(parse), actualValues = result.echoes.map(parse);
		for (let row = 0; row < nativeValues.length; row++) for (let column = 0; column < nativeValues[row].length; column++) {
			const expected = nativeValues[row][column], actual = actualValues[row][column];
			if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual));
			else if (Number.isFinite(expected)) assert.ok(Math.abs(actual - expected) <= Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-5), `${actual} differs from ${expected}`);
			else assert.equal(actual, expected);
		}
		assert.deepEqual(result.diagnostics, []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("Unicode and search built-ins match the native oracle", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-string-builtins-"));
	const source = 'echo(chr(0x1F0A1),chr([65,66]),ord("🂡a"),version_num()==20261002,search("ab","aabb"),search("ab","aabb",0),lookup(3,[[4,8],[0,0]]));';
	try {
		const input = path.join(directory, "builtins.scad"), output = path.join(directory, "builtins.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).filter((line) => line.startsWith("ECHO:"));
		assert.deepEqual(native, ['ECHO: "🂡", "AB", 127137, true, [0, 2], [[0, 1], [2, 3]], 6']);
		assert.deepEqual(evaluate(source).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("chr and ord match native Unicode conversion and strict ord arguments", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-chr-ord-edges-"));
	const source = 'echo("chr",chr(4294967361),chr(65.9),chr(-1),chr(0),chr(55296),chr(1114112),chr([65,[66,0],"C"]),chr());echo("ord",ord(),ord(""),ord("A"),ord("🂡a"),ord(65),ord(true),ord("a","b"));echo("wrapped-ordinal",ord(chr(4294967297)));';
	try {
		const input = path.join(directory, "unicode.scad"), output = path.join(directory, "unicode.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const native = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarningCount = lines.filter((line) => line.startsWith("WARNING:")).length;
		const result = evaluate(source, { file: "unicode.scad" });
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(native, ['ECHO: "chr", "A", "A", "", "", "", "", "AB", ""', 'ECHO: "ord", undef, undef, 65, 127137, undef, undef, undef', 'ECHO: "wrapped-ordinal", 1']);
		assert.equal(result.diagnostics.length, nativeWarningCount);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
			"ord() number of parameters does not match: expected 1, found 0",
			"ord() parameter could not be converted: argument 0: expected string, found number (65)",
			"ord() parameter could not be converted: argument 0: expected string, found bool (true)",
			"ord() number of parameters does not match: expected 1, found 2",
		]);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "ord-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("search matches native row validation, string-table columns, and early stopping", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-search-edges-"));
	const source = 'echo("string-column",search("ab","aabb",1,3)); echo("miss-after-invalid",search("z",[["a",1],2])); echo("all-after-invalid",search("a",[["a",1],["b",2],2],0)); echo("stop-before-invalid",search("a",[["a",1],2],1)); echo("wrong-type-column",search("a",[["a",1],["b",2]],1,1)); echo("vector-needle-invalid",search(["z"],[["a"],2],1)); echo("vector-needle-string-table",search(["a",2],"a2b")); echo("non-vector-table",search("a",3)); echo("count-string",search("a","aba","2")); echo("count-bool",search("a","aba",true)); echo("column-string",search("a",[["a",1]],0,"1")); echo("negative-column",search("a",[["a",1]],1,-1)); echo("too-few",search("a")); echo("too-many",search("a","a",0,0,1));';
	try {
		const input = path.join(directory, "search.scad"), output = path.join(directory, "search.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const native = lines.filter((line) => line.startsWith("ECHO:"));
		const warnings = lines.filter((line) => line.startsWith("WARNING:"));
		assert.deepEqual(native, ['ECHO: "string-column", [0, 2]', 'ECHO: "miss-after-invalid", []', 'ECHO: "all-after-invalid", []', 'ECHO: "stop-before-invalid", [0]', 'ECHO: "wrong-type-column", []', 'ECHO: "vector-needle-invalid", [[]]', 'ECHO: "vector-needle-string-table", [[], []]', 'ECHO: "non-vector-table", []', 'ECHO: "count-string", [[0, 2]]', 'ECHO: "count-bool", [[0, 2]]', 'ECHO: "column-string", [[0]]', 'ECHO: "negative-column", []', 'ECHO: "too-few", undef', 'ECHO: "too-many", undef']);
		assert.equal(warnings.length, 5);
		const evaluated = evaluate(source);
		assert.deepEqual(evaluated.echoes, native);
		assert.equal(evaluated.diagnostics.length, warnings.length);
		assert.equal(evaluated.diagnostics.filter((diagnostic) => diagnostic.code === "search-invalid-entry").length, 3);
		assert.equal(evaluated.diagnostics.filter((diagnostic) => diagnostic.code === "search-arguments").length, 2);
		assert.ok(evaluated.diagnostics[0].message.includes("Invalid entry in search vector at index 1, required number of values in the entry: 1. Invalid entry: 2"));
		assert.ok(evaluated.diagnostics[1].message.includes("Invalid entry in search vector at index 2, required number of values in the entry: 1. Invalid entry: 2"));
		assert.ok(evaluated.diagnostics[2].message.includes("Invalid entry in search vector at index 0, required number of values in the entry: 0. Invalid entry: [\"a\", 1]"));
		assert.ok(evaluated.diagnostics[3].message.includes("search() number of parameters does not match: expected between 2 and 4, found 1"));
		assert.ok(evaluated.diagnostics[4].message.includes("search() number of parameters does not match: expected between 2 and 4, found 5"));
		assert.ok(evaluated.diagnostics.every((diagnostic) => diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("min and max match native overloads, validation, warnings, and NaN ordering", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-min-max-"));
	const source = 'echo("normal",min(3,1,2),max(3,1,2),min([3,1,2]),max([3,1,2]));echo("empty",min(),max(),min([]),max([]));echo("bad-vector",min([2,"x",1]),max([2,true,1]));echo("bad-args",min(2,"x",1),max(2,undef,1));echo("mixed-form",min([2],3),max([2],3));echo("nan-order",min([0/0,1]),max([0/0,1]),min([1,0/0]),max([1,0/0]));';
	try {
		const input = path.join(directory, "min-max.scad"), output = path.join(directory, "min-max.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const native = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarningCount = lines.filter((line) => line.startsWith("WARNING:")).length;
		const result = evaluate(source, { file: "min-max.scad" });
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(native, [
			'ECHO: "normal", 1, 3, 1, 3',
			'ECHO: "empty", undef, undef, undef, undef',
			'ECHO: "bad-vector", undef, undef',
			'ECHO: "bad-args", undef, undef',
			'ECHO: "mixed-form", undef, undef',
			'ECHO: "nan-order", nan, nan, 1, 1',
		]);
		assert.equal(result.diagnostics.length, nativeWarningCount);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
			"min() number of parameters does not match: expected at least 1, found 0",
			"max() number of parameters does not match: expected at least 1, found 0",
			"min() number of parameters does not match: expected at least 1 vector element, found 0",
			"max() number of parameters does not match: expected at least 1 vector element, found 0",
			"min() parameter could not be converted: vector element 1: expected number, found string (\"x\")",
			"max() parameter could not be converted: vector element 1: expected number, found bool (true)",
			"min() parameter could not be converted: argument 1: expected number, found string (\"x\")",
			"max() parameter could not be converted: argument 1: expected number, found undefined (undef)",
			"min() parameter could not be converted: argument 0: expected number, found vector ([2])",
			"max() parameter could not be converted: argument 0: expected number, found vector ([2])",
		]);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "min-max-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("abs, sign, round, floor, and ceil match native scalar validation and edge values", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-scalar-numeric-"));
	const source = 'echo("ties",abs(-0),sign(-0),sign(0),round(0.5),round(-0.5),round(1.5),round(-1.5));echo("nonfinite",abs(-1/0),abs(0/0),sign(-1/0),sign(0/0),round(1/0),round(0/0),floor(-1/0),ceil(1/0));echo("bad",abs(),sign("1"),round(true),floor([1]),ceil(undef));echo("arity",abs(1,2),sign(1,2),round(1,2),floor(1,2),ceil(1,2));';
	try {
		const input = path.join(directory, "scalar.scad"), output = path.join(directory, "scalar.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarningCount = lines.filter((line) => line.startsWith("WARNING:")).length;
		const result = evaluate(source, { file: "scalar.scad" });
		assert.deepEqual(result.echoes, nativeEchoes);
		assert.deepEqual(nativeEchoes, [
			'ECHO: "ties", 0, 0, 0, 1, -1, 2, -2',
			'ECHO: "nonfinite", inf, nan, -1, 0, inf, nan, -inf, inf',
			'ECHO: "bad", undef, undef, undef, undef, undef',
			'ECHO: "arity", undef, undef, undef, undef, undef',
		]);
		assert.equal(result.diagnostics.length, nativeWarningCount);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
			"abs() number of parameters does not match: expected 1, found 0",
			"sign() parameter could not be converted: argument 0: expected number, found string (\"1\")",
			"round() parameter could not be converted: argument 0: expected number, found bool (true)",
			"floor() parameter could not be converted: argument 0: expected number, found vector ([1])",
			"ceil() parameter could not be converted: argument 0: expected number, found undefined (undef)",
			... ["abs", "sign", "round", "floor", "ceil"].map((name) => `${name}() number of parameters does not match: expected 1, found 2`),
		]);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "numeric-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("sqrt, exp, ln, and log match native overloads, domains, and argument warnings", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-transcendentals-"));
	const source = 'echo("valid",sqrt(9),exp(1),ln(2),log(100),log(2,100),sqrt(5e-324),sqrt(1e-320),sqrt(1e308),exp(-1000),exp(709),exp(710),ln(5e-324),ln(1e308));echo("domains",sqrt(-1),sqrt(0),exp(1000),ln(0),ln(-1),log(0),log(-1),log(10,0),log(1,10),log(10,1e-300),log(10,1e300),log(1,1),log(1,0),log(1/0,1/0),log(0,0),log(-1,10),log(10,-1));echo("bad",sqrt(),exp("1"),ln(true),log(),log(100,"2"));echo("arity",sqrt(4,2),exp(1,2),ln(2,3),log(2,3,4));';
	try {
		const input = path.join(directory, "transcendentals.scad"), output = path.join(directory, "transcendentals.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarningCount = lines.filter((line) => line.startsWith("WARNING:")).length;
		const result = evaluate(source, { file: "transcendentals.scad" });
		assert.deepEqual(nativeEchoes, [
			'ECHO: "valid", 3, 2.71828, 0.693147, 2, 6.64386, 2.22276e-162, 9.99994e-161, 1e+154, 0, 8.21841e+307, inf, -744.44, 709.196',
			'ECHO: "domains", nan, 0, inf, -inf, nan, -inf, nan, -inf, inf, -300, 300, nan, -inf, nan, nan, nan, nan',
			'ECHO: "bad", undef, undef, undef, undef, undef',
			'ECHO: "arity", undef, undef, undef, undef',
		]);
		const parseEcho = (line) => {
			const match = /^ECHO: "([^"]+)", (.*)$/.exec(line);
			assert.ok(match, line);
			return [match[1], ...match[2].split(", ").map((value) => value === "nan" ? NaN : value === "inf" ? Infinity : value === "-inf" ? -Infinity : Number(value))];
		};
		const expectedValues = nativeEchoes.slice(0, 2).map(parseEcho);
		const actualValues = result.echoes.slice(0, 2).map(parseEcho);
		assert.deepEqual(actualValues.map(([label]) => label), expectedValues.map(([label]) => label));
		for (let row = 0; row < expectedValues.length; row++) {
			for (let column = 1; column < expectedValues[row].length; column++) {
				const expected = expectedValues[row][column], actual = actualValues[row][column];
				if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual));
				else if (Number.isFinite(expected)) assert.ok(Math.abs(actual - expected) <= Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-5), `${actual} differs from ${expected}`);
				else assert.equal(actual, expected);
			}
		}
		assert.deepEqual(result.echoes.slice(2), nativeEchoes.slice(2));
		assert.equal(result.diagnostics.length, nativeWarningCount);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
			"sqrt() number of parameters does not match: expected 1, found 0",
			"exp() parameter could not be converted: argument 0: expected number, found string (\"1\")",
			"ln() parameter could not be converted: argument 0: expected number, found bool (true)",
			"log() number of parameters does not match: expected 2, found 0",
			"log() parameter could not be converted: argument 1: expected number, found string (\"2\")",
			"sqrt() number of parameters does not match: expected 1, found 2",
			"exp() number of parameters does not match: expected 1, found 2",
			"ln() number of parameters does not match: expected 1, found 2",
			"log() number of parameters does not match: expected 2, found 3",
		]);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "numeric-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("pow and degree trigonometry match native domains, exact angles, and argument warnings", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-pow-trig-"));
	const source = 'echo("pow",pow(2,3),pow(-2,3),pow(-2,0.5),pow(0,-1),pow(-1/0,2),pow(0/0,2),pow(-1,1/0),pow(1,1/0),pow(1,0/0),pow(-1,0/0),pow(0,0),1/pow(-0,3));echo("trig",sin(0),sin(30),sin(90),sin(180),sin(270),cos(90),cos(180),tan(45),asin(1),acos(-1),atan(1),atan2(1,0));echo("domains",sin(1/0),cos(0/0),tan(90),asin(2),acos(-2),atan(1/0),atan2(0,0),sin(1e100));echo("powbad",pow(),pow(2),pow(2,3,4),pow("2",3),pow(2,true));echo("trigbad",sin(),cos("0"),tan(true),asin([1]),acos(1,2),atan(1,2),atan2(1),atan2(1,2,3));';
	try {
		const input = path.join(directory, "pow-trig.scad"), output = path.join(directory, "pow-trig.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarningCount = lines.filter((line) => line.startsWith("WARNING:")).length;
		const result = evaluate(source, { file: "pow-trig.scad" });
		const parseEcho = (line) => {
			const match = /^ECHO: "([^"]+)", (.*)$/.exec(line);
			assert.ok(match, line);
			return [match[1], ...match[2].split(", ").map((value) => value === "nan" ? NaN : value === "inf" ? Infinity : value === "-inf" ? -Infinity : value === "undef" ? undefined : Number(value))];
		};
		const nativeValues = nativeEchoes.map(parseEcho), actualValues = result.echoes.map(parseEcho);
		assert.deepEqual(actualValues.map(([label]) => label), nativeValues.map(([label]) => label));
		for (let row = 0; row < nativeValues.length; row++) {
			for (let column = 1; column < nativeValues[row].length; column++) {
				const expected = nativeValues[row][column], actual = actualValues[row][column];
				if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual), `row ${row}, value ${column}`);
				else if (Number.isFinite(expected)) assert.ok(Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-5), `${actual} differs from ${expected}`);
				else assert.equal(actual, expected);
			}
		}
		assert.equal(result.diagnostics.length, nativeWarningCount);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
			"pow() number of parameters does not match: expected 2, found 0",
			"pow() number of parameters does not match: expected 2, found 1",
			"pow() number of parameters does not match: expected 2, found 3",
			"pow() parameter could not be converted: argument 0: expected number, found string (\"2\")",
			"pow() parameter could not be converted: argument 1: expected number, found bool (true)",
			"sin() number of parameters does not match: expected 1, found 0",
			"cos() parameter could not be converted: argument 0: expected number, found string (\"0\")",
			"tan() parameter could not be converted: argument 0: expected number, found bool (true)",
			"asin() parameter could not be converted: argument 0: expected number, found vector ([1])",
			"acos() number of parameters does not match: expected 1, found 2",
			"atan() number of parameters does not match: expected 1, found 2",
			"atan2() number of parameters does not match: expected 2, found 1",
			"atan2() number of parameters does not match: expected 2, found 3",
		]);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "numeric-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("len matches native strings, vectors, objects, and strict conversion warnings", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-len-built-in-"));
	const source = 'echo("valid",len("🂡a"),len([1,2]),len(object(a=1,b=2)),len(object()),len([for(i=[0:4]) i]));echo("ranges",len([1:3]),len([3:-1:1]));echo("bad",len(),len(3),len(true),len(undef),len(object(),1));';
	try {
		const input = path.join(directory, "len.scad"), output = path.join(directory, "len.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, ["--enable=object-function", input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarningCount = lines.filter((line) => line.startsWith("WARNING:")).length;
		const result = evaluate(source, { experimental: ["object-function"], file: "len.scad" });
		assert.deepEqual(result.echoes, nativeEchoes);
		assert.deepEqual(nativeEchoes, ['ECHO: "valid", 2, 2, 2, 0, 5', 'ECHO: "ranges", undef, undef', 'ECHO: "bad", undef, undef, undef, undef, undef']);
		assert.equal(result.diagnostics.length, nativeWarningCount);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
			"len() parameter could not be converted: argument 0: expected string, found range ([1 : 1 : 3])",
			"len() parameter could not be converted: argument 0: expected string, found range ([3 : -1 : 1])",
			"len() number of parameters does not match: expected 1, found 0",
			"len() parameter could not be converted: argument 0: expected string, found number (3)",
			"len() parameter could not be converted: argument 0: expected string, found bool (true)",
			"len() parameter could not be converted: argument 0: expected string, found undefined (undef)",
			"len() number of parameters does not match: expected 1, found 2",
		]);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "len-arguments" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("lookup matches native boundaries, row handling, duplicate keys, and warnings", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-lookup-edges-"));
	const source = 'echo("bounds",lookup(-1,[[0,10],[2,20]]),lookup(0,[[0,10],[2,20]]),lookup(1,[[0,10],[2,20]]),lookup(2,[[0,10],[2,20]]),lookup(3,[[0,10],[2,20]]));echo("unsorted",lookup(1,[[2,20],[0,0],[1,10],[3,30]]),lookup(1,[[0,0],[2,20],[1,10],[3,30]]));echo("duplicates",lookup(1,[[0,0],[1,10],[1,11],[2,20]]),lookup(1,[[1,10],[1,11]]));echo("rows",lookup(1,[["bad",2],[0,0],[2,20]]),lookup(1,[[0,0],["bad",9],[2,20]]),lookup(1,[[0],[2,20]]),lookup(1,[[0,0,99],[2,20,99]]));echo("nonfinite-rows",lookup(1,[[0/0,1],[0,0],[2,20]]),lookup(1,[[0,0],[0/0,1],[2,20]]),lookup(1,[[1/0,1],[0,0],[2,20]]));echo("invalid",lookup(),lookup(1),lookup("1",[[0,0],[2,2]]),lookup(1,3),lookup(0/0,[[0,0],[2,2]]),lookup(1,[[0,0]],3));';
	try {
		const input = path.join(directory, "lookup.scad"), output = path.join(directory, "lookup.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarnings = lines.filter((line) => line.startsWith("WARNING:")).map((line) => line.replace(/^WARNING: /, "").replace(/ in file .*$/, "").replace(/\s+/g, " ").trim());
		const result = evaluate(source, { file: "lookup.scad" });
		assert.deepEqual(result.echoes, nativeEchoes);
		assert.deepEqual(nativeEchoes, [
			'ECHO: "bounds", 10, 10, 15, 20, 20',
			'ECHO: "unsorted", 10, 10',
			'ECHO: "duplicates", 10, 10',
			'ECHO: "rows", undef, 10, undef, undef',
			'ECHO: "nonfinite-rows", nan, 10, 10',
			'ECHO: "invalid", undef, undef, undef, undef, undef, undef',
		]);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), nativeWarnings);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), Array(6).fill("lookup-arguments").map((_, index) => index === 4 ? "lookup-value" : "lookup-arguments"));
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("seeded rands matches native MT19937 sequences across seeds and bounds", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-rands-"));
	const source = "echo(rands(0,1,5,1),rands(-2,3,4,42),rands(3,1,3,1),rands(2,2,3,1),rands(0,10,-3,0.5));";
	try {
		const input = path.join(directory, "rands.scad"), output = path.join(directory, "rands.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = JSON.parse(`[${(await readFile(output, "utf8")).trim().slice("ECHO: ".length)}]`);
		const actual = JSON.parse(`[${evaluate(source).echoes[0].slice("ECHO: ".length)}]`);
		const compare = (first, second) => {
			if (Array.isArray(first)) { assert.ok(Array.isArray(second)); assert.equal(first.length, second.length); first.forEach((value, index) => compare(value, second[index])); }
			else assert.ok(Math.abs(first - second) <= Math.max(1e-6, Math.abs(first) * 5.1e-6), `${first} differs from ${second}`);
		};
		compare(native, actual);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("unseeded rands continues the seeded native MT19937 stream until reseeded", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-rands-stream-"));
	const source = "echo(rands(0,1,4,42));echo(rands(0,1,4));echo(rands(0,1,4));echo(rands(0,1,4,42));echo(rands(0,1,4));";
	try {
		const input = path.join(directory, "rands-stream.scad"), output = path.join(directory, "rands-stream.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line.slice("ECHO: ".length)));
		const actual = evaluate(source).echoes.map((line) => JSON.parse(line.slice("ECHO: ".length)));
		assert.deepEqual(native.map((values) => values.length), [4, 4, 4, 4, 4]);
		for (let batch = 0; batch < native.length; batch++) for (let index = 0; index < native[batch].length; index++) {
			assert.ok(Math.abs(actual[batch][index] - native[batch][index]) <= Math.max(1e-6, Math.abs(native[batch][index]) * 5.1e-6));
		}
		assert.deepEqual(actual[0], actual[3]);
		assert.deepEqual(actual[1], actual[4]);
		assert.notDeepEqual(actual[1], actual[2]);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("rands matches native non-finite recovery, seed handling, and argument warnings", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-rands-validation-"));
	const source = 'echo([rands(1/0,1,1,1),rands(0,1/0,1,1),rands(0,1,0/0,1),rands(0,1,1,1/0),rands(0,1,1,0/0)]);echo([rands(),rands(0,1),rands(0,1,1,1,2),rands("0",1,1),rands(0,"1",1),rands(0,1,"1"),rands(0,1,1,"1"),rands([1:3],1,1)]);';
	try {
		const input = path.join(directory, "rands-validation.scad"), output = path.join(directory, "rands-validation.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarnings = lines.filter((line) => line.startsWith("WARNING:")).map((line) => line.replace(/^WARNING: /, "").replace(/ in file .*$/, "").replace(/\s+/g, " ").trim());
		const result = evaluate(source, { file: "rands-validation.scad" });
		assert.deepEqual(nativeEchoes[1], "ECHO: [undef, undef, undef, undef, undef, undef, undef, undef]");
		assert.deepEqual(result.echoes[1], nativeEchoes[1]);
		const nativeValues = JSON.parse(nativeEchoes[0].slice("ECHO: ".length));
		const actualValues = JSON.parse(result.echoes[0].slice("ECHO: ".length));
		const compare = (expected, actual) => {
			if (Array.isArray(expected)) { assert.ok(Array.isArray(actual)); assert.equal(actual.length, expected.length); expected.forEach((value, index) => compare(value, actual[index])); }
			else assert.ok(Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 5.1e-6), `${actual} differs from ${expected}`);
		};
		compare(nativeValues, actualValues);
		assert.deepEqual(result.diagnostics.map(({ message }) => message), nativeWarnings);
		assert.deepEqual(result.diagnostics.map(({ code }) => code), ["rands-range", "rands-range", "rands-range", "rands-range", "rands-range", "rands-range", ...Array(8).fill("rands-arguments")]);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("parent_module stack indexing matches nested native module calls", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-parent-module-"));
	const source = 'function current()=parent_module(); module outer(){inner();} module inner(){echo(parent_module(0),parent_module(1),parent_module(2),current());} outer(); echo(parent_module());';
	try {
		const input = path.join(directory, "parents.scad"), output = path.join(directory, "parents.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).filter((line) => line.startsWith("ECHO:"));
		assert.deepEqual(native, ['ECHO: "inner", "outer", undef, "outer"', "ECHO: undef"]);
		assert.deepEqual(evaluate(source).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("parent_module defaults and children re-entry retain native module frames", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-parent-module-children-"));
	const source = 'module leaf(label="default",captured=parent_module()){echo("leaf",label,captured,parent_module(0),parent_module(1),parent_module(2));} module inner(explicit=undef,captured=parent_module()){echo("inner-before",explicit,captured,parent_module(0),parent_module(1));children();children();echo("inner-after",parent_module(0),parent_module(1));} module outer(){echo("outer",parent_module(0));children();} outer() inner(parent_module()) leaf("passed");';
	try {
		const input = path.join(directory, "parent.scad"), output = path.join(directory, "parent.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		const result = evaluate(source, { file: "parent.scad" });
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(native, [
			'ECHO: "outer", "outer"',
			'ECHO: "inner-before", "outer", "outer", "inner", "outer"',
			'ECHO: "leaf", "passed", "inner", "leaf", "inner", "outer"',
			'ECHO: "leaf", "passed", "inner", "leaf", "inner", "outer"',
			'ECHO: "inner-after", "inner", "outer"',
		]);
		assert.deepEqual(result.diagnostics, []);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("parent_module invalid indices and arguments match native warnings", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-parent-module-errors-"));
	const source = 'module probe(){echo(parent_module(-1),parent_module(1),parent_module(1.9),parent_module("1"),parent_module(true),parent_module(undef),parent_module(0,1),parent_module(0/0),parent_module(1/0));} probe();';
	try {
		const input = path.join(directory, "parent-errors.scad"), output = path.join(directory, "parent-errors.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const nativeEchoes = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarnings = lines.filter((line) => line.startsWith("WARNING:")).map((line) => line.replace(/^WARNING: /, "").replace(/ in file .*$/, "").replace(/\s+/g, " ").trim());
		const result = evaluate(source, { file: "parent-errors.scad" });
		assert.deepEqual(result.echoes, nativeEchoes);
		assert.deepEqual(nativeEchoes, ["ECHO: undef, undef, undef, undef, undef, undef, undef, undef, undef"]);
		assert.equal(result.diagnostics.length, nativeWarnings.length);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), nativeWarnings);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
			"parent-module-range", "parent-module-range", "parent-module-range",
			"parent-module-arguments", "parent-module-arguments", "parent-module-arguments",
			"parent-module-arguments", "parent-module-range", "parent-module-range",
		]);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("parent_module excludes function frames and matches recursive and int-boundary indexing", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-parent-module-depth-"));
	const source = 'function named(depth=0)=parent_module(depth); module recursive(n){if(n>0) recursive(n-1); else echo("recursive",parent_module(0),parent_module(1),parent_module(2),named(),named(1),(function() parent_module())());} module caller(){echo("caller",named(),named(1),(function() parent_module())());} module outer(){caller();recursive(2);} outer(); module edges(){echo("fraction",parent_module(0.9),parent_module(1.9),parent_module(-0.9)); echo("large",parent_module(2147483647),parent_module(2147483648),parent_module(-2147483649),parent_module(1e100));} edges();';
	try {
		const input = path.join(directory, "parent-depth.scad"), output = path.join(directory, "parent-depth.echo");
		await writeFile(input, source);
		const execution = await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const lines = (await readFile(output, "utf8") + execution.stderr).trim().split(/\r?\n/);
		const native = lines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarnings = lines.filter((line) => line.startsWith("WARNING:")).length;
		const result = evaluate(source, { file: "parent-depth.scad" });
		assert.deepEqual(result.echoes, native);
		assert.deepEqual(native, [
			'ECHO: "caller", "caller", "outer", "outer"',
			'ECHO: "recursive", "recursive", "recursive", "recursive", "recursive", "recursive", "recursive"',
			'ECHO: "fraction", "edges", undef, "edges"',
			'ECHO: "large", undef, undef, undef, undef',
		]);
		assert.equal(result.diagnostics.length, nativeWarnings);
		assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "parent-module-range" && diagnostic.severity === "warning" && diagnostic.location));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("parent_module names and depths match across included and used modules", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-parent-module-project-"));
	const files = {
		"main.scad": 'include <included.scad> use <library.scad> module caller(){echo("caller",parent_module(0),parent_module(1)); include_alias(); lib_entry();} caller();',
		"included.scad": 'module include_leaf(){echo("include-leaf",parent_module(0),parent_module(1),parent_module(2));} module include_alias(){include_leaf();}',
		"library.scad": 'module lib_entry(){echo("lib-entry",parent_module(0),parent_module(1),parent_module(2)); lib_alias();} module lib_alias(){echo("lib-alias",parent_module(0),parent_module(1),parent_module(2));}',
	};
	try {
		for (const [filename, text] of Object.entries(files)) await writeFile(path.join(directory, filename), text);
		const output = path.join(directory, "project.echo");
		const nativeRun = await exec(oracle, [path.join(directory, "main.scad"), "-o", output], { timeout: 30_000 });
		const nativeLines = (await readFile(output, "utf8") + nativeRun.stderr).trim().split(/\r?\n/);
		const nativeEchoes = nativeLines.filter((line) => line.startsWith("ECHO:"));
		const nativeWarnings = nativeLines.filter((line) => line.startsWith("WARNING:"));
		const project = await resolveProject({ entry: "main.scad", files });
		const result = evaluate(project.statements);
		assert.deepEqual(result.echoes, nativeEchoes);
		assert.deepEqual(nativeEchoes, [
			'ECHO: "caller", "caller", undef',
			'ECHO: "include-leaf", "include_leaf", "include_alias", "caller"',
			'ECHO: "lib-entry", "lib_entry", "caller", undef',
			'ECHO: "lib-alias", "lib_alias", "lib_entry", "caller"',
		]);
		assert.equal(nativeWarnings.length, 2);
		assert.equal(result.diagnostics.length, nativeWarnings.length);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["parent-module-range", "parent-module-range"]);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.location.file), ["main.scad", "library.scad"]);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("experimental object values and functions match native merge/delete semantics", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-object-functions-"));
	const source = 'base=object(a=1,b=[2,3]); result=object(base,[["a"],["c",4]],d=5); echo(is_object(result),has_key(result,"b"),has_key(result,"a"),result.c,result["d"],result);';
	try {
		const input = path.join(directory, "objects.scad"), output = path.join(directory, "objects.echo");
		await writeFile(input, source);
		await exec(oracle, ["--enable=object-function", input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).filter((line) => line.startsWith("ECHO:"));
		const actual = evaluate(source, { experimental: ["object-function"] });
		assert.deepEqual(actual.echoes, native);
		assert.deepEqual(native, ['ECHO: true, true, false, 4, 5, { b = [2, 3]; c = 4; d = 5; }']);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("object methods and vector swizzles match their native experimental flags", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-object-methods-swizzle-"));
	const code = "obj=object(a=42,f=function(n,this) n==0?this.a:n*this.f(n-1)); saved=obj.f; vec=[1,2,3,4]; echo(obj.f(2),saved(1),vec.zyx,vec.xz,vec.w);";
	try {
		const input = path.join(directory, "main.scad"), output = path.join(directory, "main.echo");
		await writeFile(input, code);
		await exec(oracle, ["--enable=object-function", "--enable=vector-swizzle", input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/);
		assert.deepEqual(native, ["ECHO: 84, 42, [3, 2, 1], [1, 3], 4"]);
		assert.deepEqual(evaluate(code, { experimental: ["object-function", "vector-swizzle"] }).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("object comparison dispatch matches native inequality, nesting and key order", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-object-comparison-"));
	const source = 'a=object(k=1);b=object(k=2);echo(a==b,a!=b,a==a,a!=a,object(b=2,a=1)==object(a=1,b=2),object(n=object(k=1))==object(n=object(k=1)),[object(k=1)]==[object(k=1)],a==1,a!=1);echo(a+a,a-a,a*2);';
	try {
		const input = path.join(directory, "comparison.scad"), output = path.join(directory, "comparison.echo");
		await writeFile(input, source);
		await exec(oracle, ["--enable=object-function", input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).filter((line) => line.startsWith("ECHO:"));
		assert.deepEqual(native, ["ECHO: false, true, true, false, false, true, true, false, true", "ECHO: undef, undef, undef"]);
		assert.deepEqual(evaluate(source, { experimental: ["object-function"] }).echoes, native);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("textmetrics and fontmetrics match native for the bundled Liberation font", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-font-metrics-"));
	const source = 'tm=textmetrics("hello",font="Liberation Sans"); fm=fontmetrics(font="Liberation Sans"); echo([tm.position,tm.size,tm.ascent,tm.descent,tm.offset,tm.advance]); echo([fm.nominal.ascent,fm.nominal.descent,fm.max.ascent,fm.max.descent,fm.interline]);';
	const engine = await createEngine();
	try {
		const input = path.join(directory, "metrics.scad"), output = path.join(directory, "metrics.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const native = (await readFile(output, "utf8")).trim().split(/\r?\n/).filter((line) => line.startsWith("ECHO:")).map((line) => JSON.parse(line.slice("ECHO: ".length)));
		const compiled = await engine.compile({ files: { "main.scad": source } });
		assert.equal(compiled.status, "success", JSON.stringify(compiled.diagnostics));
		const actual = compiled.echoes.map((line) => JSON.parse(line.slice("ECHO: ".length)));
		const compare = (expected, value) => {
			if (Array.isArray(expected)) { assert.ok(Array.isArray(value)); assert.equal(expected.length, value.length); expected.forEach((item, index) => compare(item, value[index])); }
			else assert.ok(Math.abs(expected - value) < 0.02, `${expected} differs from ${value}`);
		};
		native.forEach((value, index) => compare(value, actual[index]));
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("metric expression overrides prepare fonts and match native -D values", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-override-metrics-"));
	const source = 'tm=undef;fm=undef;echo([tm.size,tm.advance,fm.nominal.ascent,fm.interline]);';
	const defineExpressions = ['tm=textmetrics("hello",font="Liberation Sans")', 'fm=fontmetrics(font="Liberation Sans")'];
	const engine = await createEngine();
	try {
		const input = path.join(directory, "metrics.scad"), output = path.join(directory, "metrics.echo");
		await writeFile(input, source);
		await exec(oracle, [input, ...defineExpressions.flatMap((expression) => ["-D", expression]), "-o", output], { timeout: 30_000 });
		const native = JSON.parse((await readFile(output, "utf8")).trim().slice("ECHO: ".length)).flat();
		const result = await engine.compile({ defineExpressions, files: { "main.scad": source } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try {
			const actual = JSON.parse(result.echoes[0].slice("ECHO: ".length)).flat();
			assert.equal(actual.length, native.length);
			actual.forEach((value, index) => assert.ok(Math.abs(value - native[index]) < 0.02, `${value} differs from ${native[index]}`));
		} finally { result.dispose(); }
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("extended reference cases are native-valid with explicit experimental opt-ins", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-pending-"));
	const pending = new URL("../references/language_features_pending.scad", import.meta.url);
	const data = await readFile(new URL("../references/language_features_data.json", import.meta.url), "utf8");
	try {
		await writeFile(path.join(directory, "main.scad"), await readFile(pending, "utf8"));
		await writeFile(path.join(directory, "language_features_data.json"), data);
		for (const caseId of [1, 2]) {
			const output = path.join(directory, `${caseId}.echo`);
			const experiment = caseId === 2 ? "import-function" : null;
			await exec(oracle, [...(experiment ? [`--enable=${experiment}`] : []), path.join(directory, "main.scad"), "-D", `case_id=${caseId}`, "-o", output], { timeout: 30_000 });
			const text = await readFile(output, "utf8");
			assert.doesNotMatch(text, /WARNING:|ERROR:/);
			assert.doesNotMatch(text, /DEPRECATED:/);
			assert.equal(text.split(/\r?\n/).filter((line) => line.startsWith("ECHO:")).length, 1);
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("numeric-prefix identifiers match native behavior and report deprecation", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-identifier-"));
	const source = 'module 180_camera() { echo("numeric-prefix identifier", 8); cube(2); } 180_camera();';
	try {
		const input = path.join(directory, "identifier.scad"); const output = path.join(directory, "identifier.echo");
		await writeFile(input, source);
		await exec(oracle, [input, "-o", output], { timeout: 30_000 });
		const text = await readFile(output, "utf8");
		assert.match(text, /DEPRECATED: Variable names starting with digits/);
		assert.deepEqual(text.trim().split(/\r?\n/).filter((line) => line.startsWith("ECHO:")), ['ECHO: "numeric-prefix identifier", 8']);
		const result = evaluate(source);
		assert.deepEqual(result.echoes, ['ECHO: "numeric-prefix identifier", 8']);
		assert.equal(result.diagnostics[0].code, "deprecated-identifier");
		assert.equal(result.diagnostics[0].location.line, 1);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("legacy identifiers do not consume decimal, hexadecimal or exponent literals", () => {
	const result = evaluate("180_value=3; echo(180_value, 1e3, 1E-2, .5, 180, 0x1F0A1, 1e3_name);", { defines: { "1e3_name": 4 } });
	assert.deepEqual(result.echoes, ["ECHO: 3, 1000, 0.01, 0.5, 180, 127137, 4"]);
	assert.equal(result.diagnostics.filter((item) => item.code === "deprecated-identifier").length, 2);
});

test("bounded list comprehensions match native for, if/else, each and let semantics", async () => {
	const code = 'echo([for(index=[0:3]) index*index], [for(index=[0:4]) if(index%2==0) index], [for(index=[0:2]) if(index>0) index else -1], [each [1,2], each [3:4]], [for(index=[1,2]) let(value=index+3) [value]]);';
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-comprehension-"));
	try {
		const input = path.join(directory, "main.scad"); const output = path.join(directory, "result.echo");
		await writeFile(input, code); await exec(oracle, [input, "-o", output]);
		assert.deepEqual(evaluate(code).echoes, (await readFile(output, "utf8")).trim().split(/\r?\n/));
		assert.throws(() => evaluate("echo([for(index=[0:1000000]) index]);"), /limit/);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("polyhedron tetrahedron is native-equivalent and rejects invalid topology", async () => {
	const code = "polyhedron(points=[[0,0,0],[2,0,0],[0,2,0],[0,0,2]], faces=[[0,1,2],[0,3,1],[0,2,3],[1,3,2]]);";
	const engine = await createEngine(); const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-polyhedron-"));
	try {
		const input = path.join(directory, "main.scad"); const output = path.join(directory, "native.stl"); await writeFile(input, code);
		await exec(oracle, [input, "--backend=Manifold", "--export-format=binstl", "-o", output]);
		const native = measureMesh(decodeBinaryStl(await readFile(output)));
		const result = await engine.compile({ mode: "render", files: { "main.scad": code } });
		assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
		try { assert.ok(Math.abs(result.volume - native.volume) < 0.00001); assert.deepEqual(result.bounds, native.bounds); } finally { result.dispose(); }
		assert.equal((await engine.compile({ files: { "main.scad": "polyhedron(points=[[0,0,0]], faces=[[0,1,2]]);" } })).status, "error");
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("supported language reference produces native-equivalent final geometry", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-language-solid-"));
	const engine = await createEngine();
	try {
		const output = path.join(directory, "reference.stl");
		await exec(oracle, [fileURLToPath(sourceUrl), "--backend=Manifold", "--export-format=binstl", "-o", output], { timeout: 30_000 });
		const native = measureMesh(decodeBinaryStl(await readFile(output)));
		const result = await engine.compile({ mode: "render", entry: "language_features.scad", files: { "language_features.scad": source } });
		assert.equal(result.status, "success");
		try {
			const candidate = measureMesh(decodeBinaryStl(await engine.export(result)));
			assert.ok(Math.abs(candidate.volume - native.volume) < 0.0001);
			candidate.bounds.flat().forEach((value, index) => assert.ok(Math.abs(value - native.bounds.flat()[index]) < 0.0001));
			assert.equal(candidate.closed, native.closed);
			assert.equal(candidate.degenerateTriangles, 0);
		} finally { result.dispose(); }
	} finally { engine.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("extended reference cases compile with their required experimental gates", async () => {
	const engine = await createEngine();
	const pending = await readFile(new URL("../references/language_features_pending.scad", import.meta.url), "utf8");
	const data = await readFile(new URL("../references/language_features_data.json", import.meta.url), "utf8");
	try {
		for (const caseId of [1, 2]) {
			const experimental = caseId === 2 ? ["import-function"] : [];
			const result = await engine.compile({ mode: "render", defines: { case_id: caseId }, experimental, files: { "main.scad": pending, "language_features_data.json": data } });
			assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
			assert.ok(result.volume > 0);
			result.dispose();
		}
	} finally { engine.dispose(); }
});