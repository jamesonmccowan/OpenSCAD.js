import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const generatedPaths = [
	"dist", "src/studio/editor-bundle.js", "src/studio/editor-bundle.js.LEGAL.txt",
	"extension/media", "extension/licenses", "extension/LICENSE", "extension/THIRD_PARTY_NOTICES.md",
	"test-results", "playwright-report", "extension/test-results", "extension/playwright-report",
];

export async function clean(base = new URL("../", import.meta.url)) {
	for (const name of generatedPaths) {
		await rm(new URL(name, base), { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await clean();
	console.log("Removed generated builds and test reports; dependencies, native reference, OCCT cache and release-check results retained.");
}
