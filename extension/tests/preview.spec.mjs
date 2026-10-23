import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import htmlModule from '../src/html.cjs';
import stlEditor from '../src/stl-editor.cjs';
import { createRequire } from 'node:module';
import { runtimeFont } from '../../tests/helpers/fonts.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/runtime/vendor/manifold.js', route => route.abort());
  await page.addInitScript(() => {
    const bridge = { source: 'include <part.scad>\ncube(5);', files: { 'project/part.scad': 'translate([8,0,0]) sphere(2);' }, fonts: [
      { name: 'Liberation Sans:style=Regular', family: 'Liberation Sans', style: 'Regular', source: 'bundled' },
      { name: 'DejaVu Sans:style=Bold Oblique', family: 'DejaVu Sans', style: 'Bold Oblique', source: 'system' },
    ], experimental: [], revision: 0, job: 0, sent: [], compiles: [], exports: [], measurements: [], copiedMeasurements: [], changeDuringCompile: false, heldReads: [], holdReadPath: undefined };
    const send = message => window.postMessage(message, '*');
    bridge.edit = source => { bridge.source = source; bridge.revision++; send({ type: 'stale', revision: bridge.revision }); };
    window.__bridge = bridge;
    window.acquireVsCodeApi = () => ({ postMessage(message) {
      bridge.sent.push(message);
      if (message.type === 'ready') send({ type: 'init', revision: bridge.revision, workerUrl: `${location.origin}/extension/media/worker.js`, manifoldModuleUrl: `${location.origin}/extension/media/runtime/vendor/manifold.js`, wasmUrl: `${location.origin}/extension/media/runtime/vendor/manifold.wasm`, fontBase: `${location.origin}/extension/media/runtime/assets/fonts/` });
      if (message.type === 'requestCompile') {
        bridge.compiles.push(message);
        send({ ...message, type: 'compile', job: ++bridge.job, revision: bridge.revision, requestRevision: message.revision, source: bridge.source, entry: 'project/main.scad', files: { 'project/main.scad': bridge.source }, libraryPaths: [], experimental: bridge.experimental });
        if (bridge.changeDuringCompile) bridge.edit('cube(11);');
      }
      if (message.type === 'read') {
        const reply = { type: 'readResult', job: message.job, id: message.id, value: bridge.files[message.path] };
        if (message.path === bridge.holdReadPath) bridge.heldReads.push(reply);
        else send(reply);
      }
      if (message.type === 'fontList') send({ type: 'fontListResult', requestId: message.requestId, fonts: bridge.fonts, error: bridge.fontError, host: "Remote extension host (ssh-remote, linux). These are not your client PC's fonts." });
      if (message.type === 'fontCopy') { bridge.fontCopy = message.name; send({ type: 'fontCopied', name: message.name }); }
      if (message.type === 'export') bridge.exports.push(message);
      if (message.type === 'measurement') bridge.measurements.push(message.measurement);
      if (message.type === 'copyMeasurement') bridge.copiedMeasurements.push(message.measurement);
    } });
  });
  await page.route('**/extension-harness', route => route.fulfill({ contentType: 'text/html', body: htmlModule.previewHtml("'self'", '/extension/media/main.js', '/extension/media/style.css') }));
  await page.goto('/extension-harness');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
});

async function camera(page) { return page.evaluate(async () => (await import('/extension/media/main.js')).viewer.getCamera()); }

test('font browser loads lazily, filters exact names, copies through host and preserves the model', async ({ page }) => {
  const before = await stats(page);
  expect(await page.evaluate(() => window.__bridge.sent.some(message => message.type === 'fontList'))).toBe(false);
  await page.getByRole('tab', { name: 'Fonts', exact: true }).click();
  await expect(page.locator('#font-list [role="listitem"]')).toHaveCount(2);
  await expect(page.locator('#font-host')).toContainText("not your client PC's fonts");
  await expect(page.locator('#font-list')).toContainText('Bundled');
  await expect(page.locator('#font-list')).toContainText('Host installed');
  await page.getByRole('textbox', { name: 'Search fonts', exact: true }).fill('bold oblique');
  await expect(page.locator('#font-list [role="listitem"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Copy font DejaVu Sans:style=Bold Oblique', exact: true }).click();
  await expect(page.locator('#font-status')).toContainText('Copied font="DejaVu Sans:style=Bold Oblique"');
  expect(await page.evaluate(() => window.__bridge.fontCopy)).toBe('DejaVu Sans:style=Bold Oblique');
  await page.locator('#font-search').fill('not a font');
  await expect(page.locator('#font-status')).toContainText('No matching fonts');
  await page.locator('#collapse-tab').click();
  await page.locator('#fonts-tab').click();
  expect(await page.evaluate(() => window.__bridge.sent.filter(message => message.type === 'fontList').length)).toBe(1);
  expect(await stats(page)).toEqual(before);
});

test('font browser surfaces discovery errors, refreshes and activates with keyboard navigation', async ({ page }) => {
  await page.evaluate(() => { window.__bridge.fontError = 'Font directory unavailable'; });
  await page.locator('#references-tab').click();
  await page.locator('#references-tab').press('ArrowRight');
  await expect(page.locator('#fonts-controls')).toBeVisible();
  await expect(page.locator('#font-status')).toContainText('Font directory unavailable');
  await page.evaluate(() => { window.__bridge.fontError = undefined; });
  await page.getByRole('button', { name: 'Refresh available fonts', exact: true }).click();
  await expect(page.locator('#font-list [role="listitem"]')).toHaveCount(2);
  await expect(page.locator('#font-status')).not.toHaveClass('error');
});

test('preview resolves runtime fonts through the host bridge for geometry and metrics', async ({ page }) => {
  const bytes = await runtimeFont('Bold Italic');
  await page.evaluate(data => {
    window.__bridge.files['Runtime Test Sans:style=Bold Italic'] = data;
    window.__bridge.edit('echo(fontmetrics(font="Runtime Test Sans:style=Bold Italic").font); linear_extrude(1) text("Arial",font="Runtime Test Sans:style=Bold Italic");');
  }, Array.from(bytes));
  await compile(page);
  await expect(page.locator('#messages')).toContainText('Runtime Test Sans');
  expect(await page.evaluate(() => window.__bridge.sent.some(message => message.type === 'read' && message.kind === 'font'))).toBe(true);
  expect((await stats(page)).volume).toBeGreaterThan(0);
});
async function stats(page) { return page.evaluate(async () => (await import('/extension/media/main.js')).viewer.stats()); }
async function compile(page, button = 'preview') {
  await page.locator(`#${button}`).click();
  try { await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 8_000 }); }
  catch (error) {
    const state = await page.evaluate(() => ({ status: document.querySelector('#status').outerHTML, summary: document.querySelector('#summary').textContent, messages: document.querySelector('#messages').textContent, request: window.__bridge.compiles.at(-1) }));
    throw new Error(`${error.message}\nPreview state: ${JSON.stringify(state)}`);
  }
}

