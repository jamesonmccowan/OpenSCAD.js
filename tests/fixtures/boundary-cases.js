export const boundarySeed = 0x5cad;

export function malformedBoundaryCases() {
	const cycle = {}; cycle.self = cycle;
	const vectorCycle = []; vectorCycle.push(vectorCycle);
	let deep = 1;
	for (let level = 0; level < 65; level++) deep = { child: deep };
	const source = (name, text, code, options = {}) => ({ name, code, located: true, request: { ...options, files: { "main.scad": text } } });
	const cases = [
		{ name: "cyclic object", code: "resource-limit", request: { defines: { payload: cycle } } },
		{ name: "cyclic vector", code: "resource-limit", request: { defines: { payload: vectorCycle } } },
		{ name: "binding depth 65", code: "resource-limit", request: { defines: { payload: deep } } },
		{ name: "sparse vector over slot limit", code: "resource-limit", request: { defines: { payload: new Array(100001) } } },
		{ name: "aggregate vector slot limit", code: "resource-limit", request: { defines: { first: new Array(49999), second: new Array(50000) } } },
		{ name: "non-SCAD date value", code: "invalid-request", request: { defines: { payload: new Date(0) } } },
		{ name: "non-SCAD null value", code: "invalid-request", request: { defines: { payload: null } } },
		{ name: "invalid evaluator limit", code: "invalid-request", request: { maxDepth: 0, files: { "main.scad": "cube();" } } },
		source("oversized source", " ".repeat(1000001), "resource-limit"),
		source("deep parser expression", `echo(${'('.repeat(260)}1${')'.repeat(260)});`, "resource-limit"),
		source("oversized range", "for(index=[0:1000000])cube();", "resource-limit", { maxSteps: 100 }),
		source("recursive closure", "fn=function()fn();echo(fn());", "resource-limit", { maxDepth: 12 }),
		source("dependency cycle", "include <main.scad>", "dependency-cycle"),
		source("escaping include", "include <../outside.scad>", "restricted-path"),
		source("nonfinite geometry", "cube([0/0,1,1]);", "geometry-error"),
		source("invalid face index", "polyhedron(points=[[0,0,0],[1,0,0],[0,1,0]],faces=[[0,1,99]]);", "geometry-error"),
		source("mixed geometry dimensions", "union(){cube();square();}", "mixed-dimensions"),
		source("inherited builtin function name", "echo(constructor());", "unsupported-feature"),
		source("extreme fragment count", "sphere($fn=1000000000);", "geometry-error", { maxTriangles: 1000 }),
		source("extrusion subdivision estimate", "linear_extrude(height=5,slices=10)square(2);", "resource-limit", { maxTriangles: 10 }),
	];
	let state = boundarySeed;
	for (let index = 0; index < 12; index++) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		const program = `translate([${state % 17},0,0])cube([${1 + state % 7},2,3]);`;
		cases.push(source(`truncated program ${index}, seed ${boundarySeed}`, program.slice(0, -(1 + state % 3)), "syntax-error"));
	}
	return cases;
}

export function validBindingBoundaries() {
	let deep = 1;
	for (let level = 0; level < 64; level++) deep = { child: deep };
	const keys = Object.create(null);
	keys.__proto__ = 7; keys.constructor = 8; keys.prototype = 9;
	keys.anonymous = true; keys.statement = {}; keys.scope = {};
	return [
		{ name: "prototype-like parameter names", defines: {}, source: "function read(__proto__,constructor)=[__proto__,constructor];echo(read(7,8));cube(2);", echo: "ECHO: [7, 8]" },
		{ name: "maximum binding depth", defines: { payload: deep }, source: "echo(is_object(payload));cube(2);", echo: "ECHO: true" },
		{ name: "maximum vector slots including container", defines: { payload: new Array(99999) }, source: "echo(len(payload));cube(2);", echo: "ECHO: 99999" },
		{ name: "prototype and callable-like keys", defines: { payload: keys }, source: 'echo(payload["__proto__"],payload.constructor,payload.prototype,is_object(payload),is_function(payload));cube(2);', echo: "ECHO: 7, 8, 9, true, false" },
	];
}