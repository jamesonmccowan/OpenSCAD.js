import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function bundlePackages(metafile, workingDirectory) {
	const packages = new Map();
	for (const input of Object.keys(metafile.inputs)) {
		if (!input.replaceAll("\\", "/").includes("node_modules/")) continue;
		let directory = path.dirname(path.resolve(workingDirectory, input));
		while (directory !== path.dirname(directory)) {
			if (!directory.replaceAll("\\", "/").includes("/node_modules/")) {
				throw new Error(`Cannot identify bundled package for ${input}`);
			}
			let metadata;
			try {
				metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			if (metadata?.name && metadata.version) {
				packages.set(directory, { directory, metadata });
				break;
			}
			directory = path.dirname(directory);
		}
		if (directory === path.dirname(directory)) throw new Error(`Cannot identify bundled package for ${input}`);
	}
	return [...packages.values()].sort((first, second) => first.directory.localeCompare(second.directory));
}

export async function retainPackageLicense(directory, output) {
	const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
	const files = (await readdir(directory, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && /^(?:license|copying|notice)(?:[.-]|$)/i.test(entry.name))
		.map((entry) => entry.name).sort();
	if (!files.length) throw new Error(`No license/notice found for ${metadata.name}@${metadata.version}`);
	await mkdir(output, { recursive: true });
	const licenses = [];
	for (const file of files) {
		const bytes = await readFile(path.join(directory, file));
		await writeFile(path.join(output, file), bytes);
		licenses.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
	}
	return {
		name: metadata.name, version: metadata.version, license: metadata.license,
		source: typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url ?? metadata.homepage,
		licenses,
	};
}