const referenceSettings = () => ({ visible: true, opacity: 0.28, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const referenceTriangle = Buffer.from('solid ref\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 3 1\nendloop\nendfacet\nendsolid ref\n');
async function addReference(page, format = 'stl', data = { data: referenceTriangle.toString('base64'), size: referenceTriangle.length }) {
  const descriptor = { id: 'reference-1', name: `reference.${format}`, path: `/models/reference.${format}`, format, settings: referenceSettings() };
  await page.evaluate(({ descriptor, data }) => {
    window.postMessage({ type: 'referenceList', references: [descriptor] }, '*');
    window.postMessage({ type: 'referenceLoad', id: descriptor.id, format: descriptor.format, ...data }, '*');
  }, { descriptor, data });
  await page.locator('#references-tab').click();
  await expect(page.locator('.reference-message')).toHaveText('Loaded - preview only');
  return page.getByRole('group', { name: descriptor.name, exact: true });
}
async function referenceObject(page) {
  return page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    const object = viewer.references.children[0];
    return { count: viewer.references.children.length, position: object.position.toArray(), rotation: object.rotation.toArray().slice(0, 3), scale: object.scale.toArray(), visible: object.visible, opacity: object.material[0].opacity, depthWrite: object.material[0].depthWrite, triangles: object.geometry.index.count / 3 };
  });
}

test('reference transforms, visibility and opacity stay separate from compiled geometry and exports', async ({ page }, testInfo) => {
  const beforeStats = await stats(page);
  const beforeCamera = await camera(page);
  await page.locator('#export').click();
  await expect.poll(() => page.evaluate(() => window.__bridge.exports.length)).toBe(1);
  const summary = await page.locator('#summary').textContent();
  const row = await addReference(page);
  expect(await stats(page)).toEqual(beforeStats);
  expect(await page.locator('#summary').textContent()).toBe(summary);
  const afterCamera = await camera(page);
  for (const name of ['eye', 'target', 'up']) afterCamera[name].forEach((value, index) => expect(value).toBeCloseTo(beforeCamera[name][index], 7));
  await row.getByLabel('Position X', { exact: true }).fill('15');
  await row.getByLabel('Position X', { exact: true }).press('Tab');
  await row.getByLabel('Rotation Z', { exact: true }).fill('90');
  await row.getByLabel('Rotation Z', { exact: true }).press('Tab');
  await row.getByLabel('Scale Y', { exact: true }).fill('2');
  await row.getByLabel('Scale Y', { exact: true }).press('Tab');
  await row.getByLabel('Opacity', { exact: true }).evaluate(input => {
    input.value = '0.65'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
  });
  let object = await referenceObject(page);
  expect(object.position).toEqual([15, 0, 0]);
  expect(object.rotation[2]).toBeCloseTo(Math.PI / 2);
  expect(object.scale).toEqual([1, 2, 1]);
  expect(object.opacity).toBe(0.65); expect(object.depthWrite).toBe(false);
  await row.getByLabel('Visible', { exact: true }).uncheck();
  expect((await referenceObject(page)).visible).toBe(false);
  await row.getByLabel('Visible', { exact: true }).check();
  const saved = await page.evaluate(() => window.__bridge.sent.filter(message => message.type === 'referenceUpdate').at(-1));
  expect(saved.settings).toEqual({ visible: true, opacity: 0.65, position: [15, 0, 0], rotation: [0, 0, 90], scale: [1, 2, 1] });
  await row.getByRole('button', { name: 'Fit Reference' }).click();
  // The transformed triangle spans X=[9,15], Y=[0,2], Z=[0,1].
  const fitted = await camera(page);
  fitted.target.forEach((value, index) => expect(value).toBeCloseTo([12, 1, 0.5][index], 6));
  await page.locator('#slice-tab').click();
  await page.locator('#slice-enabled').check();
  expect(await page.evaluate(async () => (await import('/extension/media/main.js')).viewer.references.children[0].material[0].clippingPlanes)).toBeNull();
  await page.locator('#slice-enabled').uncheck();
  await compile(page);
  expect((await referenceObject(page)).position).toEqual([15, 0, 0]);
  expect(await stats(page)).toEqual(beforeStats);
  await page.locator('#export').click();
  await expect.poll(() => page.evaluate(() => window.__bridge.exports.length)).toBe(2);
  expect(await page.evaluate(() => window.__bridge.exports[1].bytes)).toEqual(await page.evaluate(() => window.__bridge.exports[0].bytes));
  await page.locator('#references-tab').click();
  await row.getByRole('button', { name: 'Reset Placement' }).click();
  object = await referenceObject(page);
  expect(object.position).toEqual([0, 0, 0]); expect(object.scale).toEqual([1, 1, 1]); expect(object.opacity).toBe(0.65);
  await page.locator('#fit').click();
  await page.screenshot({ path: testInfo.outputPath('reference-overlay.png') });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  expect(await page.evaluate(() => window.__bridge.sent.at(-1).type)).toBe('referenceRemove');
  await page.evaluate(() => window.postMessage({ type: 'referenceList', references: [] }, '*'));
  await expect(page.locator('#reference-list')).toHaveText('No reference models. Add an STL, STEP or 3MF file.');
  expect(await page.evaluate(async () => (await import('/extension/media/main.js')).viewer.references.children.length)).toBe(0);
});

test('reference load failures retain the last mesh, settings acknowledgements roll back failed saves', async ({ page }) => {
  const row = await addReference(page);
  const before = await referenceObject(page);
  await page.evaluate(() => window.postMessage({ type: 'referenceLoad', id: 'reference-1', format: 'stl', data: 'AQID', size: 3 }, '*'));
  await expect(page.locator('.reference-message')).toContainText('retained');
  expect(await referenceObject(page)).toEqual(before);
  await row.getByLabel('Position X', { exact: true }).fill('8');
  await row.getByLabel('Position X', { exact: true }).press('Tab');
  await page.evaluate(settings => {
    const update = window.__bridge.sent.filter(message => message.type === 'referenceUpdate').at(-1);
    window.postMessage({ type: 'referenceSettings', id: update.id, settings, requestId: update.requestId }, '*');
    window.postMessage({ type: 'referenceError', message: 'Storage unavailable' }, '*');
  }, referenceSettings());
  await expect(row.getByLabel('Position X', { exact: true })).toHaveValue('0');
  expect((await referenceObject(page)).position).toEqual([0, 0, 0]);
  await expect(page.locator('#reference-status')).toContainText('Storage unavailable');
  await page.evaluate(() => window.postMessage({ type: 'referenceError', id: 'reference-1', message: 'Reference file deleted; previous geometry retained.' }, '*'));
  await expect(page.locator('.reference-message')).toContainText('deleted');
  expect(await referenceObject(page)).toEqual(before);
  await page.evaluate(() => window.postMessage({ type: 'referenceLoad', id: 'reference-1', format: 'stl', data: 'AQID', size: 30 }, '*'));
  await expect(page.locator('.reference-message')).toContainText('truncated');
});

