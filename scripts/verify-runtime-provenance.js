import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export function verifyRuntimeHash(bytes, expected, label) {
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expected) throw new Error(`${label}: runtime provenance hash mismatch; review the changed asset and its notices before updating licenses/wasm/provenance.json`);
}

export async function verifyRuntimeProvenance() {
	const directory = path.join(root, "licenses/wasm");
	const provenance = JSON.parse(await readFile(path.join(directory, "provenance.json"), "utf8"));
	for (const [name, version] of Object.entries(provenance.packages)) {
		const metadata = JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"));
		if (metadata.version !== version) throw new Error(`${name}: runtime provenance version mismatch; review the new dependency before packaging`);
	}
	for (const input of provenance.inputs) {
		verifyRuntimeHash(await readFile(path.join(root, input.path)), input.sha256, input.path);
	}
	for (const file of provenance.files) {
		verifyRuntimeHash(await readFile(path.join(directory, file.path)), file.sha256, file.path);
	}
	return provenance;
}
