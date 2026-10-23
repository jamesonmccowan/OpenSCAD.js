import { WebGLPreview } from 'gcode-preview';
import { Color } from 'three';
import { createIcons, Scan, RotateCcw, ZoomIn, ZoomOut, FileText } from 'lucide';
import { base64ToBytes } from './model-formats.js';
import { analyzeToolpath, formatDuration, parseGcodeInfo } from './gcode-info.mjs';

const BACKGROUND = '#cbd1c9';
const DEFAULT_EXTRUSION = '#3a7bd5';
const hsl = {};

// Keep very dark or very light filament colours distinguishable on the light background.
function displayColour(hex) {
  const colour = new Color(hex).getHSL(hsl);
  return new Color().setHSL(hsl.h, hsl.s, Math.min(0.8, Math.max(0.3, hsl.l)));
}
// World space is Y-up: gcode-preview maps G-code (x, y, z) to (x - bedX/2, z, bedY/2 - y).
const DIRECTIONS = { iso: [0.6, 0.8, 1], right: [1, 0, 0], left: [-1, 0, 0], back: [0, 0, -1], front: [0, 0, 1], top: [0, 1, 0.0001] };

const host = acquireVsCodeApi();
createIcons({ icons: { Scan, RotateCcw, ZoomIn, ZoomOut, FileText } });
const canvas = document.querySelector('#gcode-canvas');
const status = document.querySelector('#status');
const summary = document.querySelector('#summary');
const messages = document.querySelector('#messages');
const layerStart = document.querySelector('#layer-start');
const layerEnd = document.querySelector('#layer-end');
const layerLabel = document.querySelector('#layer-label');
const travel = document.querySelector('#show-travel');
const tubes = document.querySelector('#show-tubes');

export const preview = new WebGLPreview({ canvas, backgroundColor: BACKGROUND, renderTravel: false, travelColor: '#b04a3b' });
let loaded;
let fitted = false;
let loadGeneration = 0;
let renderQueued = false;

new ResizeObserver(() => preview.resize()).observe(document.querySelector('#viewport'));

function setStatus(text, state) {
  status.textContent = text;
  status.dataset.state = state;
}

function showError(text) {
  messages.replaceChildren(Object.assign(document.createElement('div'), { className: 'error', textContent: text }));
  messages.hidden = false;
}

