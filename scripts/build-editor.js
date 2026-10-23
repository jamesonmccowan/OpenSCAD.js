import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { bundlePackages } from "./package-licenses.js";

export async function buildEditor() {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const result = await build({
		absWorkingDir: root,
		entryPoints: [fileURLToPath(new URL("../src/studio/editor.js", import.meta.url))],
		outfile: fileURLToPath(new URL("../src/studio/editor-bundle.js", import.meta.url)),
		bundle: true, format: "esm", platform: "browser", target: "es2022",
		minify: true, legalComments: "external", metafile: true,
	});
	return bundlePackages(result.metafile, root);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildEditor();
