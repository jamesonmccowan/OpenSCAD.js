import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_FACES } from "../src/geometry/text.js";
import { buildEditor } from "./build-editor.js";
import { verifyRuntimeProvenance } from "./verify-runtime-provenance.js";
import { bundlePackages, retainPackageLicense } from "./package-licenses.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
const staging = path.join(root, `.dist-build-${process.pid}`);
const packages = ["manifold-3d", "three", "earcut", "opentype.js", "lucide", "fflate", "@fontsource/dm-mono", "@fontsource/manrope"];
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageDirectories = new Set(packages.map((name) => path.join(root, "node_modules", name)));

async function buildTracked(options) {
	const result = await build({ ...options, absWorkingDir: root, metafile: true });
	for (const { directory } of await bundlePackages(result.metafile, root)) packageDirectories.add(directory);
}

function rewrite(source, before, after) {
	if (!source.includes(before)) throw new Error(`Distribution input no longer contains ${before}`);
	return source.replaceAll(before, after);
}

async function copy(source, target) {
	await mkdir(path.dirname(path.join(staging, target)), { recursive: true });
	await cp(path.join(root, source), path.join(staging, target));
}

async function emit(file, contents) {
	await mkdir(path.dirname(path.join(staging, file)), { recursive: true });
	await writeFile(path.join(staging, file), contents);
}

async function rewriteFile(file, replacements) {
	let source = await readFile(path.join(staging, file), "utf8");
	for (const [before, after] of replacements) source = rewrite(source, before, after);
	await writeFile(path.join(staging, file), source);
}

async function files(directory, prefix = "") {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const name = path.posix.join(prefix, entry.name);
		if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), name));
		else if (entry.isFile()) result.push(name);
		else throw new Error(`Unexpected nonregular distribution entry: ${name}`);
	}
	return result.sort();
}

