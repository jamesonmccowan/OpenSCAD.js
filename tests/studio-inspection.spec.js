import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#auto-preview").uncheck();
});

async function compile(page, source = "cube(10);") {
	await page.locator("#editor").fill(source);
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("READY");
}

async function state(page) {
	return page.evaluate(async () => {
		const { viewer } = await import("/openscad.js");
		return { camera: viewer.getCamera(), volume: viewer.volume, model: viewer.model.uuid };
	});
}

async function clickPoint(page, point) {
	const position = await page.evaluate(async (point) => {
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const { viewer } = await import("/openscad.js"), THREE = await import("three");
		viewer.camera.updateMatrixWorld();
		const ndc = new THREE.Vector3(...point).project(viewer.camera);
		const rect = viewer.renderer.domElement.getBoundingClientRect();
		viewer.renderer.domElement.addEventListener("pointerup", (event) => {
			const bounds = viewer.renderer.domElement.getBoundingClientRect();
			const depth = new THREE.Vector3(...point).project(viewer.camera).z;
			globalThis.expectedSurfacePoint = new THREE.Vector3(
				(event.clientX - bounds.left) / bounds.width * 2 - 1,
				-(event.clientY - bounds.top) / bounds.height * 2 + 1,
				depth,
			).unproject(viewer.camera).toArray();
		}, { once: true, capture: true });
		return { x: rect.left + (ndc.x + 1) * rect.width / 2, y: rect.top + (1 - ndc.y) * rect.height / 2 };
	}, point);
	await page.mouse.click(position.x, position.y);
	return page.evaluate(() => globalThis.expectedSurfacePoint);
}

test("camera, guides and metrics use the shared viewer without changing geometry", async ({ page }) => {
	await compile(page);
	await expect(page.locator("#model-metrics")).toHaveText("10.00 × 10.00 × 10.00 mm | Volume 1000.00 mm³ | 12 triangles");
	const before = await state(page);
	await page.locator("#camera-direction").selectOption("top");
	let after = await state(page);
	expect(after.camera.eye[0]).toBeCloseTo(after.camera.target[0], 8);
	expect(after.camera.eye[1]).toBeCloseTo(after.camera.target[1], 8);
	await page.locator("#zoom-in-button").click();
	expect((await state(page)).camera.eye[2]).toBeLessThan(after.camera.eye[2]);
	await page.locator("#projection-button").click();
	await page.locator("#show-marks").check();
	await expect(page.locator("#show-axes")).toBeChecked();
	await page.locator("#show-axes").uncheck();
	await expect(page.locator("#show-marks")).not.toBeChecked();
	await page.locator("#wireframe-button").click();
	await compile(page);
	const settings = await page.evaluate(async () => {
		const { viewer } = await import("/openscad.js");
		return { projection: viewer.projection, wireframe: viewer.model.children[0].material.every((material) => material.wireframe) };
	});
	expect(settings).toEqual({ projection: "orthographic", wireframe: true });
	expect((await state(page)).volume).toBe(before.volume);
	await page.locator("#editor").fill("cube(;"); await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator("#model-metrics")).toContainText("1000.00 mm³");
});

test("cross sections persist across tab changes and recompilation but never enter STL", async ({ page }) => {
	await compile(page);
	await page.getByRole("tab", { name: "Cross section" }).click();
	await page.evaluate(async () => {
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const { viewer } = await import("/openscad.js");
		viewer.renderer.render(viewer.scene, viewer.camera);
		const canvas = viewer.renderer.domElement, gl = viewer.renderer.getContext();
		globalThis.unslicedPixels = new Uint8Array(canvas.width * canvas.height * 4);
		gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, globalThis.unslicedPixels);
	});
	await page.locator("#slice-enabled").check();
	await page.locator("#slice-axis").selectOption("x");
	const changedPixels = await page.evaluate(async () => {
		const { viewer } = await import("/openscad.js");
		viewer.renderer.render(viewer.scene, viewer.camera);
		const canvas = viewer.renderer.domElement, gl = viewer.renderer.getContext(), pixels = new Uint8Array(canvas.width * canvas.height * 4);
		gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		let changed = 0;
		for (let index = 0; index < pixels.length; index += 4) if (pixels[index] !== globalThis.unslicedPixels[index] || pixels[index + 1] !== globalThis.unslicedPixels[index + 1] || pixels[index + 2] !== globalThis.unslicedPixels[index + 2]) changed++;
		return changed;
	});
	expect(changedPixels).toBeGreaterThan(100);
	await expect(page.locator("#slice-value")).toHaveText("5.00 mm");
	await page.locator("#slice-invert").check();
	await page.getByRole("tab", { name: "Audit", exact: true }).click();
	await expect(page.locator("#slice-panel")).toBeHidden();
	await compile(page, "cube(20);");
	const clipping = await page.evaluate(async () => {
		const { viewer } = await import("/openscad.js");
		const plane = viewer.model.children[0].material[0].clippingPlanes[0];
		return { normal: plane.normal.toArray(), constant: plane.constant };
	});
	expect(clipping).toEqual({ normal: [1, 0, 0], constant: -10 });
	await page.getByRole("tab", { name: "Cross section" }).click();
	await expect(page.locator("#slice-value")).toHaveText("10.00 mm");
	const download = page.waitForEvent("download"); await page.locator("#download-button").click();
	const mesh = measureMesh(decodeBinaryStl(await readFile(await (await download).path())));
	expect(mesh.volume).toBeCloseTo(8000, 5);
	expect(mesh.bounds).toEqual([[0, 0, 0], [20, 20, 20]]);
});

