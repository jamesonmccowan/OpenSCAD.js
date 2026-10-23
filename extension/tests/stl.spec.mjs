import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import htmlModule from '../src/html.cjs';
import stlEditor from '../src/stl-editor.cjs';
import { fileURLToPath } from 'node:url';

const cubeFaces = [
  [[0, 0, 0], [0, 1, 0], [1, 1, 0]], [[0, 0, 0], [1, 1, 0], [1, 0, 0]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1]], [[0, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1]], [[0, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1]], [[0, 1, 0], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 1], [0, 1, 0]],
  [[1, 0, 0], [1, 1, 0], [1, 1, 1]], [[1, 0, 0], [1, 1, 1], [1, 0, 1]],
];
const scaled = (faces, size) => faces.map(face => face.map(vertex => vertex.map((value, axis) => value * size[axis])));

function binaryStl(faces) {
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.writeUInt32LE(faces.length, 80);
  faces.forEach((face, index) => face.forEach((vertex, corner) => vertex.forEach((value, axis) => buffer.writeFloatLE(value, 84 + index * 50 + 12 + corner * 12 + axis * 4))));
  return [...buffer];
}

const asciiStl = faces => `solid test\n${faces.map(face => `facet normal 0 0 0\nouter loop\n${face.map(vertex => `vertex ${vertex.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid test\n`;

const formatName = { stl: 'part.stl', step: 'part.step', '3mf': 'part.3mf' };

async function open(page, bytes, format = 'stl') {
  const initial = Array.isArray(bytes) ? { type: 'load', data: Buffer.from(bytes).toString('base64'), size: bytes.length, reload: false } : bytes;
  await page.addInitScript(initial => {
    window.stlHost = { sent: [] };
    window.acquireVsCodeApi = () => ({ postMessage: message => {
      window.stlHost.sent.push(message);
      if (message.type === 'ready') window.postMessage(initial, '*');
    } });
  }, initial);
  await page.route('**/stl-harness', route => route.fulfill({ contentType: 'text/html', body: htmlModule.stlHtml("'self'", '/extension/media/stl.js', '/extension/media/style.css', formatName[format], { format }) }));
  await page.goto('/stl-harness');
}

const send = (page, { bytes, ...message }) => page.evaluate(value => window.postMessage(value, '*'), bytes ? { ...message, data: Buffer.from(bytes).toString('base64'), size: bytes.length } : message);

test('binary STL renders with dimensions, volume and watertight status; reload keeps the camera', async ({ page }) => {
  await open(page, binaryStl(scaled(cubeFaces, [10, 20, 5])));
  await expect(page.locator('#status')).toHaveText('Loaded');
  await expect(page.locator('#summary')).toContainText('12 triangles | 10 × 20 × 5 mm | 1000 mm³ | Watertight');
  await expect(page.locator('#summary')).toHaveAttribute('data-watertight', 'true');
  await expect(page.locator('#stl-name')).toHaveText('part.stl');
  await expect(page.getByLabel('3D model preview')).toBeVisible();
  await page.locator('#use-reference').click();
  expect(await page.evaluate(() => window.stlHost.sent.at(-1))).toEqual({ type: 'useReference' });
  await page.locator('#view-top').click();
  await page.locator('#zoom-in').click();
  const camera = await page.evaluate(async () => (await import('/extension/media/stl.js')).viewer.getCamera());
  await send(page, { type: 'load', bytes: binaryStl(scaled(cubeFaces, [10, 20, 8])), reload: true });
  await expect(page.locator('#status')).toHaveText('Reloaded');
  await expect(page.locator('#summary')).toContainText('10 × 20 × 8 mm | 1600 mm³');
  expect(await page.evaluate(async () => (await import('/extension/media/stl.js')).viewer.getCamera())).toEqual(camera);
  await page.locator('#wireframe').click();
  await expect(page.locator('#wireframe')).toHaveAttribute('aria-pressed', 'true');
});

test('ASCII STL loads and open meshes report missing edges', async ({ page }) => {
  await open(page, [...Buffer.from(asciiStl(scaled(cubeFaces.slice(0, 10), [2, 2, 2])))]);
  await expect(page.locator('#summary')).toContainText('10 triangles | 2 × 2 × 2 mm | Not watertight: 4 open, 0 non-manifold edges');
  await expect(page.locator('#summary')).toHaveAttribute('data-watertight', 'false');
});

test('invalid bytes, host errors and deletion keep the previous model visible', async ({ page }) => {
  await open(page, binaryStl(cubeFaces));
  await expect(page.locator('#status')).toHaveText('Loaded');
  await send(page, { type: 'load', bytes: [1, 2, 3], reload: true });
  await expect(page.locator('#status')).toHaveText('Load failed; previous model retained');
  await expect(page.locator('#messages')).toBeVisible();
  await expect(page.locator('#summary')).toContainText('1 × 1 × 1 mm');
  await send(page, { type: 'error', message: 'STL exceeds the 100 MB viewer limit' });
  await expect(page.locator('#messages')).toContainText('100 MB');
  await send(page, { type: 'deleted' });
  await expect(page.locator('#status')).toHaveText('File deleted');
  expect(await page.evaluate(async () => (await import('/extension/media/stl.js')).viewer.model.children.length)).toBeGreaterThan(0);
});

test('the sample binary cube from the repository renders', async ({ page }) => {
  await open(page, [...await readFile(new URL('../../references/scad sample files/cube.stl', import.meta.url))]);
  await expect(page.locator('#status')).toHaveText('Loaded');
  await expect(page.locator('#summary')).toContainText('12 triangles');
  await expect(page.locator('#summary')).toContainText('Watertight');
});

test('STL viewer fits a narrow editor without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await open(page, binaryStl(cubeFaces));
  await expect(page.locator('#status')).toHaveText('Loaded');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.locator('#viewport').boundingBox();
  expect(box.height).toBeGreaterThan(300);
});

const occtScript = process.env.OPENSCAD_OCCT_SCRIPT ?? fileURLToPath(new URL('../media/vendor/occt/occt-import-js.js', import.meta.url));
const toBase64 = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
// Mirrors the host: OpenCascade runs in a Node worker and the webview receives tessellated meshes.
async function stepMessage(name, base = '../node_modules/occt-import-js/test/testfiles/') {
  const bytes = await readFile(new URL(`${base}${name}`, import.meta.url));
  const meshes = await stlEditor.tessellateStep(new Uint8Array(bytes), occtScript).promise;
  return { type: 'load', name, meshes: meshes.map(mesh => ({ position: toBase64(mesh.position), index: toBase64(mesh.index) })), size: bytes.length, reload: false };
}
const savedStl = async page => {
  const message = await page.evaluate(() => window.stlHost.sent.find(value => value.type === 'saveStl'));
  const bytes = Buffer.from(message.data, 'base64');
  expect(bytes.length).toBe(message.size);
  return { bytes, triangles: bytes.readUInt32LE(80) };
};

test('plain STL files do not offer conversion', async ({ page }) => {
  await open(page, binaryStl(cubeFaces));
  await expect(page.locator('#status')).toHaveText('Loaded');
  await expect(page.locator('#convert-stl')).toHaveCount(0);
});

test('STEP files are tessellated by OpenCascade, welded watertight and convert to binary STL', async ({ page }) => {
  await open(page, await stepMessage('rounded-cube/rounded-cube.step'), 'step');
  await expect(page.locator('#status')).toHaveText('Loaded');
  await expect(page.locator('#summary')).toContainText('10 × 10 × 10 mm');
  await expect(page.locator('#summary')).toContainText('Watertight');
  const convert = page.locator('#convert-stl');
  await expect(convert).toBeEnabled();
  await convert.click();
  await expect(page.locator('#status')).toHaveText('Converting...');
  const { triangles } = await savedStl(page);
  expect(triangles).toBe(Number((await page.locator('#summary').textContent()).match(/^([\d,]+) triangles/)[1].replace(/,/g, '')));
  await page.evaluate(() => window.postMessage({ type: 'saved', name: 'part.stl' }, '*'));
  await expect(page.locator('#status')).toHaveText('Saved part.stl');
  await expect(convert).toBeEnabled();
});

test('a STEP file in inches is converted to millimeters and multi-solid assemblies load', async ({ page }) => {
  await open(page, await stepMessage('cax-if/as1_pe_203.stp'), 'step');
  await expect(page.locator('#status')).toHaveText('Loaded');
  await expect(page.locator('#summary')).toContainText('triangles');
});

test('STEP reader errors and malformed mesh data report errors without crashing the viewer', async ({ page }) => {
  await open(page, { type: 'loading' }, 'step');
  await expect(page.locator('#status')).toHaveText('Tessellating STEP...');
  await send(page, { type: 'error', message: 'OpenCascade could not read this STEP file' });
  await expect(page.locator('#status')).toHaveText('Load failed');
  await expect(page.locator('#messages')).toContainText('OpenCascade could not read');
  await expect(page.locator('#convert-stl')).toBeDisabled();
  await send(page, { type: 'load', meshes: [{ position: 'AAAA', index: '' }], size: 10 });
  await expect(page.locator('#messages')).toContainText('STEP mesh data is malformed');
});

const cubeModel = (unit, id = 1) => {
  const vertices = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
  const index = (x, y, z) => x * 4 + y * 2 + z;
  const quads = [[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], [[1,0,0],[1,1,0],[1,1,1],[1,0,1]]];
  const triangles = quads.flatMap(quad => { const [a, b, c, d] = quad.map(point => index(...point)); return [`<triangle v1="${a}" v2="${b}" v3="${c}"/>`, `<triangle v1="${a}" v2="${c}" v3="${d}"/>`]; });
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="${id}" type="model"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object></resources><build/></model>`;
};

test('3MF production components across model parts honor transforms and units', async ({ page }) => {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="5" type="model"><components>
      <component p:path="/3D/Objects/object_1.model" objectid="1" transform="2 0 0 0 1 0 0 0 1 0 0 0"/>
      <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/>
    </components></object>
    <object id="6" type="support"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 50 50 50"/></components></object>
  </resources>
  <build><item objectid="5" transform="1 0 0 0 1 0 0 0 1 0 0 3"/><item objectid="6"/></build>
</model>`;
  const archive = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(root),
    '3D/Objects/object_1.model': strToU8(cubeModel('centimeter')),
    'Metadata/plate_1.png': new Uint8Array(64),
  });
  await open(page, [...archive], '3mf');
  await expect(page.locator('#status')).toHaveText('Loaded');
  // Two touching unit cubes (one stretched to 2 cm) span 3 × 1 × 1 cm, lifted 3 cm; the support object is skipped.
  await expect(page.locator('#summary')).toContainText('24 triangles | 30 × 10 × 10 mm');
  await page.locator('#convert-stl').click();
  const { bytes, triangles } = await savedStl(page);
  expect(triangles).toBe(24);
  expect(Math.min(...Array.from({ length: 24 }, (_, index) => bytes.readFloatLE(84 + index * 50 + 12 + 8)))).toBeCloseTo(30);
});

