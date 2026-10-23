import assert from "node:assert/strict";
import { test } from "node:test";
import createModule from "manifold-3d";
import { CAPABILITIES, evaluate } from "../src/core/evaluator.js";
import { compileScad } from "../src/core/compiler.js";
import { languageCases } from "./fixtures/backend-cases.js";

for (const fixture of languageCases) {
	test(`reusable evaluator: ${fixture.id}`, () => {
		const result = evaluate(fixture.source, { file: `${fixture.id}.scad` });
		assert.deepEqual(result.echoes, fixture.echoes);
		assert.equal(result.diagnostics.length, fixture.diagnostics?.length ?? 0);
		assert.equal(typeof document, "undefined");
	});
}

test("immutable semantic tree preserves primitive resolution and CSG children", () => {
	const result = evaluate("$fn=8; difference() { sphere(5); %translate([0,0,2]) cylinder(h=10, r=2, $fn=12); }");
	const difference = result.tree.children[0];
	assert.equal(difference.kind, "boolean");
	assert.equal(difference.children.length, 2);
	assert.equal(difference.children[0].resolution.$fn, 8);
	assert.equal(difference.children[1].kind, "modifier");
	assert.equal(difference.children[1].children[0].children[0].resolution.$fn, 12);
	assert.ok(Object.isFrozen(result.tree));
	assert.ok(Object.isFrozen(difference.children[0].args));
});

test("functions are lexical while special variables follow the caller", () => {
	const result = evaluate("a=1; $fn=6; function value()=[a,$fn]; module inner() { a=2; $fn=8; echo(value()); } inner(); echo(value());");
	assert.deepEqual(result.echoes, ["ECHO: [1, 8]", "ECHO: [1, 6]"]);
});

test("conditionals, recursion, ranges, indexing and let expressions", () => {
	const result = evaluate("function factorial(n)=n<=1 ? 1 : n*factorial(n-1); echo(factorial(5)); echo(let(a=2,b=a+3) b); for(i=[0:2:4]) if(i>0) translate([i,0,0]) cube([1,2,3]); echo([3,4].y, \"abc\"[1]);");
	assert.deepEqual(result.echoes, ["ECHO: 120", "ECHO: 5", 'ECHO: 4, "b"']);
	assert.equal(result.tree.children.filter((node) => node.children.length).length, 1);
});

test("intersection_for and range loops preserve their distinct CSG semantics", async () => {
	const result = evaluate('for(i=[0:1:2]) echo(i); module first(){ children(0); } first(){ cube(2); sphere(1); }');
	assert.deepEqual(result.echoes, ["ECHO: 0", "ECHO: 1", "ECHO: 2"]);
	assert.equal(result.tree.children.at(-1).children[0].children[0].args.size, 2);
	assert.ok(CAPABILITIES.syntax.includes("intersection_for"));
	assert.ok(!CAPABILITIES.unsupported.includes("intersection_for"));
	const moduleInstance = await createModule();
	moduleInstance.setup();
	const compiled = compileScad("intersection_for(i=[0:1]) translate([i,0,0]) cube(2);", moduleInstance);
	try { assert.equal(compiled.solid.volume(), 4); }
	finally { compiled.dispose(); }
});

test("built-in functions accept labels while evaluating values in native call order", () => {
	const result = evaluate("echo(pow(y=3,x=2),pow(x=2,y=3),atan2(x=1,y=0),max(b=2,a=5),concat(b=[2],a=[1]),sqrt(missing=9)); echo(pow(2,3),atan2(1,0),min(5,2),max(5,2));");
	assert.deepEqual(result.echoes, ["ECHO: 9, 8, 90, 5, [2, 1], 3", "ECHO: 8, 90, 2, 5"]);
	assert.ok(CAPABILITIES.syntax.includes("named-built-in-function-arguments"));
	assert.ok(!CAPABILITIES.unsupported.includes("named-built-in-function-arguments"));
});

test("cross and lookup built-ins match native vector and interpolation behavior", () => {
	const result = evaluate("echo(cross([1,2,3],[4,5,6]),lookup(2,[[0,0],[4,8]]),lookup(3,[[4,8],[0,0]]),lookup(-1,[[0,2],[4,6]]),lookup(5,[[0,2],[4,6]]),lookup(2,[]));");
	assert.deepEqual(result.echoes, ["ECHO: [-3, 6, -3], 4, 6, 2, 6, undef"]);
});

