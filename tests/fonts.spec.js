import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { runtimeFont } from "./helpers/fonts.js";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";

const bytes = await runtimeFont("Bold Italic");
const source = 'linear_extrude(1) text("Arial",font="Runtime Test Sans:style=Bold Italic");';

for (const base of ["/", "/dist/"]) test(`font file picker enables a missing face for preview and STL export at ${base}`, async ({ page }) => {
	await page.goto(base);
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#auto-preview").uncheck();
	await page.locator("#editor").fill(source);
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator("#error-panel")).toContainText("was not found");
	await expect(page.getByRole("note", { name: "Font help" })).toBeVisible();
	await expect(page.locator("#font-help")).toContainText('font="Liberation Sans:style=Bold Italic"');
	await page.locator("#font-help summary").click();
	await expect(page.locator("#font-help code")).toHaveCount(12);
	const picker = page.waitForEvent("filechooser");
	await page.locator("#font-help").getByRole("button", { name: "Load font files", exact: true }).click();
	await (await picker).setFiles({ name: "runtime.otf", mimeType: "font/otf", buffer: Buffer.from(bytes) });
	await expect(page.locator("#status")).toHaveText("READY");
	await expect(page.locator("#font-help")).toBeHidden();
	await expect(page.locator("#font-info")).toContainText("1 loaded");
	const download = page.waitForEvent("download");
	await page.locator("#download-button").click();
	const mesh = measureMesh(decodeBinaryStl(await readFile(await (await download).path())));
	expect(mesh.volume).toBeGreaterThan(0);
	expect(mesh.closed).toBe(true);
});

test("local font access is opt-in and resolves the selected face lazily", async ({ page }) => {
	await page.addInitScript(data => {
		window.fontQueries = 0;
		window.fontReads = 0;
		window.queryLocalFonts = async () => {
			window.fontQueries++;
			return [{ family: "Runtime Test Sans", style: "Bold Italic", blob: async () => {
				window.fontReads++;
				return new Blob([new Uint8Array(data)]);
			} }];
		};
	}, Array.from(bytes));
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY");
	expect(await page.evaluate(() => window.fontQueries)).toBe(0);
	await page.getByRole("button", { name: "Use local fonts", exact: true }).click();
	await expect(page.locator("#font-info")).toContainText("1 local");
	await expect(page.locator("#status")).toHaveText("READY");
	expect(await page.evaluate(() => window.fontReads)).toBe(0);
	await page.locator("#auto-preview").uncheck();
	await page.locator("#editor").fill(source);
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("READY");
	expect(await page.evaluate(() => window.fontReads)).toBe(1);
});

test("local-font permission denial and malformed files surface errors without replacing geometry", async ({ page }) => {
	await page.addInitScript(() => { window.queryLocalFonts = async () => { throw new Error("Font permission denied"); }; });
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY");
	const volume = await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume);
	await page.getByRole("button", { name: "Use local fonts", exact: true }).click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator("#error-panel")).toContainText("Font permission denied");
	await expect(page.locator("#font-help")).toContainText("permission");
	await expect(page.locator("#font-help").getByRole("button", { name: "Use local fonts", exact: true })).toBeVisible();
	await page.locator("#font-files-input").setInputFiles({ name: "bad.ttf", mimeType: "font/ttf", buffer: Buffer.from("invalid") });
	await expect(page.locator("#error-panel")).toContainText("Unsupported OpenType signature");
	expect(await page.evaluate(async () => (await import("/openscad.js")).viewer.stats().volume)).toBe(volume);
});

for (const secure of [true, false]) test(`font help explains unavailable local font access with secure context ${secure}`, async ({ page }) => {
	await page.addInitScript(value => {
		Object.defineProperty(window, "isSecureContext", { value });
		Object.defineProperty(window, "queryLocalFonts", { value: undefined });
	}, secure);
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY");
	await page.locator("#auto-preview").uncheck();
	await page.locator("#editor").fill(source);
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).toHaveText("ERROR");
	await expect(page.locator("#font-help")).toContainText(secure ? "does not expose local font access" : "HTTPS or localhost");
	await expect(page.locator("#font-help").getByRole("button", { name: "Use local fonts", exact: true })).toHaveCount(0);
	await page.locator("#editor").fill("cube(;");
	await page.locator("#render-button").click();
	await expect(page.locator("#error-panel")).not.toContainText("was not found");
	await expect(page.locator("#font-help")).toBeHidden();
});