const formatNumber = value => Number(value.toFixed(2)).toString();
const formatBytes = value => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1000))} KB`;

function worldBox({ min, max }, bed) {
  return { min: [min[0] - bed.x / 2, min[2], bed.y / 2 - max[1]], max: [max[0] - bed.x / 2, max[2], bed.y / 2 - min[1]] };
}

function frame(direction) {
  if (!loaded) return;
  const { camera, controls } = preview;
  const { min, max } = loaded.box;
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const radius = Math.max(1, Math.hypot(...max.map((value, axis) => value - min[axis])) / 2);
  const distance = radius / Math.sin(camera.fov * Math.PI / 360) * 1.1;
  const length = Math.hypot(...direction);
  controls.target.set(...center);
  camera.position.set(...center.map((value, axis) => value + direction[axis] / length * distance));
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = Math.max(2000, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

function currentDirection() {
  const { camera, controls } = preview;
  return ['x', 'y', 'z'].map(axis => camera.position[axis] - controls.target[axis]);
}

function zoomBy(factor) {
  const { camera, controls } = preview;
  camera.position.sub(controls.target).divideScalar(factor).add(controls.target);
  controls.update();
}

function updateLayerLabel() {
  if (!loaded) return;
  const start = Number(layerStart.value), end = Number(layerEnd.value);
  const z = loaded.layerZ[end];
  layerLabel.textContent = `${start === end ? start : `${start}–${end}`} of ${loaded.layerCount}${z == null ? '' : ` · Z ${formatNumber(z)} mm`}`;
}

function renderLayers() {
  if (!loaded) return;
  const start = Number(layerStart.value), end = Number(layerEnd.value);
  // Index 0 is the start G-code preamble; include its travel moves only with the first layer.
  preview.startLayer = start === 1 ? 1 : start + 1;
  preview.endLayer = end + 1;
  preview.renderTravel = travel.checked;
  preview.renderTubes = tubes.checked;
  preview.render();
}

function queueRender() {
  updateLayerLabel();
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    try { renderLayers(); } catch (error) { setStatus('Render failed', 'stale'); showError(error.message); }
  });
}

async function load(message) {
  const generation = ++loadGeneration;
  setStatus('Loading...', 'busy');
  messages.hidden = true;
  // Let the loading state paint before synchronous parsing of large files.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (generation !== loadGeneration) return;
  try {
    if (typeof message.data !== 'string') throw new Error('G-code data was not received');
    const bytes = base64ToBytes(message.data);
    if (Number.isInteger(message.size) && bytes.byteLength !== message.size) throw new Error(`G-code transfer was truncated: received ${bytes.byteLength} of ${message.size} bytes`);
    const text = new TextDecoder().decode(bytes);
    const info = parseGcodeInfo(text);
    preview.clear();
    preview.parser.parseGCode(text);
    const { bounds, layerZ } = analyzeToolpath(preview.layers);
    const layerCount = preview.layers.length - 1;
    if (!bounds || layerCount < 1) throw new Error('G-code contains no extrusion moves');
    const bed = info.bed ?? { x: Math.ceil(bounds.max[0] + 10), y: Math.ceil(bounds.max[1] + 10) };
    preview.buildVolume = { ...bed, z: info.printableHeight ?? Math.ceil(bounds.max[2] + 10) };
    const colours = info.colours.map(displayColour);
    preview.extrusionColor = colours[0] ?? DEFAULT_EXTRUSION;
    // gcode-preview only accepts tool colours in its constructor options.
    preview._toolColors = Object.fromEntries(colours.map((colour, tool) => [tool, colour]));
    loaded = { box: worldBox(bounds, bed), layerZ, layerCount };
    for (const slider of [layerStart, layerEnd]) { slider.max = String(layerCount); slider.disabled = false; }
    layerStart.value = '1';
    layerEnd.value = String(layerCount);
    updateLayerLabel();
    renderLayers();
    if (!fitted) { frame(DIRECTIONS.iso); fitted = true; }
    const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
    const filament = info.filamentMm ? `${formatNumber(info.filamentMm)} mm filament${info.filamentG ? ` (${formatNumber(info.filamentG)} g)` : ''}` : info.filamentG ? `${formatNumber(info.filamentG)} g filament` : null;
    summary.textContent = [
      `${layerCount.toLocaleString('en-US')} layers`,
      `${size.map(formatNumber).join(' × ')} mm`,
      filament,
      info.seconds ? `est. ${formatDuration(info.seconds)}` : null,
      info.printer,
      info.slicer,
      formatBytes(message.size ?? bytes.byteLength),
    ].filter(Boolean).join(' | ');
    setStatus(message.reload ? 'Reloaded' : 'Loaded', 'ready');
  } catch (error) {
    if (generation !== loadGeneration) return;
    setStatus(loaded ? 'Load failed; previous G-code retained' : 'Load failed', 'stale');
    showError(error.message);
  }
}

window.addEventListener('message', event => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'load') void load(message);
  else if (message.type === 'error') { loadGeneration++; setStatus(loaded ? 'Load failed; previous G-code retained' : 'Load failed', 'stale'); showError(message.message); }
  else if (message.type === 'deleted') { loadGeneration++; setStatus('File deleted', 'stale'); }
});

layerStart.addEventListener('input', () => {
  if (Number(layerStart.value) > Number(layerEnd.value)) layerEnd.value = layerStart.value;
  queueRender();
});
layerEnd.addEventListener('input', () => {
  if (Number(layerEnd.value) < Number(layerStart.value)) layerStart.value = layerEnd.value;
  queueRender();
});
travel.addEventListener('change', queueRender);
tubes.addEventListener('change', queueRender);
document.querySelector('#fit').addEventListener('click', () => frame(currentDirection()));
document.querySelector('#zoom-in').addEventListener('click', () => zoomBy(1.25));
document.querySelector('#zoom-out').addEventListener('click', () => zoomBy(0.8));
document.querySelector('#reset-view').addEventListener('click', () => frame(DIRECTIONS.iso));
for (const button of document.querySelectorAll('[data-direction]')) button.addEventListener('click', () => frame(DIRECTIONS[button.dataset.direction]));
document.querySelector('#open-text').addEventListener('click', () => host.postMessage({ type: 'openText' }));
window.addEventListener('unload', () => preview.dispose());
host.postMessage({ type: 'ready' });
