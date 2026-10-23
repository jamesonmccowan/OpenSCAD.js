import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareOcct } from './prepare-occt.mjs';
import { bundlePackages, retainPackageLicense } from '../../scripts/package-licenses.js';

const extension = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(extension, '..');
execFileSync(process.execPath, [path.join(root, 'scripts/build-distribution.js')], { cwd: root, stdio: 'inherit' });
const media = path.join(extension, 'media');
await rm(media, { recursive: true, force: true });
await mkdir(path.join(media, 'runtime/vendor'), { recursive: true });
await cp(path.join(root, 'branding/icon-256.png'), path.join(media, 'icon.png'));
for (const file of ['manifold.js', 'manifold.wasm']) await cp(path.join(root, 'dist/openscad.js/runtime/vendor', file), path.join(media, 'runtime/vendor', file));
await cp(path.join(root, 'src/geometry/roof-voronoi-wasm.wasm'), path.join(media, 'runtime/vendor/roof-voronoi-wasm.wasm'));
await cp(path.join(root, 'dist/openscad.js/runtime/assets/fonts'), path.join(media, 'runtime/assets/fonts'), { recursive: true });
await rm(path.join(extension, 'licenses'), { recursive: true, force: true });
await cp(path.join(root, 'dist/licenses'), path.join(extension, 'licenses'), { recursive: true });
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(path.join(root, file), path.join(extension, file));
const bundled = new Map();
const bundles = [];
async function buildTracked(options) {
  const result = await build({ ...options, metafile: true, absWorkingDir: root });
  const packages = await bundlePackages(result.metafile, root);
  const ids = [];
  for (const { directory, metadata } of packages) {
    const id = `${metadata.name.replaceAll('/', '-')}@${metadata.version}`;
    if (!bundled.has(id)) bundled.set(id, { id, ...await retainPackageLicense(directory, path.join(extension, 'licenses/npm', id)) });
    ids.push(id);
  }
  const outputs = [];
  for (const name of Object.keys(result.metafile.outputs).sort()) {
    const filename = path.resolve(root, name);
    outputs.push({ file: path.relative(extension, filename).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(filename)).digest('hex') });
  }
  bundles.push({ file: path.relative(extension, options.outfile).replaceAll('\\', '/'), packages: ids.sort(), outputs });
}
const common = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'external', external: ['node:*', 'fs', 'module', 'manifold-3d'] };
await buildTracked({ entryPoints: [path.join(root, 'src/node/fonts.js')], outfile: path.join(media, 'font-resolver.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node20', legalComments: 'external' });
await buildTracked({ ...common, entryPoints: [path.join(extension, 'webview/main.js')], outfile: path.join(media, 'main.js') });
await buildTracked({ ...common, entryPoints: [path.join(extension, 'webview/stl.js')], outfile: path.join(media, 'stl.js') });
await buildTracked({ ...common, entryPoints: [path.join(extension, 'webview/gcode.js')], outfile: path.join(media, 'gcode.js') });
await buildTracked({ ...common, external: ['node:*', 'fs', 'module'], entryPoints: [path.join(root, 'src/core/worker-entry.js')], outfile: path.join(media, 'worker.js'), plugins: [{ name: 'packaged-worker', setup(builder) {
  builder.onLoad({ filter: /[/\\]core[/\\]worker-entry\.js$/ }, async args => {
    const original = await readFile(args.path, 'utf8');
    const before = '(await import(message.manifoldModuleUrl)).default';
    if (!original.includes(before)) throw new Error('Worker loader changed; update extension kernel rewrite');
    return { contents: 'import manifoldFactory from "manifold-3d";\n' + original.replace(before, 'manifoldFactory'), loader: 'js', resolveDir: path.dirname(args.path) };
  });
  builder.onLoad({ filter: /[/\\]geometry[/\\]text\.js$/ }, async args => {
    const original = await readFile(args.path, 'utf8');
    const before = 'new URL("../../references/openscad/fonts/Liberation-2.00.1/ttf/", import.meta.url)';
    if (!original.includes(before)) throw new Error('Font loader changed; update extension asset rewrite');
    return { contents: original.replace(before, 'new URL(globalThis.__openscadFontBase)'), loader: 'js', resolveDir: path.dirname(args.path) };
  });
  builder.onLoad({ filter: /[/\\]geometry[/\\]roof\.js$/ }, async args => {
    const original = await readFile(args.path, 'utf8');
    const before = 'const options = {};';
    if (!original.includes(before)) throw new Error('Roof loader changed; update extension asset rewrite');
    return { contents: original.replace(before, 'const options = { locateFile: () => globalThis.__openscadRoofWasmUrl };'), loader: 'js', resolveDir: path.dirname(args.path) };
  });
} }] });
await cp(path.join(extension, 'webview/style.css'), path.join(media, 'style.css'));
// Keep OCCT replaceable, with matching sources and notices delivered in the VSIX.
const occt = path.join(extension, 'node_modules/occt-import-js');
const occtVersion = JSON.parse(await readFile(path.join(occt, 'package.json'), 'utf8')).version;
await prepareOcct();
await mkdir(path.join(media, 'vendor/occt'), { recursive: true });
for (const file of ['occt-import-js.js', 'occt-import-js.wasm']) await cp(path.join(occt, 'dist', file), path.join(media, 'vendor/occt', file));
await appendFile(path.join(extension, 'THIRD_PARTY_NOTICES.md'), `

## occt-import-js ${occtVersion} and Open CASCADE Technology

Source: https://www.npmjs.com/package/occt-import-js/v/${occtVersion} and
https://github.com/kovacsv/occt-import-js, which builds Open CASCADE Technology
(https://dev.opencascade.org). Used by the model viewer to read STEP files.
The importer is licensed under GNU LGPL version 2.1; OCCT 7.6.1 is
LGPL-2.1 with the Open CASCADE exception. This extension makes use of
facilities provided by Open CASCADE Technology. See licenses/occt-import-js/
for the LGPL texts, exception and Emscripten/runtime notices, and
OCCT-SOURCES.txt for rebuilding and replacement instructions.
Complete pinned importer, OCCT and Emscripten sources are delivered in
licenses/occt-import-js/sources/ in this package, with checksums and revision
information in licenses/occt-import-js/provenance.json.
The files media/vendor/occt/occt-import-js.js and
media/vendor/occt/occt-import-js.wasm are distributed unmodified from the npm
package and are loaded at runtime by the extension host, so they may be
replaced with a compatible build.
`);
await writeFile(path.join(extension, 'licenses/bundled-packages.json'), JSON.stringify({ schemaVersion: 1, bundles, packages: [...bundled.values()].sort((a, b) => a.id.localeCompare(b.id)) }, null, 2) + '\n');
await appendFile(path.join(extension, 'THIRD_PARTY_NOTICES.md'), `

## Extension JavaScript bundle inventory

licenses/bundled-packages.json records actual esbuild input packages for each
generated host/webview/worker bundle, including separate Three.js versions.
Their exact license/notice files and SHA-256 hashes are retained under
licenses/npm/<name>@<version>/. Copied WASM, fonts and embedded OpenType/Lucide
components have the additional notices described above. The inventory is not
a claim that esbuild can discover components already embedded inside a
dependency's published bundle.
`);
console.log('Built extension/media with bundled webview, worker, WASM, fonts and notices.');