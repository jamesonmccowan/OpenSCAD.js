import { editorValue, editorSelection, expectEditor } from "./helpers/editor.js";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#auto-preview").uncheck();
});

async function preview(page, source) {
	await page.locator("#editor").fill(source); await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("READY");
}

test("Customizer tab preserves overrides and presets while switching tools", async ({ page }) => {
	await page.locator("#example-select").selectOption("motion");
	await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#editor-pane #parameter-controls")).toHaveCount(0);
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await expect(page.getByRole("tabpanel", { name: "Customizer", exact: true })).toBeVisible();
	const source = await editorValue(page);
	await page.locator("#parameter-width-1").fill("20"); await page.locator("#parameter-width-1").press("Tab");
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#preset-name").fill("Wide"); await page.locator("#preset-save").click();
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await expect(page.locator("#parameter-width-1")).toHaveValue("20");
	await expect(page.locator("#preset-select")).toHaveValue("Wide");
	await expectEditor(page).toBe(source);
});

test("stale badge survives failed preview and final export and clears only on successful preview", async ({ page }) => {
	await preview(page, "cube(2);");
	await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
	await expect(page.locator("#preview-state")).toBeHidden();
	await page.locator("#editor").fill("cube(3);");
	await expect(page.locator("#status")).toHaveText("MODIFIED");
	await expect(page.locator("#status")).toHaveAttribute("data-state", "modified");
	await expect(page.locator("#preview-state")).toBeVisible();
	const download = page.waitForEvent("download"); await page.locator("#download-button").click();
	await readFile(await (await download).path());
	await expect(page.locator("#status")).toHaveText("MODIFIED");
	await expect(page.locator("#preview-state")).toBeVisible();
	await page.locator("#render-button").click(); await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#preview-state")).toBeHidden();
	await page.locator("#editor").fill("cube(;"); await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator("#status")).toHaveAttribute("data-state", "error");
	await expect(page.locator("#preview-state")).toBeVisible();
	await expect(page.locator("#model-metrics")).toContainText("Volume 27.00");
	await preview(page, "cube(4);");
	await expect(page.locator("#preview-state")).toBeHidden();
});

test("console shows warnings and echoes safely and each location navigates to its own source", async ({ page }) => {
	await page.locator("#project-files-input").setInputFiles([
		{ name: "main.scad", mimeType: "text/plain", buffer: Buffer.from('include <part.scad>\necho("<img src=x onerror=alert(1)>", main_missing); cube(2);') },
		{ name: "part.scad", mimeType: "text/plain", buffer: Buffer.from("echo(part_missing);") },
	]);
	await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#diagnostics-console")).toHaveAttribute("open", "");
	await expect(page.locator("#console-summary")).toContainText("2 warnings");
	await expect(page.locator("#console-summary")).toContainText("2 echoes");
	await expect(page.locator("#error-panel")).toContainText("<img src=x onerror=alert(1)>");
	await expect(page.locator("#error-panel img")).toHaveCount(0);
	const links = page.locator("#error-panel .source-location");
	await expect(links).toHaveCount(2);
	await links.filter({ hasText: "part.scad" }).click();
	await expect(page.locator("#source-select")).toHaveValue("part.scad");
	await expect(page.locator("#editor")).toBeFocused();
	await links.filter({ hasText: "main.scad" }).click();
	await expect(page.locator("#source-select")).toHaveValue("main.scad");
	expect(await editorSelection(page)).toBeGreaterThan(30);
	const consoleBounds = await page.locator("#diagnostics-console").boundingBox(), stage = await page.locator(".viewport-stage").boundingBox();
	expect(consoleBounds.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
	await page.locator("#console-summary").click(); await expect(page.locator("#error-panel")).toBeHidden();
	await page.locator("#console-summary").click(); await expect(page.locator("#error-panel")).toBeVisible();
	await preview(page, "cube(3);");
	await expect(page.locator("#console-summary")).toHaveText("Console · No messages");
	await expect(page.locator("#error-panel")).toBeEmpty();
});

test("layout, tab and display preferences survive reload without saving project contents", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	const divider = page.getByRole("separator");
	await divider.focus(); await page.keyboard.press("Shift+ArrowLeft");
	const desktop = await divider.getAttribute("aria-valuenow");
	await page.setViewportSize({ width: 375, height: 812 });
	await divider.focus(); await page.keyboard.press("ArrowUp");
	const mobile = await divider.getAttribute("aria-valuenow");
	await page.locator("#projection-button").click(); await page.locator("#show-marks").check();
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await page.locator("#preset-name").fill("Not persisted"); await page.locator("#preset-save").click();
	await page.locator("#editor").fill("cube(123);");
	await page.reload(); await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#customizer-tab")).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#projection-button")).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("#show-axes")).toBeChecked(); await expect(page.locator("#show-marks")).toBeChecked();
	await page.getByRole("tab", { name: "Hide tools", exact: true }).click();
	await expect(divider).toHaveAttribute("aria-valuenow", mobile);
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(divider).toHaveAttribute("aria-valuenow", desktop);
	await expectEditor(page).not.toBe("cube(123);");
	await expect(page.locator("#preset-select option[value='Not persisted']")).toHaveCount(0);
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("openscad-studio-ui-v1")));
	expect(Object.keys(saved).sort()).toEqual(["axes", "horizontal", "marks", "projection", "tab", "vertical"]);
});

