import { expect, test } from "@playwright/test";
import createModule from "manifold-3d";
import { geometryCases, languageCases } from "./fixtures/backend-cases.js";
import { copyMesh, decodeBinaryStl, measureMesh, runGeometryCase } from "./helpers/backend.js";
import { compileScad } from "../src/core/compiler.js";
import { projectCases } from "./fixtures/project-cases.js";
import { createEngine } from "../src/index.js";

test("concave and holed roofs compile and export through browser workers", async ({ page }) => {
	const sources = ["voronoi", "straight"].flatMap((method) => [
		`roof(method="${method}") polygon([[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]]);`,
		`$fa=1;$fs=0.1;roof(method="${method}") difference(){square([10,6]);translate([2,2])square(2);translate([6,2])square(2);}`,
	]);
	const engine = await createEngine();
	const expected = [];
	try {
		for (const source of sources) {
			const result = await engine.compile({ mode: "render", experimental: ["roof"], files: { "main.scad": source } });
			assertSuccess(result);
			expected.push(result.volume); result.dispose();
		}
	} finally { engine.dispose(); }
	const actual = await page.evaluate(async (sources) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const reports = [];
			for (const source of sources) {
				const result = await engine.compile({ mode: "render", experimental: ["roof"], files: { "main.scad": source } });
				try { reports.push({ status: result.status, volume: result.volume, bytes: result.status === "success" ? (await engine.export(result)).byteLength : 0, diagnostics: result.diagnostics }); }
				finally { result.dispose?.(); }
			}
			return reports;
		} finally { await engine.dispose(); }
	}, sources);
	actual.forEach((result, index) => {
		expect(result.status, JSON.stringify(result.diagnostics)).toBe("success");
		expect(result.volume).toBeCloseTo(expected[index], 6);
		expect(result.bytes).toBeGreaterThan(84);
	});
});

function assertSuccess(result) { expect(result.status, JSON.stringify(result.diagnostics)).toBe("success"); }

let nodeResults;
let compiledResults;
test.beforeAll(async () => {
	const module = await createModule();
	module.setup();
	nodeResults = geometryCases.map((fixture) => runGeometryCase(module, fixture));
	compiledResults = geometryCases.map((fixture) => {
		const result = compileScad(fixture.source, module, { mode: "render" });
		try { return { id: fixture.id, ...measureMesh(copyMesh(result.getMesh())) }; }
		finally { result.dispose(); }
	});
});

test.beforeEach(async ({ page }) => {
	await page.route("**/backend-fixture", (route) => route.fulfill({
		contentType: "text/html",
		headers: { "Content-Security-Policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'" },
		body: "<!doctype html><html lang=\"en\"><title>Backend feasibility</title><body></body></html>",
	}));
	await page.goto("/backend-fixture");
});

async function startWorker(page, name = "backend") {
	return page.evaluate((name) => new Promise((resolve, reject) => {
		const worker = new Worker("/tests/helpers/backend-worker.js", { type: "module" });
		window[name] = worker;
		worker.onerror = (event) => reject(new Error(event.message));
		worker.onmessage = ({ data }) => {
			if (data.type === "ready") resolve(data);
		};
	}), name);
}

async function runWorker(page, cycles = 1, name = "backend") {
	return page.evaluate(({ cycles, name }) => new Promise((resolve, reject) => {
		const worker = window[name];
		worker.onmessage = ({ data }) => {
			if (data.type === "error") reject(new Error(data.message));
			if (data.type === "result") resolve(data);
		};
		worker.postMessage({ type: "run", id: name, cycles });
	}), { cycles, name });
}

test("local WASM worker matches Node without cross-origin isolation", async ({ page }, testInfo) => {
	const remoteRequests = [];
	page.on("request", (request) => {
		if (new URL(request.url()).origin !== "http://127.0.0.1:4173") remoteRequests.push(request.url());
	});
	const ready = await startWorker(page);
	expect(ready.isolated).toBe(false);
	const result = await runWorker(page);
	expect(result.results).toEqual(nodeResults);
	expect(remoteRequests).toEqual([]);
	await testInfo.attach("backend-metrics", {
		body: JSON.stringify({ ...ready, ...result, browser: testInfo.project.name || "chromium" }, null, 2),
		contentType: "application/json",
	});
	await page.evaluate(() => window.backend.terminate());
});

test("worker stress does not block the page", async ({ page }) => {
	await startWorker(page);
	await page.evaluate(() => {
		window.ticks = 0;
		window.timer = setInterval(() => window.ticks++, 5);
	});
	const result = await runWorker(page, 100);
	expect(result.results).toEqual(nodeResults);
	expect(await page.evaluate(() => window.ticks)).toBeGreaterThan(5);
	await page.evaluate(() => { clearInterval(window.timer); window.backend.terminate(); });
});

