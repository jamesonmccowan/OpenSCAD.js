import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const fixtureUrl = new URL("fixtures/doughnut.scad", import.meta.url);

async function render(page, source) {
	await page.locator("#editor").fill(source);
	await page.locator("#render-button").click();
	await expect(page.locator("#status")).not.toHaveText("COMPILING");
	return {
		status: await page.locator("#status").textContent(),
		info: await page.locator("#scene-info").textContent(),
		error: await page.locator("#error-panel").textContent(),
	};
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#status")).toHaveText("READY");
});

test("compiles the project author's doughnut regression model", async ({ page }) => {
	const source = await readFile(fixtureUrl, "utf8");
	const result = await render(page, source);

	expect(result.status).toBe("READY");
	expect(result.error).toBe("");
	expect(result.info).toMatch(/^3 meshes/);
});

test("resolves a module declared after its call", async ({ page }) => {
	const result = await render(page, "shape(); module shape() { cube(10); }");

	expect(result.status).toBe("READY");
	expect(result.info).toMatch(/^1 mesh/);
});

test("evaluates built-in functions in expressions", async ({ page }) => {
	const result = await render(page, "a = asin(0.5); rotate([0, 0, a]) cube(10);");

	expect(result.status).toBe("READY");
	expect(result.info).toMatch(/^1 mesh/);
});

test("renders background geometry without using it as a boolean operand", async ({ page }) => {
	const result = await render(page, `difference() {
		cube([10, 10, 10]);
		%translate([2, 2, 2]) cube([2, 2, 12]);
	}`);

	expect(result.status).toBe("READY");
	expect(result.info).toMatch(/^2 meshes/);
});

test("all bundled examples compile", async ({ page }) => {
	for (const example of ["bracket", "tower", "rings", "basics"]) {
		await page.locator("#example-select").selectOption(example);
		await expect(page.locator("#status")).toHaveText("READY");
		await expect(page.locator("#error-panel")).not.toHaveClass(/visible/);
	}
});

test("reports malformed source with a location", async ({ page }) => {
	const result = await render(page, "difference() { cube(10);");

	expect(result.status).toBe("ERROR");
	expect(result.error).toMatch(/Expected '}'[\s\S]*line 1, column 25/);
});