test("measurement raycasts visible surfaces, reports deltas, copies JSON and clears stale annotations", async ({ page }) => {
	await compile(page);
	await page.locator("#camera-direction").selectOption("top");
	await page.locator("#projection-button").click();
	await page.getByRole("tab", { name: "Measure", exact: true }).click();
	await page.locator("#measure-toggle").click();
	const first = await clickPoint(page, [2, 2, 10]);
	await expect(page.locator("#measurement-readout")).toContainText("Select the second point");
	const second = await clickPoint(page, [8, 2, 10]);
	await expect(page.locator("#measurement-readout")).toContainText("Distance");
	await expect(page.locator("#measurement-readout")).toContainText("Delta X +");
	await expect(page.locator("#measure-toggle")).toHaveAttribute("aria-pressed", "false");
	await page.locator("#measure-tolerance").selectOption("0.3");
	await expect(page.locator("#measurement-readout")).toContainText("Over 0.30 mm gap target");
	// A clipboard stub verifies the exact payload on browsers without clipboard permissions.
	await page.evaluate(() => {
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { globalThis.copiedMeasurement = text; } } });
	});
	await page.locator("#measure-copy").click();
	const copied = await page.evaluate(() => JSON.parse(globalThis.copiedMeasurement));
	expect(copied).toMatchObject({ units: "mm", tolerance: 0.3, withinTolerance: false });
	// Verify the actual pointer rays, including browser pixel rounding and layout changes.
	expect(Math.abs(copied.distance - 6)).toBeLessThan(0.1);
	copied.points.forEach((point, index) => point.forEach((value, axis) => expect(value).toBeCloseTo([first, second][index][axis], 3)));
	["x", "y", "z"].forEach((axis, index) => expect(copied.delta[axis]).toBeCloseTo(copied.points[1][index] - copied.points[0][index], 3));
	expect(copied.distance).toBeCloseTo(Math.hypot(copied.delta.x, copied.delta.y, copied.delta.z), 3);
	await page.getByRole("tab", { name: "Cross section" }).click();
	await page.locator("#slice-axis").selectOption("x"); await page.locator("#slice-enabled").check();
	await page.getByRole("tab", { name: "Measure", exact: true }).click();
	await expect(page.locator("#measurement-readout")).toBeHidden();
	await page.locator("#measure-toggle").click();
	await clickPoint(page, [8, 2, 10]);
	await expect(page.locator("#measurement-readout")).toContainText("No visible model surface");
	await clickPoint(page, [2, 2, 10]);
	await expect(page.locator("#measurement-readout")).toContainText("Select the second point");
	await page.locator("#editor").fill("cube(20);");
	await expect(page.locator("#measurement-readout")).toBeHidden();
	await expect(page.locator("#measure-copy")).toBeDisabled();
});