test("independent workers compute independent results", async ({ page }) => {
	await startWorker(page, "first");
	await startWorker(page, "second");
	const first = await runWorker(page, 1, "first");
	const second = await runWorker(page, 1, "second");
	expect(first.results).toEqual(nodeResults);
	expect(second.results).toEqual(nodeResults);
	await page.evaluate(() => { window.first.terminate(); window.second.terminate(); });
});

test("busy worker can be terminated and replaced", async ({ page }) => {
	await startWorker(page);
	const termination = await page.evaluate(() => new Promise((resolve) => {
		window.backend.onmessage = ({ data }) => {
			if (data.type === "started") {
				const started = performance.now();
				window.backend.terminate();
				resolve(performance.now() - started);
			}
		};
		window.backend.postMessage({ type: "run", id: "cancelled", cycles: 100_000 });
	}));
	expect(termination).toBeLessThan(500);
	await startWorker(page);
	expect((await runWorker(page)).results).toEqual(nodeResults);
	await page.evaluate(() => window.backend.terminate());
});

test("SCAD parser, evaluator and tree compiler work inside the browser worker", async ({ page }) => {
	await startWorker(page);
	const result = await page.evaluate(() => new Promise((resolve, reject) => {
		window.backend.onmessage = ({ data }) => {
			if (data.type === "result") resolve(data);
			if (data.type === "error") reject(new Error(data.message));
		};
		window.backend.postMessage({ type: "compile", id: "scad" });
	}));
	expect(result.results).toEqual(compiledResults);
	expect(result.language).toEqual(languageCases.map((fixture) => ({ id: fixture.id, echoes: fixture.echoes })));
	await page.evaluate(() => window.backend.terminate());
});

test("public service resolves virtual projects and transfers STL from a browser worker", async ({ page }) => {
	await startWorker(page);
	const report = await page.evaluate(() => new Promise((resolve, reject) => {
		window.backend.onmessage = ({ data }) => {
			if (data.type === "result") resolve({ ...data, binary: Array.from(data.binary) });
			if (data.type === "error") reject(new Error(data.message));
		};
		window.backend.postMessage({ type: "service", id: "project-service" });
	}));
	expect(report.results).toHaveLength(projectCases.length);
	report.results.forEach((result, index) => {
		expect(result.id).toBe(projectCases[index].id);
		expect(result.echoes).toEqual(projectCases[index].echoes);
		expect(result.volume).toBeCloseTo(projectCases[index].volume, 5);
		expect(result.dependencies).toContain(projectCases[index].entry);
		expect(result.ascii).toBe(true);
	});
	expect(measureMesh(decodeBinaryStl(new Uint8Array(report.binary))).volume).toBeCloseTo(projectCases.at(-1).volume, 5);
	await page.evaluate(() => window.backend.terminate());
});

test("worker-backed API compiles and exports without caller-managed messaging", async ({ page }) => {
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ mode: "render", files: { "main.scad": "use <shape.scad> shape();", "shape.scad": "module shape() { cube(2); }" } });
			if (result.status !== "success") throw new Error(JSON.stringify(result.diagnostics));
			const bytes = await engine.export(result);
			const ascii = new TextDecoder().decode(await engine.export(result, { encoding: "ascii" }));
			const mesh = result.getMesh();
			const metadata = { volume: result.volume, dependencies: result.dependencies, meshVertices: mesh.vertProperties.length, binary: Array.from(bytes), ascii: ascii.startsWith("solid openscad_js\n"), isolated: crossOriginIsolated };
			result.dispose();
			return metadata;
		} finally { await engine.dispose(); }
	});
	expect(report.volume).toBe(8); expect(report.ascii).toBe(true); expect(report.isolated).toBe(false);
	expect(report.dependencies).toEqual(["main.scad", "shape.scad"]);
	expect(report.meshVertices).toBeGreaterThan(0);
	expect(measureMesh(decodeBinaryStl(new Uint8Array(report.binary))).volume).toBeCloseTo(8, 5);
});

