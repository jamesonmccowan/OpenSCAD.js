import { expect, test } from "@playwright/test";
import { editorSelection, expectEditor } from "./helpers/editor.js";

const sources = [
	{ name: "main.scad", mimeType: "text/plain", buffer: Buffer.from("use <part.scad> shape();") },
	{ name: "part.scad", mimeType: "text/plain", buffer: Buffer.from("module shape() { cube(2); }") },
];

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#auto-preview").uncheck();
});

async function select(page, from, to = from) {
	await page.evaluate(async ({ from, to }) => {
		const { editor } = await import("/openscad.js");
		editor.focus(); editor.setSelectionRange(from, to);
	}, { from, to });
}

test("local CodeMirror highlights OpenSCAD tokens and tolerates unfinished source", async ({ page }) => {
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const source = 'include <parts/shape.scad>\nmodule shape() {\n  $fn = 0x30;\n  cube(2.5e1); // sample\n  echo("hello");\n  enabled = true;\n}\n/* unfinished';
	await page.locator("#editor").fill(source);
	await expectEditor(page).toBe(source);
	await expect(page.locator("#editor")).toHaveAttribute("contenteditable", "true");
	await expect(page.locator("#source-editor textarea")).toHaveCount(0);
	await expect(page.locator(".cm-lineNumbers")).toContainText("9");
	const color = (text) => page.locator("#editor span").filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first()
		.evaluate((element) => getComputedStyle(element).color);
	await expect.poll(() => color("module")).toBe("rgb(198, 167, 255)");
	expect(await color("cube")).toBe("rgb(136, 207, 244)");
	expect(await color("$fn")).toBe("rgb(255, 173, 206)");
	expect(await color("0x30")).toBe("rgb(232, 203, 101)");
	expect(await color("2.5e1")).toBe("rgb(232, 203, 101)");
	expect(await color("<parts/shape.scad>")).toBe("rgb(184, 238, 98)");
	expect(await color('"hello"')).toBe("rgb(184, 238, 98)");
	expect(await color("// sample")).toBe("rgb(145, 160, 152)");
	expect(await color("true")).toBe("rgb(242, 177, 131)");
	expect(await color("/* unfinished")).toBe("rgb(145, 160, 152)");
	await page.locator("#editor").fill('module shape() {\n  echo("unfinished');
	await page.keyboard.press("End"); await page.keyboard.type('");\n}');
	await expectEditor(page).toBe('module shape() {\n  echo("unfinished");\n}');
	expect(errors).toEqual([]);
});

test("Enter, Tab and Shift+Tab use two spaces, with undo and redo", async ({ page }) => {
	await page.locator("#editor").fill("module shape() {}");
	await select(page, 16);
	await page.keyboard.press("Enter");
	await expectEditor(page).toBe("module shape() {\n  \n}");
	await expect(page.locator("#cursor-position")).toHaveText("Ln 2, Col 3");
	await page.keyboard.press("ControlOrMeta+z");
	await expectEditor(page).toBe("module shape() {}");
	await page.keyboard.press("ControlOrMeta+y");
	await expectEditor(page).toBe("module shape() {\n  \n}");
	await page.locator("#editor").fill("cube(2);\nsphere(1);");
	await select(page, 0, 19);
	await page.keyboard.press("Tab");
	await expectEditor(page).toBe("  cube(2);\n  sphere(1);");
	await page.keyboard.press("Shift+Tab");
	await expectEditor(page).toBe("cube(2);\nsphere(1);");
	await page.keyboard.press("Escape"); await page.keyboard.press("Tab");
	await expect(page.locator("#editor")).not.toBeFocused();
});

test("matching brackets and active line follow selection, and Ctrl+Enter previews", async ({ page }) => {
	await page.locator("#editor").fill("cube([2, 3, 4]);");
	await select(page, 5);
	await expect(page.locator(".cm-matchingBracket")).toHaveCount(2);
	await expect(page.locator(".cm-activeLine")).toHaveText("cube([2, 3, 4]);");
	await page.keyboard.press("ControlOrMeta+Enter");
	await expect(page.locator("#status")).toHaveText("READY");
	expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(24);
	await expect(page.locator("#preview-state")).toBeHidden();
});