test('a single-file 3MF with a mesh object loads as watertight, and corrupt archives fail cleanly', async ({ page }) => {
  const single = cubeModel('millimeter').replace('<build/>', '<build><item objectid="1" transform="5 0 0 0 5 0 0 0 5 0 0 0"/></build>');
  await open(page, [...zipSync({ '3D/3dmodel.model': strToU8(single) })], '3mf');
  await expect(page.locator('#summary')).toContainText('12 triangles | 5 × 5 × 5 mm | 125 mm³ | Watertight');
  await send(page, { type: 'load', bytes: [...Buffer.from('PK not a zip')], reload: true });
  await expect(page.locator('#status')).toHaveText('Load failed; previous model retained');
  await expect(page.locator('#messages')).toContainText('3MF');
});

test('the sample STEP and 3MF files from the repository render as watertight solids', async ({ page, context }) => {
  const samples = '../../references/scad sample files/';
  await open(page, await stepMessage('plate with hole.step', samples), 'step');
  await expect(page.locator('#status')).toHaveText('Loaded');
  await expect(page.locator('#summary')).toContainText('30 × 20 × 5 mm | 2858.');
  await expect(page.locator('#summary')).toHaveAttribute('data-watertight', 'true');
  const second = await context.newPage();
  await open(second, [...await readFile(new URL(`${samples}hex prisms.3mf`, import.meta.url))], '3mf');
  await expect(second.locator('#status')).toHaveText('Loaded');
  await expect(second.locator('#summary')).toContainText('48 triangles | 45 × 17.32 × 15 mm | 6495.2');
  await expect(second.locator('#summary')).toContainText('Watertight');
});