test("vector built-ins preserve native values, warnings and export through browser workers", async ({ page }) => {
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const source = 'echo(cross([2,3],[4,5]),cross([1,2],[3,"4"]),cross([1,true],[3,4]),cross([1,2,3],[4,5,6]),norm([3,4]),norm([]),str(norm([1e200])),[0/0,1/0,-1/0]); echo(cross([1,true,3],[4,5,6]),cross([1,2],[3,4,5]),cross([1,0/0,3],[4,5,6]),cross([1,1/0,3],[4,5,6]),norm([3,"4"]),norm(undef)); cube([norm([3,4]),norm([3,4]),-cross([2,3],[4,5])]);';
			const result = await engine.compile({ mode: "render", files: { "main.scad": source } });
			if (result.status !== "success") throw new Error(JSON.stringify(result.diagnostics));
			try {
				const recovered = await engine.compile({ mode: "render", files: { "main.scad": "cube(1);" } });
				try {
					return { volume: result.volume, echoes: result.echoes, diagnostics: result.diagnostics, bytes: Array.from(await engine.export(result)), recovery: { status: recovered.status, volume: recovered.volume } };
				} finally { recovered.dispose?.(); }
			} finally { result.dispose(); }
		} finally { await engine.dispose(); }
	});
	expect(report.echoes).toEqual(['ECHO: -2, -6, 4, [-3, 6, -3], 5, 0, "inf", [nan, inf, -inf]', "ECHO: undef, undef, undef, undef, undef, undef"]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(["cross-arguments", "cross-arguments", "cross-arguments", "cross-arguments", "norm-arguments", "norm-arguments"]);
	expect(report.diagnostics.map(({ message }) => message)).toEqual(["Invalid value in parameter vector for cross()", "Invalid vector size of parameter for cross()", "Invalid value (NaN) in parameter vector for cross()", "Invalid value (INF) in parameter vector for cross()", "norm() requires one numeric vector", "norm() requires one numeric vector"]);
	expect(report.diagnostics.every((diagnostic) => diagnostic.severity === "warning" && diagnostic.location?.file === "main.scad")).toBe(true);
	expect(report.volume).toBe(50);
	expect(measureMesh(decodeBinaryStl(new Uint8Array(report.bytes))).volume).toBeCloseTo(50, 9);
	expect(report.recovery).toEqual({ status: "success", volume: 1 });
});

test("cross preserves overflow, underflow, and cancellation in browser workers", async ({ page }) => {
	const source = 'echo(cross([1e308,0],[0,1e308]),cross([1e-200,0],[0,1e-200]),cross([1e200,1e200],[1e200,1e200]));echo(cross([1e308,0,0],[0,1e308,0])[2],cross([1e-200,0,0],[0,1e-200,0])[2],cross([1e200,1e200,0],[1e200,1e200,0])[2]);';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose?.(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: inf, 0, nan", "ECHO: inf, 0, nan"]);
	expect(report.diagnostics).toEqual([]);
});

test("norm preserves square overflow and underflow in browser workers", async ({ page }) => {
	const source = 'echo(norm([1e154]),norm([1.4e154]),norm([1.5e154]),norm([1e-154]),norm([1e-160]),norm([1e-162]),norm([1e-200]));echo(norm([1e154,1e154]),norm([1e-160,1e-160]),norm([-0]));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose?.(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: 1e+154, inf, inf, 1e-154, 9.99994433575849e-161, 0, 0", "ECHO: inf, 1.4142056902605667e-160, 0"]);
	expect(report.diagnostics).toEqual([]);
});

test("rands recovers non-finite bounds and counts in browser workers", async ({ page }) => {
	const source = 'echo(rands(1/0,1,1,1),rands(0,1,0/0,1),rands(0,1,1,1/0));echo(rands(),rands("0",1,1),rands([1:3],1,1));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose?.(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: [-2.530425458886246e+305], [0.9971848082302656], [0.07767170663409012]", "ECHO: undef, undef, undef"]);
	expect(report.diagnostics.map(({ message }) => message)).toEqual([
		"rands() range min cannot be infinite",
		"resetting to -89884656743115785407263711865852178399035283762922498299458738401578630390014269380294779316383439085770229476757191232117160663444732091384233773351768758493024955288275641038122745045194664472037934254227566971152291618451611474082904279666061674137398913102072361584369088590459649940625202013092062429184.000000",
		"rands() cannot create an infinite number of results",
		"resetting number of results to 1",
		"rands() number of parameters does not match: expected 3 or 4, found 0",
		'rands() parameter could not be converted: argument 0: expected number, found string ("0")',
		"rands() parameter could not be converted: argument 0: expected number, found range ([1 : 1 : 3])",
	]);
});

test("rands stream continues across browser-worker compiles and seeded calls reset it", async ({ page }) => {
	const sources = ["echo(rands(0,1,4,42));", "echo(rands(0,1,4));", "echo(rands(0,1,4));", "echo(rands(0,1,4,42));", "echo(rands(0,1,4));"];
	const report = await page.evaluate(async (sources) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const results = [];
			for (const source of sources) {
				const result = await engine.compile({ files: { "main.scad": source } });
				try { results.push({ status: result.status, echo: result.echoes[0], diagnostics: result.diagnostics }); }
			finally { result.dispose?.(); }
			}
			return results;
		} finally { await engine.dispose(); }
	}, sources);
	expect(report.map(({ status }) => status)).toEqual(Array(5).fill("success"));
	expect(report.map(({ echo }) => echo)).toEqual([
		"ECHO: [0.796542984287846, 0.18343478789336848, 0.7796909976126613, 0.5968501615800565]",
		"ECHO: [0.44583275754843343, 0.09997492054384075, 0.45924888785418205, 0.3337086115186513]",
		"ECHO: [0.1428668144161615, 0.6508884734260088, 0.056411576462114345, 0.7219987716455734]",
		"ECHO: [0.796542984287846, 0.18343478789336848, 0.7796909976126613, 0.5968501615800565]",
		"ECHO: [0.44583275754843343, 0.09997492054384075, 0.45924888785418205, 0.3337086115186513]",
	]);
	expect(report.flatMap(({ diagnostics }) => diagnostics)).toEqual([]);
});