test("Unicode chr/ord, version_num, and search return native-shaped results", () => {
	const result = evaluate('echo(chr(65),chr([65,66]),chr([65:67]),chr(0x1F0A1),ord("🂡a"),version_num(),search("ab","aabb"),search("ab","aabb",0),search("ab",[["x","a"],["y","b"],["z","a"]],0,1),search(["b","a"],["a","b","a"],1),search(2,[1,2,2],0));');
	assert.deepEqual(result.echoes, ['ECHO: "A", "AB", "ABC", "🂡", 127137, 20261002, [0, 2], [[0, 1], [2, 3]], [[0, 2], [1]], [1, 0], [1, 2]']);
});

test("seeded rands is deterministic and bounded by the evaluator budget", () => {
	const first = evaluate("echo(rands(0,1,5,1),rands(-2,3,4,42),rands(3,1,3,1),rands(2,2,3,1));");
	const second = evaluate("echo(rands(0,1,5,1),rands(-2,3,4,42),rands(3,1,3,1),rands(2,2,3,1));");
	assert.deepEqual(first.echoes, second.echoes);
	assert.throws(() => evaluate("echo(rands(0,1,20,1));", { maxSteps: 10 }), (error) => error.code === "resource-limit");
});

test("randomSeed makes unseeded rands reproducible for each evaluation", () => {
	const source = "echo(rands(0,1,5),rands(0,1,3));";
	const first = evaluate(source, { randomSeed: 42 });
	const repeated = evaluate(source, { randomSeed: 42 });
	const different = evaluate(source, { randomSeed: 43 });
	assert.deepEqual(first.echoes, repeated.echoes);
	assert.notDeepEqual(first.echoes, different.echoes);
	assert.deepEqual(first.echoes, ["ECHO: [0.796542984287846, 0.18343478789336848, 0.7796909976126613, 0.5968501615800565, 0.44583275754843343], [0.09997492054384075, 0.45924888785418205, 0.3337086115186513]"]);
	assert.throws(() => evaluate("echo(1);", { randomSeed: "42" }), /randomSeed must be a number/);
});

test("anonymous functions capture lazy lexical scope and support defaults and named parameters", () => {
	const source = "base=3; square_fn=function(x) x*x; scale_fn=function(x,factor=2) x*factor; captured=function(x) x+base; base=9; echo(square_fn(4),scale_fn(3),scale_fn(factor=4,x=3),captured(2));";
	const result = evaluate(source);
	assert.deepEqual(result.echoes, ["ECHO: 16, 6, 12, 11"]);
	assert.ok(CAPABILITIES.syntax.includes("anonymous-functions:closures"));
	assert.ok(!CAPABILITIES.unsupported.includes("anonymous-functions"));
});

test("call expressions invoke closure values, indexes, and members", () => {
	const source = 'double_fn=function(x) x*2; apply=function(fn,x) fn(x); funcs=[function(x) x+1]; record=object(run=function(x) x+4); echo((function(x) x*3)(2),funcs[0](4),apply(double_fn,5),apply(function(x) sin(x),30),record.run(2),record["run"](3),is_function(double_fn));';
	const result = evaluate(source, { experimental: ["object-function"] });
	assert.deepEqual(result.echoes, ["ECHO: 6, 5, 10, 0.5, 6, 7, true"]);
	assert.ok(CAPABILITIES.syntax.includes("callable-expressions"));
	assert.ok(!CAPABILITIES.unsupported.includes("callable-expressions"));
});

test("parent_module indexes only the active user-module stack", () => {
	const source = 'function current()=parent_module(); module outer(){inner();} module inner(){echo(parent_module(0),parent_module(1),parent_module(2),current());} outer(); echo(parent_module());';
	const result = evaluate(source);
	assert.deepEqual(result.echoes, ['ECHO: "inner", "outer", undef, "outer"', "ECHO: undef"]);
	assert.deepEqual(result.diagnostics.map((item) => item.code), ["parent-module-range", "parent-module-range"]);
});

test("experimental objects merge, set, delete, access keys, and remain gated", () => {
	const source = 'base=object(a=1,b=[2,3]); result=object(base,[["a"],["c",4]],d=5); echo(is_object(result),has_key(result,"b"),has_key(result,"a"),result.c,result["d"],result);';
	assert.throws(() => evaluate("echo(object(a=1));"), (error) => error.code === "experimental-disabled");
	assert.throws(() => evaluate("has_key(object(),\"a\");"), (error) => error.code === "experimental-disabled");
	const result = evaluate(source, { experimental: ["object-function"] });
	assert.deepEqual(result.echoes, ['ECHO: true, true, false, 4, 5, { b = [2, 3]; c = 4; d = 5; }']);
	assert.deepEqual(result.diagnostics, []);
});