for (const format of ['step', '3mf']) {
  test(`${format.toUpperCase()} references reuse the model viewer decoding`, async ({ page }, testInfo) => {
    const bytes = await readFile(new URL(`../../references/scad sample files/${format === 'step' ? 'plate with hole.step' : 'hex prisms.3mf'}`, import.meta.url));
    let data;
    if (format === 'step') {
      const meshes = await stlEditor.tessellateStep(bytes, createRequire(import.meta.url).resolve('occt-import-js')).promise;
      const encoded = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
      data = { meshes: meshes.map(mesh => ({ position: encoded(mesh.position), index: encoded(mesh.index) })), size: bytes.length };
    } else data = { data: bytes.toString('base64'), size: bytes.length };
    const before = await stats(page);
    const row = await addReference(page, format, data);
    expect((await referenceObject(page)).triangles).toBeGreaterThan(10);
    expect(await stats(page)).toEqual(before);
    await row.getByRole('button', { name: 'Fit Reference' }).click();
    await page.screenshot({ path: testInfo.outputPath(`${format}-reference.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [390, 1280]) {
  test(`tool tabs show one panel, preserve settings and collapse at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const panels = page.locator('.tool-panel');
    await expect(page.getByRole('tab')).toHaveCount(7);
    await expect(page.locator('#collapse-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tool-panel:visible')).toHaveCount(0);
    const collapsedHeight = (await page.locator('#viewport').boundingBox()).height;
    const compileCount = await page.evaluate(() => window.__bridge.compiles.length);
    for (const [tab, panel] of [
      ['audit', 'interference-audit'], ['slice', 'cross-section'],
      ['animation', 'animation'], ['customizer', 'customizer'],
      ['references', 'references'],
      ['fonts', 'fonts'],
    ]) {
      await page.locator(`#${tab}-tab`).click();
      await expect(page.locator(`#${panel}-controls`)).toBeVisible();
      await expect(page.locator('.tool-panel:visible')).toHaveCount(1);
      await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
      await expect(page.locator(`#${tab}-tab`)).toHaveAttribute('tabindex', '0');
      if (tab === 'audit') await page.locator('#audit-samples').fill('7');
      if (tab === 'slice') await page.locator('#slice-enabled').check();
      if (tab === 'customizer') await page.locator('#preset-name').fill('Keep me');
      expect((await page.locator('#viewport').boundingBox()).height).toBeLessThan(collapsedHeight);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.locator('#collapse-tab').click();
    for (const panel of await panels.all()) await expect(panel).toBeHidden();
    expect((await page.locator('#viewport').boundingBox()).height).toBeCloseTo(collapsedHeight, 0);
    await page.locator('#audit-tab').click();
    await expect(page.locator('#audit-samples')).toHaveValue('7');
    await page.locator('#slice-tab').click();
    await expect(page.locator('#slice-enabled')).toBeChecked();
    await page.locator('#customizer-tab').click();
    await expect(page.locator('#preset-name')).toHaveValue('Keep me');
    expect(await page.evaluate(() => window.__bridge.compiles.length)).toBe(compileCount);
  });
}

test('tool tabs support arrow navigation, wrapping, Home and End', async ({ page }) => {
  const collapse = page.locator('#collapse-tab');
  await collapse.focus();
  for (const [key, selected] of [
    ['ArrowRight', 'audit'], ['ArrowLeft', 'collapse'],
    ['Home', 'audit'], ['ArrowRight', 'slice'], ['End', 'collapse'],
  ]) {
    await page.keyboard.press(key);
    await expect(page.locator(`#${selected}-tab`)).toBeFocused();
    await expect(page.locator(`#${selected}-tab`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tool-panel:visible')).toHaveCount(selected === 'collapse' ? 0 : 1);
  }
});

test('initial preview automatically compiles on open, preserves camera and retains geometry on errors', async ({ page }) => {
  expect((await stats(page)).solid).toBeGreaterThan(0);
  const before = await camera(page);
  await page.evaluate(() => window.__bridge.edit('$vpt=[999,999,999]; cube(7);'));
  await expect(page.locator('#status')).toHaveText('Out of Date');
  await compile(page, 'render');
  const after = await camera(page);
  for (const name of ['eye', 'target', 'up']) after[name].forEach((value, index) => expect(value).toBeCloseTo(before[name][index], 7));
  expect(after.projection).toBe(before.projection);
  expect(after.fov).toBeCloseTo(before.fov, 7);
  expect(after.zoom).toBeCloseTo(before.zoom, 7);
  expect((await stats(page)).volume).toBeCloseTo(343);
  await page.evaluate(() => window.__bridge.edit('cube(;'));
  await page.locator('#preview').click();
  await expect(page.locator('#summary')).toHaveText('Compilation failed; previous model retained');
  expect((await stats(page)).volume).toBeCloseTo(343);
  await expect(page.locator('#status')).toHaveText('Out of Date');
  await page.locator('.source-link').click();
  expect(await page.evaluate(() => window.__bridge.sent.some(message => message.type === 'navigate'))).toBe(true);
});

test('configured experimental features enable roof geometry', async ({ page }) => {
  await page.evaluate(() => { window.__bridge.experimental = ['roof']; window.__bridge.edit('roof() square(4);'); });
  await compile(page);
  expect((await stats(page)).volume).toBeGreaterThan(0);
});

test('camera toolbar preserves target and scale across directions and resets to a fitted default', async ({ page }) => {
  await expect(page.locator('#zoom-in svg')).toBeVisible();
  await expect(page.locator('#zoom-out svg')).toBeVisible();
  const distance = camera => Math.hypot(...camera.eye.map((value, index) => value - camera.target[index]));
  const direction = camera => camera.eye.map((value, index) => (value - camera.target[index]) / distance(camera));
  const initial = await camera(page);
  for (const projection of ['perspective', 'orthographic']) {
    if ((await camera(page)).projection !== projection) await page.locator('#projection').click();
    const before = await camera(page);
    await page.locator('#zoom-in').click();
    const zoomed = await camera(page);
    expect(zoomed.target).toEqual(before.target);
    expect(distance(zoomed) / zoomed.zoom).toBeCloseTo(distance(before) / before.zoom / 1.25, 5);
    await page.locator('#zoom-out').click();
    expect(distance(await camera(page)) / (await camera(page)).zoom).toBeCloseTo(distance(before) / before.zoom, 5);
    for (const [name, expected] of Object.entries({ right: [1, 0, 0], left: [-1, 0, 0], back: [0, 1, 0], front: [0, -1, 0], top: [0, 0, 1], bottom: [0, 0, -1] })) {
      await page.locator(`#view-${name}`).click();
      const oriented = await camera(page);
      direction(oriented).forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
      expect(oriented.target).toEqual(before.target);
      expect(distance(oriented) / oriented.zoom).toBeCloseTo(distance(before) / before.zoom, 5);
    }
    await page.locator('#fit').click();
    direction(await camera(page)).forEach((value, index) => expect(value).toBeCloseTo([0, 0, -1][index], 6));
    await page.locator('#reset-view').click();
    const reset = await camera(page);
    expect(reset.projection).toBe(projection);
    direction(reset).forEach((value, index) => expect(value).toBeCloseTo(direction(initial)[index], 6));
    expect(reset.zoom).toBe(1);
  }
});

test('world axes, adaptive marks, and corner orientation indicator render and respond to camera changes', async ({ page }, testInfo) => {
  await compile(page);
  const interval = () => page.evaluate(async () => (await import('/extension/media/main.js')).viewer.axisInterval);
  const indicator = () => page.locator('#viewport canvas.orientation-indicator').evaluate(canvas => canvas.toDataURL());
  const webglFrame = () => page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    viewer.renderer.render(viewer.scene, viewer.camera);
    const canvas = viewer.renderer.domElement;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    viewer.renderer.getContext().readPixels(0, 0, canvas.width, canvas.height, viewer.renderer.getContext().RGBA, viewer.renderer.getContext().UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      hash = Math.imul(hash ^ pixels[index], 16777619);
      hash = Math.imul(hash ^ pixels[index + 1], 16777619);
      hash = Math.imul(hash ^ pixels[index + 2], 16777619);
    }
    return hash >>> 0;
  });
  const withoutAxes = await webglFrame();
  await page.locator('#show-axes').check();
  const withAxes = await webglFrame();
  const axesState = await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    const geometry = viewer.axesGroup.children[0]?.geometry;
    return { enabled: viewer.showAxes, visible: viewer.axesGroup.visible, points: geometry?.attributes.position.count, renderedLines: viewer.renderer.info.render.lines };
  });
  expect(withAxes, JSON.stringify(axesState)).not.toBe(withoutAxes);
  await page.locator('#show-marks').check();
  await expect(page.locator('#show-axes')).toBeChecked();
  expect(await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    return { axesVisible: viewer.axesGroup.visible, marksVisible: viewer.marksGroup.visible, axisLines: viewer.axesGroup.children[0].geometry.attributes.position.count, labels: viewer.axisLabelCount };
  })).toMatchObject({ axesVisible: true, marksVisible: true, axisLines: 6 });
  expect(await interval()).toBe(10);
  const withMarks = await webglFrame();
  expect(withMarks).not.toBe(withAxes);
  await page.screenshot({ path: testInfo.outputPath('world-axes-marks.png'), fullPage: true });
  const originalIndicator = await indicator();
  await page.locator('#view-top').click();
  await expect.poll(indicator).not.toBe(originalIndicator);
  await page.evaluate(async () => (await import('/extension/media/main.js')).viewer.zoomBy(0.05));
  await expect.poll(interval).toBe(100);
  await page.evaluate(async () => (await import('/extension/media/main.js')).viewer.zoomBy(0.1));
  await expect.poll(interval).toBe(1000);
  await page.locator('#show-axes').uncheck();
  await expect(page.locator('#show-marks')).not.toBeChecked();
  expect(await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    return { axesVisible: viewer.axesGroup.visible, marksVisible: viewer.marksGroup.visible };
  })).toEqual({ axesVisible: false, marksVisible: false });
});