test("blocked storage and malformed saved preferences visibly warn without breaking startup", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("openscad-studio-ui-v1", '{"horizontal":"bad"}'));
	await page.reload(); await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#preferences-message")).toBeVisible();
	await page.addInitScript(() => {
		Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
	});
	await page.reload(); await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#preferences-message")).toHaveText("UI preferences unavailable");
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await expect(page.locator("#customizer")).toBeVisible();
});

test("dragging past pane bounds saves valid preferences and keeps both panes usable", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	const divider = page.getByRole("separator");
	const errors = []; page.on("pageerror", (error) => errors.push(error.message));
	const bounds = await divider.boundingBox();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
	await page.mouse.move(0, bounds.y + bounds.height / 2); await page.mouse.up();
	await expect(page.locator("main")).not.toHaveClass(/resizing/);
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("openscad-studio-ui-v1")));
	expect(saved.horizontal).toBe(0);
	expect((await page.locator("#editor-pane").boundingBox()).width).toBeGreaterThanOrEqual(279);
	await page.reload(); await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#preferences-message")).toBeHidden();
	expect(errors).toEqual([]);
});

test("parameter changes and time seeks expose stale geometry while busy and clear after preview", async ({ page }) => {
	await preview(page, "width=2; translate([10*$t,0,0]) cube(width);");
	await page.getByRole("tab", { name: "Customizer", exact: true }).click();
	await page.locator("#parameter-width").fill("4"); await page.locator("#parameter-width").press("Tab");
	await expect(page.locator("#preview-state")).toBeVisible();
	await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#preview-state")).toBeHidden();
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
	await page.locator("#animation-time").fill("1"); await page.locator("#animation-time").press("Tab");
	await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#preview-state")).toBeHidden();
	await page.locator("#editor").fill("sphere(10,$fn=800);"); await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveAttribute("data-state", "busy");
	await expect(page.locator("#preview-state")).toBeVisible();
	await page.locator("#cancel-button").click();
	await expect(page.locator("#status")).toHaveAttribute("data-state", "cancelled");
	await expect(page.locator("#preview-state")).toBeVisible();
});

test("mobile tabs stay on one row and scroll keyboard selection into view", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 375, height: 812 });
	const tabs = page.getByRole("tab");
	const rows = await tabs.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
	expect(new Set(rows).size).toBe(1);
	await page.getByRole("tab", { name: "Hide tools" }).focus();
	await page.keyboard.press("End");
	await expect(page.locator("#audit-tab")).toBeFocused();
	const tab = await page.locator("#audit-tab").boundingBox();
	expect(tab.x).toBeGreaterThanOrEqual(0); expect(tab.x + tab.width).toBeLessThanOrEqual(375);
	await page.keyboard.press("ArrowLeft");
	await expect(page.locator("#customizer-tab")).toBeFocused();
	await expect(page.locator("#customizer")).toBeVisible();
	await preview(page, 'echo("Console output"); cube(2);');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	expect((await page.locator("#viewport").boundingBox()).height).toBeGreaterThanOrEqual(100);
	await page.screenshot({ path: testInfo.outputPath("mobile-polish.png"), fullPage: true });
});
