import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const exec = promisify(execFile);

async function files(directory) {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await files(filename));
		else if (entry.isFile()) result.push(filename);
		else throw new Error(`Unexpected release entry: ${filename}`);
	}
	return result.sort();
}

export async function verifyVsix(filename) {
	const entries = unzipSync(await readFile(filename));
	const manifest = JSON.parse(Buffer.from(entries["extension/package.json"]).toString());
	const expected = JSON.parse(await readFile(path.join(root, "extension/package.json"), "utf8"));
	assert.equal(manifest.name, expected.name);
	assert.equal(manifest.version, expected.version);
	assert.equal(manifest.publisher, expected.publisher);
	for (const field of ["description", "author", "repository", "homepage", "bugs", "keywords"]) assert.deepEqual(manifest[field], expected[field], field);
	for (const name of Object.keys(entries)) {
		assert.ok(!/(^|\/)(?:node_modules|\.occt-cache|tests|webview|scripts|robot|references)(\/|$)/.test(name), `Unexpected VSIX payload: ${name}`);
	}
	for (const directory of ["licenses", "media", "src", "examples", "syntaxes"]) {
		const prefix = path.join(root, "extension");
		const expectedNames = [];
		for (const file of await files(path.join(prefix, directory))) {
			const name = `extension/${path.relative(prefix, file).replaceAll("\\", "/")}`;
			expectedNames.push(name);
			assert.ok(entries[name], `Missing VSIX file: ${name}`);
			assert.equal(hash(entries[name]), hash(await readFile(file)), name);
		}
		assert.deepEqual(Object.keys(entries).filter(name => name.startsWith(`extension/${directory}/`) && !name.endsWith("/")).sort(), expectedNames.sort());
	}
	for (const [source, target] of [["LICENSE", "LICENSE.txt"], ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"], ["OCCT-SOURCES.txt", "OCCT-SOURCES.txt"]]) {
		assert.equal(hash(entries[`extension/${target}`]), hash(await readFile(path.join(root, "extension", source))), target);
	}
	const readme = Buffer.from(entries["extension/readme.md"]).toString();
	const sourceReadme = await readFile(path.join(root, "extension/README.md"), "utf8");
	const base = /--baseContentUrl (\S+)/.exec(expected.scripts.package)?.[1];
	assert.ok(base, "Packaging must specify the extension subdirectory link base");
	const packagedLinks = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(([, destination]) => new URL(destination, base + "/").href);
	for (const [, destination] of sourceReadme.matchAll(/\]\(([^)\s]+)\)/g)) {
		if (/^(?:https?:|#)/.test(destination)) continue;
		const absolute = new URL(destination, base + "/").href;
		assert.ok(packagedLinks.includes(absolute), `Missing rewritten README link: ${absolute}`);
	}
	assert.ok(!/\]\((?:\.\.?\/|[A-Za-z_-]+\.md)/.test(readme), "Packaged README must not retain relative documentation links");
	const inventory = JSON.parse(Buffer.from(entries["extension/licenses/bundled-packages.json"]).toString());
	for (const bundle of inventory.bundles) for (const output of bundle.outputs) {
		assert.equal(hash(entries[`extension/${output.file}`]), output.sha256, output.file);
	}
	return { files: Object.keys(entries).length, bundles: inventory.bundles.length, packages: inventory.packages.length };
}

export async function verifyStandalone(filename) {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-release-archive-"));
	try {
		await exec("tar", ["-xzf", filename, "-C", directory]);
		const packaged = path.join(directory, "package");
		const manifestBytes = await readFile(path.join(packaged, "distribution-manifest.json"));
		assert.deepEqual(manifestBytes, await readFile(path.join(root, "dist/distribution-manifest.json")));
		const inventory = JSON.parse(manifestBytes);
		const names = (await files(packaged)).map(file => path.relative(packaged, file).replaceAll("\\", "/")).sort();
		assert.deepEqual(names, [...inventory.files.map(file => file.path), "distribution-manifest.json"].sort());
		for (const file of inventory.files) {
			const bytes = await readFile(path.join(packaged, file.path));
			assert.equal(bytes.length, file.bytes, file.path);
			assert.equal(hash(bytes), file.sha256, file.path);
		}
		return { files: names.length, dependencies: inventory.dependencies.length };
	} finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const filename = process.argv[2];
	if (!filename || !/\.(?:vsix|tgz)$/.test(filename)) throw new Error("Usage: node scripts/verify-release-artifacts.js <extension.vsix|standalone.tgz>");
	console.log("Verified archive:", await (filename.endsWith(".vsix") ? verifyVsix : verifyStandalone)(path.resolve(filename)));
}
