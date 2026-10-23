import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";

async function distributionOnly(page) {
	const rejected = [], failed = [], errors = [];
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (url.origin === "http://127.0.0.1:4173" && url.pathname.startsWith("/dist/")) return route.continue();
		rejected.push(url.href);
		return route.abort();
	});
	page.on("response", (response) => { if (response.status() >= 400) failed.push(response.url()); });
	page.on("pageerror", (error) => errors.push(error.message));
	return { rejected, failed, errors };
}

for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 812 }]]) {
	test(`standalone ${name} studio draws and exports using only distribution assets`, async ({ page }, testInfo) => {
		await page.setViewportSize(viewport);
		const requests = await distributionOnly(page);
		await page.goto(name === "desktop" ? "/dist/editor.html" : "/dist/");
		await expect.poll(async () => ({
			status: await page.locator("#status").textContent(),
			...requests,
		}), { timeout: 20_000 }).toEqual({ status: "READY", rejected: [], failed: [], errors: [] });
		await expect(page.locator(".brand-mark")).toHaveJSProperty("naturalWidth", 128);
		expect(await page.locator('link[rel="icon"][sizes="32x32"]').getAttribute("href")).toBe("./openscad.js/runtime/assets/branding/icon-32.png");
		await page.locator("#editor").fill('linear_extrude(2) text("OpenSCAD",size=4,font="Liberation Serif:style=Italic");');
		await page.locator("#render-button").click();
		await expect(page.locator("#status")).toHaveText("READY", { timeout: 20_000 });
		await page.locator("#fit-button").click();
		const report = await page.evaluate(async () => {
			await document.fonts.ready;
			const { viewer } = await import("/dist/openscad.js/runtime/studio.js");
			const canvas = viewer.renderer.domElement, gl = viewer.renderer.getContext();
			const pixels = () => {
				viewer.renderer.render(viewer.scene, viewer.camera);
				const values = new Uint8Array(canvas.width * canvas.height * 4);
				gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, values);
				return values;
			};
			viewer.model.visible = false;
			const hidden = pixels();
			viewer.model.visible = true;
			const visible = pixels();
			let changed = 0;
			for (let index = 0; index < visible.length; index += 4) if (visible[index] !== hidden[index] || visible[index + 1] !== hidden[index + 1] || visible[index + 2] !== hidden[index + 2]) changed++;
			const fonts = Array.from(document.fonts);
			return { changed, volume: viewer.stats().volume, mono: fonts.some((font) => font.family.includes("DM Mono") && font.status === "loaded"), ui: fonts.some((font) => font.family.includes("Manrope") && font.status === "loaded") };
		});
		expect(report.changed).toBeGreaterThan(100);
		expect(report.volume).toBeGreaterThan(0);
		expect(report.mono).toBe(true);
		expect(report.ui).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`distribution-${name}.png`), fullPage: true });
		const downloaded = page.waitForEvent("download");
		await page.locator("#download-button").click();
		const artifact = await downloaded;
		const metrics = measureMesh(decodeBinaryStl(await readFile(await artifact.path())));
		expect(metrics.volume).toBeCloseTo(report.volume, 4);
		expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
	});
}