test('numeral stencil compiles with default Voronoi roof in the packaged worker', async ({ page }) => {
  test.setTimeout(120_000);
  const source = await readFile(new URL('../../references/scad sample files/numbers_stencil.scad', import.meta.url), 'utf8');
  await page.evaluate(source => { window.__bridge.experimental = ['roof']; window.__bridge.edit(source); }, source);
  await page.locator('#preview').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
  expect((await stats(page)).volume).toBeGreaterThan(0);
  expect((await stats(page)).background).toBeGreaterThan(0);
  await page.evaluate(() => { window.__bridge.experimental = []; window.__bridge.edit('roof() square(4);'); });
  await page.locator('#preview').click();
  await expect(page.locator('#messages')).toContainText('roof requires explicit experimental');
  const diagnostics = await page.evaluate(() => window.__bridge.sent.filter(message => message.type === 'diagnostics').at(-1).diagnostics);
  expect(diagnostics.at(-1).location.line).toBe(1);
});

test('current-source STL export loads packaged fonts and refuses a stale snapshot', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit('linear_extrude(2) text("SCAD", size=5);'));
  await compile(page, 'export');
  await expect.poll(() => page.evaluate(() => window.__bridge.exports.length)).toBe(1);
  const length = await page.evaluate(() => window.__bridge.exports[0].bytes.length);
  expect(length).toBeGreaterThan(84);
  expect((length - 84) % 50).toBe(0);
  const volume = (await stats(page)).volume;
  await page.evaluate(() => {
    window.__bridge.files['project/piece.stl'] = window.__bridge.exports[0].bytes;
    window.__bridge.edit('import("piece.stl");');
  });
  await compile(page);
  expect((await stats(page)).volume).toBeCloseTo(volume, 3);
  await page.evaluate(() => { window.__bridge.changeDuringCompile = true; window.__bridge.edit('cube(4);'); });
  await page.locator('#export').click();
  await expect(page.locator('#messages')).toContainText('Source or parameters changed');
  expect(await page.evaluate(() => window.__bridge.exports.length)).toBe(1);
  await expect(page.locator('#status')).toHaveText('Out of Date');
});

