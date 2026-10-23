import { GeometryAdapter } from "../../src/geometry/manifold.js";

function sphereExpectation(radius, fragments) {
	const latitudes = Math.ceil(fragments / 2);
	let volume = 0;
	let previousRadius;
	let previousHeight;
	let maximumRadius = 0;
	for (let latitude = 0; latitude < latitudes; latitude++) {
		const angle = (latitude + 0.5) * Math.PI / latitudes;
		const currentRadius = radius * Math.sin(angle);
		const height = radius * Math.cos(angle);
		maximumRadius = Math.max(maximumRadius, currentRadius);
		if (latitude > 0) volume += (previousHeight - height) * (previousRadius ** 2 + previousRadius * currentRadius + currentRadius ** 2);
		previousRadius = currentRadius;
		previousHeight = height;
	}
	const horizontal = Array.from({ length: fragments }, (_, index) => index * 2 * Math.PI / fragments);
	const height = radius * Math.cos(Math.PI / (2 * latitudes));
	return {
		volume: volume * fragments * Math.sin(2 * Math.PI / fragments) / 6,
		bounds: [
			[Math.min(...horizontal.map(Math.cos)) * maximumRadius, Math.min(...horizontal.map(Math.sin)) * maximumRadius, -height],
			[Math.max(...horizontal.map(Math.cos)) * maximumRadius, Math.max(...horizontal.map(Math.sin)) * maximumRadius, height],
		],
	};
}

function sphereFixture(id, source, radius, fragments, args, specialVariables = {}) {
	return {
		id, source, ...sphereExpectation(radius, fragments),
		build: (module, own) => own(new GeometryAdapter(module, { specialVariables }).sphere(args)),
	};
}

function cylinderFixture(id, source, height, bottomRadius, topRadius, fragments, args, specialVariables = {}) {
	const radius = Math.max(bottomRadius, topRadius);
	const angles = Array.from({ length: fragments }, (_, index) => index * 2 * Math.PI / fragments);
	const bottomHeight = args.center ? -height / 2 : 0;
	return {
		id, source,
		volume: fragments * Math.sin(2 * Math.PI / fragments) / 6 * height * (bottomRadius ** 2 + bottomRadius * topRadius + topRadius ** 2),
		bounds: [
			[Math.min(...angles.map(Math.cos)) * radius, Math.min(...angles.map(Math.sin)) * radius, bottomHeight],
			[Math.max(...angles.map(Math.cos)) * radius, Math.max(...angles.map(Math.sin)) * radius, bottomHeight + height],
		],
		build: (module, own) => own(new GeometryAdapter(module, { specialVariables }).cylinder(args)),
	};
}

