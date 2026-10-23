import { editorValue, expectEditor } from "./helpers/editor.js";
import { expect, test } from "@playwright/test";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";
import { unzipSync, strFromU8 } from "fflate";

const sources = [
	{ name: "main.scad", mimeType: "text/plain", buffer: Buffer.from("use <shape.scad> shape();") },
	{ name: "shape.scad", mimeType: "text/plain", buffer: Buffer.from("module shape() { cube(2); }") },
];

test.beforeEach(async ({ page }) => {
	await page.goto("/"); await expect(page.locator("#status")).toHaveText("READY");
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
});

test("Customizer applies typed overrides without editing source and preserves them in timed final export", async ({ page }) => {
	await page.locator("#example-select").selectOption("motion"); await expect(page.locator("#status")).toHaveText("READY");
	const source = await editorValue(page);
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await page.locator("#parameter-width-1").fill("20"); await page.locator("#parameter-width-1").dispatchEvent("change");
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(3200);
	await expectEditor(page).toBe(source);
	await page.locator("#preset-name").fill("Wide"); await page.locator("#preset-save").click();
	await page.locator("#parameter-reset").click();
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(1568);
	await page.locator("#preset-select").selectOption("Wide");
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(3200);
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
	await page.locator("#animation-time").fill("0.25"); await page.locator("#animation-time").dispatchEvent("change");
	await expect(page.locator("#status")).toHaveText("READY");
	const download = page.waitForEvent("download"); await page.locator("#download-button").click();
	const mesh = measureMesh(decodeBinaryStl(await readFile(await (await download).path())));
	expect(mesh.volume).toBeCloseTo(3200, 3); expect(mesh.bounds[0][0]).toBeCloseTo(10, 3);
});

test("animation scrubs and plays without resetting the camera and errors pause playback", async ({ page }) => {
	await page.locator("#auto-preview").uncheck(); await page.locator("#editor").fill('translate([20*$t,0,0]) cube(4);');
	await page.locator("#render-button").click(); await expect(page.locator("#status")).toHaveText("READY");
	const camera = await page.evaluate(async () => (await import("/openscad.js")).viewer.getCamera());
	await page.locator("#animation-time").fill("1"); await page.locator("#animation-time").dispatchEvent("change");
	await expect(page.locator("#status")).toHaveText("READY");
	expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.bounds.min.x)).toBe(20);
	await page.locator("#animation-steps").fill("4"); await page.locator("#animation-steps").dispatchEvent("change");
	await page.locator("#animation-play").click();
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).animation.time)).not.toBe(1);
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.bounds.min.x)).not.toBe(20);
	await page.locator("#animation-play").click();
	const after = await page.evaluate(async () => (await import("/openscad.js")).viewer.getCamera());
	after.eye.forEach((value, index) => expect(value).toBeCloseTo(camera.eye[index], 8));
	await page.locator("#editor").fill("cube(;"); await page.locator("#animation-play").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator("#animation-play")).toHaveAttribute("aria-pressed", "false");
});

test("frame sequences compile every final-mode time into a deterministic archive", async ({ page }) => {
	await page.locator("#auto-preview").uncheck();
	await page.locator("#editor").fill('width=2; translate([10*$t,0,0]) cube($preview ? 1 : width);');
	await page.locator("#render-button").click(); await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#animation-steps").fill("3"); await page.locator("#animation-steps").dispatchEvent("change");
	const camera = await page.evaluate(async () => (await import("/openscad.js")).viewer.getCamera());
	const download = page.waitForEvent("download"); await page.locator("#animation-export").click();
	const artifact = await download; expect(artifact.suggestedFilename()).toBe("model-frames.zip");
	const archive = unzipSync(new Uint8Array(await readFile(await artifact.path())));
	expect(Object.keys(archive)).toEqual(["model-0000.stl", "model-0001.stl", "model-0002.stl"]);
	Object.values(archive).forEach((data, index) => {
		const mesh = measureMesh(decodeBinaryStl(data)); expect(mesh.volume).toBeCloseTo(8, 5); expect(mesh.bounds[0][0]).toBeCloseTo(10 * index / 3, 5);
	});
	await expect(page.locator("#status")).toHaveText("READY");
	const after = await page.evaluate(async () => (await import("/openscad.js")).viewer.getCamera());
	after.eye.forEach((value, index) => expect(value).toBeCloseTo(camera.eye[index], 8));
	expect(after.target).toEqual(camera.target); expect(after.projection).toBe(camera.projection);
});

