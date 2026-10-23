import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import stlEditor from '../src/stl-editor.cjs';
import { measureMesh } from '../../tests/helpers/backend.js';
import { provenance, verifyHash } from '../scripts/prepare-occt.mjs';

const extension = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, extension));

test('OCCT release integrity checks reject changed binaries and sources', () => {
  const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.doesNotThrow(() => verifyHash(Buffer.alloc(0), hash, 'fixture'));
  assert.throws(() => verifyHash(Buffer.from('changed'), hash, 'fixture'), /fixture: SHA-256 mismatch/);
  assert.equal(provenance.importerRevision.length, 40);
  assert.equal(provenance.occtRevision.length, 40);
  assert.deepEqual(provenance.patches, []);
});

test('built OCCT package delivers verified source archives and unchanged library pair', async () => {
  const manifest = JSON.parse(await read('licenses/occt-import-js/provenance.json'));
  assert.deepEqual(manifest, provenance);
  for (const source of manifest.sources) {
    verifyHash(await read(`licenses/occt-import-js/sources/${source.file}`), source.sha256, source.file);
  }
  for (const [name, hash] of Object.entries(manifest.binaries)) {
    verifyHash(await read(`media/vendor/occt/${name}`), hash, name);
  }
  assert.match((await read('licenses/occt-import-js/OCCT_LGPL_EXCEPTION.txt')).toString(), /Open CASCADE exception/);
  for (const name of [
    'license.occt-import-js.txt', 'license.occt.txt',
    'runtime/Emscripten.LICENSE', 'runtime/Emscripten.AUTHORS',
    'runtime/musl.COPYRIGHT', 'runtime/libcxx.LICENSE', 'runtime/libcxxabi.LICENSE',
    'runtime/compiler-rt.LICENSE', 'runtime/libunwind.LICENSE', 'runtime/dlmalloc.c',
  ]) {
    assert.ok((await stat(new URL(`licenses/occt-import-js/${name}`, extension))).size > 0, name);
  }
  assert.deepEqual(await read('OCCT-SOURCES.txt'), await read('licenses/occt-import-js/OCCT-SOURCES.txt'));
  assert.match((await read('THIRD_PARTY_NOTICES.md')).toString(), /Complete pinned importer, OCCT and Emscripten sources/);
});

test('extension retains parent kernel and roof embedded-component notices', async () => {
  const manifest = JSON.parse(await read('licenses/wasm/provenance.json'));
  for (const file of manifest.files) {
    verifyHash(await read(`licenses/wasm/${file.path}`), file.sha256, file.path);
  }
  for (const name of [
    'manifold/Clipper2.LICENSE', 'manifold/PhysX.LICENSE', 'manifold/SVD.NOTICE',
    'manifold/disjoint-sets.NOTICE', 'manifold/math.NOTICE',
    'emscripten-5.0.2/LICENSE', 'emscripten-4.0.23/LICENSE',
    'roof/straight-skeleton.LICENSE',
  ]) assert.ok(manifest.files.some(file => file.path === name), name);
  for (const input of manifest.inputs.filter(input => input.path.startsWith('node_modules/manifold-3d/'))) {
    const name = input.path.split('/').at(-1);
    verifyHash(await read(`media/runtime/vendor/${name}`), input.sha256, name);
  }
  const roof = manifest.inputs.find(input => input.path.endsWith('/roof-voronoi-wasm.wasm'));
  verifyHash(await read('media/runtime/vendor/roof-voronoi-wasm.wasm'), roof.sha256, roof.path);
});