test("switching sources restores each cursor and undo history", async ({ page }) => {
	await page.locator("#project-files-input").setInputFiles(sources);
	await expect(page.locator("#status")).toHaveText("READY");
	await select(page, 0);
	await page.keyboard.type("// main");
	await page.locator("#source-select").selectOption("part.scad");
	await select(page, 0);
	await page.keyboard.type("// part");
	await page.locator("#source-select").selectOption("main.scad");
	expect(await editorSelection(page)).toBe(7);
	await page.locator("#editor").focus(); await page.keyboard.press("ControlOrMeta+z");
	await expectEditor(page).toBe("use <part.scad> shape();");
	await page.locator("#source-select").selectOption("part.scad");
	expect(await editorSelection(page)).toBe(7);
	await expectEditor(page).toBe("// partmodule shape() { cube(2); }");
	await page.locator("#editor").focus(); await page.keyboard.press("ControlOrMeta+z");
	await expectEditor(page).toBe("module shape() { cube(2); }");
});

test("project replacement resets history and formatting is undoable", async ({ page }) => {
	await page.locator("#editor").fill("cube(2);  \n");
	await page.locator("#format-button").click();
	await expectEditor(page).toBe("cube(2);\n");
	await page.locator("#editor").focus(); await page.keyboard.press("ControlOrMeta+z");
	await expectEditor(page).toBe("cube(2);  \n");
	page.once("dialog", (dialog) => dialog.accept());
	await page.locator("#example-select").selectOption("basics");
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#editor").focus(); await page.keyboard.press("ControlOrMeta+z");
	await expectEditor(page).toContain("// Core primitives");
});

test("errors and warnings mark only their source and edits invalidate old markers", async ({ page }) => {
	await page.locator("#project-files-input").setInputFiles([
		{ ...sources[0], buffer: Buffer.from("include <part.scad>\ncube(2);") },
		{ ...sources[1], buffer: Buffer.from("echo(missing);") },
	]);
	await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator(".cm-lintRange-warning")).toHaveCount(0);
	await page.locator("#error-panel .source-location").click();
	await expect(page.locator(".cm-lintRange-warning")).toHaveCount(1);
	await expect(page.locator(".cm-lint-marker-warning")).toHaveCount(1);
	await page.locator("#source-select").selectOption("main.scad");
	await expect(page.locator(".cm-lintRange-warning")).toHaveCount(0);
	await page.locator("#source-select").selectOption("part.scad");
	await expect(page.locator(".cm-lintRange-warning")).toHaveCount(1);
	await page.locator("#editor").fill("echo(1);");
	await expect(page.locator(".cm-lintRange-warning")).toHaveCount(0);
	await page.locator("#source-select").selectOption("main.scad");
	await page.locator("#editor").fill("cube(");
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator(".cm-lint-marker-error")).toHaveCount(1);
	await expect(page.locator(".cm-lintPoint-error")).toHaveCount(1);
	await page.locator("#error-panel .source-location").first().click();
	expect(await editorSelection(page)).toBe(5);
	await page.keyboard.type("2);");
	await expect(page.locator(".cm-lint-marker-error")).toHaveCount(0);
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("READY");
});

test("exports freeze the real editor and restore editing after cancellation", async ({ page }) => {
	await page.getByRole("tab", { name: "Animation", exact: true }).click();
	await page.locator("#animation-steps").fill("1000"); await page.locator("#animation-steps").dispatchEvent("change");
	const before = await page.evaluate(async () => (await import("/openscad.js")).editor.value);
	await page.locator("#animation-export").click();
	await expect(page.locator("#editor")).toHaveAttribute("contenteditable", "false");
	await select(page, 0);
	await page.keyboard.type("not editable");
	await expectEditor(page).toBe(before);
	await page.locator("#cancel-button").click();
	await expect(page.locator("#status")).toHaveText("CANCELLED");
	await expect(page.locator("#editor")).toHaveAttribute("contenteditable", "true");
	await page.locator("#editor").focus(); await page.keyboard.type("// editable\n");
	await expectEditor(page).toContain("// editable");
});

test("desktop and mobile pane resizing keeps scrolling and source selection usable", async ({ page }) => {
	const source = "// " + "long-line ".repeat(100) + "\n" + "cube(2);\n".repeat(150);
	await page.locator("#editor").fill(source);
	for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
		await page.setViewportSize(size);
		const divider = page.getByRole("separator");
		await divider.focus();
		await page.keyboard.press(size.width > 760 ? "Shift+ArrowRight" : "Shift+ArrowDown");
		await select(page, source.length);
		await expect(page.locator("#cursor-position")).toHaveText("Ln 152, Col 1");
		await expect.poll(() => page.locator(".cm-scroller").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		const scroller = await page.locator(".cm-scroller").boundingBox(), pane = await page.locator(".editor-wrap").boundingBox();
		expect(scroller.height).toBeLessThanOrEqual(pane.height + 1);
		await expectEditor(page).toBe(source);
	}
});
