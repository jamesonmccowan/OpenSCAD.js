import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import htmlModule from '../src/html.cjs';

const SAMPLE = new URL('../../references/scad sample files/viewer-calibration.gcode', import.meta.url);
const message = (text, extra = {}) => { const bytes = Buffer.from(text); return { type: 'load', data: bytes.toString('base64'), size: bytes.length, reload: false, ...extra }; };

async function open(page, initial, name = 'part.gcode') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(initial => {
    window.gcodeHost = { sent: [] };
    window.acquireVsCodeApi = () => ({ postMessage: message => {
      window.gcodeHost.sent.push(message);
      if (message.type === 'ready') window.postMessage(initial, '*');
    } });
  }, initial);
  await page.route('**/gcode-harness', route => route.fulfill({ contentType: 'text/html', body: htmlModule.gcodeHtml("'self'", '/extension/media/gcode.js', '/extension/media/style.css', name) }));
  await page.goto('/gcode-harness');
  return errors;
}

const preview = page => page.evaluate(async () => {
  const { preview } = await import('/extension/media/gcode.js');
  const group = preview.scene.getObjectByName('allLayers');
  return { startLayer: preview.startLayer, endLayer: preview.endLayer, renderTravel: preview.renderTravel, renderTubes: preview.renderTubes, objects: group?.children.length ?? 0, camera: preview.camera.position.toArray(), target: preview.controls.target.toArray() };
});

// Two 10 × 10 mm square perimeters with absolute extrusion and no slicer metadata.
function squares(layers = 2, side = 10) {
  const lines = ['G21', 'G90', 'M82', 'G92 E0', 'G1 X5 Y5 F6000'];
  let e = 0;
  for (let layer = 1; layer <= layers; layer++) {
    lines.push(`G1 Z${(layer * 0.2).toFixed(1)}`);
    for (const [x, y] of [[5 + side, 5], [5 + side, 5 + side], [5, 5 + side], [5, 5]]) lines.push(`G1 X${x} Y${y} E${(e += 0.5).toFixed(2)} F1800`);
  }
  return lines.join('\n') + '\n';
}

test('sample G-code renders with slicer metadata, layer range, travel and Open as Text', async ({ page }) => {
  const errors = await open(page, message(await readFile(SAMPLE, 'utf8')), 'viewer-calibration.gcode');
  await expect(page.locator('#status')).toHaveText('Loaded', { timeout: 20_000 });
  await expect(page.locator('#summary')).toContainText('55 layers |');
  await expect(page.locator('#summary')).toContainText('20 × 10 × 10.8 mm');
  await expect(page.locator('#summary')).toContainText('111 mm filament (0.28 g) | est. 2m 3s | Synthetic test printer | OpenSCAD.js fixture generator');
  await expect(page.locator('#layer-end')).toHaveAttribute('max', '55');
  await expect(page.locator('#layer-label')).toHaveText('1–55 of 55 · Z 11 mm');
  expect((await preview(page)).objects).toBeGreaterThan(0);

  await page.locator('#layer-end').fill('10');
  await page.locator('#layer-start').fill('10');
  await expect(page.locator('#layer-label')).toHaveText('10 of 55 · Z 2 mm');
  await expect.poll(async () => (await preview(page)).startLayer).toBe(11);
  expect((await preview(page)).endLayer).toBe(11);
  await page.locator('#layer-start').fill('20');
  await expect(page.locator('#layer-end')).toHaveValue('20');

  await page.locator('#show-travel').check();
  await expect.poll(async () => (await preview(page)).renderTravel).toBe(true);
  await page.locator('#show-tubes').check();
  await expect.poll(async () => (await preview(page)).renderTubes).toBe(true);

  const before = (await preview(page)).camera;
  await page.locator('button[data-direction="top"]').click();
  const top = await preview(page);
  expect(top.camera).not.toEqual(before);
  expect(top.camera[1] - top.target[1]).toBeGreaterThan(0);
  await page.locator('#zoom-in').click();
  await page.locator('#fit').click();
  await page.locator('#reset-view').click();
  await page.locator('#open-text').click();
  expect(await page.evaluate(() => window.gcodeHost.sent.map(sent => sent.type))).toEqual(['ready', 'openText']);
  expect(errors).toEqual([]);
});

test('G-code without metadata uses detected layers and keeps the camera on reload', async ({ page }) => {
  const errors = await open(page, message(squares()));
  await expect(page.locator('#status')).toHaveText('Loaded');
  await expect(page.locator('#summary')).toHaveText('2 layers | 10 × 10 × 0.2 mm | 1 KB');
  await expect(page.locator('#layer-label')).toHaveText('1–2 of 2 · Z 0.4 mm');
  await page.locator('#zoom-out').click();
  const camera = (await preview(page)).camera;
  await page.evaluate(value => window.postMessage(value, '*'), message(squares(3, 20), { reload: true }));
  await expect(page.locator('#status')).toHaveText('Reloaded');
  await expect(page.locator('#summary')).toContainText('3 layers | 20 × 20 × 0.4 mm');
  (await preview(page)).camera.forEach((value, axis) => expect(value).toBeCloseTo(camera[axis], 6));
  expect(errors).toEqual([]);
});

test('G-code without extrusion and host errors are reported', async ({ page }) => {
  await open(page, message('G28\nG1 X10 Y10 F3000\n'));
  await expect(page.locator('#status')).toHaveText('Load failed');
  await expect(page.locator('#messages')).toContainText('G-code contains no extrusion moves');
  await page.evaluate(value => window.postMessage(value, '*'), message(squares()));
  await expect(page.locator('#status')).toHaveText('Loaded');
  await page.evaluate(() => window.postMessage({ type: 'error', message: 'File exceeds the 100 MB viewer limit' }, '*'));
  await expect(page.locator('#status')).toHaveText('Load failed; previous G-code retained');
  await page.evaluate(() => window.postMessage({ type: 'deleted' }, '*'));
  await expect(page.locator('#status')).toHaveText('File deleted');
});