test("audit reports sampled pairs and bounds without replacing the preview or camera", async ({ page }) => {
	await compile(page, 'audit_part("fixed") cube(10); translate([15-10*$t,0,0]) audit_part("moving") cube(10);');
	const before = await state(page);
	await page.getByRole("tab", { name: "Audit", exact: true }).click();
	await page.locator("#audit-samples").fill("3");
	await page.locator("#audit-run").click();
	await expect(page.locator("#audit-status")).toContainText("Found 1 overlapping component pair");
	await expect(page.locator("#audit-results")).toContainText("fixed / moving");
	await expect(page.locator("#audit-results")).toContainText("Max overlap 500.0000 mm³");
	await expect(page.locator("#audit-results")).toContainText("$t: 1.000");
	await expect(page.locator("#audit-results")).toContainText("Bounds at max overlap: [5.000, 0.000, 0.000] to [10.000, 10.000, 10.000]");
	const after = await state(page);
	expect(after.volume).toBe(before.volume);
	expect(after.model).toBe(before.model);
	expect(after.camera.target).toEqual(before.camera.target);
	expect(after.camera.projection).toBe(before.camera.projection);
	after.camera.eye.forEach((value, index) => expect(value).toBeCloseTo(before.camera.eye[index], 8));
	await expect(page.locator("#editor")).toHaveAttribute("aria-readonly", "false");
	await page.locator("#audit-epsilon").fill("101");
	await page.locator("#audit-run").click();
	await expect(page.locator("#audit-status")).toContainText("Choose 2-20 samples");
	await page.locator("#audit-epsilon").fill("0.001");
	await compile(page, 'audit_part("a") cube(2); translate([4,0,0]) audit_part("b") cube(2);');
	await page.locator("#audit-run").click();
	await expect(page.locator("#audit-status")).toContainText("No overlap above");
});

test("audit cancellation and invalid source restore controls without partial findings", async ({ page }) => {
	await compile(page, 'audit_part("a") sphere(10,$fn=64); audit_part("b") sphere(10,$fn=64);');
	await page.getByRole("tab", { name: "Audit", exact: true }).click();
	await page.locator("#audit-samples").fill("20");
	await page.locator("#audit-run").click();
	await expect(page.locator("#editor")).toHaveAttribute("aria-readonly", "true");
	await expect(page.locator("#animation-play")).toBeDisabled();
	await expect(page.locator("#preset-save")).toBeDisabled();
	await page.locator("#cancel-button").click();
	await expect(page.locator("#audit-status")).toContainText("Audit cancelled");
	await expect(page.locator("#audit-results")).toBeEmpty();
	await expect(page.locator("#render-button")).toBeEnabled();
	await expect(page.locator("#editor")).toHaveAttribute("aria-readonly", "false");
	await page.locator("#editor").fill("cube(;");
	await page.locator("#audit-run").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator("#audit-status")).not.toContainText("Checking sample");
	await expect(page.locator("#audit-run")).toBeEnabled();
});

test("audit freezes Customizer overrides and samples final-mode geometry without seeking animation", async ({ page }) => {
	await compile(page, 'width=10; audit_part("fixed") cube($preview ? 1 : width); translate([5+10*$t,0,0]) audit_part("moving") cube($preview ? 1 : width);');
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await page.locator("#parameter-width").fill("12");
	await page.locator("#parameter-width").dispatchEvent("change");
	await expect.poll(() => page.evaluate(async () => (await import("/openscad.js")).project.compileDirty)).toBe(false);
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
	await page.locator("#animation-time").fill("1");
	await page.locator("#animation-time").dispatchEvent("change");
	await page.locator("#animation-time").press("Tab");
	await expect(page.locator("#status")).toHaveText("READY");
	const before = await state(page);
	expect(before.volume).toBeCloseTo(2, 8);
	await page.getByRole("tab", { name: "Audit", exact: true }).click();
	await page.locator("#audit-samples").fill("2"); await page.locator("#audit-run").click();
	await expect(page.locator("#audit-results")).toContainText("Max overlap 1008.0000 mm³");
	await expect(page.locator("#audit-results")).toContainText("$t: 0.000");
	await expect(page.locator("#animation-time")).toHaveValue("1");
	const after = await state(page);
	expect(after.volume).toBe(before.volume); expect(after.model).toBe(before.model);
});

test("animation lives beneath the viewer and keeps playing when its tab is hidden", async ({ page }) => {
	await compile(page, "translate([20*$t,0,0]) cube(4);");
	await expect(page.locator("#editor-pane #animation-play")).toHaveCount(0);
	await expect(page.locator("#animation-panel")).toBeHidden();
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
	await expect(page.locator("#viewport-pane #animation-play")).toBeVisible();
	await page.locator("#animation-steps").fill("4"); await page.locator("#animation-steps").press("Tab");
	await page.locator("#animation-play").click();
	await expect.poll(() => page.locator("#animation-time").inputValue()).not.toBe("0");
	await page.getByRole("tab", { name: "Cross section", exact: true }).click();
	await expect(page.locator("#animation-panel")).toBeHidden();
	await expect(page.locator("#animation-play")).toHaveAttribute("aria-pressed", "true");
	const time = await page.locator("#animation-time").inputValue();
	await expect.poll(() => page.locator("#animation-time").inputValue()).not.toBe(time);
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
	await page.locator("#animation-play").click();
	await expect(page.locator("#animation-play")).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator("#animation-steps")).toHaveValue("4");
});