export const primitiveCases = [
	sphereFixture("sphere-default-resolution", "sphere(r=5);", 5, 16, { r: 5 }),
	sphereFixture("sphere-adaptive-angle", "$fa=45; $fs=0.1; sphere(r=5);", 5, 8, { r: 5 }, { $fa: 45, $fs: 0.1 }),
	sphereFixture("sphere-adaptive-size", "$fa=1; $fs=4; sphere(r=5);", 5, 8, { r: 5 }, { $fa: 1, $fs: 4 }),
	sphereFixture("sphere-odd-fragments", "$fn=7; sphere(r=2);", 2, 7, { r: 2 }, { $fn: 7 }),
	sphereFixture("sphere-fractional-fragments", "$fn=7.2; sphere(r=2);", 2, 8, { r: 2 }, { $fn: 7.2 }),
	sphereFixture("sphere-minimum-fixed-fragments", "$fn=1; sphere(r=2);", 2, 3, { r: 2 }, { $fn: 1 }),
	sphereFixture("sphere-local-fn-override", "$fn=6; sphere(d=4, $fn=9);", 2, 9, { d: 4, $fn: 9 }, { $fn: 6 }),
	{
		...sphereFixture("sphere-dynamic-module-resolution", "$fn=8; module shape() { sphere(r=2); } shape($fn=7);", 2, 7, { r: 2 }),
		build: (module, own) => own(new GeometryAdapter(module, { specialVariables: { $fn: 8 } }).withSpecialVariables({ $fn: 7 }).sphere({ r: 2 })),
	},
	cylinderFixture("cylinder-default-resolution", "cylinder(h=5, r=5);", 5, 5, 5, 16, { h: 5, r: 5 }),
	cylinderFixture("cylinder-odd-fragments", "cylinder(h=4, d=6, $fn=7);", 4, 3, 3, 7, { h: 4, d: 6, $fn: 7 }),
	cylinderFixture("cylinder-adaptive-angle", "$fa=45; $fs=0.1; cylinder(h=5, r=5);", 5, 5, 5, 8, { h: 5, r: 5 }, { $fa: 45, $fs: 0.1 }),
	cylinderFixture("cylinder-adaptive-size", "$fa=1; $fs=4; cylinder(h=5, r=5);", 5, 5, 5, 8, { h: 5, r: 5 }, { $fa: 1, $fs: 4 }),
	cylinderFixture("cylinder-largest-radius-resolution", "cylinder(h=5, r1=1, r2=5);", 5, 1, 5, 16, { h: 5, r1: 1, r2: 5 }),
	cylinderFixture("cone-top-apex", "cylinder(h=5, r1=3, r2=0, $fn=8);", 5, 3, 0, 8, { h: 5, r1: 3, r2: 0, $fn: 8 }),
	cylinderFixture("cone-bottom-apex", "cylinder(h=5, r1=0, r2=3, $fn=8);", 5, 0, 3, 8, { h: 5, r1: 0, r2: 3, $fn: 8 }),
	cylinderFixture("centered-diameter-frustum", "cylinder(h=5, d1=6, d2=2, center=true, $fn=9);", 5, 3, 1, 9, { h: 5, d1: 6, d2: 2, center: true, $fn: 9 }),
	{
		...sphereFixture("sphere-diameter-precedence", "sphere(r=9, d=4, $fn=8);", 2, 8, { r: 9, d: 4, $fn: 8 }),
		warnings: ["Ignoring radius variable"],
	},
	{
		...cylinderFixture("cylinder-radius-precedence", "cylinder(h=3, r=9, d=8, r1=8, d1=4, r2=7, d2=2, $fn=8);", 3, 2, 1, 8, { h: 3, r: 9, d: 8, r1: 8, d1: 4, r2: 7, d2: 2, $fn: 8 }),
		warnings: ["Ignoring radius variable", "Ignoring radius variable", "Ignoring radius variable", "Cylinder parameters ambiguous"],
	},
	{
		...sphereFixture("sphere-negative-fn", "$fn=-2; sphere(r=2);", 2, 7, { r: 2 }, { $fn: -2 }),
		warnings: ["\\$fn negative"],
	},
	{
		...cylinderFixture("cylinder-clamped-angle", "$fa=0; cylinder(h=3, r=2);", 3, 2, 2, 7, { h: 3, r: 2 }, { $fa: 0 }),
		warnings: ["\\$fa too small"],
	},
	{
		...sphereFixture("sphere-clamped-size", "$fs=0; sphere(r=2);", 2, 30, { r: 2 }, { $fs: 0 }),
		warnings: ["\\$fs too small"],
	},
	...[
		["sphere-zero-radius", "sphere(r=0);", "sphere", { r: 0 }],
		["sphere-negative-radius", "sphere(r=-1);", "sphere", { r: -1 }],
		["cylinder-zero-height", "cylinder(h=0);", "cylinder", { h: 0 }],
		["cylinder-negative-radius", "cylinder(r1=-1);", "cylinder", { r1: -1 }],
		["cylinder-zero-radii", "cylinder(r=0);", "cylinder", { r: 0 }],
	].map(([id, source, method, args]) => ({ id, source, volume: 0, bounds: null, build: (module, own) => own(new GeometryAdapter(module)[method](args)) })),
];