test('cancellation and supersession allow the next compilation to succeed', async ({ page }) => {
  await page.evaluate(() => {
    window.__bridge.holdReadPath = 'project/blocked.scad';
    window.__bridge.files['project/blocked.scad'] = 'cube(100);';
    window.__bridge.edit('include <blocked.scad> cube(1);');
  });
  await page.locator('#preview').click();
  await expect.poll(() => page.evaluate(() => window.__bridge.heldReads.length)).toBe(1);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'busy');
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toHaveText('Out of Date');
  expect(await page.evaluate(() => window.__bridge.sent.some(message => message.type === 'cancel'))).toBe(true);
  await page.evaluate(() => window.__bridge.edit('cube(3);'));
  await compile(page);
  expect((await stats(page)).volume).toBeCloseTo(27);
  await page.evaluate(() => window.__bridge.edit('include <blocked.scad> cube(1);'));
  await page.locator('#preview').click();
  await expect.poll(() => page.evaluate(() => window.__bridge.heldReads.length)).toBe(2);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'busy');
  await page.evaluate(() => window.__bridge.edit('cube(4);'));
  await compile(page, 'render');
  await page.evaluate(() => {
    for (const reply of window.__bridge.heldReads.splice(0)) window.postMessage(reply, '*');
  });
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect((await stats(page)).volume).toBeCloseTo(64);
  await expect(page.locator('#messages')).toBeHidden();
});

test('Customizer overrides update geometry and presets preserve selected values', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__bridge.edit('/* [Dimensions] */\nwidth = 10; // [4:2:20]\nshade = "red"; // [red:Red,blue:Blue]\ncentered = false;\ncube([width, width, 1], center = centered);'));
  await compile(page);
  await expect(page.locator('#customizer-controls')).toContainText('width');
  await page.locator('#customizer-tab').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const slider = page.locator('#parameter-controls input[type="range"]');
  await slider.evaluate(input => { input.value = '14'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(async () => (await stats(page)).volume).toBeCloseTo(196, 0);
  const overrideRequest = await page.evaluate(() => window.__bridge.compiles.at(-1));
  expect(overrideRequest.defines.width).toBe(14);
  await page.locator('#preset-name').fill('Wide');
  await page.locator('#preset-save').click();
  await slider.evaluate(input => { input.value = '8'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(async () => (await stats(page)).volume).toBeCloseTo(64, 0);
  await page.locator('#preset-select').selectOption('Wide');
  await expect.poll(async () => (await stats(page)).volume).toBeCloseTo(196, 0);
  await page.locator('#preset-input').setInputFiles({ name: 'presets.json', mimeType: 'application/json', buffer: Buffer.from('{"fileFormatVersion":"1","parameterSets":{"Imported":{"width":"12"}}}') });
  await page.locator('#preset-select').selectOption('Imported');
  await expect.poll(async () => (await stats(page)).volume).toBeCloseTo(144, 0);
  const download = page.waitForEvent('download');
  await page.locator('#preset-export').click();
  expect((await download).suggestedFilename()).toBe('openscad-parameters.json');
});

test('$t scrubbing and playback compile sequential frames with bounded settings', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit('cube(1 + $t);'));
  await compile(page);
  await page.locator('#animation-tab').click();
  await page.locator('#animation-scrub').evaluate(input => { input.value = '0.5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(async () => (await stats(page)).volume).toBeCloseTo(3.375, 2);
  expect((await page.evaluate(() => window.__bridge.compiles.at(-1))).time).toBe(0.5);
  await page.locator('#animation-steps').fill('4');
  await page.locator('#animation-steps').dispatchEvent('change');
  await page.locator('#animation-fps').fill('30');
  await page.locator('#animation-fps').dispatchEvent('change');
  const count = await page.evaluate(() => window.__bridge.compiles.length);
  await expect(page.locator('#animation-play')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#animation-play').click();
  await expect(page.locator('#animation-play')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(previous => window.__bridge.compiles.length, count), { timeout: 5_000 }).toBeGreaterThan(count);
  await expect(page.locator('#animation-play')).toHaveAttribute('aria-label', 'Pause animation');
  await page.locator('#collapse-tab').click();
  await expect(page.locator('#animation-controls')).toBeHidden();
  await expect.poll(() => page.evaluate(previous => window.__bridge.compiles.length, count), { timeout: 5_000 }).toBeGreaterThan(count + 1);
  await page.locator('#animation-tab').click();
  await page.locator('#animation-play').click();
  await expect(page.locator('#animation-play')).toHaveAttribute('aria-label', 'Play animation');
  expect((await page.evaluate(previous => window.__bridge.compiles.slice(previous).map(item => item.time), count)).every(time => time >= 0 && time < 1)).toBe(true);
});

test('auto-preview toggle automatically recompiles on source changes', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit('cube(2);'));
  await compile(page);
  expect((await stats(page)).volume).toBeCloseTo(8, 0);
  const checkbox = page.locator('#auto-preview');
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page.evaluate(() => window.__bridge.edit('cube(3);'));
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'stale');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect.poll(async () => (await stats(page)).volume).toBeCloseTo(27, 0);
});

test('model metrics are computed and snapshot button captures viewport to host', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit('cube([10, 20, 30]);'));
  await compile(page);
  await expect(page.locator('#summary')).toContainText('10 × 20 × 30 mm');
  const metricsMessage = await page.evaluate(() => window.__bridge.sent.find(m => m.type === 'modelMetrics' && m.metrics?.size?.x === 10));
  expect(metricsMessage).toBeDefined();
  expect(metricsMessage.metrics.size).toEqual({ x: 10, y: 20, z: 30 });
  expect(metricsMessage.metrics.volume).toBeCloseTo(6000, 0);

  const snapshotBtn = page.locator('#snapshot');
  await expect(snapshotBtn).toBeVisible();
  await snapshotBtn.click();
  await expect.poll(() => page.evaluate(() => window.__bridge.sent.some(m => m.type === 'snapshotCaptured' && m.dataUrl.startsWith('data:image/png;base64,')))).toBe(true);
});

test('command snapshot survives immediate viewport resize and contains nonblank PNG pixels', async ({ page }, testInfo) => {
  await page.evaluate(() => window.__bridge.edit('color("red") cube([10, 20, 30]);'));
  await compile(page);
  const expectedSize = await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    viewer.element.style.flex = 'none';
    viewer.element.style.width = '377px';
    viewer.element.style.height = '241px';
    window.postMessage({ type: 'captureSnapshot', requestId: 'snapshot-resized' }, '*');
    return { width: 377 * viewer.renderer.getPixelRatio(), height: 241 * viewer.renderer.getPixelRatio() };
  });
  await expect.poll(() => page.evaluate(() => window.__bridge.sent.some(message => message.type === 'snapshotCaptured' && message.requestId === 'snapshot-resized'))).toBe(true);
  const image = await page.evaluate(async () => {
    const message = window.__bridge.sent.find(message => message.type === 'snapshotCaptured' && message.requestId === 'snapshot-resized');
    const image = new Image();
    image.src = message.dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let redPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.5 && pixels[i] > 60 && pixels[i + 3] === 255) redPixels++;
    }
    return { width: image.width, height: image.height, redPixels, dataUrl: message.dataUrl };
  });
  expect({ width: image.width, height: image.height }).toEqual(expectedSize);
  expect(image.redPixels).toBeGreaterThan(100);
  const png = Buffer.from(image.dataUrl.split(',')[1], 'base64');
  expect(png.readUInt32BE(16)).toBe(expectedSize.width);
  expect(png.readUInt32BE(20)).toBe(expectedSize.height);
  await testInfo.attach('resized-viewport-snapshot', { body: png, contentType: 'image/png' });
});