test("pane divider resizes desktop and stacked layouts with pointer, keyboard and bounded limits", async ({ page }, testInfo) => {
	const divider = page.getByRole("separator", { name: "Resize code and model panes" });
	const model = await state(page);
	for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
		await page.getByRole("tab", { name: "Hide tools", exact: true }).click();
		await page.setViewportSize(viewport);
		const stacked = viewport.width < 760;
		await expect(divider).toHaveAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
		const before = await page.locator("#editor-pane").boundingBox(), handle = await divider.boundingBox();
		const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
		await page.mouse.move(x, y); await page.mouse.down();
		await page.mouse.move(x + (stacked ? 0 : -100), y + (stacked ? -60 : 0), { steps: 5 });
		await page.mouse.up();
		const after = await page.locator("#editor-pane").boundingBox();
		expect(stacked ? before.height - after.height : before.width - after.width).toBeCloseTo(stacked ? 60 : 100, 0);
		await expect(page.locator("main")).not.toHaveClass(/resizing/);
		await divider.focus();
		const share = Number(await divider.getAttribute("aria-valuenow"));
		await page.keyboard.press(stacked ? "ArrowDown" : "ArrowRight");
		expect(Number(await divider.getAttribute("aria-valuenow"))).toBe(share + 2);
		await page.keyboard.press("Home");
		expect(Number(await divider.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(Number(await divider.getAttribute("aria-valuemin")));
		await page.keyboard.press("End");
		expect(Number(await divider.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(Number(await divider.getAttribute("aria-valuemax")));
		await page.getByRole("tab", { name: "Animation", exact: true }).click();
		await expect(page.locator("#animation-play")).toBeVisible();
		await expect.poll(async () => (await page.locator("#viewport").boundingBox()).height).toBeGreaterThanOrEqual(100);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await divider.dblclick();
		expect(Number(await divider.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(stacked ? 46 : 42);
		await page.getByRole("tab", { name: "Hide tools", exact: true }).click();
		await expect(divider).toHaveAttribute("aria-valuenow", stacked ? "46" : "42");
		const cancelledHandle = await divider.boundingBox();
		await page.mouse.move(cancelledHandle.x + cancelledHandle.width / 2, cancelledHandle.y + cancelledHandle.height / 2);
		await page.mouse.down();
		await divider.dispatchEvent("pointercancel", { pointerId: 1 });
		await page.mouse.up();
		await expect(page.locator("main")).not.toHaveClass(/resizing/);
		await page.screenshot({ path: testInfo.outputPath(`resizable-${viewport.width}.png`), fullPage: true });
	}
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(divider).toHaveAttribute("aria-valuenow", "42");
	const after = await state(page);
	expect(after.volume).toBe(model.volume); expect(after.model).toBe(model.model);
	after.camera.eye.forEach((value, index) => expect(value).toBeCloseTo(model.camera.eye[index], 8));
});

test("inspection panels are keyboard accessible and fit desktop and mobile", async ({ page }, testInfo) => {
	await page.getByRole("tab", { name: "Hide tools" }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.locator("#slice-tab")).toBeFocused();
	await expect(page.locator("#slice-panel")).toBeVisible();
	await page.keyboard.press("End");
	await expect(page.locator("#audit-tab")).toBeFocused();
	await expect(page.locator("#audit-panel")).toBeVisible();
	for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
		await page.setViewportSize(viewport);
		for (const tab of ["Cross section", "Measure", "Audit"]) {
			await page.getByRole("tab", { name: tab, exact: true }).click();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			const bounds = await page.locator("#viewport").boundingBox();
			expect(bounds.height).toBeGreaterThan(100);
		}
		await page.screenshot({ path: testInfo.outputPath(`inspection-${viewport.width}.png`), fullPage: true });
	}
	await page.getByRole("tab", { name: "Hide tools" }).click();
	const download = page.waitForEvent("download"); await page.locator("#snapshot-button").click();
	const image = await download;
	expect(image.suggestedFilename()).toBe("model-preview.png");
	const data = await readFile(await image.path());
	expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(data.readUInt32BE(16)).toBeGreaterThan(100);
	expect(data.readUInt32BE(20)).toBeGreaterThan(100);
});