test("standalone direct and worker APIs resolve text, roof and WASM from a nested base URL", async ({ page }) => {
	const requests = await distributionOnly(page);
	const loaded = [];
	page.on("request", (request) => loaded.push(request.url()));
	await page.route("**/dist/host/pages/consumer.html", (route) => route.fulfill({
		contentType: "text/html", body: '<!doctype html><html lang="en"><title>Core consumer without a viewer</title><body>Core consumer</body></html>',
	}));
	await page.goto("/dist/host/pages/consumer.html");
	await page.evaluate(() => import("../../openscad.js/core.js"));
	expect(loaded.filter((url) => /\.wasm(?:$|\?)|worker-entry\.js|\/vendor\/manifold\.js/.test(url))).toEqual([]);
	const reports = await page.evaluate(async () => {
		const { createEngine, createWorkerEngine } = await import("../../openscad.js/core.js");
		const legacy = await import("../../src/index.js");
		if (legacy.createEngine !== createEngine) throw new Error("Legacy API is not the same engine");
		const engines = [
			await createEngine(),
			await createWorkerEngine(),
			await createWorkerEngine({ manifoldModuleUrl: new URL("../../vendor/manifold.js", location.href) }),
		];
		try {
			const reports = [];
			for (const engine of engines) {
				const results = [];
				const project = await engine.compile({
					mode: "render", entry: "models/main.scad",
					files: { "models/main.scad": "use <shape.scad> shape();", "models/shape.scad": "module shape() { cube([1,2,3]); }" },
				});
				try {
					if (project.status !== "success") throw new Error(JSON.stringify(project.diagnostics));
					const bytes = await engine.export(project);
					const imported = await engine.compile({
						mode: "render", files: { "main.scad": 'import("part.stl"); translate([3,0,0]) cube([1,2,3]);' },
						assets: { "part.stl": bytes },
					});
					try { results.push({ status: imported.status, volume: imported.volume, diagnostics: imported.diagnostics }); }
					finally { imported.dispose?.(); }
				} finally { project.dispose?.(); }
				const font = await engine.compile({ mode: "render", files: { "main.scad": 'linear_extrude(1) text("OpenSCAD",size=4,font="Liberation Serif:style=Italic");' } });
				try { results.push({ status: font.status, volume: font.volume, diagnostics: font.diagnostics }); }
				finally { font.dispose?.(); }
				for (const method of ["voronoi", "straight"]) {
					const result = await engine.compile({ mode: "render", experimental: ["roof"], files: { "main.scad": `roof(method="${method}") text("5",size=4);` } });
					try { results.push({ status: result.status, volume: result.volume, bytes: result.status === "success" ? (await engine.export(result)).byteLength : 0, diagnostics: result.diagnostics }); }
					finally { result.dispose?.(); }
				}
				reports.push(results);
			}
			return reports;
		} finally { for (const engine of engines) await engine.dispose(); }
	});
	for (const results of reports) for (const result of results) {
		expect(result.status, JSON.stringify(result.diagnostics)).toBe("success");
		expect(result.volume).toBeGreaterThan(0);
		if (result.bytes !== undefined) expect(result.bytes).toBeGreaterThan(84);
	}
	expect(reports[0]).toEqual(reports[1]);
	expect(reports[0]).toEqual(reports[2]);
	expect(reports[0][0].volume).toBeCloseTo(12, 8);
	expect(loaded.filter((url) => /three|lucide|studio|editor-bundle/.test(url))).toEqual([]);
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("standalone demo shows two previews, exports current core source and reports located errors", async ({ page }, testInfo) => {
	const requests = await distributionOnly(page);
	await page.goto("/dist/demo.html");
	await expect(page.locator("#readonly-model .window")).toHaveAttribute("data-state", "ready");
	await expect(page.locator("#editable-model .window")).toHaveAttribute("data-state", "ready");
	await page.screenshot({ path: testInfo.outputPath("preview-demo.png"), fullPage: true });
	await page.locator("#source").fill("cube([2,3,4]);");
	const download = page.waitForEvent("download");
	await page.locator("#export").click();
	const artifact = await download;
	expect(measureMesh(decodeBinaryStl(await readFile(await artifact.path()))).volume).toBeCloseTo(24, 8);
	await expect(page.locator("#status")).toContainText("Success: 24.000");
	await expect(page.locator("#export")).toBeEnabled();
	let unexpectedDownloads = 0;
	page.on("download", () => unexpectedDownloads++);
	await page.locator("#source").fill("cube([);");
	await page.locator("#export").click();
	await expect(page.locator("#status")).toContainText("main.scad:1:");
	await expect(page.locator("#export")).toBeEnabled();
	expect(unexpectedDownloads).toBe(0);
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

async function previewPage(page) {
	const requests = await distributionOnly(page);
	await page.route("**/dist/host/pages/previews.html", route => route.fulfill({
		contentType: "text/html",
		body: `<!doctype html><html lang="en"><title>Embedded previews</title>
<style>body{margin:8px} .models{display:flex;gap:12px} .model{width:48%;height:380px}
@media(max-width:500px){.models{display:block}.model{width:100%;height:360px}}
</style><body><button id="host-button">Host button</button><div class="models"><div id="a" class="model"></div><div id="b" class="model"></div></div></body></html>`,
	}));
	await page.goto("/dist/host/pages/previews.html");
	await page.evaluate(async () => {
		const { Viewer } = await import("../../openscad.js/viewer.js");
		window.viewers = [];
		const pause = Viewer.prototype.setPaused;
		Viewer.prototype.setPaused = function (value) {
			const container = this.element.getRootNode().host.parentElement;
			window.viewers[container.id === "a" ? 0 : 1] = this;
			return pause.call(this, value);
		};
		window.createPreview = (await import("../../openscad.js/preview.js")).createPreview;
		window.previews = [];
		window.createdUrls = [];
		window.revokedUrls = [];
		const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
		URL.createObjectURL = blob => { const url = create.call(URL, blob); window.createdUrls.push(url); return url; };
		URL.revokeObjectURL = url => { window.revokedUrls.push(url); revoke.call(URL, url); };
	});
	return requests;
}

async function mountPair(page) {
	await page.evaluate(async () => {
		window.previews.push(await window.createPreview(document.querySelector("#a"), { source: "cube([2,3,4]);" }));
		window.previews.push(await window.createPreview(document.querySelector("#b"), {
			editable: true,
			project: {
				entry: "models/main.scad",
				files: {
					"models/main.scad": "use <shape.scad> shape();",
					"models/shape.scad": "module shape() { cube(3); }",
				},
			},
		}));
	});
	await expect(page.locator("#a .window")).toHaveAttribute("data-state", "ready");
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "ready");
}

function roundedCamera(camera) {
	return JSON.parse(JSON.stringify(camera, (_key, value) => typeof value === "number" ? Math.round(value * 1e7) / 1e7 : value));
}

test("packaged previews draw independently, edit multiple files, preserve cameras and show errors", async ({ page }, testInfo) => {
	const requests = await previewPage(page);
	await mountPair(page);
	const pixels = await page.evaluate(() => window.viewers.map(viewer => {
		const canvas = viewer.renderer.domElement, gl = viewer.renderer.getContext();
		const read = () => {
			viewer.renderer.render(viewer.scene, viewer.camera);
			const bytes = new Uint8Array(canvas.width * canvas.height * 4);
			gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
			return bytes;
		};
		viewer.model.visible = false; const hidden = read();
		viewer.model.visible = true; const visible = read();
		let changed = 0;
		for (let index = 0; index < visible.length; index += 4) if (visible[index] !== hidden[index] || visible[index + 1] !== hidden[index + 1] || visible[index + 2] !== hidden[index + 2]) changed++;
		return changed;
	}));
	for (const changed of pixels) expect(changed).toBeGreaterThan(100);
	expect(await page.evaluate(() => window.previews.map(preview => preview.state.volume))).toEqual([24, 27]);
	await page.locator("#a").getByRole("button", { name: "Source", exact: true }).click();
	const readonly = page.locator("#a textarea");
	await expect(readonly).toHaveJSProperty("readOnly", true);
	await readonly.selectText();
	expect(await readonly.evaluate(element => element.selectionEnd - element.selectionStart)).toBeGreaterThan(0);
	await page.locator("#a").getByRole("button", { name: "Source", exact: true }).click();
	await page.locator("#b").getByRole("button", { name: "Source", exact: true }).click();
	await page.locator("#b select").selectOption("models/shape.scad");
	const editor = page.locator("#b textarea");
	await expect(editor).toHaveJSProperty("readOnly", false);
	await editor.fill("module shape() { cube([2,3,5]); }");
	await expect(page.locator("#b .stale")).toBeVisible();
	await page.locator("#b").getByRole("button", { name: "Source", exact: true }).click();
	await page.locator("#b").getByRole("button", { name: "Source", exact: true }).click();
	await expect(editor).toHaveValue("module shape() { cube([2,3,5]); }");
	const cameras = await page.evaluate(() => window.viewers.map(viewer => viewer.getCamera()));
	await editor.press("Control+Enter");
	await expect.poll(() => page.evaluate(() => window.previews[1].state.volume)).toBeCloseTo(30, 8);
	await expect(page.locator("#b .stale")).toBeHidden();
	expect((await page.evaluate(() => window.viewers.map(viewer => viewer.getCamera()))).map(roundedCamera)).toEqual(cameras.map(roundedCamera));
	await editor.fill("module shape() { cube([); }");
	await editor.press("Meta+Enter");
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "error");
	await expect(page.locator("#b pre")).toContainText("models/shape.scad:1:");
	expect(await page.evaluate(() => window.previews.map(preview => preview.state.volume))).toEqual([24, 30]);
	await expect(page.locator("#b .stale")).toBeVisible();
	await page.locator("#b select").selectOption("models/main.scad");
	await expect(editor).toHaveValue("use <shape.scad> shape();");
	await editor.press("Escape");
	await expect(page.locator("#b .source")).toBeHidden();
	await expect(page.locator("#b").getByRole("button", { name: "Source", exact: true })).toBeFocused();
	const firstCamera = await page.evaluate(() => window.viewers[0].getCamera());
	await page.evaluate(() => window.viewers[1].zoomBy(1.7));
	expect(roundedCamera(await page.evaluate(() => window.viewers[0].getCamera()))).toEqual(roundedCamera(firstCamera));
	await page.locator("#b").getByRole("button", { name: "Reset view / fit", exact: true }).click();
	const resetCamera = await page.evaluate(() => window.viewers[1].getCamera());
	resetCamera.target.forEach((value, axis) => expect(value).toBeCloseTo([1, 1.5, 2.5][axis], 7));
	expect(resetCamera.zoom).toBe(1);
	expect(await page.evaluate(() => window.previews[1].state.status)).toBe("error");
	await page.screenshot({ path: testInfo.outputPath("independent-previews.png") });
	expect(await page.locator("#host-button").evaluate(button => getComputedStyle(button).minHeight)).toBe("0px");
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("preview download compiles edited final geometry without changing stale display", async ({ page }) => {
	const requests = await previewPage(page);
	await mountPair(page);
	await page.locator("#b").getByRole("button", { name: "Source", exact: true }).click();
	await page.locator("#b textarea").fill('cube([2,3,5]); %translate([10,0,0]) cube(20); echo("hello");');
	const download = page.waitForEvent("download");
	await page.locator("#b").getByRole("button", { name: "Download STL", exact: true }).click();
	const artifact = await download;
	expect(artifact.suggestedFilename()).toBe("main.stl");
	const metrics = measureMesh(decodeBinaryStl(await readFile(await artifact.path())));
	expect(metrics.volume).toBeCloseTo(30, 8);
	expect(metrics.bounds).toEqual([[0, 0, 0], [2, 3, 5]]);
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "modified");
	expect(await page.evaluate(() => window.previews[1].state.volume)).toBe(27);
	await expect(page.locator("#b .stale")).toBeVisible();
	await expect(page.locator("#b pre")).toContainText("hello");
	await page.locator("#b").getByRole("button", { name: "Render", exact: true }).click();
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "ready");
	expect(await page.evaluate(() => window.previews[1].state.mode)).toBe("render");
	expect(await page.evaluate(() => window.viewers[1].stats().background)).toBe(0);
	await page.locator("#b").getByRole("button", { name: "Preview", exact: true }).click();
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "ready");
	expect(await page.evaluate(() => window.viewers[1].stats().background)).toBe(1);
	let downloads = 0;
	page.on("download", () => downloads++);
	await page.locator("#b textarea").fill("cube([);");
	await page.locator("#b").getByRole("button", { name: "Download STL", exact: true }).click();
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "error");
	expect(downloads).toBe(0);
	await page.evaluate(() => Promise.all(window.previews.map(preview => preview.dispose())));
	await expect.poll(() => page.evaluate(() => window.createdUrls.every(url => window.revokedUrls.includes(url)))).toBe(true);
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("preview ignores stale resolver completions and cancels without downloads or cross-instance effects", async ({ page }) => {
	const requests = await previewPage(page);
	await mountPair(page);
	await page.evaluate(async () => {
		await window.previews[1].dispose();
		window.previews[1] = await window.createPreview(document.querySelector("#b"), {
			editable: true,
			project: {
				files: { "main.scad": "cube(3);" },
				resolver: path => {
					window.readStarted = path;
					return new Promise(resolve => { window.release = resolve; });
				},
			},
		});
		await window.previews[1].ready;
	});
	await page.locator("#b").getByRole("button", { name: "Source", exact: true }).click();
	const editor = page.locator("#b textarea");
	await editor.fill("include <late.scad>");
	await page.locator("#b").getByRole("button", { name: "Preview", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.readStarted)).toBe("late.scad");
	await editor.fill("cube(4);");
	await page.evaluate(() => window.release("cube(50);"));
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "modified");
	expect(await page.evaluate(() => window.previews[1].state.volume)).toBe(27);
	await editor.press("Control+Enter");
	await expect.poll(() => page.evaluate(() => window.previews[1].state.volume)).toBe(64);
	let downloads = 0;
	page.on("download", () => downloads++);
	await page.evaluate(() => { window.readStarted = undefined; });
	await editor.fill("include <cancel.scad>");
	await page.locator("#b").getByRole("button", { name: "Download STL", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.readStarted)).toBe("cancel.scad");
	await page.locator("#b").getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "cancelled");
	await page.evaluate(() => window.release("cube(100);"));
	expect(downloads).toBe(0);
	expect(await page.evaluate(() => window.previews.map(preview => preview.state.volume))).toEqual([24, 64]);
	expect((await page.evaluate(() => window.previews[0].render())).status).toBe("success");
	await editor.fill("cube(5);");
	await editor.press("Control+Enter");
	await expect.poll(() => page.evaluate(() => window.previews[1].state.volume)).toBe(125);
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("preview defers offscreen work, pauses hidden drawing, resizes and disposes during work", async ({ page }) => {
	const requests = await previewPage(page);
	await page.evaluate(async () => {
		document.querySelector("#a").style.marginTop = "1500px";
		window.previews.push(await window.createPreview(document.querySelector("#a"), { source: "cube(4);" }));
		document.querySelector("#b").style.height = "0px";
		window.zeroPreview = await window.createPreview(document.querySelector("#b"), { source: "cube(2);" });
	});
	await expect(page.locator("#a .window")).toHaveAttribute("data-state", "waiting");
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "waiting");
	expect(page.workers()).toHaveLength(0);
	expect(await page.locator("#a canvas").count()).toBe(0);
	await page.locator("#a").scrollIntoViewIfNeeded();
	await expect(page.locator("#a .window")).toHaveAttribute("data-state", "ready");
	expect(page.workers()).toHaveLength(1);
	await page.evaluate(async () => {
		await window.zeroPreview.dispose();
		document.querySelector("#b").style.height = "380px";
	});
	await page.evaluate(() => { document.querySelector("#a").style.width = "300px"; });
	await expect.poll(() => page.locator("#a canvas").first().evaluate(canvas => canvas.clientWidth)).toBe(300);
	await page.evaluate(() => { document.querySelector("#a").style.height = "0px"; });
	await expect.poll(() => page.evaluate(() => window.viewers[0].paused)).toBe(true);
	await page.evaluate(() => { document.querySelector("#a").style.height = "380px"; });
	await expect.poll(() => page.evaluate(() => window.viewers[0].paused)).toBe(false);
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect.poll(() => page.evaluate(() => window.viewers[0].paused)).toBe(true);
	const frame = await page.evaluate(() => window.viewers[0].renderer.info.render.frame);
	await page.waitForTimeout(100);
	expect(await page.evaluate(() => window.viewers[0].renderer.info.render.frame)).toBe(frame);
	await page.evaluate(() => Promise.all([window.previews[0].dispose(), window.previews[0].dispose()]));
	expect(await page.locator("#a").evaluate(element => element.childElementCount)).toBe(0);
	await expect.poll(() => page.workers().length).toBe(0);
	expect(await page.evaluate(() => window.viewers[0].disposed)).toBe(true);
	expect((await page.evaluate(() => window.previews[0].preview())).status).toBe("disposed");
	await page.evaluate(async () => {
		const hidden = await window.createPreview(document.querySelector("#a"), { source: "cube(2);" });
		await hidden.dispose();
		window.hiddenOutcome = await hidden.ready;
	});
	expect(await page.evaluate(() => window.hiddenOutcome.status)).toBe("disposed");
	await page.evaluate(async () => {
		const preview = await window.createPreview(document.querySelector("#b"), {
			project: { resolver: () => new Promise(resolve => { window.release = resolve; }) },
		});
		window.previews.push(preview);
		window.pending = preview.preview();
	});
	await expect.poll(() => page.evaluate(() => typeof window.release)).toBe("function");
	await page.evaluate(async () => { await window.previews[1].dispose(); await window.pending; window.release("cube(4);"); });
	await expect.poll(() => page.workers().length).toBe(0);
	const startup = await page.evaluate(async () => {
		const preview = await window.createPreview(document.querySelector("#b"), { source: "cube(2);" });
		const pending = preview.preview();
		await preview.dispose();
		return (await pending).status;
	});
	expect(startup).toBe("disposed");
	await expect.poll(() => page.workers().length).toBe(0);
	await page.evaluate(async () => {
		const preview = await window.createPreview(document.querySelector("#b"), {
			source: "cube(2);",
			workerOptions: {
				workerFactory: url => new Promise(resolve => { window.finishStartup = () => resolve(new Worker(url, { type: "module" })); }),
			},
		});
		window.previews.push(preview);
		window.pending = preview.preview();
	});
	await expect.poll(() => page.evaluate(() => typeof window.finishStartup)).toBe("function");
	await page.evaluate(async () => {
		const disposal = window.previews[2].dispose();
		window.finishStartup();
		await disposal;
		window.startupOutcome = await window.pending;
	});
	expect(await page.evaluate(() => window.startupOutcome.status)).toBe("disposed");
	await expect.poll(() => page.workers().length).toBe(0);
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("preview validates inputs, exposes startup errors and remains usable at narrow sizes", async ({ page }) => {
	const requests = await previewPage(page);
	const failures = await page.evaluate(async () => {
		const cases = [null, { source: 3 }, { source: "", project: {} }, { source: "", editable: "yes" }, { project: { mode: "render" } }, { source: "", workerOptions: "bad" }, { project: { files: "bad" } }];
		const failures = [];
		for (const options of cases) {
			try { await window.createPreview(document.querySelector("#a"), options); }
			catch (error) { failures.push(error.message); }
		}
		return failures;
	});
	expect(failures).toHaveLength(7);
	await page.setViewportSize({ width: 375, height: 812 });
	await page.evaluate(async () => {
		window.previews.push(await window.createPreview(document.querySelector("#a"), {
			source: "cube(2);", workerOptions: { workerFactory: () => { throw new Error("Worker unavailable"); } },
		}));
	});
	await expect(page.locator("#a .window")).toHaveAttribute("data-state", "error");
	await expect(page.locator("#a pre")).toContainText("Worker unavailable");
	expect((await page.evaluate(() => window.previews[0].ready)).status).toBe("error");
	await page.evaluate(async () => {
		window.previews.push(await window.createPreview(document.querySelector("#b"), { source: 'linear_extrude(2) text("5",size=4);' }));
	});
	await page.locator("#b").scrollIntoViewIfNeeded();
	await expect(page.locator("#b .window")).toHaveAttribute("data-state", "ready");
	for (const name of ["Preview", "Render", "Download STL", "Reset view / fit", "Source"]) {
		await expect(page.locator("#b").getByRole("button", { name, exact: true })).toBeVisible();
	}
	expect(await page.locator("#b .window").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
	await page.locator("#b").getByRole("button", { name: "Source", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("#b textarea")).toBeFocused();
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("preview resolver sources become editable, and cancelled geometry export leaves no download", async ({ page }) => {
	const requests = await previewPage(page);
	await page.evaluate(async () => {
		window.previews.push(await window.createPreview(document.querySelector("#a"), {
			editable: true,
			project: {
				resolver: path => ({
					"main.scad": "use <shape.scad> shape();",
					"shape.scad": "module shape() { cube(3); }",
				})[path],
			},
			workerOptions: {
				onProgress: event => {
					if (event.phase === "started" && window.cancelHeavy) {
						window.heavyStarted = true;
					}
				},
			},
		}));
		await window.previews[0].ready;
	});
	await page.locator("#a").getByRole("button", { name: "Source", exact: true }).click();
	await page.locator("#a select").selectOption("shape.scad");
	await expect(page.locator("#a textarea")).toHaveValue("module shape() { cube(3); }");
	await page.locator("#a textarea").fill("module shape() { cube(4); }");
	await page.locator("#a textarea").press("Control+Enter");
	await expect.poll(() => page.evaluate(() => window.previews[0].state.volume)).toBe(64);
	await page.locator("#a textarea").fill("module shape() { sphere(r=10,$fn=800); }");
	let downloads = 0;
	page.on("download", () => downloads++);
	const result = await page.evaluate(async () => {
		window.cancelHeavy = true;
		window.heavyStarted = false;
		let ticks = 0;
		const timer = setInterval(() => {
			if (window.heavyStarted && ++ticks === 2) {
				clearInterval(timer);
				window.previews[0].stop();
			}
		}, 5);
		try { return { outcome: await window.previews[0].downloadStl(), ticks }; }
		finally { clearInterval(timer); window.cancelHeavy = false; }
	});
	expect(result.outcome.status).toBe("cancelled");
	expect(result.ticks).toBe(2);
	expect(downloads).toBe(0);
	expect(await page.evaluate(() => window.previews[0].state.volume)).toBe(64);
	await page.locator("#a textarea").fill("module shape() { cube(2); }");
	await page.locator("#a textarea").press("Control+Enter");
	await expect.poll(() => page.evaluate(() => window.previews[0].state.volume)).toBe(8);
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("preview reports WebGL startup failure and can retry without orphaned workers", async ({ page }) => {
	const requests = await previewPage(page);
	await page.evaluate(async () => {
		window.originalGetContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (name, ...args) {
			if (name.startsWith("webgl")) return null;
			return window.originalGetContext.call(this, name, ...args);
		};
		window.previews.push(await window.createPreview(document.querySelector("#a"), { source: "cube(3);" }));
	});
	await expect(page.locator("#a .window")).toHaveAttribute("data-state", "error");
	await expect(page.locator("#a pre")).toContainText("WebGL");
	expect((await page.evaluate(() => window.previews[0].ready)).status).toBe("error");
	expect(page.workers()).toHaveLength(0);
	await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.originalGetContext; });
	expect((await page.evaluate(() => window.previews[0].preview())).status).toBe("success");
	expect(await page.evaluate(() => window.previews[0].state.volume)).toBe(27);
	await page.evaluate(() => window.previews[0].dispose());
	await expect.poll(() => page.workers().length).toBe(0);
	expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
});

test("preview controls remain discoverable and operable with touch input", async ({ browser }) => {
	const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
	try {
		const page = await context.newPage();
		const requests = await previewPage(page);
		await page.evaluate(async () => {
			window.previews.push(await window.createPreview(document.querySelector("#a"), { source: "cube(3);", editable: true }));
		});
		await expect(page.locator("#a .window")).toHaveAttribute("data-state", "ready");
		for (const name of ["Preview", "Render", "Download STL", "Reset view / fit", "Source"]) {
			const button = page.locator("#a").getByRole("button", { name, exact: true });
			await expect(button).toBeVisible();
			expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
		}
		await page.locator("#a").getByRole("button", { name: "Source", exact: true }).tap();
		await expect(page.locator("#a textarea")).toBeVisible();
		await page.locator("#a textarea").fill("cube(4);");
		await page.locator("#a").getByRole("button", { name: "Preview", exact: true }).tap();
		await expect.poll(() => page.evaluate(() => window.previews[0].state.volume)).toBe(64);
		await page.locator("#a").getByRole("button", { name: "Source", exact: true }).tap();
		await expect(page.locator("#a .source")).toBeHidden();
		expect(requests).toEqual({ rejected: [], failed: [], errors: [] });
	} finally { await context.close(); }
});