test("randomSeed makes unseeded rands reproducible across browser-worker compiles", async ({ page }) => {
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const compile = async (randomSeed) => {
				const result = await engine.compile({ randomSeed, files: { "main.scad": "echo(rands(0,1,5),rands(0,1,3));" } });
				try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
				finally { result.dispose?.(); }
			};
			return [await compile(42), await compile(42), await compile(43)];
		} finally { await engine.dispose(); }
	});
	expect(report.map(({ status }) => status)).toEqual(["success", "success", "success"]);
	expect(report[0].echoes).toEqual(report[1].echoes);
	expect(report[0].echoes).not.toEqual(report[2].echoes);
	expect(report[0].echoes).toEqual(["ECHO: [0.796542984287846, 0.18343478789336848, 0.7796909976126613, 0.5968501615800565, 0.44583275754843343], [0.09997492054384075, 0.45924888785418205, 0.3337086115186513]"]);
	expect(report.flatMap(({ diagnostics }) => diagnostics)).toEqual([]);
});

test("worker-backed latest requests cancel old reads and replace busy workers", async ({ page }) => {
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const moduleUrl = new URL("/node_modules/manifold-3d/manifold.js", location.href);
		const controller = new AbortController();
		let cancelBusy = false;
		let ticks = 0;
		const timer = setInterval(() => ticks++, 5);
		const engine = await createWorkerEngine({ manifoldModuleUrl: moduleUrl, onProgress: (event) => {
			if (cancelBusy && event.phase === "started") setTimeout(() => controller.abort(), 75);
		} });
		try {
			let started;
			const ready = new Promise((resolve) => { started = resolve; });
			let finish;
			const old = engine.compileLatest({ resolver: () => { started(); return new Promise((resolve) => { finish = resolve; }); } });
			await ready;
			const latest = engine.compileLatest({ files: { "main.scad": "cube(3);" } });
			const previous = await old;
			finish("cube(100);");
			const current = await latest;
			cancelBusy = true;
			const busy = await engine.compile({ signal: controller.signal, files: { "main.scad": "sphere(r=10,$fn=800);" } });
			cancelBusy = false;
			const replacement = await engine.compile({ files: { "main.scad": "cube(2);" } });
			return { oldStatus: previous.status, oldCode: previous.diagnostics[0].code, latestVolume: current.volume, busyStatus: busy.status, replacementVolume: replacement.volume, ticks };
		} finally { clearInterval(timer); await engine.dispose(); }
	});
	expect(report.oldStatus).toBe("cancelled"); expect(report.oldCode).toBe("superseded");
	expect(report.latestVolume).toBe(27); expect(report.busyStatus).toBe("cancelled");
	expect(report.replacementVolume).toBe(8); expect(report.ticks).toBeGreaterThan(5);
});

test("new language, virtual STL assets, text and square experimental roof work in browser workers",async({page})=>{
	const result=await page.evaluate(async()=>{
		const {createWorkerEngine}=await import("/src/index.js");
		const engine=await createWorkerEngine({manifoldModuleUrl:new URL("/node_modules/manifold-3d/manifold.js",location.href)});
		try{
			const source='module 180_shape(){polyhedron(points=[[0,0,0],[2,0,0],[0,2,0],[0,0,2]],faces=[[0,1,2],[0,3,1],[0,2,3],[1,3,2]]);} echo([for(index=[0:3])index*index]); 180_shape();';
			const first=await engine.compile({mode:"render",files:{"main.scad":source}});
			const asset=await engine.export(first); first.dispose();
			const imported=await engine.compile({mode:"render",assets:{"tetra.stl":asset},files:{"main.scad":'import("tetra.stl");'}});
			const text=await engine.compile({mode:"render",files:{"main.scad":'linear_extrude(1) text("5",size=4);'}});
			const roof=await engine.compile({mode:"render",experimental:["roof"],files:{"main.scad":"roof() square(4);"}});
			const disabled=await engine.compile({files:{"main.scad":"roof() square(4);"}});
			return {echoes:first.echoes,deprecation:first.diagnostics[0].code,imported:imported.volume,text:text.volume,textStatus:text.status,roof:roof.volume,roofStatus:roof.status,disabled:disabled.diagnostics.at(-1).code};
		}finally{await engine.dispose();}
	});
	expect(result.echoes).toEqual(["ECHO: [0, 1, 4, 9]"]);expect(result.deprecation).toBe("deprecated-identifier");
	expect(result.imported).toBeCloseTo(4/3,6);expect(result.textStatus).toBe("success");expect(result.text).toBeGreaterThan(4);
	expect(result.roofStatus).toBe("success");expect(result.roof).toBeCloseTo(32/3,6);expect(result.disabled).toBe("experimental-disabled");
});