test("experimental object methods bind this through copied and recursive calls", () => {
	const source = 'record=object(value=42, factorial=function(n,this) n<=1 ? this.value : n*this.factorial(n-1)); saved=record.factorial; echo(record.factorial(3),saved(1),record["factorial"](2),is_function(record.factorial)); plain=function(this) this; echo(is_undef(plain()));';
	assert.throws(() => evaluate(source), (error) => error.code === "experimental-disabled");
	const result = evaluate(source, { experimental: ["object-function"] });
	assert.deepEqual(result.echoes, ["ECHO: 252, 42, 84, true", "ECHO: true"]);
});

test("experimental vector swizzling reads and reorders components", () => {
	assert.throws(() => evaluate("echo([1,2,3,4].zyx);"), (error) => error.code === "experimental-disabled");
	const result = evaluate("v=[1,2,3,4]; echo(v.zyx,v.xz,v.w,v.x);", { experimental: ["vector-swizzle"] });
	assert.deepEqual(result.echoes, ["ECHO: [3, 2, 1], [1, 3], 4, 1"]);
});

test("API object bindings become safe SCAD objects with nested property access", () => {
	const result = evaluate('echo(is_object(config),config.width,config.nested.enabled,config["bad-key"],config.anonymous);', { defines: { config: { width: 12, nested: { enabled: true }, "bad-key": 4, anonymous: true } } });
	assert.deepEqual(result.echoes, ["ECHO: true, 12, true, 4, true"]);
});

test("text metric built-ins require asynchronous font preparation", () => {
	assert.throws(() => evaluate('echo(textmetrics("hello"));'), (error) => error.code === "unresolved-font");
});

test("short-circuit evaluation and mode/time snapshots", () => {
	assert.deepEqual(evaluate("echo(false && missing, true || missing, $preview, $t);", { mode: "render", time: 0.5 }).echoes, ["ECHO: false, true, false, 0.5"]);
	assert.equal(evaluate("echo(false && missing);").diagnostics.length, 0);
});

test("unbraced children and modifiers follow upstream grammar", () => {
	const syntaxError = (line, pattern) => (error) => error.code === "syntax-error" && error.location.line === line && pattern.test(error.message);
	for (const source of [
		"color([0,1,1])\nx = [1,2,3];\ncube(x);",
		"if (true) y = 2;",
		"if (true) cube(); else y = 3;",
		"for (i=[1]) y = 2;",
		"let (a=1) y = 2;",
		"module m() children(); m() y = 2;",
	]) assert.throws(() => evaluate(source), syntaxError(source.startsWith("color") ? 2 : 1, /Assignment to '\w+' cannot be the unbraced child/), source);
	assert.throws(() => evaluate("translate([1,0,0]) function f() = 1;"), syntaxError(1, /Function definition 'f'/));
	assert.throws(() => evaluate("if (true) module m() cube();"), syntaxError(1, /Module definition 'm'/));
	for (const source of ["# y = 2;", "# module m() cube();", "# function f() = 1;", "% { cube(); }", "# ;"]) {
		assert.throws(() => evaluate(source), syntaxError(1, /Modifier '[#%]' can only be applied to a module instantiation/), source);
	}
	for (const source of [
		"translate([1,0,0]) { y = 2; cube(y); }",
		"if (true) { y = 2; cube(y); } else { z = 1; cube(z); }",
		"module m() y = 2; cube(1);",
		"cube(1) { y = 2; }",
		"color(\"red\") ; cube(1);",
		"if (true) if (true) cube(1); else #cube(2);",
		"translate([1,0,0]) %cube(1);",
	]) assert.doesNotThrow(() => evaluate(source), source);
});

test("bounded evaluation, located errors, and unsupported features", () => {
	assert.throws(() => evaluate("cube("), (error) => error.name === "ScadError" && error.location.line === 1);
	assert.throws(() => evaluate("for(i=[0:1000000]) cube();"), /limit/);
	assert.throws(() => evaluate("function forever()=forever(); echo(forever());"), /depth limit/);
	assert.equal(evaluate("hull() cube();").tree.children[0].kind, "hull");
	assert.equal(evaluate("rotate_extrude() square();").tree.children[0].kind, "revolution");
	assert.equal(evaluate("projection() cube();").tree.children[0].kind, "projection");
	assert.equal(evaluate("minkowski() cube();").tree.children[0].kind, "minkowski");
	assert.throws(() => evaluate(`echo(${'('.repeat(300)}1${')'.repeat(300)});`), /nesting limit/);
	assert.throws(() => evaluate("cube();", { maxSteps: NaN }), /positive safe integers/);
	assert.deepEqual(evaluate("echo([[1,2]]*[[3],[4]]);").echoes, ["ECHO: [[11]]"]);
	assert.throws(() => evaluate("echo([1,2]<[3,4]);"), (error) => error.code === "unsupported-feature" && error.location.line === 1);
	assert.equal(evaluate("cube();").capabilities, CAPABILITIES);
	assert.ok(Object.isFrozen(CAPABILITIES.unsupported));
});