test("frame-sequence cancellation produces no partial download and restores controls", async ({ page }) => {
	await page.locator("#animation-steps").fill("1000"); await page.locator("#animation-steps").dispatchEvent("change");
	const downloads = []; page.on("download", (download) => downloads.push(download));
	await page.locator("#animation-export").click(); await expect(page.locator("#editor")).toHaveAttribute("aria-readonly", "true");
	await page.locator("#cancel-button").click();
	await expect(page.locator("#status")).toHaveText("CANCELLED");
	await expect(page.locator("#animation-export")).toBeEnabled();
	expect(downloads).toHaveLength(0);
	await page.locator("#render-button").click(); await expect(page.locator("#status")).toHaveText("READY");
});

test("animation and Customizer fit mobile and desktop with visible moving geometry", async ({ page }, testInfo) => {
	await page.locator("#example-select").selectOption("motion"); await expect(page.locator("#status")).toHaveText("READY");
	for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
		await page.setViewportSize(viewport);
		await page.locator("#fit-button").click();
		await page.getByRole("tab", { name: "Customizer", exact: true }).click();
		await expect(page.locator("#parameter-width-1")).toBeVisible();
		await page.getByRole("tab", { name: "Animation", exact: true }).click();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		const positions = await page.evaluate(() => ["#animation-time", "#animation-play", "#source-editor", "#viewport"].map((selector) => { const bounds = document.querySelector(selector).getBoundingClientRect(); return { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height }; }));
		positions.forEach((bounds) => { expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(viewport.width); expect(bounds.height).toBeGreaterThan(0); });
		const colored = await page.evaluate(async () => {
			const { viewer } = await import("/openscad.js");
			viewer.renderer.render(viewer.scene, viewer.camera);
			const gl = viewer.renderer.getContext(), canvas = viewer.renderer.domElement;
			const pixels = new Uint8Array(canvas.width * canvas.height * 4);
			gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			let count = 0;
			for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 1] > pixels[index] * 1.1 && pixels[index + 1] > pixels[index + 2] * 1.1) count++;
			return count;
		});
		expect(colored).toBeGreaterThan(100);
		await page.screenshot({ path: testInfo.outputPath(`features-${viewport.width}.png`), fullPage: true });
	}
	await page.locator("#animation-time").fill("0.25"); await page.locator("#animation-time").dispatchEvent("change");
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.bounds.min.x)).toBeCloseTo(13, 5);
});