test("DXF dimension and line-cross built-ins resolve assets in browser workers", async ({ page }) => {
	const dxf = `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nCROSS\n10\n0\n20\n0\n11\n10\n21\n10\n0\nLINE\n8\nCROSS\n10\n0\n20\n10\n11\n10\n21\n0\n0\nDIMENSION\n8\nDIMS\n1\nwidth\n70\n1\n13\n1\n23\n2\n14\n5\n24\n6\n0\nENDSEC\n0\nEOF\n`;
	const report = await page.evaluate(async (asset) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": 'echo(dxf_dim(file="model.dxf",layer="DIMS",name="width"));echo(dxf_cross(file="model.dxf",layer="CROSS"));' }, assets: { "model.dxf": asset } });
			try { return { status: result.status, echoes: result.echoes, dependencies: result.dependencies, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, dxf);
	expect(report.status, JSON.stringify(report.diagnostics)).toBe("success");
	expect(Number(report.echoes[0].slice("ECHO: ".length))).toBeCloseTo(Math.sqrt(32), 4);
	expect(JSON.parse(report.echoes[1].slice("ECHO: ".length))).toEqual([5, 5]);
	expect(report.dependencies).toContain("model.dxf");
});

test("anonymous closures and vector built-ins work in browser workers", async ({ page }) => {
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": "base=3; fn=function(x) x+base; base=9; echo(fn(2),cross([1,2,3],[4,5,6]),lookup(2,[[0,0],[4,8]]),chr(0x1F0A1),ord(\"🂡a\"),search(\"ab\",\"aabb\"),rands(0,1,3,1));" } });
			return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics };
		} finally { await engine.dispose(); }
	});
	expect(report.status, JSON.stringify(report.diagnostics)).toBe("success");
	expect(report.echoes[0]).toContain('"🂡", 127137, [0, 2], [0.9971848082302656, 0.9325573613681655, 0.128124447772306]');
});

test("offset, fill and resize compile in browser workers", async ({ page }) => {
	const reports = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const values = [];
			for (const source of [
				"linear_extrude(2) offset(r=1,$fn=24) square(4);",
				"linear_extrude(1) fill(){difference(){square(10);translate([2,2])square(6);}translate([4,4])square(2);}",
				"linear_extrude(2) resize([10,0],auto=true) square([2,4]);",
			]) {
				const result = await engine.compile({ mode: "render", files: { "main.scad": source } });
				values.push({ status: result.status, volume: result.volume, diagnostics: result.diagnostics }); result.dispose?.();
			}
			return values;
		} finally { await engine.dispose(); }
	});
	expect(reports.map((result) => result.status), JSON.stringify(reports.map((result) => result.diagnostics))).toEqual(["success", "success", "success"]);
	reports.forEach((result) => expect(result.volume).toBeGreaterThan(0));
	expect(reports[1].volume).toBeCloseTo(100, 8);
});

test("search preserves native string-table and malformed-row results in browser workers", async ({ page }) => {
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const source = 'echo(search("ab","aabb",1,3),search("z",[["a",1],2]),search("a",[["a",1],2],1),search(["a",2],"a2b"));';
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	});
	expect(report.status, JSON.stringify(report.diagnostics)).toBe("success");
	expect(report.echoes).toEqual(['ECHO: [0, 2], [], [0], [[], []]']);
	expect(report.diagnostics).toHaveLength(1);
	expect(report.diagnostics[0]).toMatchObject({ severity: "warning", code: "search-invalid-entry" });
});

test("parent_module defaults and children re-entry preserve stack frames in browser workers", async ({ page }) => {
	const source = 'module leaf(label="default",captured=parent_module()){echo("leaf",label,captured,parent_module(0),parent_module(1),parent_module(2));} module inner(explicit=undef,captured=parent_module()){echo("inner-before",explicit,captured,parent_module(0),parent_module(1));children();children();echo("inner-after",parent_module(0),parent_module(1));} module outer(){echo("outer",parent_module(0));children();} outer() inner(parent_module()) leaf("passed");';
	const echoes = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try {
				if (result.status !== "success") throw new Error(JSON.stringify(result.diagnostics));
				return result.echoes;
			} finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(echoes).toEqual([
		'ECHO: "outer", "outer"',
		'ECHO: "inner-before", "outer", "outer", "inner", "outer"',
		'ECHO: "leaf", "passed", "inner", "leaf", "inner", "outer"',
		'ECHO: "leaf", "passed", "inner", "leaf", "inner", "outer"',
		'ECHO: "inner-after", "inner", "outer"',
	]);
});

