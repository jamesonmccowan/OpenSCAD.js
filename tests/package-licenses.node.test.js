import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bundlePackages, retainPackageLicense } from "../scripts/package-licenses.js";

test("license discovery preserves actual nested/scoped package roots and versions", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "openscad-package-licenses-"));
	try {
		for (const [directory, version] of [["node_modules/@scope/example", "1.0.0"], ["extension/node_modules/@scope/example", "2.0.0"]]) {
			const location = path.join(root, directory);
			await mkdir(path.join(location, "dist"), { recursive: true });
			await writeFile(path.join(location, "package.json"), JSON.stringify({ name: "@scope/example", version, license: "MIT" }));
			await writeFile(path.join(location, "dist/package.json"), JSON.stringify({ type: "module" }));
			await writeFile(path.join(location, "LICENSE-MIT.txt"), "MIT fixture license\n");
			await writeFile(path.join(location, "NOTICE"), "Fixture attribution\n");
		}
		const packages = await bundlePackages({ inputs: {
			"node_modules/@scope/example/dist/index.js": {},
			"extension/node_modules/@scope/example/dist/index.js": {},
			"src/local.js": {},
		} }, root);
		assert.equal(packages.length, 2);
		assert.deepEqual(packages.map(({ metadata }) => metadata.version).sort(), ["1.0.0", "2.0.0"]);
		for (const { directory, metadata } of packages) {
			const output = path.join(root, "licenses", metadata.version);
			const record = await retainPackageLicense(directory, output);
			assert.deepEqual(record.licenses.map(({ file }) => file), ["LICENSE-MIT.txt", "NOTICE"]);
			assert.equal(await readFile(path.join(output, "LICENSE-MIT.txt"), "utf8"), "MIT fixture license\n");
			assert.match(record.licenses[0].sha256, /^[a-f0-9]{64}$/);
		}
		await mkdir(path.join(root, "unlicensed"));
		await writeFile(path.join(root, "unlicensed/package.json"), JSON.stringify({ name: "unlicensed", version: "1" }));
		await assert.rejects(retainPackageLicense(path.join(root, "unlicensed"), path.join(root, "output")), /No license\/notice found/);
		await assert.rejects(bundlePackages({ inputs: { "missing/node_modules/example/index.js": {} } }, root), /Cannot identify bundled package/);
	} finally { await rm(root, { recursive: true, force: true }); }
});