test("Customizer presets download and import native JSON without evaluating code", async ({ page }) => {
	await page.locator("#example-select").selectOption("motion"); await expect(page.locator("#status")).toHaveText("READY");
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await page.locator("#preset-name").fill("Saved"); await page.locator("#preset-save").click();
	const download = page.waitForEvent("download"); await page.locator("#preset-export").click();
	const data = JSON.parse(strFromU8(new Uint8Array(await readFile(await (await download).path()))));
	expect(data.parameterSets.Saved.width).toBe("14");
	await page.locator("#preset-input").setInputFiles({ name: "presets.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ fileFormatVersion: "1", parameterSets: { Imported: { width: "20", centered: "false", travel: "[0,0,0]", shade: "red" } } })) });
	await page.locator("#preset-select").selectOption("Imported");
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(3200);
	await expect(page.locator("#parameter-centered")).not.toBeChecked();
	await page.locator("#preset-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"fileFormatVersion":"1","parameterSets":{"Bad":{"width":"cube(9)"}}}') });
	await expect(page.locator("#error-panel")).toContainText("preset-invalid");
	await expect(page.locator("#preset-select option[value='Bad']")).toHaveCount(0);
});

test("experimental roof is opt-in for studio preview and STL export", async ({ page }) => {
	await page.locator("#auto-preview").uncheck();
	await page.locator("#editor").fill('roof(method="straight") difference(){square(6);translate([2,2])square(2);}');
	await page.locator("#render-button").click();
	await expect(page.locator("#error-panel")).toContainText("experimental-disabled");
	await page.locator("#experimental-roof").check();
	await expect(page.locator("#status")).toHaveText("READY");
	const volume = await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume);
	const downloaded = page.waitForEvent("download");
	await page.locator("#download-button").click();
	const mesh = measureMesh(decodeBinaryStl(await readFile(await (await downloaded).path())));
	expect(mesh.volume).toBeCloseTo(volume, 4); expect(mesh.closed).toBe(true);
	await page.locator("#experimental-roof").uncheck();
	await expect(page.locator("#error-panel")).toContainText("experimental-disabled");
});

test("project files preserve library edits, compile the entry and export its name", async ({ page }) => {
	await page.locator("#project-files-input").setInputFiles(sources);
	await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#entry-select")).toHaveValue("main.scad");
	await page.locator("#source-select").selectOption("shape.scad");
	await page.locator("#editor").fill("module shape() { cube(3); }");
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(27);
	await page.locator("#source-select").selectOption("main.scad");
	await expectEditor(page).toBe("use <shape.scad> shape();");
	await page.locator("#source-select").selectOption("shape.scad");
	await expectEditor(page).toBe("module shape() { cube(3); }");
	const download = page.waitForEvent("download"); await page.locator("#download-button").click();
	expect((await download).suggestedFilename()).toBe("main.stl");
});

test("diagnostics navigate into the dependent source and entries are independent of edited files", async ({ page }) => {
	await page.locator("#auto-preview").uncheck();
	await page.locator("#project-files-input").setInputFiles([sources[0], { ...sources[1], buffer: Buffer.from("module shape() { cube(; }") }]);
	await expect(page.locator("#status")).toHaveText("ERROR"); await expect(page.locator("#error-panel")).toContainText("shape.scad");
	await page.locator("#error-panel .source-location").first().click(); await expect(page.locator("#source-select")).toHaveValue("shape.scad");
	await expect(page.locator("#entry-select")).toHaveValue("main.scad");
	await page.locator("#editor").fill("module shape() { cube(4); }"); await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("READY");
});

test("Pico sources and original binary fixture load as a project and export final STL", async ({ page }) => {
	const directory = new URL("../references/scad sample files/", import.meta.url);
	await page.locator("#project-files-input").setInputFiles(["pico.scad", "parts.scad", "import-base.stl"].map((name) => fileURLToPath(new URL(name.replaceAll(" ", "%20"), directory))));
	await page.locator("#entry-select").selectOption("pico.scad");
	await expect(page.locator("#status")).toHaveText("READY", { timeout: 15_000 });
	await expect(page.locator("#project-info")).toContainText("1 asset");
	const model = await page.evaluate(async () => (await import("/openscad.js")).viewer.stats());
	expect(model.volume).toBeGreaterThan(1472);
	const downloaded = page.waitForEvent("download"); await page.locator("#download-button").click();
	const artifact = await downloaded; expect(artifact.suggestedFilename()).toBe("pico.stl");
	const mesh = measureMesh(decodeBinaryStl(await readFile(await artifact.path())));
	expect(mesh.volume).toBeCloseTo(model.volume, 2); expect(mesh.degenerateTriangles).toBe(0);
});

test("folder loading retains nested include/import paths and selecting a new entry recompiles", async ({ page }) => {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-folder-ui-"));
	try {
		await mkdir(path.join(directory, "lib")); await mkdir(path.join(directory, "assets"));
		await writeFile(path.join(directory, "main.scad"), 'use <lib/shape.scad> shape();');
		await writeFile(path.join(directory, "lib/shape.scad"), 'module shape() { import("../assets/cube.stl"); }');
		await writeFile(path.join(directory, "other.scad"), "cube(3);");
		const asset = await page.evaluate(async () => {
			const { createWorkerEngine } = await import("/src/index.js"); const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
			try { const result = await engine.compile({ mode: "render", files: { "main.scad": "cube(2);" } }); const bytes = await engine.export(result); result.dispose(); return Array.from(bytes); }
			finally { await engine.dispose(); }
		});
		await writeFile(path.join(directory, "assets/cube.stl"), new Uint8Array(asset));
		await page.locator("#project-folder-input").setInputFiles(directory);
		await expect(page.locator("#status")).toHaveText("READY");
		await expect(page.locator("#source-select option[value='lib/shape.scad']")).toHaveCount(1);
		expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(8);
		await page.locator("#entry-select").selectOption("other.scad"); await expect(page.locator("#status")).toHaveText("READY");
		expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(27);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing assets can be added without discarding sources and unsaved replacement requires confirmation", async ({ page }) => {
	await page.locator("#project-files-input").setInputFiles([{ name: "main.scad", mimeType: "text/plain", buffer: Buffer.from('import("cube.stl");') }]);
	await expect(page.locator("#status")).toHaveText("ERROR"); await expect(page.locator("#error-panel")).toContainText("Missing geometry asset");
	const asset = await page.evaluate(async () => {
		const { createWorkerEngine } = await import("/src/index.js"); const engine = await createWorkerEngine({ manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href) });
		try { const result = await engine.compile({ mode: "render", files: { "main.scad": "cube(2);" } }); return Array.from(await engine.export(result)); }
		finally { await engine.dispose(); }
	});
	await page.locator("#project-add-input").setInputFiles([{ name: "cube.stl", mimeType: "model/stl", buffer: Buffer.from(asset) }]);
	await expect(page.locator("#status")).toHaveText("READY"); await expectEditor(page).toBe('import("cube.stl");');
	await page.locator("#auto-preview").uncheck(); await page.locator("#editor").fill('import("cube.stl"); cube(1);');
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.locator("#project-files-input").setInputFiles(sources);
	await expectEditor(page).toBe('import("cube.stl"); cube(1);');
	const saved = page.waitForEvent("download"); await page.locator("#save-source-button").click();
	expect((await saved).suggestedFilename()).toBe("main.scad");
});

test("mobile project controls fit and render the loaded project", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.locator("#project-files-input").setInputFiles(sources); await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#fit-button").click();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await expect(page.locator("#entry-select")).toBeVisible(); await expect(page.locator("#source-select")).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("mobile-project.png"), fullPage: true });
});

test("disabled auto-preview and failed loading retain the current project and visible model", async ({ page }) => {
	await page.locator("#project-files-input").setInputFiles(sources); await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#auto-preview").uncheck(); await page.locator("#source-select").selectOption("shape.scad");
	await page.locator("#editor").fill("module shape(){cube(4);}"); await expect(page.locator("#status")).toHaveText("MODIFIED");
	expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(8);
	await page.locator("#render-button").click(); await expect(page.locator("#status")).toHaveText("READY");
	expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(64);
	await page.locator("#project-add-input").setInputFiles([{ name: "shape.scad", mimeType: "text/plain", buffer: Buffer.from("module shape(){cube(10);}") }]);
	await expect(page.locator("#status")).toHaveText("ERROR"); await expect(page.locator("#error-panel")).toContainText("edited source");
	await expectEditor(page).toBe("module shape(){cube(4);}");
	expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(64);
});

test("dependency edits still recompile when an unrelated buffer is edited during debounce", async ({ page }) => {
	await page.locator("#project-files-input").setInputFiles([...sources, { name: "unused.scad", mimeType: "text/plain", buffer: Buffer.from("cube(10);") }]);
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#source-select").selectOption("shape.scad"); await page.locator("#editor").fill("module shape(){cube(3);}");
	await page.locator("#source-select").selectOption("unused.scad"); await page.locator("#editor").fill("cube(20);");
	await expect.poll(async () => page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(27);
});