const module = await createModule();
module.setup();

test("preview layers preserve transforms but do not enter the solid", () => {
	const source = "cube(4); translate([10,0,0]) %color([1,0,0,0.5]) cube(2); #translate([0,0,4]) cube(1); *cube(100);";
	const preview = compileScad(source, module);
	const rendered = compileScad(source, module, { mode: "render" });
	try {
		assert.equal(preview.solid.volume(), 65);
		assert.equal(rendered.solid.volume(), 65);
		assert.equal(preview.layers.background.length, 1);
		assert.equal(preview.layers.background[0].kind, "transform");
		assert.deepEqual(preview.layers.background[0].args.v, [10, 0, 0]);
		assert.equal(preview.layers.debug.length, 1);
		assert.deepEqual(rendered.layers, { background: [], debug: [] });
	} finally { preview.dispose(); rendered.dispose(); }
	preview.dispose();
	assert.throws(() => preview.getMesh(), /disposed/);
});

test("root selection, grouped operands, selected time, and geometry errors", () => {
	const result = compileScad("cube(100); !translate([10*$t,0,0]) cube(2);", module, { time: 0.5 });
	try { assert.equal(result.solid.volume(), 8); assert.deepEqual(result.solid.boundingBox().min, [5, 0, 0]); }
	finally { result.dispose(); }
	assert.throws(() => compileScad("union() { cube(); square(); }", module), (error) => error.code === "mixed-dimensions");
	assert.throws(() => compileScad("square();", module), (error) => error.code === "mixed-dimensions");
	assert.throws(() => compileScad("linear_extrude(5) cube();", module), (error) => error.code === "mixed-dimensions");
	assert.throws(() => compileScad("sphere(r=0/0);", module), (error) => error.location.line === 1);
	assert.throws(() => compileScad("linear_extrude(5) circle(r=2, $fn=1e9);", module), /fragment limit/);
	assert.throws(() => compileScad("linear_extrude(height=5, slices=1e9) square();", module), /slice limit/);
});

test("compiler instances do not retain resolution, echoes, or geometry after failure", () => {
	for (let cycle = 0; cycle < 20; cycle++) {
		assert.throws(() => compileScad("cube(); sphere($fn=1e9);", module), /triangle limit/);
		const result = compileScad("echo($fn); cube(2);", module);
		try { assert.deepEqual(result.evaluation.echoes, ["ECHO: 0"]); assert.equal(result.solid.volume(), 8); }
		finally { result.dispose(); }
	}
});

test("preview provenance preserves native outer-color precedence and separate ghost/debug meshes", () => {
	const result = compileScad('color("red",0.8) { color([0,0,1,0.2]) cube(2); } %translate([5,0,0]) cube(2); #translate([0,0,2]) cube(1);', module);
	try {
		const mesh = result.getMesh();
		assert.ok(mesh.runOriginalID.length > 0);
		const appearances = Object.values(result.materials).map((material) => material.appearance);
		assert.ok(appearances.some((appearance) => appearance.c === "red" && appearance.alpha === 0.8));
		assert.ok(!appearances.some((appearance) => Array.isArray(appearance.c)));
		assert.deepEqual(result.overlays.map((overlay) => overlay.kind), ["background", "debug"]);
		assert.ok(result.overlays.every((overlay) => overlay.mesh.triVerts.length > 0));
		assert.equal(result.solid.volume(), 9);
	} finally { result.dispose(); }
});

test("source view assignments are top-level while viewport reads use the host snapshot", () => {
	const result = evaluate('$vpt=[1,2,3]; $vpd=80; module nested() { $vpf=10; cube(); } nested(); echo($vpr);', { specialVariables: { $vpr: [55, 0, 25] } });
	assert.deepEqual(result.view, { $vpt: [1, 2, 3], $vpd: 80 });
	assert.deepEqual(result.echoes, ["ECHO: [55, 0, 25]"]);
});