export const geometryCases = [
	{
		id: "cube",
		source: "cube([10, 10, 10]);",
		volume: 1000,
		bounds: [[0, 0, 0], [10, 10, 10]],
		build: ({ Manifold }, own) => own(Manifold.cube([10, 10, 10])),
	},
	{
		id: "overlapping-union",
		source: "union() { cube(10); translate([5, 0, 0]) cube(10); }",
		volume: 1500,
		bounds: [[0, 0, 0], [15, 10, 10]],
		build: ({ Manifold }, own) => own(own(Manifold.cube(10)).add(own(own(Manifold.cube(10)).translate([5, 0, 0])))),
	},
	{
		id: "touching-union",
		source: "union() { cube(10); translate([10, 0, 0]) cube(10); }",
		volume: 2000,
		bounds: [[0, 0, 0], [20, 10, 10]],
		build: ({ Manifold }, own) => own(own(Manifold.cube(10)).add(own(own(Manifold.cube(10)).translate([10, 0, 0])))),
	},
	{
		id: "coincident-difference",
		source: "difference() { cube(10); cube(10); }",
		volume: 0,
		bounds: null,
		build: ({ Manifold }, own) => own(own(Manifold.cube(10)).subtract(own(Manifold.cube(10)))),
	},
	{
		id: "disjoint-intersection",
		source: "intersection() { cube(2); translate([4, 0, 0]) cube(2); }",
		volume: 0,
		bounds: null,
		build: ({ Manifold }, own) => own(own(Manifold.cube(2)).intersect(own(own(Manifold.cube(2)).translate([4, 0, 0])))),
	},
	{
		id: "contained-cavity",
		source: "difference() { cube(10); translate([2, 2, 2]) cube(6); }",
		volume: 784,
		bounds: [[0, 0, 0], [10, 10, 10]],
		build: ({ Manifold }, own) => own(own(Manifold.cube(10)).subtract(own(own(Manifold.cube(6)).translate([2, 2, 2])))),
	},
	{
		id: "grouped-nested-csg",
		source: "module pair() { cube(4); translate([6, 0, 0]) cube(4); } difference() { union() { pair(); } translate([3, 1, -1]) cube([4, 2, 6]); }",
		volume: 112,
		bounds: [[0, 0, 0], [10, 4, 4]],
		build: ({ Manifold }, own) => {
			const pair = own(own(Manifold.cube(4)).add(own(own(Manifold.cube(4)).translate([6, 0, 0]))));
			const tool = own(own(Manifold.cube([4, 2, 6])).translate([3, 1, -1]));
			return own(pair.subtract(tool));
		},
	},
	{
		id: "reflected-transform",
		source: "translate([10, 20, 30]) mirror([1, 0, 0]) cube([2, 3, 4]);",
		volume: 24,
		bounds: [[8, 20, 30], [10, 23, 34]],
		build: ({ Manifold }, own) => own(own(own(Manifold.cube([2, 3, 4])).mirror([1, 0, 0])).translate([10, 20, 30])),
	},
	{
		id: "extrusion-with-hole",
		source: "linear_extrude(height=5) difference() { square(10); translate([3, 3]) square(4); }",
		volume: 420,
		bounds: [[0, 0, 0], [10, 10, 5]],
		build: ({ CrossSection }, own) => {
			const profile = own(own(CrossSection.square(10)).subtract(own(own(CrossSection.square(4)).translate([3, 3]))));
			return own(profile.extrude(5));
		},
	},
	{
		id: "concave-extrusion",
		source: "linear_extrude(height=3) polygon([[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]]);",
		volume: 15,
		bounds: [[0, 0, 0], [3, 3, 3]],
		build: ({ CrossSection }, own) => own(own(new CrossSection([[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]])).extrude(3)),
	},
	{
		id: "scad-sphere-fn32",
		source: "$fn=32; sphere(r=5);",
		volume: 515.2487099195863,
		bounds: [[-1, -1, -1].map((sign) => sign * 5 * Math.cos(Math.PI / 32)), [1, 1, 1].map((sign) => sign * 5 * Math.cos(Math.PI / 32))],
		build: (module, own) => own(new GeometryAdapter(module).sphere({ r: 5, $fn: 32 })),
	},
	{
		id: "frustum-orientation",
		source: "$fn=32; cylinder(h=5, r1=3, r2=1);",
		volume: 32 * Math.sin(2 * Math.PI / 32) / 2 * 5 * 13 / 3,
		bounds: [[-3, -3, 0], [3, 3, 5]],
		build: ({ Manifold }, own) => own(Manifold.cylinder(5, 3, 1, 32)),
	},
	...primitiveCases,
	{
		id: "semantic-module-grouped-base",
		source: "module pair() { cube(4); translate([6,0,0]) cube(4); } difference() { pair(); translate([3,1,-1]) cube([4,2,6]); }",
		volume: 112, bounds: [[0, 0, 0], [10, 4, 4]],
		build: (module, own) => geometryCases.find((fixture) => fixture.id === "grouped-nested-csg").build(module, own),
	},
	{
		id: "semantic-transformed-background",
		source: "intersection() { cube(4); translate([1,1,1]) %cube(2); }",
		volume: 0, bounds: null,
		build: ({ Manifold }, own) => own(own(Manifold.cube(1)).subtract(own(Manifold.cube(1)))),
	},
	{
		id: "semantic-direct-background",
		source: "intersection() { cube(4); %translate([1,1,1]) cube(2); }",
		volume: 64, bounds: [[0, 0, 0], [4, 4, 4]],
		build: ({ Manifold }, own) => own(Manifold.cube(4)),
	},
	{
		id: "semantic-debug-subtraction",
		source: "difference() { cube(4); #cube(2); }",
		volume: 56, bounds: [[0, 0, 0], [4, 4, 4]],
		build: ({ Manifold }, own) => own(own(Manifold.cube(4)).subtract(own(Manifold.cube(2)))),
	},
	{
		id: "semantic-root-selection",
		source: "cube(10); !translate([20,0,0]) cube(2);",
		volume: 8, bounds: [[20, 0, 0], [22, 2, 2]],
		build: ({ Manifold }, own) => own(own(Manifold.cube(2)).translate([20, 0, 0])),
	},
	{
		id: "semantic-module-children",
		source: "module shifted(distance=3) { translate([distance,0,0]) children(); } shifted(5) cube(2);",
		volume: 8, bounds: [[5, 0, 0], [7, 2, 2]],
		build: ({ Manifold }, own) => own(own(Manifold.cube(2)).translate([5, 0, 0])),
	},
];