test("parent_module invalid arguments return native-style warnings in browser workers", async ({ page }) => {
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const source = 'module probe(){echo(parent_module(-1),parent_module(1),parent_module("1"),parent_module(true),parent_module(0,1));} probe();';
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	});
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: undef, undef, undef, undef, undef"]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual([
		"parent-module-range", "parent-module-range", "parent-module-arguments", "parent-module-arguments", "parent-module-arguments",
	]);
	expect(report.diagnostics[0].message).toContain("Negative parent module index (-1) not allowed");
	expect(report.diagnostics[2].message).toContain("expected number, found string (\"1\")");
	expect(report.diagnostics[4].message).toContain("expected 1, found 2");
});

test("parent_module preserves recursive frames and numeric boundaries in browser workers", async ({ page }) => {
	const source = 'function named(depth=0)=parent_module(depth); module recursive(n){if(n>0) recursive(n-1); else echo("recursive",parent_module(0),parent_module(1),parent_module(2),named(),named(1),(function() parent_module())());} module outer(){recursive(2);} outer(); module edges(){echo("indices",parent_module(0.9),parent_module(-0.9),parent_module(2147483648));} edges();';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual([
		'ECHO: "recursive", "recursive", "recursive", "recursive", "recursive", "recursive", "recursive"',
		'ECHO: "indices", "edges", "edges", undef',
	]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(["parent-module-range"]);
});

test("parent_module preserves include and use module frames in browser workers", async ({ page }) => {
	const files = {
		"main.scad": 'include <included.scad> use <library.scad> module caller(){echo("caller",parent_module(0),parent_module(1)); include_alias(); lib_entry();} caller();',
		"included.scad": 'module include_leaf(){echo("include-leaf",parent_module(0),parent_module(1),parent_module(2));} module include_alias(){include_leaf();}',
		"library.scad": 'module lib_entry(){echo("lib-entry",parent_module(0),parent_module(1),parent_module(2)); lib_alias();} module lib_alias(){echo("lib-alias",parent_module(0),parent_module(1),parent_module(2));}',
	};
	const report = await page.evaluate(async (files) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, files);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual([
		'ECHO: "caller", "caller", undef',
		'ECHO: "include-leaf", "include_leaf", "include_alias", "caller"',
		'ECHO: "lib-entry", "lib_entry", "caller", undef',
		'ECHO: "lib-alias", "lib_alias", "lib_entry", "caller"',
	]);
	expect(report.diagnostics.map(({ code, location }) => [code, location.file])).toEqual([
		["parent-module-range", "main.scad"], ["parent-module-range", "library.scad"],
	]);
});

test("min and max preserve native overloads and warnings in browser workers", async ({ page }) => {
	const source = 'echo(min(3,1,2),max(3,1,2),min([3,1,2]),max([3,1,2]));echo(min([0/0,1]),max([0/0,1]),min([1,0/0]),max([1,0/0]));echo(min(),max(),min([]),max([]),min([2,"x"]),max([2,true]),min([2],3));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual([
		"ECHO: 1, 3, 1, 3",
		"ECHO: nan, nan, 1, 1",
		"ECHO: undef, undef, undef, undef, undef, undef, undef",
	]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(Array(7).fill("min-max-arguments"));
});

test("scalar unary numeric built-ins preserve native validation in browser workers", async ({ page }) => {
	const source = 'echo(abs(-0),sign(-0),sign(0),round(0.5),round(-0.5),round(1.5),round(-1.5));echo(abs(-1/0),abs(0/0),sign(-1/0),sign(0/0),round(1/0),round(0/0),floor(-1/0),ceil(1/0));echo(abs(),sign("1"),round(true),floor([1]),ceil(undef));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual([
		"ECHO: 0, 0, 0, 1, -1, 2, -2",
		"ECHO: inf, nan, -1, 0, inf, nan, -inf, inf",
		"ECHO: undef, undef, undef, undef, undef",
	]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(Array(5).fill("numeric-arguments"));
});

test("sqrt, exp, ln, and both log overloads work in browser workers", async ({ page }) => {
	const source = 'echo(sqrt(9),exp(1),ln(2),log(100),log(2,100));echo(sqrt(-1),sqrt(0),exp(1000),ln(0),ln(-1),log(0),log(-1),log(10,0),log(1,10));echo(sqrt(5e-324),sqrt(1e-320),sqrt(1e308),exp(-1000),exp(709),exp(710),ln(5e-324),ln(1e308),log(10,1e-300),log(10,1e300),log(1,1));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	const match = /^ECHO: 3, 2\.718281828459045, 0\.6931471805599453, 2, ([0-9.]+)$/.exec(report.echoes[0]);
	expect(match).not.toBeNull();
	expect(Number(match[1])).toBeCloseTo(Math.log(100) / Math.log(2), 14);
	expect(report.echoes[1]).toBe("ECHO: nan, 0, inf, -inf, nan, -inf, nan, -inf, inf");
	expect(report.echoes[2]).toBe("ECHO: 2.2227587494850775e-162, 9.99994433575849e-161, 1e+154, 0, 8.218407461554972e+307, inf, -744.4400719213812, 709.1962086421661, -299.99999999999994, 299.99999999999994, nan");
	expect(report.diagnostics).toEqual([]);
});

