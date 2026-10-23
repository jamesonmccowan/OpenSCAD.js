import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	testIgnore: "**/*.node.test.js",
	fullyParallel: true,
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{
			name: "firefox",
			use: {
				browserName: "firefox",
				launchOptions: {
					// Xvfb/Mesa can provide WebGL2 even when Firefox's graphics blocklist rejects it.
					firefoxUserPrefs: { "webgl.force-enabled": true },
				},
			},
		},
		{ name: "webkit", use: { browserName: "webkit" } },
	],
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: "http://127.0.0.1:4173",
		headless: true,
		trace: "retain-on-failure",
	},
	webServer: {
		command: "python3 -m http.server 4173",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: !process.env.CI && !process.env.OPENSCAD_RELEASE_CHECK,
	},
});