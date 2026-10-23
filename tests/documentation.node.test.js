import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);

test("repository Markdown links point to existing local files", async () => {
	const { stdout } = await exec("git", ["ls-files", "--", "*.md"], { cwd: root });
	const documents = new Set([...stdout.trim().split("\n"), "RELEASE_CHECKLIST.md"]);
	const missing = [];
	for (const name of documents) {
		// The distribution README is a template whose links resolve in dist/.
		if (!name || name === "scripts/distribution/README.md" || name.startsWith("licenses/")) continue;
		const contents = await readFile(path.join(root, name), "utf8");
		for (const [, raw] of contents.matchAll(/\]\(([^)\n]+)\)/g)) {
			const destination = raw.replace(/^<|>$/g, "").split("#")[0];
			if (!destination || /^[a-z][a-z0-9+.-]*:/i.test(destination)) continue;
			const target = path.resolve(root, path.dirname(name), decodeURIComponent(destination));
			try { await access(target); }
			catch (error) {
				if (error.code !== "ENOENT") throw error;
				missing.push(`${name}: ${destination}`);
			}
		}
	}
	assert.deepEqual(missing, [], "Broken local Markdown links (initialize the reference submodule if needed)");
});