test('extension inventories actual bundled packages, sidecars and unchanged licensed fonts', async () => {
  const inventory = JSON.parse(await read('licenses/bundled-packages.json'));
  assert.equal(inventory.schemaVersion, 1);
  assert.deepEqual(inventory.bundles.map(bundle => bundle.file).sort(), [
    'media/font-resolver.cjs', 'media/gcode.js', 'media/main.js', 'media/stl.js', 'media/worker.js',
  ]);
  const ids = inventory.packages.map(pkg => pkg.id);
  for (const id of [
    'three@0.159.0', 'three@0.180.0', 'gcode-preview@2.18.0', 'lil-gui@0.19.2',
    'lucide@0.468.0', 'opentype.js@1.3.4', 'earcut@3.0.2', 'fflate@0.8.3', 'manifold-3d@3.5.4',
  ]) assert.ok(ids.includes(id), `Missing bundled dependency: ${id}`);
  for (const pkg of inventory.packages) {
    assert.ok(pkg.licenses.length > 0);
    for (const license of pkg.licenses) {
      verifyHash(await read(`licenses/npm/${pkg.id}/${license.file}`), license.sha256, `${pkg.id}/${license.file}`);
    }
  }
  for (const bundle of inventory.bundles) {
    assert.ok(bundle.packages.length > 0);
    for (const id of bundle.packages) assert.ok(ids.includes(id), id);
    for (const output of bundle.outputs) verifyHash(await read(output.file), output.sha256, output.file);
    assert.ok(bundle.outputs.some(output => output.file === `${bundle.file}.LEGAL.txt`), bundle.file);
  }
  const gcode = inventory.bundles.find(bundle => bundle.file === 'media/gcode.js');
  for (const id of ['three@0.159.0', 'gcode-preview@2.18.0', 'lil-gui@0.19.2']) assert.ok(gcode.packages.includes(id), id);
  for (const file of ['Feather.LICENSE', 'tiny-inflate.LICENSE', 'codepointat.LICENSE', 'tinf.LICENSE']) {
    assert.deepEqual(await read(`licenses/javascript/${file}`), await readFile(new URL(`../../licenses/javascript/${file}`, import.meta.url)));
  }
  const parent = new URL('../../dist/', import.meta.url);
  const fontPath = 'openscad.js/runtime/assets/fonts/';
  const fonts = (await readdir(new URL(fontPath, parent))).sort();
  assert.equal(fonts.length, 18);
  assert.deepEqual((await readdir(new URL('media/runtime/assets/fonts/', extension))).sort(), fonts);
  for (const file of fonts) assert.deepEqual(await read(`media/runtime/assets/fonts/${file}`), await readFile(new URL(fontPath + file, parent)));
  for (const file of ['Liberation.LICENSE', '@fontsource-dm-mono/LICENSE', '@fontsource-manrope/LICENSE']) {
    assert.deepEqual(await read(`licenses/${file}`), await readFile(new URL(`licenses/${file}`, parent)));
  }
  assert.ok(!(await readdir(new URL('licenses/', extension))).includes('gcode-viewer'), 'Obsolete license trees must not survive rebuilds');
});

test('packaged or replacement OCCT library runs through the extension worker', async () => {
  const script = process.env.OPENSCAD_OCCT_SCRIPT ?? fileURLToPath(new URL('media/vendor/occt/occt-import-js.js', extension));
  const bytes = await readFile(new URL('../../references/scad sample files/plate with hole.step', import.meta.url));
  const meshes = await stlEditor.tessellateStep(new Uint8Array(bytes), script).promise;
  assert.equal(meshes.length, 1);
  const mesh = measureMesh({ positions: meshes[0].position, triangles: meshes[0].index });
  for (const [axis, expected] of [30, 20, 5].entries()) {
    assert.ok(Math.abs(mesh.bounds[1][axis] - mesh.bounds[0][axis] - expected) < 1e-6);
  }
  assert.ok(Math.abs(mesh.volume - (30 * 20 - Math.PI * 3 ** 2) * 5) < 1);
  assert.equal(mesh.degenerateTriangles, 0);
  await assert.rejects(stlEditor.tessellateStep(new Uint8Array([1, 2, 3]), script).promise, /OpenCascade could not read this STEP file/);
});
