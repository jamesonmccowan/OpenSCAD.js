import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { decodeBinaryStl, measureMesh } from "./helpers/backend.js";
import { verifyRuntimeHash, verifyRuntimeProvenance } from "../scripts/verify-runtime-provenance.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test("runtime provenance verifies reviewed inputs and rejects changed assets", async () => {
	const provenance = await verifyRuntimeProvenance();
	assert.equal(provenance.manifold.revision, "ce50d78021d64507f89e8c9fc2c2e51018117857");
	assert.equal(provenance.roof.voronoiRebuildByteIdentical, true);
	assert.equal(provenance.roof.straightSkeletonRebundleByteIdentical, true);
	assert.throws(() => verifyRuntimeHash(Buffer.from("changed"), provenance.inputs[0].sha256, "changed runtime"), /changed runtime: runtime provenance hash mismatch/);
});

test("standalone distribution packs and installs offline with API, worker, viewer, CLI, fonts and both WASM kernels", { timeout: 90_000 }, async () => {
	await exec(process.execPath, ["scripts/build-distribution.js"], { cwd: root });
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-distribution-"));
	try {
		const manifestBytes = await readFile(path.join(root, "dist/distribution-manifest.json"), "utf8");
		const inventory = JSON.parse(manifestBytes);
		await exec(process.execPath, ["scripts/build-distribution.js"], { cwd: root });
		assert.equal(await readFile(path.join(root, "dist/distribution-manifest.json"), "utf8"), manifestBytes, "Repeated builds must have identical inventories");
		for (const file of inventory.files) {
			assert.ok(!/(^|\/)(?:node_modules|references|tests)(\/|$)/.test(file.path), file.path);
			const bytes = await readFile(path.join(root, "dist", file.path));
			assert.equal(bytes.length, file.bytes, file.path);
			assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
		}
		const runtimeProvenance = JSON.parse(await readFile(path.join(root, "licenses/wasm/provenance.json"), "utf8"));
		for (const file of ["provenance.json", ...runtimeProvenance.files.map((file) => file.path)]) {
			assert.ok(inventory.files.some((entry) => entry.path === `licenses/wasm/${file}`), `Missing embedded-component notice/evidence: ${file}`);
			assert.deepEqual(await readFile(path.join(root, "dist/licenses/wasm", file)), await readFile(path.join(root, "licenses/wasm", file)));
		}
		for (const dependency of inventory.dependencies) {
			for (const license of dependency.licenses) {
				const filename = `${dependency.licenseDirectory}/${license.file}`;
				const shipped = await readFile(path.join(root, "dist", filename));
				assert.deepEqual(shipped, await readFile(path.join(root, "node_modules", dependency.name, license.file)));
				assert.equal(createHash("sha256").update(shipped).digest("hex"), license.sha256);
			}
		}
		for (const file of ["Feather.LICENSE", "tiny-inflate.LICENSE", "codepointat.LICENSE", "tinf.LICENSE"]) {
			assert.deepEqual(await readFile(path.join(root, "dist/licenses/javascript", file)), await readFile(path.join(root, "licenses/javascript", file)));
		}
		const fonts = path.join(root, "dist/openscad.js/runtime/assets/fonts");
		const originalFonts = [];
		for (const name of ["@fontsource/dm-mono", "@fontsource/manrope"]) {
			for (const file of await readdir(path.join(root, "node_modules", name, "files"))) {
				if (/\.woff2?$/.test(file)) originalFonts.push(await readFile(path.join(root, "node_modules", name, "files", file)));
			}
		}
		let ttf = 0, webFonts = 0;
		for (const file of await readdir(fonts)) {
			const bytes = await readFile(path.join(fonts, file));
			if (file.endsWith(".ttf")) {
				assert.deepEqual(bytes, await readFile(path.join(root, "references/openscad/fonts/Liberation-2.00.1/ttf", file)));
				ttf++;
			} else if (/\.woff2?$/.test(file)) {
				assert.ok(originalFonts.some((source) => source.equals(bytes)), `Modified or unattributed UI font: ${file}`);
				webFonts++;
			} else assert.fail(`Unreviewed font asset: ${file}`);
		}
		assert.equal(ttf, 12);
		assert.equal(webFonts, 6);
		const editorPackages = ["@codemirror/state", "@codemirror/view", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@lezer/highlight"];
		for (const name of editorPackages) {
			assert.ok(inventory.dependencies.some((dependency) => dependency.name === name), name);
			assert.ok(inventory.files.some((file) => file.path.startsWith(`licenses/${name.replaceAll("/", "-")}/`)), name);
		}
		for (const file of ["openscad.js/core.js", "openscad.js/core.d.ts", "openscad.js/cli.js", "openscad.js/viewer.js", "openscad.js/preview.js", "openscad.js/preview.d.ts", "openscad.js/runtime/src/studio/editor-bundle.js", "demo.html", "editor.html"]) {
			assert.ok(inventory.files.some((entry) => entry.path === file), file);
		}
		assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), await readFile(path.join(root, "dist/editor.html"), "utf8"));
		for (const size of [16, 32, 128]) {
			assert.deepEqual(
				await readFile(path.join(root, `dist/openscad.js/runtime/assets/branding/icon-${size}.png`)),
				await readFile(path.join(root, `branding/icon-${size}.png`)),
			);
		}
		const packed = await exec("npm", ["pack", path.join(root, "dist"), "--ignore-scripts", "--pack-destination", directory, "--json"], { cwd: directory });
		const [artifact] = JSON.parse(packed.stdout);
		assert.deepEqual(artifact.files.map((file) => file.path).sort(), [...inventory.files.map((file) => file.path), "distribution-manifest.json"].sort(), "Packed files must exactly match the inventory");
		assert.ok(artifact.files.some((file) => file.path === "openscad.js/runtime/vendor/manifold.wasm"));
		assert.ok(artifact.files.some((file) => file.path === "openscad.js/runtime/src/geometry/roof-voronoi-wasm.wasm"));
		assert.equal(artifact.files.filter((file) => /^openscad\.js\/runtime\/assets\/fonts\/Liberation.*\.ttf$/.test(file.path)).length, 12);
		const consumer = path.join(directory, "consumer");
		await mkdir(consumer);
		await writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
		await exec("npm", ["install", path.join(directory, artifact.filename), "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: consumer });
		const installed = path.join(consumer, "node_modules/openscad-js-studio");
		const metadata = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
		assert.deepEqual(metadata.dependencies, {});
		const sourceMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
		for (const field of ["author", "description", "repository", "homepage", "bugs", "keywords", "version", "private"]) {
			assert.deepEqual(metadata[field], sourceMetadata[field], `Standalone publication metadata: ${field}`);
		}
		assert.equal(metadata.bin["openscad-js"], "./openscad.js/cli.js");
		const version = await exec(process.execPath, [path.join(installed, "bin/openscad-js.js"), "--version"], { cwd: consumer });
		assert.ok(version.stdout.startsWith(`OpenSCAD.js ${metadata.version} `));
		assert.equal((await exec(path.join(installed, "bin/openscad-js.js"), ["--version"], { cwd: consumer })).stdout, version.stdout);
		assert.equal((await exec(path.join(consumer, "node_modules/.bin/openscad-js"), ["--version"], { cwd: consumer })).stdout, version.stdout);
		const probe = await exec(process.execPath, ["--input-type=module", "-e", `
			import assert from "node:assert/strict";
			import {createEngine, createWorkerEngine} from "openscad-js-studio";
			import {Viewer} from "openscad-js-studio/viewer";
			import {createPreview} from "openscad-js-studio/preview";
			import {createFilesystemProject} from "openscad-js-studio/node";
			import {createSystemFontResolver} from "openscad-js-studio/node/fonts";
			import {createEngine as directEngine} from "./node_modules/openscad-js-studio/openscad.js/core.js";
			import {createEngine as legacyEngine} from "./node_modules/openscad-js-studio/src/index.js";
			import {Viewer as legacyViewer} from "./node_modules/openscad-js-studio/src/viewer/viewer.js";
			assert.equal(createEngine,directEngine);assert.equal(createEngine,legacyEngine);assert.equal(Viewer,legacyViewer);
			assert.ok(import.meta.resolve("openscad-js-studio/worker").endsWith("/runtime/src/core/worker-entry.js"));
			assert.equal(typeof Viewer,"function");
			assert.equal(typeof createPreview,"function");
			assert.equal(typeof createSystemFontResolver({systemFonts:false}),"function");
			const sources=['cube([1,2,3]);', 'cube([norm([3,4]),norm([3,4]),-cross([2,3],[4,5])]);', 'linear_extrude(2) text("5",size=4);', 'linear_extrude(1) text("OpenSCAD",size=4,font="Liberation Serif:style=Italic");', ...['voronoi','straight'].map(method=>'roof(method="'+method+'") difference(){square(6);translate([2,2])square(2);}')] ;
			const engines=[await createEngine(),await createWorkerEngine()];
			try {
				const reports=[];
				for(const engine of engines){
					const volumes=[];
					for(const source of sources){const result=await engine.compile({mode:"render",experimental:["roof"],files:{"main.scad":source}});assert.equal(result.status,"success",JSON.stringify(result.diagnostics));assert.ok(result.volume>0);assert.ok((await engine.export(result)).byteLength>84);volumes.push(result.volume);result.dispose();}
					reports.push(volumes);
				}
				assert.deepEqual(reports[0],reports[1]);assert.equal(reports[0][0],6);assert.equal(reports[0][1],50);
				console.log(JSON.stringify(reports));
			}finally{for(const engine of engines)await engine.dispose();}
		`], { cwd: consumer, timeout: 30_000 });
		assert.equal(JSON.parse(probe.stdout).length, 2);
		await writeFile(path.join(consumer, "consumer.mts"), `
			import { createEngine, createWorkerEngine, type CompileRequest } from "openscad-js-studio";
			import { createEngine as directEngine } from "./node_modules/openscad-js-studio/openscad.js/core.js";
			import { createEngine as legacyEngine } from "./node_modules/openscad-js-studio/src/index.js";
			import { Viewer } from "openscad-js-studio/viewer";
			import { createPreview, type PreviewOptions, type PreviewOutcome } from "openscad-js-studio/preview";
			import { createPreview as directPreview } from "./node_modules/openscad-js-studio/openscad.js/preview.js";
			import { Viewer as directViewer } from "./node_modules/openscad-js-studio/openscad.js/viewer.js";
			import { createFilesystemProject } from "openscad-js-studio/node";
			import { createSystemFontResolver } from "openscad-js-studio/node/fonts";
			const request: CompileRequest = { mode: "render", files: { "main.scad": "cube(2);" } };
			const engine = await createWorkerEngine();
			const result = await engine.compile(request);
			if (result.status === "success") { const bytes: Uint8Array = await engine.export(result); result.dispose(); }
			await engine.dispose();
			const options: PreviewOptions = { source: "cube(2);", editable: true };
			const preview = await createPreview(document.createElement("div"), options);
			const outcome: PreviewOutcome = await preview.ready;
			const volume: number | undefined = preview.state.volume;
			await preview.render(); await preview.downloadStl(); preview.stop(); await preview.dispose();
			void [directPreview, outcome, volume];
			void [createEngine, directEngine, legacyEngine, Viewer, directViewer, createFilesystemProject, createSystemFontResolver];
		`);
		await exec(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "consumer.mts"], { cwd: consumer });
		const source = path.join(consumer, "main.scad"), output = path.join(consumer, "model.stl");
		await writeFile(source, 'linear_extrude(2) text("OpenSCAD",size=4,font="Liberation Serif:style=Italic"); roof() square(2);');
		await exec(process.execPath, [path.join(installed, "openscad.js/cli.js"), source, "-o", output, "--enable=roof"], { cwd: consumer, timeout: 30_000 });
		const metrics = measureMesh(decodeBinaryStl(await readFile(output)));
		assert.ok(metrics.volume > 0);
		assert.equal(metrics.degenerateTriangles, 0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});