export const languageCases = [
	{ id: "matrix-vector-multiplication", source: "echo([[1,2],[3,4]]*[5,6], [5,6]*[[1,2],[3,4]], [[1,2],[3,4]]*[[5,6],[7,8]]);", echoes: ["ECHO: [17, 39], [23, 34], [[19, 22], [43, 50]]"] },
	{ id: "descending-stepped-range", source: "for(index=[3:-1:1]) echo(index);", echoes: ["ECHO: 3", "ECHO: 2", "ECHO: 1"] },
	{ id: "lexical-and-dynamic-lookup", source: "a=1; $fn=6; function value()=[a,$fn]; module inner() { a=2; $fn=8; echo(value()); } inner(); echo(value());", echoes: ["ECHO: [1, 8]", "ECHO: [1, 6]"] },
	{ id: "recursive-conditional", source: "function factorial(n)=n<=1 ? 1 : n*factorial(n-1); echo(factorial(5));", echoes: ["ECHO: 120"] },
	{ id: "indexing-and-let", source: 'echo(let(a=2,b=a+3) b, [3,4].y, "abc"[1]);', echoes: ['ECHO: 5, 4, "b"'] },
	{ id: "eof-identifier", source: "eof=3; echo(eof);", echoes: ["ECHO: 3"] },
	{ id: "last-assignment", source: "a=1; echo(a); a=2; echo(a);", echoes: ["ECHO: 2", "ECHO: 2"], diagnostics: ['WARNING: "a" was assigned on line 1 but was overwritten in file last-assignment.scad, line 1'] },
	{ id: "function-forward-reference", source: "echo(twice(3)); function twice(x)=x*2;", echoes: ["ECHO: 6"] },
	{ id: "dynamic-special-variable", source: "$fn=8; module report() { echo($fn); } report($fn=16); echo($fn);", echoes: ["ECHO: 16", "ECHO: 8"] },
	{ id: "scad-truthiness", source: "echo(!![], !![0], !!undef, !!\"\");", echoes: ["ECHO: false, true, false, false"] },
	{ id: "vector-arithmetic", source: "echo([1,2,3]*[4,5,6], 2*[1,2], [1,2]+[3,4]);", echoes: ["ECHO: 32, [2, 4], [4, 6]"] },
	{ id: "animation-inheritance", source: "$t=0.5; function time()=$t; module report() { echo(time()); } report();", echoes: ["ECHO: 0.5"] },
];