test("pow and degree trigonometry match native edge values in browser workers", async ({ page }) => {
	const source = 'echo(pow(2,3),pow(-2,0.5),pow(y=3,x=2),pow(x=2,y=3),pow(-1,1/0),pow(1,1/0),pow(1,0/0),pow(-1,0/0),sin(30),sin(180),cos(90),tan(90),asin(1),atan2(1,0));echo(sin(1/0),cos(0/0),tan(1e100),asin(2));echo(pow("2",3),sin("30"),atan2(1));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual([
		"ECHO: 8, nan, 9, 8, 1, 1, 1, nan, 0.5, 0, 0, inf, 90, 90",
		"ECHO: nan, nan, nan, nan",
		"ECHO: undef, undef, undef",
	]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(Array(3).fill("numeric-arguments"));
});

test("len handles strings, vectors, and experimental objects in browser workers", async ({ page }) => {
	const source = 'echo(len("🂡a"),len([1,2]),len(object(a=1,b=2)),len(object()));echo(len(3),len([1:3]));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ experimental: ["object-function"], files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: 2, 2, 2, 0", "ECHO: undef, undef"]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(["len-arguments", "len-arguments"]);
});

test("lookup preserves native interpolation and row validation in browser workers", async ({ page }) => {
	const source = 'echo(lookup(1,[[0,10],[2,20]]),lookup(1,[["bad",2],[0,0],[2,20]]),lookup(1,[[0,0],["bad",9],[2,20]]));echo(lookup("1",[[0,0],[2,2]]),lookup(0/0,[[0,0],[2,2]]),lookup());';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: 15, undef, 10", "ECHO: undef, undef, undef"]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(["lookup-arguments", "lookup-value", "lookup-arguments"]);
});

test("chr and ord preserve native Unicode conversions in browser workers", async ({ page }) => {
	const source = 'echo(chr(4294967361),chr(65.9),chr([65,[66,0],"C"]),ord("🂡a"),ord(chr(4294967297)));echo(ord(),ord(65),ord("a","b"));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(['ECHO: "A", "A", "AB", 127137, 1', "ECHO: undef, undef, undef"]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(["ord-arguments", "ord-arguments", "ord-arguments"]);
});

test("concat preserves one-level expansion and mixed values in browser workers", async ({ page }) => {
	const source = 'echo(concat(),concat([1,2],[3,4]),concat([[1,2],[3]],[4]),concat(1,"a",[2],true,undef),concat(b=[2],a=[1]));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose?.(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(['ECHO: [], [1, 2, 3, 4], [[1, 2], [3], 4], [1, "a", 2, true, undef], [2, 1]']);
	expect(report.diagnostics).toEqual([]);
});

test("str uses native numeric and nested-value formatting in browser workers", async ({ page }) => {
	const source = 'echo(str(1e-6,1e-5,1e6)=="1e-60.000011e+6",str([1,"x"])=="[1, \\"x\\"]");obj=object(z=1,a="q");f=function(x=2)x+1;echo(str(obj)=="{ z = 1; a = \\"q\\"; }",str(f)=="function(x = 2) (x + 1)");';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ experimental: ["object-function"], files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose?.(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: true, true", "ECHO: true, true"]);
	expect(report.diagnostics).toEqual([]);
});

test("type predicates preserve native NaN, undefined, and arity behavior in browser workers", async ({ page }) => {
	const source = 'echo(is_num(0/0),is_num(1/0),is_undef(missing_name));echo(is_function(function(x)x),is_object(object(a=1)));echo(is_num(),is_undef(1,2));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ experimental: ["object-function"], files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose?.(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: false, true, true", "ECHO: true, true", "ECHO: undef, undef"]);
	expect(report.diagnostics.map(({ code }) => code)).toEqual(["is-num-arguments", "is-undef-arguments"]);
});

test("version_num handles omitted and malformed date vectors without worker errors", async ({ page }) => {
	const source = 'echo(version()==[2026,10,2],version_num()==20261002);echo(version_num([2024,3])==20240300,version_num([2024,3,4])==20240304);echo(is_undef(version_num(1)),is_undef(version_num([1,2,3,4])));';
	const report = await page.evaluate(async (source) => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const result = await engine.compile({ files: { "main.scad": source } });
			try { return { status: result.status, echoes: result.echoes, diagnostics: result.diagnostics }; }
			finally { result.dispose?.(); }
		} finally { await engine.dispose(); }
	}, source);
	expect(report.status).toBe("success");
	expect(report.echoes).toEqual(["ECHO: true, true", "ECHO: true, true", "ECHO: true, true"]);
	expect(report.diagnostics).toEqual([]);
});

