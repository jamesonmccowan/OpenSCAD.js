import { editorSelection } from "./helpers/editor.js";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";

async function preview(page, source) {
	await page.locator("#editor").fill(source);
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("READY", { timeout: 15_000 });
}

async function camera(page) { return page.evaluate(async () => (await import("/openscad.js")).viewer.getCamera()); }
async function stats(page) { return page.evaluate(async () => (await import("/openscad.js")).viewer.stats()); }

function sameCamera(actual, expected) {
	for (const name of ["eye", "target", "up"]) actual[name].forEach((value, index) => expect(value).toBeCloseTo(expected[name][index], 7));
	expect(actual.projection).toBe(expected.projection); expect(actual.fov).toBeCloseTo(expected.fov, 7); expect(actual.zoom).toBeCloseTo(expected.zoom, 7);
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY", { timeout: 15_000 });
});

test("native color precedence, explicit alpha, and independent ghost/debug layers", async ({ page }) => {
	await preview(page, 'color("red",0.8) color([0,0,1,0.2]) cube(2); %translate([5,0,0]) cube(2); #translate([0,0,2]) cube(1);');
	const result = await stats(page);
	expect(result.solid).toBe(1); expect(result.background).toBe(1); expect(result.debug).toBe(1); expect(result.volume).toBe(9);
	expect(result.materials).toContainEqual({ color: "ff0000", opacity: 0.8 });
	expect(result.materials).toContainEqual({ color: "a3a9af", opacity: 0.28 });
	expect(result.materials).toContainEqual({ color: "ff6955", opacity: 0.48 });
});

test("hand background geometry is actually drawn rather than merely present in the scene", async ({ page }, testInfo) => {
	const source = await readFile(new URL("../references/scad sample files/hand.scad", import.meta.url), "utf8");
	await preview(page, source);
	await page.locator("#fit-button").click();
	const report = await page.evaluate(async () => {
		const { viewer } = await import("/openscad.js");
		const background = viewer.model.children.filter((object) => object.userData.scadLayer === "background");
		const gl = viewer.renderer.getContext();
		const canvas = viewer.renderer.domElement;
		const pixels = () => {
			viewer.renderer.render(viewer.scene, viewer.camera);
			const values = new Uint8Array(canvas.width * canvas.height * 4);
			gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, values);
			return values;
		};
		background.forEach((object) => { object.visible = false; });
		const hidden = pixels();
		background.forEach((object) => { object.visible = true; });
		const visible = pixels();
		let changed = 0;
		for (let index = 0; index < visible.length; index += 4) if (visible[index] !== hidden[index] || visible[index + 1] !== hidden[index + 1] || visible[index + 2] !== hidden[index + 2]) changed++;
		return { backgrounds: background.length, groups: background.map((object) => object.geometry.groups.length), changed };
	});
	expect(report.backgrounds).toBe(1);
	expect(report.groups.every((groups) => groups > 0)).toBe(true);
	expect(report.changed).toBeGreaterThan(100);
	await page.screenshot({ path: testInfo.outputPath("hand-background.png"), fullPage: true });
	const downloaded = page.waitForEvent("download");
	await page.locator("#download-button").click();
	const artifact = await downloaded;
	const exported = measureMesh(decodeBinaryStl(await readFile(await artifact.path())));
	expect(exported.degenerateTriangles).toBe(0);
	expect(exported.volume).toBeCloseTo((await stats(page)).volume, 2);
	await expect(page.locator("#status")).toHaveText("READY");
});

test("camera persists across compilation and source view settings respect camera lock", async ({ page }) => {
	const original = await camera(page);
	await preview(page, "cube(5);");
	sameCamera(await camera(page), original);
	await preview(page, "$vpt=[1,2,3]; $vpr=[55,0,25]; $vpd=80; $vpf=30; cube(5);");
	const authored = await camera(page);
	expect(authored.target).toEqual([1, 2, 3]); expect(authored.fov).toBe(30);
	const distance = Math.hypot(...authored.eye.map((coordinate, index) => coordinate - authored.target[index]));
	expect(distance).toBeCloseTo(80, 7);
	await page.locator("#camera-lock-button").click();
	await preview(page, "$vpt=[100,200,300]; $vpd=400; cube(5);");
	sameCamera(await camera(page), authored);
	await page.locator("#projection-button").click();
	expect((await camera(page)).projection).toBe("orthographic");
	await page.locator("#wireframe-button").click();
	await expect(page.locator("#wireframe-button")).toHaveAttribute("aria-pressed", "true");
});

test("STL download recompiles final mode and excludes preview overlays", async ({ page }) => {
	await preview(page, "if($preview) cube(2); else cube(3); %cube(100);");
	expect((await stats(page)).volume).toBe(8);
	const downloaded = page.waitForEvent("download");
	await page.locator("#download-button").click();
	const artifact = await downloaded;
	expect(artifact.suggestedFilename()).toBe("model.stl");
	const mesh = measureMesh(decodeBinaryStl(await readFile(await artifact.path())));
	expect(mesh.volume).toBeCloseTo(27, 7); expect(mesh.closed).toBe(true);
	await expect(page.locator("#status")).toHaveText("READY");
	expect((await stats(page)).volume).toBe(8);
});

test("failed source retains the previous model and the diagnostic selects its source location", async ({ page }) => {
	await preview(page, "cube(2);");
	await page.locator("#editor").fill("cube("); await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	expect((await stats(page)).volume).toBe(8);
	await page.locator("#error-panel .source-location").first().click();
	await expect(page.locator("#editor")).toBeFocused();
	expect(await editorSelection(page)).toBe(5);
	await preview(page, "cube(3);"); expect((await stats(page)).volume).toBe(27);
});