try {
	await verifyRuntimeProvenance();
	for (const { directory } of await buildEditor()) packageDirectories.add(directory);
	await mkdir(staging);
	for (const file of await files(path.join(root, "src"))) {
		if (["studio/editor.js", "studio/scad-language.js"].includes(file)) continue;
		if (/\.(?:js|d\.ts|wasm|txt)$/.test(file)) await copy(`src/${file}`, `src/${file}`);
	}
	for (const file of ["index.html", "openscad.js", "bin/openscad-js.js", "LICENSE", "THIRD_PARTY_NOTICES.md"]) await copy(file, file);
	for (const file of await files(path.join(root, "licenses/wasm"))) await copy(`licenses/wasm/${file}`, `licenses/wasm/${file}`);
	for (const file of await files(path.join(root, "licenses/javascript"))) await copy(`licenses/javascript/${file}`, `licenses/javascript/${file}`);
	await copy("scripts/distribution/README.md", "README.md");
	await copy("scripts/distribution/demo.html", "demo.html");
	for (const size of [16, 32, 128]) await copy(`branding/icon-${size}.png`, `assets/branding/icon-${size}.png`);
	await mkdir(path.join(staging, "vendor"));
	for (const [name, entry] of [
		["earcut", "earcut/src/earcut.js"],
		["opentype", "opentype.js/dist/opentype.js"],
		["fflate", "fflate/esm/browser.js"],
		["three", "three/build/three.module.js"],
	]) {
		await buildTracked({ entryPoints: [path.join(root, "node_modules", entry)], outfile: path.join(staging, "vendor", `${name}.js`), bundle: true, format: "esm", platform: "neutral", external: ["fs"], target: "es2022", minify: true, legalComments: "external" });
	}
	await buildTracked({
		entryPoints: [path.join(root, "src/viewer/viewer.js")], outfile: path.join(staging, "src/viewer/viewer.js"),
		bundle: true, format: "esm", platform: "neutral", target: "es2022", minify: true, legalComments: "external",
		plugins: [{ name: "shared-three", setup(builder) { builder.onResolve({ filter: /^three$/ }, () => ({ path: "../../vendor/three.js", external: true })); } }],
	});
	await copy("node_modules/manifold-3d/manifold.js", "vendor/manifold.js");
	await copy("node_modules/manifold-3d/manifold.wasm", "vendor/manifold.wasm");
	await copy("node_modules/lucide/dist/umd/lucide.js", "vendor/lucide.js");
	for (const face of FONT_FACES) await copy(`references/openscad/fonts/Liberation-2.00.1/ttf/${face.filename}`, `assets/fonts/${face.filename}`);
	await copy("references/openscad/fonts/Liberation-2.00.1/LICENSE", "licenses/Liberation.LICENSE");
	await buildTracked({
		stdin: { contents: '@import "@fontsource/dm-mono/latin-400.css";\n@import "@fontsource/manrope/latin-500.css";\n@import "@fontsource/manrope/latin-700.css";', resolveDir: root, loader: "css" },
		outfile: path.join(staging, "assets/fonts.css"), bundle: true, minify: true,
		loader: { ".woff": "file", ".woff2": "file" }, assetNames: "fonts/[name]-[hash]", legalComments: "external",
	});
	await rewriteFile("src/core/service.js", [['import("manifold-3d")', 'import("../../vendor/manifold.js")']]);
	await rewriteFile("src/core/worker-engine.js", [["../../node_modules/manifold-3d/manifold.js", "../../vendor/manifold.js"]]);
	await rewriteFile("src/node/cli.js", [['new URL("../../package.json", import.meta.url)', 'new URL("../../../../package.json", import.meta.url)']]);
	await rewriteFile("src/geometry/text.js", [
		["../../references/openscad/fonts/Liberation-2.00.1/ttf/", "../../assets/fonts/"],
	]);
	await rewriteFile("src/geometry/font-data.js", [["../../node_modules/opentype.js/dist/opentype.js", "../../vendor/opentype.js"]]);
	for (const file of ["src/geometry/roof.js", "src/geometry/polyhedron.js"]) await rewriteFile(file, [["../../node_modules/earcut/src/earcut.js", "../../vendor/earcut.js"]]);
	await rewriteFile("openscad.js", [
		["./node_modules/fflate/esm/browser.js", "./vendor/fflate.js"],
		["./node_modules/manifold-3d/manifold.js", "./vendor/manifold.js"],
	]);
	await rewriteFile("index.html", [
		["./branding/", "./assets/branding/"],
		['{ "imports": { "three": "./node_modules/three/build/three.module.js", "three/addons/": "./node_modules/three/examples/jsm/" } }', '{ "imports": { "three": "./vendor/three.js" } }'],
		["./node_modules/lucide/dist/umd/lucide.js", "./vendor/lucide.js"],
		["./node_modules/@fontsource/dm-mono/latin-400.css", "./assets/fonts.css"],
		['    <link href="./node_modules/@fontsource/manrope/latin-500.css" rel="stylesheet">\n', ""],
		['    <link href="./node_modules/@fontsource/manrope/latin-700.css" rel="stylesheet">\n', ""],
	]);
	const runtime = "openscad.js/runtime";
	// Keep relative relationships inside the runtime; only public entries know its layout.
	await rename(path.join(staging, "openscad.js"), path.join(staging, "studio.js"));
	await mkdir(path.join(staging, runtime), { recursive: true });
	for (const name of ["src", "vendor", "assets"]) await rename(path.join(staging, name), path.join(staging, runtime, name));
	await rename(path.join(staging, "studio.js"), path.join(staging, runtime, "studio.js"));
	await rewriteFile("index.html", [
		["./vendor/", `./${runtime}/vendor/`],
		["./assets/", `./${runtime}/assets/`],
		['src="openscad.js"', `src="./${runtime}/studio.js"`],
	]);
	await cp(path.join(staging, "index.html"), path.join(staging, "editor.html"));
	await cp(path.join(staging, "bin/openscad-js.js"), path.join(staging, "openscad.js/cli.js"));
	await rewriteFile("openscad.js/cli.js", [["../src/node/cli.js", "./runtime/src/node/cli.js"]]);
	await emit("bin/openscad-js.js", '#!/usr/bin/env node\nimport "../openscad.js/cli.js";\n');
	for (const [entry, target] of [
		["core", "index.js"], ["viewer", "viewer/viewer.js"], ["preview", "preview/preview.js"],
	]) {
		await emit(`openscad.js/${entry}.js`, `export * from "./runtime/src/${target}";\n`);
		await emit(`openscad.js/${entry}.d.ts`, `export * from "./runtime/src/${target}";\n`);
	}
	await emit("src/index.js", 'export * from "../openscad.js/core.js";\n');
	await emit("src/index.d.ts", 'export * from "../openscad.js/core.js";\n');
	await emit("src/viewer/viewer.js", 'export * from "../../openscad.js/viewer.js";\n');
	await emit("src/viewer/viewer.d.ts", 'export * from "../../openscad.js/viewer.js";\n');
	await emit("vendor/manifold.js", 'export { default } from "../openscad.js/runtime/vendor/manifold.js";\n');
	await cp(path.join(staging, runtime, "vendor/manifold.wasm"), path.join(staging, "vendor/manifold.wasm"));
	const dependencies = [];
	for (const directory of [...packageDirectories].sort()) {
		const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
		const name = metadata.name;
		const primary = directory === path.join(root, "node_modules", name);
		if (primary && manifest.dependencies[name] && metadata.version !== manifest.dependencies[name]) throw new Error(`Installed ${name} does not match the pinned dependency`);
		const licenseDirectory = `licenses/${name.replaceAll("/", "-")}${primary ? "" : `@${metadata.version}`}`;
		dependencies.push({ ...await retainPackageLicense(directory, path.join(staging, licenseDirectory)), licenseDirectory });
	}
	const { scripts, dependencies: unusedDependencies, devDependencies, ...metadata } = manifest;
	const exports = {
		".": { types: "./openscad.js/core.d.ts", import: "./openscad.js/core.js" },
		"./worker": `./${runtime}/src/core/worker-entry.js`,
		"./viewer": { types: "./openscad.js/viewer.d.ts", import: "./openscad.js/viewer.js" },
		"./preview": { types: "./openscad.js/preview.d.ts", import: "./openscad.js/preview.js" },
		"./node": { types: `./${runtime}/src/node/filesystem.d.ts`, import: `./${runtime}/src/node/filesystem.js` },
		"./node/fonts": { types: `./${runtime}/src/node/fonts.d.ts`, import: `./${runtime}/src/node/fonts.js` },
	};
	await writeFile(path.join(staging, "package.json"), JSON.stringify({
		...metadata, exports, types: "./openscad.js/core.d.ts", bin: { "openscad-js": "./openscad.js/cli.js" },
		scripts: { cli: "node openscad.js/cli.js" }, dependencies: {},
	}, null, 2) + "\n");
	const inventory = [];
	for (const file of await files(staging)) {
		const bytes = await readFile(path.join(staging, file));
		inventory.push({ path: file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
	}
	await writeFile(path.join(staging, "distribution-manifest.json"), JSON.stringify({ version: manifest.version, dependencies, files: inventory }, null, 2) + "\n");
	await rm(output, { recursive: true, force: true });
	await rename(staging, output);
	console.log(`Built dist/: ${inventory.length + 1} files, ${(inventory.reduce((total, file) => total + file.bytes, 0) / 1048576).toFixed(2)} MiB plus manifest`);
} finally {
	await rm(staging, { recursive: true, force: true });
}