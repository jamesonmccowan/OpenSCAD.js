const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gcodeHtml, previewHtml, stlHtml } = require('../src/html.cjs');

test('preview uses restrictive CSP, external assets and explicit controls', () => {
  const html = previewHtml('https://assets.example', 'https://assets.example/main.js', 'https://assets.example/style.css');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /worker-src blob:/);
  assert.match(html, /wasm-unsafe-eval/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.match(html, /Out of Date/);
  for (const name of ['preview', 'render', 'cancel', 'fit', 'zoom-in', 'zoom-out', 'reset-view', 'view-right', 'view-left', 'view-back', 'view-front', 'view-top', 'view-bottom', 'projection', 'show-axes', 'show-marks', 'measure-toggle', 'measure-copy', 'measure-clear', 'snapshot', 'export']) assert.match(html, new RegExp(`id="${name}"`));
});

test('asset URLs cannot inject HTML attributes', () => {
  const html = previewHtml('source', 'bad" onerror="alert(1)', 'style');
  assert.match(html, /bad&amp;|bad&quot;/);
  assert.doesNotMatch(html, /src="bad" onerror=/);
});

test('preview tools share accessible tabs and start collapsed', () => {
  const html = previewHtml('source', 'script', 'style');
  assert.doesNotMatch(html, /<details|<summary/);
  assert.match(html, /role="tablist" aria-label="Preview tools"/);
  for (const [tab, panel] of [
    ['audit', 'interference-audit'], ['slice', 'cross-section'],
    ['animation', 'animation'], ['customizer', 'customizer'],
    ['references', 'references'],
    ['fonts', 'fonts'],
  ]) {
    assert.match(html, new RegExp(`id="${tab}-tab" role="tab" aria-controls="${panel}-controls" aria-selected="false" tabindex="-1"`));
    assert.match(html, new RegExp(`id="${panel}-controls"[^>]*role="tabpanel" aria-labelledby="${tab}-tab" hidden`));
  }
  assert.match(html, /id="collapse-tab"[^>]*aria-selected="true" tabindex="0"[^>]*>&#9660;<\/button>/);
  assert.match(html, /id="collapsed-controls" role="tabpanel" aria-labelledby="collapse-tab"/);
});
test('STL viewer uses restrictive CSP, nonce scripts and escaped file names', () => {
  const html = stlHtml("'self'", '/media/stl.js', '/media/style.css', '<bad>&.stl');
  const nonce = html.match(/nonce-([A-Za-z0-9+/=_-]+)/)[1];
  assert.match(html, /default-src 'none'/);
  assert.ok(html.includes(`<script nonce="${nonce}" type="module" src="/media/stl.js">`));
  assert.match(html, /&lt;bad&gt;&amp;\.stl/);
  assert.doesNotMatch(html, /<bad>/);
  for (const id of ['viewport', 'summary', 'status', 'wireframe', 'fit', 'use-reference']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-format="stl"/);
  assert.doesNotMatch(html, /convert-stl/);
});
test('model viewer labels STEP and 3MF files and offers Convert to STL', () => {
  for (const [format, label] of [['step', 'STEP'], ['3mf', '3MF']]) {
    const html = stlHtml("'self'", '/media/stl.js', '/media/style.css', `part.${format}`, { format });
    assert.match(html, new RegExp(`data-format="${format}"`));
    assert.match(html, /id="convert-stl"[^>]*>.*Convert to STL/s);
    assert.match(html, new RegExp(label));
  }
  assert.match(stlHtml("'self'", '/media/stl.js', '/media/style.css', 'x', { format: '"><script>' }), /data-format="stl"/);
});

test('G-code viewer uses restrictive CSP, escaped names and layer controls', () => {
  const html = gcodeHtml("'self'", '/media/gcode.js', '/media/style.css', '<bad>&.gcode');
  const nonce = html.match(/nonce-([A-Za-z0-9+/=_-]+)/)[1];
  assert.match(html, /default-src 'none'/);
  assert.ok(html.includes(`<script nonce="${nonce}" type="module" src="/media/gcode.js">`));
  assert.match(html, /&lt;bad&gt;&amp;\.gcode/);
  assert.doesNotMatch(html, /<bad>/);
  for (const id of ['gcode-canvas', 'layer-start', 'layer-end', 'layer-label', 'show-travel', 'show-tubes', 'open-text', 'fit', 'summary', 'status']) assert.match(html, new RegExp(`id="${id}"`));
});