test("new preview wins over a stale job and cancellation leaves the viewport responsive", async ({ page }) => {
	await page.locator("#editor").fill("sphere(r=10,$fn=800);"); await page.locator("#render-button").click();
	await page.locator("#cancel-button").click();
	await expect(page.locator("#status")).toHaveText("CANCELLED");
	await preview(page, "cube(2);");
	await page.evaluate(async () => {
		const studio = await import("/openscad.js");
		const { editor } = studio;
		editor.value = "sphere(r=10,$fn=800);"; const old = studio.preview();
		editor.value = "cube(3);"; await studio.preview(); await old;
	});
	expect((await stats(page)).volume).toBe(27);
});

test("viewer-only containers fit compact, wide and tall windows", async ({ page }, testInfo) => {
	await page.evaluate(async () => {
		const { Viewer } = await import("/src/viewer/viewer.js");
		const { createWorkerEngine } = await import("/src/index.js");
		const element = document.createElement("div"); element.id = "embedded-viewer";
		Object.assign(element.style, { position: "fixed", left: "0", top: "0", width: "160px", height: "120px", zIndex: "10" }); document.body.append(element);
		const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		const result = await engine.compile({ files: { "main.scad": "cube([10,15,20],center=true);" } });
		window.embedded = new Viewer(element); window.embedded.setModel(result); result.dispose(); await engine.dispose();
	});
	for (const [width, height] of [[160, 120], [1200, 300], [300, 900]]) {
		const corners = await page.evaluate(async ({ width, height }) => {
			const viewer = window.embedded;
			const THREE = await import("three");
			viewer.element.style.width = `${width}px`; viewer.element.style.height = `${height}px`; viewer.resize(); viewer.fit();
			viewer.renderer.render(viewer.scene, viewer.camera);
			const box = viewer.bounds; const points = [];
			for (const horizontal of [box.min.x,box.max.x]) for (const vertical of [box.min.y,box.max.y]) for (const depth of [box.min.z,box.max.z]) points.push(new THREE.Vector3(horizontal,vertical,depth).project(viewer.camera).toArray());
			return points;
		}, { width, height });
		expect(corners.every(([horizontal, vertical]) => Math.abs(horizontal) < 1 && Math.abs(vertical) < 1)).toBe(true);
		await page.locator("#embedded-viewer").screenshot({ path: testInfo.outputPath(`embed-${width}x${height}.png`) });
	}
	await page.evaluate(() => { window.embedded.dispose(); window.embedded.dispose(); window.embedded.element.remove(); });
});

test("studio has local-only startup and restores a lost WebGL context", async ({ page }) => {
	const remote = [];
	page.on("request", (request) => { if (new URL(request.url()).origin !== "http://127.0.0.1:4173") remote.push(request.url()); });
	await page.route("https://**", (route) => route.abort());
	await page.reload(); await expect(page.locator("#status")).toHaveText("READY"); expect(remote).toEqual([]);
	const restored = await page.evaluate(async () => {
		const { viewer } = await import("/openscad.js");
		const extension = viewer.renderer.getContext().getExtension("WEBGL_lose_context");
		if (!extension) return false;
		const canvas = viewer.renderer.domElement;
		await new Promise((resolve) => {
			canvas.addEventListener("webglcontextrestored", resolve, { once: true });
			canvas.addEventListener("webglcontextlost", () => requestAnimationFrame(() => extension.restoreContext()), { once: true });
			extension.loseContext();
		});
		await new Promise(requestAnimationFrame);
		viewer.renderer.render(viewer.scene, viewer.camera);
		return !viewer.renderer.getContext().isContextLost();
	});
	expect(restored).toBe(true);
	await preview(page, "cube(2);"); expect((await stats(page)).volume).toBe(8);
});

for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 812 }]]) {
	test(`${name} viewport is framed, nonblank, and interactive`, async ({ page }, testInfo) => {
		await page.setViewportSize(size);
		await preview(page, 'color("#badf67") cube([10,15,20],center=true);');
		await page.locator("#fit-button").click();
		const pixels = await page.evaluate(async () => {
			const { viewer } = await import("/openscad.js");
			const THREE = await import("three");
			viewer.controls.update(); viewer.renderer.render(viewer.scene, viewer.camera);
			const gl = viewer.renderer.getContext(); const canvas = viewer.renderer.domElement;
			const values = new Uint8Array(canvas.width * canvas.height * 4);
			gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, values);
			let colored = 0;
			for (let index = 0; index < values.length; index += 4) if (values[index + 1] > values[index] * 1.03 && values[index + 2] < values[index + 1] * 0.85) colored++;
			const bounds = viewer.bounds;
			const corners = [];
			for (const horizontal of [bounds.min.x,bounds.max.x]) for (const vertical of [bounds.min.y,bounds.max.y]) for (const depth of [bounds.min.z,bounds.max.z]) corners.push(new THREE.Vector3(horizontal,vertical,depth).project(viewer.camera).toArray());
			return { colored, corners, width: canvas.width, height: canvas.height };
		});
		expect(pixels.colored).toBeGreaterThan(100);
		expect(pixels.corners.every(([horizontal, vertical, depth]) => Math.abs(horizontal) < 1 && Math.abs(vertical) < 1 && depth > -1 && depth < 1)).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`${name}-studio.png`), fullPage: true });
		const before = await camera(page);
		const canvas = page.locator('#viewport canvas[aria-label="3D model preview"]'); const box = await canvas.boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 4 }); await page.mouse.up();
		expect((await camera(page)).eye).not.toEqual(before.eye);
	});
}