test('snapshot errors are explicit and do not stop an in-progress compile', async ({ page }) => {
  await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    const original = viewer.renderer.domElement.toDataURL;
    viewer.renderer.domElement.toDataURL = () => { throw new Error('Canvas capture unavailable'); };
    window.postMessage({ type: 'captureSnapshot', requestId: 'snapshot-error' }, '*');
    await new Promise(resolve => setTimeout(resolve, 0));
    viewer.renderer.domElement.toDataURL = original;
  });
  await expect.poll(() => page.evaluate(() => window.__bridge.sent.find(message => message.type === 'snapshotFailed' && message.requestId === 'snapshot-error')?.message)).toBe('Canvas capture unavailable');
  await expect(page.locator('#messages')).toContainText('Snapshot capture failed');
  await page.evaluate(() => {
    window.postMessage({ type: 'triggerCompile', mode: 'preview' }, '*');
    window.postMessage({ type: 'captureSnapshot', requestId: 'snapshot-busy' }, '*');
    window.postMessage({ type: 'snapshotSaveFailed', message: 'Read-only destination' }, '*');
  });
  await expect.poll(() => page.evaluate(() => window.__bridge.sent.find(message => message.type === 'snapshotFailed' && message.requestId === 'snapshot-busy')?.message)).toContain('Compilation is in progress');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  expect(await page.evaluate(() => window.__bridge.sent.some(message => message.type === 'snapshotCaptured' && ['snapshot-error', 'snapshot-busy'].includes(message.requestId)))).toBe(false);
});

test('snapshot refuses a hidden viewport and a lost graphics context', async ({ page }) => {
  await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    viewer.element.style.display = 'none';
    window.postMessage({ type: 'captureSnapshot', requestId: 'snapshot-hidden' }, '*');
  });
  await expect.poll(() => page.evaluate(() => window.__bridge.sent.find(message => message.type === 'snapshotFailed' && message.requestId === 'snapshot-hidden')?.message)).toContain('hidden or has no size');
  await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    viewer.element.style.display = '';
    const original = viewer.renderer.getContext;
    viewer.renderer.getContext = () => ({ isContextLost: () => true });
    window.postMessage({ type: 'captureSnapshot', requestId: 'snapshot-context' }, '*');
    await new Promise(resolve => setTimeout(resolve, 0));
    viewer.renderer.getContext = original;
  });
  await expect.poll(() => page.evaluate(() => window.__bridge.sent.find(message => message.type === 'snapshotFailed' && message.requestId === 'snapshot-context')?.message)).toContain('graphics context was lost');
});

test('cross section slicing controls enable Three.js local clipping planes', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit('cube([10, 10, 10]);'));
  await compile(page);
  await page.locator('#slice-tab').click();

  const enableCheckbox = page.locator('#slice-enabled');
  await expect(enableCheckbox).not.toBeChecked();

  // Check initial clipping planes state (empty)
  const initialPlanesCount = await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    let planes = 0;
    viewer.model.traverse(o => { if (o.isMesh && o.material?.[0]?.clippingPlanes?.length) planes++; });
    return planes;
  });
  expect(initialPlanesCount).toBe(0);

  // Enable slicing
  await enableCheckbox.check();
  await expect(enableCheckbox).toBeChecked();

  // Verify clipping planes are applied to model materials
  const slicedPlanesCount = await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    let planes = 0;
    viewer.model.traverse(o => { if (o.isMesh && o.material?.[0]?.clippingPlanes?.length) planes++; });
    return planes;
  });
  expect(slicedPlanesCount).toBeGreaterThan(0);

  // Check offset slider update updates label
  const slider = page.locator('#slice-offset');
  await slider.evaluate(input => { input.value = '75'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#slice-value')).toHaveText('7.5 mm');

  // Change axis to X and check update
  await page.locator('#slice-axis').selectOption('x');
  await expect(page.locator('#slice-value')).toHaveText('7.5 mm');

  // Disable slicing
  await enableCheckbox.uncheck();
  const disabledPlanesCount = await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    let planes = 0;
    viewer.model.traverse(o => { if (o.isMesh && o.material?.[0]?.clippingPlanes?.length) planes++; });
    return planes;
  });
  expect(disabledPlanesCount).toBe(0);
});

test('measure tool raycasts two cube points and reports distance and signed axis deltas', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit('cube([20, 30, 40]);'));
  await page.locator('#preview').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#fit').click();
  await page.locator('#measure-toggle').click();
  await expect(page.locator('#measure-toggle')).toHaveAttribute('aria-pressed', 'true');

  const points = await page.evaluate(async () => {
    const { Raycaster, Vector2 } = await import('/node_modules/three/build/three.module.js');
    const { viewer } = await import('/extension/media/main.js');
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const raycaster = new Raycaster();
    const candidates = [];
    for (let y = -0.8; y <= 0.8; y += 0.08) {
      for (let x = -0.8; x <= 0.8; x += 0.08) {
        raycaster.setFromCamera(new Vector2(x, y), viewer.camera);
        const hit = raycaster.intersectObjects(viewer.model.children, true)[0];
        if (hit) candidates.push({ x: rect.left + (x + 1) * rect.width / 2, y: rect.top + (1 - y) * rect.height / 2, point: hit.point.toArray() });
      }
    }
    for (const first of candidates) {
      const second = candidates.find(candidate => Math.hypot(...candidate.point.map((value, axis) => value - first.point[axis])) > 10);
      if (second) return [first, second];
    }
    return [];
  });
  expect(points).toHaveLength(2);
  await page.locator('#measure-tolerance').selectOption('0.4');

  await page.mouse.click(points[0].x, points[0].y);
  await expect(page.locator('#measurement-readout')).toContainText('First point');
  await page.mouse.click(points[1].x, points[1].y);

  const expectedDelta = points[1].point.map((value, axis) => value - points[0].point[axis]);
  const expectedDistance = Math.hypot(...expectedDelta);
  await expect(page.locator('#measurement-readout')).toContainText(`Distance ${expectedDistance.toFixed(3)} mm`);
  await expect(page.locator('#measurement-readout')).toContainText(`ΔX ${expectedDelta[0] >= 0 ? '+' : ''}${expectedDelta[0].toFixed(3)} mm`);
  await expect(page.locator('#measurement-readout')).toContainText('gap target');
  await expect(page.locator('#measure-toggle')).toHaveAttribute('aria-pressed', 'false');
  const result = await page.evaluate(() => window.__bridge.measurements.at(-1));
  expect(result.distance).toBeCloseTo(expectedDistance, 3);
  expect(result.units).toBe('mm');
  expect(result.tolerance).toBe(0.4);
  expect(result.withinTolerance).toBe(expectedDistance <= 0.4);

  await page.locator('#measure-copy').click();
  expect(await page.evaluate(() => window.__bridge.copiedMeasurements.at(-1))).toEqual(result);
  await page.locator('#measure-clear').click();
  await expect(page.locator('#measurement-readout')).toBeHidden();
  const overlayChildren = await page.evaluate(async () => (await import('/extension/media/main.js')).viewer.scene.getObjectByName('measurement-annotation').children.length);
  expect(overlayChildren).toBe(0);
});