test("experimental object methods, vector swizzles, and JSON imports work in browser workers", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const compiled = await engine.compile({ experimental: ["object-function", "vector-swizzle", "import-function"], defines: { config: { width: 2, enabled: true } }, files: { "main.scad": 'data=object(config,[["enabled"]],depth=3); record=object(value=42,factorial=function(n,this) n<=1?this.value:n*this.factorial(n-1)); saved=record.factorial; vector=[1,2,3,4]; imported=import("data.json"); echo(is_object(data),has_key(data,"width"),has_key(data,"enabled"),object(k=1)!=object(k=2),object(n=object(k=1))==object(n=object(k=1))); echo(record.factorial(3),saved(1),vector.zyx,vector.xz,vector.w); echo(imported.nested.answer); cube(data.width);', "data.json": '{"nested":{"answer":42}}' } });
			return { status: compiled.status, echoes: compiled.echoes, volume: compiled.volume, diagnostics: compiled.diagnostics };
		} finally { await engine.dispose(); }
	});
	expect(result.status, JSON.stringify(result.diagnostics)).toBe("success");
	expect(result.echoes).toEqual(["ECHO: true, true, false, true, true", "ECHO: 252, 42, [3, 2, 1], [1, 3], 4", "ECHO: 42"]); expect(result.volume).toBe(8);
});

test("browser workers reject reproducible malformed inputs and preserve valid handles", async ({ page }) => {
	const errors = []; page.on("pageerror", (error) => errors.push(error.message));
	const report = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const { malformedBoundaryCases, validBindingBoundaries, boundarySeed } = await import("/tests/fixtures/boundary-cases.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const preserved = await engine.compile({ mode: "render", files: { "main.scad": "cube(3);" } });
			const rejected = [], accepted = [];
			for (const fixture of malformedBoundaryCases()) {
				const result = await engine.compile(fixture.request);
				const diagnostic = result.diagnostics.at(-1);
				const recovery = await engine.compile({ files: { "main.scad": "cube(2);" } });
				rejected.push({ name: fixture.name, status: result.status, code: diagnostic?.code, expected: fixture.code, located: fixture.located, file: diagnostic?.location?.file, recovery: recovery.status, volume: recovery.volume }); recovery.dispose?.();
			}
			for (const fixture of validBindingBoundaries()) {
				const result = await engine.compile({ defines: fixture.defines, files: { "main.scad": fixture.source } });
				accepted.push({ name: fixture.name, status: result.status, echoes: result.echoes, expected: fixture.echo, diagnostics: result.diagnostics }); result.dispose?.();
			}
			const bytes = await engine.export(preserved); preserved.dispose();
			return { seed: boundarySeed, rejected, accepted, exportedBytes: bytes.byteLength };
		} finally { await engine.dispose(); }
	});
	expect(report.seed).toBe(0x5cad);
	report.rejected.forEach((item) => {
		expect(item.status, item.name).toBe("error"); expect(item.code, item.name).toBe(item.expected);
		if (item.located) expect(item.file, item.name).toBe("main.scad");
		expect(item.recovery, item.name).toBe("success"); expect(item.volume, item.name).toBe(8);
	});
	report.accepted.forEach((item) => { expect(item.status, `${item.name}: ${JSON.stringify(item.diagnostics)}`).toBe("success"); expect(item.echoes, item.name).toEqual([item.expected]); });
	expect(report.exportedBytes).toBeGreaterThan(84); expect(errors).toEqual([]);
});

test("textmetrics and fontmetrics use locally prepared browser fonts", async ({ page }) => {
	const result = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js");
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try {
			const compiled = await engine.compile({ files: { "main.scad": 'tm=textmetrics("hello",font="Liberation Sans");fm=fontmetrics(font="Liberation Sans");echo(tm.position,tm.size,fm.nominal.ascent,is_object(tm),is_object(fm));' } });
			const overrides = await engine.compile({ defineExpressions: ['tm=textmetrics("hello",font="Liberation Sans")', 'fm=fontmetrics(font="Liberation Sans")'], files: { "main.scad": 'tm=undef;fm=undef;echo(is_object(tm),fm.font.family);linear_extrude()square(2);' } });
			return { status: compiled.status, echoes: compiled.echoes, diagnostics: compiled.diagnostics, overrideStatus: overrides.status, overrideEchoes: overrides.echoes, overrideDiagnostics: overrides.diagnostics, volume: overrides.volume };
		} finally { await engine.dispose(); }
	});
	expect(result.status, JSON.stringify(result.diagnostics)).toBe("success");
	expect(result.echoes[0]).toContain("true, true");
	expect(result.overrideStatus, JSON.stringify(result.overrideDiagnostics)).toBe("success");
	expect(result.overrideEchoes).toEqual(['ECHO: true, "Liberation Sans"']);
	expect(result.volume).toBe(400);
});