test('sampled interference audit finds moving named parts that overlap at t=1', async ({ page }) => {
  const source = 'audit_part("fixed") cube([5,5,5]);\ntranslate([10-10*$t,0,0]) audit_part("slider") cube([5,5,5]);';
  await page.evaluate(text => window.__bridge.edit(text), source);
  await page.locator('#preview').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#audit-tab').click();
  await page.locator('#audit-samples').fill('3');
  await page.locator('#audit-epsilon').fill('0.0001');
  await page.locator('#audit-run').click();
  await expect(page.locator('#audit-status')).toContainText('1 overlapping component pair', { timeout: 15_000 });
  await expect(page.locator('#audit-results')).toContainText('fixed ↔ slider');
  await expect(page.locator('#audit-results')).toContainText('$t = 1.000');
  await expect(page.locator('#audit-results')).toContainText('125');
  await expect(page.locator('#audit-results')).toHaveAttribute('data-state', 'collision');
});

test('sampled interference audit asks for named parts instead of reporting a false clear result', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit('cube(5);'));
  await page.locator('#preview').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#audit-tab').click();
  await page.locator('#audit-samples').fill('2');
  await page.locator('#audit-run').click();
  await expect(page.locator('#audit-status')).toContainText('Mark at least two 3D parts', { timeout: 15_000 });
  await expect(page.locator('#audit-results')).not.toContainText('No overlap');
});

test('audit accepts the full 64-part component budget', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit(
    'for(i=[0:63]) translate([3*i,0,0]) audit_part(str("part",i)) cube(1);'
  ));
  await compile(page);
  await page.locator('#audit-tab').click();
  await page.locator('#audit-samples').fill('2');
  await page.locator('#audit-run').click();
  await expect(page.locator('#audit-results')).toHaveAttribute('data-state', 'clear', { timeout: 15_000 });
  await expect(page.locator('#audit-status')).toContainText('No overlap above');
  const requests = await page.evaluate(() => window.__bridge.compiles.filter(message => message.auditOnly));
  expect(requests).toHaveLength(2);
  expect(requests.every(message => message.maxAuditComponents === 64)).toBe(true);
});

test('audit distinguishes contact, clearance and overlap without replacing the preview', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit(
    'audit_part("fixed") cube(5); translate([5.1-0.2*$t,0,0]) audit_part("slider") cube(5);'
  ));
  await compile(page);
  const beforeStats = await stats(page);
  const beforeCamera = await camera(page);
  await page.locator('#audit-tab').click();
  await expect(page.locator('#audit-clearance')).toHaveValue('0.2');
  await page.locator('#audit-samples').fill('3');
  await page.locator('#audit-run').click();
  await expect(page.locator('#audit-status')).toContainText('1 under-clearance and 1 touching pair(s)', { timeout: 15_000 });
  await expect(page.locator('#audit-results > [data-kind="clearance"]')).toContainText('min gap 0.1000 mm');
  await expect(page.locator('#audit-results > [data-kind="clearance"]')).toContainText('worst at $t = 0.000');
  await expect(page.locator('#audit-results > [data-kind="contact"]')).toContainText('$t = 0.500');
  await expect(page.locator('#audit-results > [data-kind="interference"]')).toContainText('max overlap 2.5000 mm³');
  await expect(page.locator('#audit-results > [data-kind="interference"]')).toContainText('worst at $t = 1.000');
  expect(await stats(page)).toEqual(beforeStats);
  const afterCamera = await camera(page);
  for (const name of ['eye', 'target', 'up']) {
    afterCamera[name].forEach((value, index) => expect(value).toBeCloseTo(beforeCamera[name][index], 7));
  }
  expect(afterCamera.projection).toBe(beforeCamera.projection);
  expect(afterCamera.fov).toBe(beforeCamera.fov);
  const requests = await page.evaluate(() => window.__bridge.compiles.filter(message => message.auditOnly));
  expect(requests).toHaveLength(3);
  expect(requests.every(message => message.auditClearance === 0.2)).toBe(true);
});

test('audit shows a clearance warning without calling it an overlap, and zero disables gap checks', async ({ page }) => {
  await page.evaluate(() => window.__bridge.edit(
    'audit_part("fixed") cube(5); translate([5.1,0,0]) audit_part("slider") cube(5);'
  ));
  await compile(page);
  await page.locator('#audit-tab').click();
  await page.locator('#audit-samples').fill('2');
  await page.locator('#audit-run').click();
  await expect(page.locator('#audit-status')).toContainText('No overlap above', { timeout: 15_000 });
  await expect(page.locator('#audit-results')).toHaveAttribute('data-state', 'clearance');
  await expect(page.locator('#audit-results > [data-kind="clearance"]')).toContainText('$t = 0.000, 1.000');
  await expect(page.locator('#audit-run')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#audit-clearance').fill('0');
  await page.locator('#audit-run').click();
  await expect(page.locator('#audit-results')).toHaveAttribute('data-state', 'clear', { timeout: 15_000 });
  await expect(page.locator('#audit-results')).toBeEmpty();
});

test('audit rejects invalid clearance before compiling', async ({ page }) => {
  await page.locator('#audit-tab').click();
  await page.locator('#audit-clearance').fill('-1');
  const before = await page.evaluate(() => window.__bridge.compiles.length);
  await page.locator('#audit-run').click();
  await expect(page.locator('#audit-status')).toContainText('clearance from 0–100 mm');
  expect(await page.evaluate(() => window.__bridge.compiles.length)).toBe(before);
});

test('robot hand exercise validates Customizer, animation, telemetry, slicing and snapshot together', async ({ page }, testInfo) => {
  // Three compilations each allow 30 seconds; leave time for the viewer interactions too.
  test.setTimeout(120_000);
  const source = await readFile(new URL('../../references/scad sample files/hand.scad', import.meta.url), 'utf8');
  await page.evaluate(text => window.__bridge.edit(text), source);
  await page.locator('#preview').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(page.locator('#messages')).toBeHidden();

  const firstMetrics = await page.evaluate(() => window.__bridge.sent.filter(message => message.type === 'modelMetrics').at(-1)?.metrics);
  expect(firstMetrics).toBeDefined();
  expect(firstMetrics.triangles).toBeGreaterThan(1000);
  expect(firstMetrics.volume).toBeGreaterThan(0);
  expect(firstMetrics.layers.background).toBeGreaterThan(0);
  await expect(page.locator('#summary')).toContainText('mm');

  await page.locator('#customizer-tab').click();
  const testVar = page.locator('#parameter-controls input[type="number"]').first();
  await expect(testVar).toBeVisible();
  const compileCount = await page.evaluate(() => window.__bridge.compiles.length);
  await testVar.fill('0.5');
  await testVar.dispatchEvent('change');
  await expect.poll(() => page.evaluate(count => window.__bridge.compiles.length, compileCount), { timeout: 15_000 }).toBeGreaterThan(compileCount);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  const parameterRequest = await page.evaluate(() => window.__bridge.compiles.at(-1));
  expect(parameterRequest.defines.test_var).toBe(0.5);

  await page.locator('#animation-tab').click();
  const beforeFrameCount = await page.evaluate(() => window.__bridge.compiles.length);
  await page.locator('#animation-scrub').evaluate(input => { input.value = '0.5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(count => window.__bridge.compiles.length, beforeFrameCount), { timeout: 15_000 }).toBeGreaterThan(beforeFrameCount);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  expect((await page.evaluate(() => window.__bridge.compiles.at(-1))).time).toBe(0.5);

  await page.locator('#slice-tab').click();
  await page.locator('#fit').click();
  await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    viewer.renderer.render(viewer.scene, viewer.camera);
    const gl = viewer.renderer.getContext();
    const canvas = viewer.renderer.domElement;
    window.__handPixelsBeforeSlice = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, window.__handPixelsBeforeSlice);
  });
  await page.screenshot({ path: testInfo.outputPath('robot-hand-before-slice.png'), fullPage: true });
  await page.locator('#slice-enabled').check();
  const clippingState = await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    const planes = [];
    viewer.model.traverse(object => {
      if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const plane of material.clippingPlanes ?? []) planes.push({ normal: plane.normal.toArray(), constant: plane.constant });
      }
    });
    return { planes, localClippingEnabled: viewer.renderer.localClippingEnabled, bounds: [viewer.bounds.min.toArray(), viewer.bounds.max.toArray()] };
  });
  expect(clippingState.planes.length).toBeGreaterThan(0);
  const changedPixels = await page.evaluate(async () => {
    const { viewer } = await import('/extension/media/main.js');
    viewer.renderer.render(viewer.scene, viewer.camera);
    const gl = viewer.renderer.getContext();
    const canvas = viewer.renderer.domElement;
    const after = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, after);
    let changed = 0;
    for (let i = 0; i < after.length; i += 4) {
      if (after[i] !== window.__handPixelsBeforeSlice[i] || after[i + 1] !== window.__handPixelsBeforeSlice[i + 1] || after[i + 2] !== window.__handPixelsBeforeSlice[i + 2]) changed++;
    }
    return changed;
  });
  await page.screenshot({ path: testInfo.outputPath('robot-hand-slice-enabled.png'), fullPage: true });
  expect(changedPixels).toBeGreaterThan(100);

  await page.locator('#measure-toggle').click();
  const handPoints = await page.evaluate(async () => {
    const { Raycaster, Vector2 } = await import('/node_modules/three/build/three.module.js');
    const { viewer } = await import('/extension/media/main.js');
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const raycaster = new Raycaster();
    const candidates = [];
    for (let y = -0.8; y <= 0.8; y += 0.08) {
      for (let x = -0.8; x <= 0.8; x += 0.08) {
        raycaster.setFromCamera(new Vector2(x, y), viewer.camera);
        const hits = raycaster.intersectObjects(viewer.model.children, true);
        const hit = hits.find(intersection => {
          const materials = Array.isArray(intersection.object.material) ? intersection.object.material : [intersection.object.material];
          const material = materials[intersection.face?.materialIndex ?? 0] ?? materials[0];
          return !material?.clippingPlanes?.some(plane => plane.distanceToPoint(intersection.point) < -1e-5);
        });
        if (hit) {
          const candidate = { x: rect.left + (x + 1) * rect.width / 2, y: rect.top + (1 - y) * rect.height / 2, point: hit.point.toArray() };
          const first = candidates.find(first => Math.hypot(...candidate.point.map((value, axis) => value - first.point[axis])) > 3);
          if (first) return [first, candidate];
          candidates.push(candidate);
        }
      }
    }
    return [];
  });
  expect(handPoints).toHaveLength(2);
  await page.mouse.click(handPoints[0].x, handPoints[0].y);
  await page.mouse.click(handPoints[1].x, handPoints[1].y);
  await expect(page.locator('#measurement-readout')).toContainText('Distance');
  await expect(page.locator('#measure-copy')).toBeEnabled();
  await page.locator('#measure-copy').click();
  expect(await page.evaluate(() => window.__bridge.copiedMeasurements.at(-1)?.units)).toBe('mm');

  await page.locator('#snapshot').click();
  await expect.poll(() => page.evaluate(() => window.__bridge.sent.some(message => message.type === 'snapshotCaptured' && message.dataUrl.startsWith('data:image/png;base64,')))).toBe(true);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`nonblank interactive canvas and fitted controls at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await compile(page);
    const report = await page.evaluate(async () => {
      const { viewer } = await import('/extension/media/main.js');
      viewer.renderer.render(viewer.scene, viewer.camera);
      const gl = viewer.renderer.getContext();
      const canvas = viewer.renderer.domElement;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
      return { colors: colors.size, overflow: document.documentElement.scrollWidth > innerWidth, width: canvas.width, height: canvas.height };
    });
    expect(report.colors).toBeGreaterThan(100);
    expect(report.width).toBeGreaterThan(200);
    expect(report.height).toBeGreaterThan(200);
    expect(report.overflow).toBe(false);
    const before = await camera(page);
    const box = await page.locator('#viewport canvas[aria-label="3D model preview"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    expect(await camera(page)).not.toEqual(before);
    await page.locator('#projection').click();
    expect((await camera(page)).projection).toBe('orthographic');
    await page.locator('#wireframe').click();
    await expect(page.locator('#wireframe')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#fit').click();
    await page.screenshot({ path: testInfo.outputPath(`preview-${viewport.width}.png`), fullPage: true });
  });
}