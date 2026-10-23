import { Viewer } from '../../src/viewer/viewer.js';
import { exportStl } from '../../src/geometry/stl.js';
import { createIcons, Scan, View, Grid3x3, RotateCcw, ZoomIn, ZoomOut, Download, Upload } from 'lucide';
import { bytesToBase64, decodeModel, MAX_MODEL_TRIANGLES } from './model-formats.js';

export const MAX_STL_TRIANGLES = MAX_MODEL_TRIANGLES;

const host = acquireVsCodeApi();
export const viewer = new Viewer(document.querySelector('#viewport'));
createIcons({ icons: { Scan, View, Grid3x3, RotateCcw, ZoomIn, ZoomOut, Download, Upload } });
const format = document.body.dataset.format ?? 'stl';
const convertButton = document.querySelector('#convert-stl');
let currentMesh;
const status = document.querySelector('#status');
const summary = document.querySelector('#summary');
const messages = document.querySelector('#messages');
let loadGeneration = 0;

function setStatus(text, state) {
  status.textContent = text;
  status.dataset.state = state;
}

function showError(text) {
  messages.replaceChildren(Object.assign(document.createElement('div'), { className: 'error', textContent: text }));
  messages.hidden = false;
}

export function analyzeStl(mesh) {
  const positions = mesh.vertProperties;
  const indices = mesh.triVerts;
  const vertexCount = positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  const edges = new Map();
  let signedVolume = 0;
  const point = (vertex, axis) => positions[vertex * 3 + axis];
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index], b = indices[index + 1], c = indices[index + 2];
    signedVolume += (
      point(a, 0) * (point(b, 1) * point(c, 2) - point(b, 2) * point(c, 1))
      - point(a, 1) * (point(b, 0) * point(c, 2) - point(b, 2) * point(c, 0))
      + point(a, 2) * (point(b, 0) * point(c, 1) - point(b, 1) * point(c, 0))
    ) / 6;
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(start, end) * vertexCount + Math.max(start, end);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edges.values()) {
    if (count === 1) openEdges++;
    else if (count > 2) nonManifoldEdges++;
  }
  const triangles = indices.length / 3;
  const watertight = triangles > 0 && openEdges === 0 && nonManifoldEdges === 0;
  return { triangles, min, max, size: max.map((value, axis) => value - min[axis]), watertight, openEdges, nonManifoldEdges, volume: watertight ? Math.abs(signedVolume) : null };
}

const formatNumber = value => Number(value.toFixed(2)).toString();
const formatBytes = value => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1000))} KB`;

async function load(message) {
  const generation = ++loadGeneration;
  setStatus('Loading...', 'busy');
  messages.hidden = true;
  // Let the loading state paint before synchronous parsing of large files.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (generation !== loadGeneration) return;
  try {
    const mesh = decodeModel(message, format);
    const size = message.size;
    const metrics = analyzeStl(mesh);
    if (!metrics.triangles) throw new Error('Model contains no non-degenerate triangles');
    viewer.setModel({
      empty: false,
      materials: {},
      volume: metrics.volume ?? 0,
      bounds: [metrics.min, metrics.max],
      getMesh: () => mesh,
      getOverlays: () => [],
    });
    const quality = metrics.watertight ? `${formatNumber(metrics.volume)} mm³ | Watertight` : `Not watertight: ${metrics.openEdges} open, ${metrics.nonManifoldEdges} non-manifold edges`;
    summary.textContent = `${metrics.triangles.toLocaleString('en-US')} triangles | ${metrics.size.map(formatNumber).join(' × ')} mm | ${quality} | ${formatBytes(size)}`;
    summary.dataset.watertight = String(metrics.watertight);
    currentMesh = mesh;
    if (convertButton) convertButton.disabled = false;
    setStatus(message.reload ? 'Reloaded' : 'Loaded', 'ready');
  } catch (error) {
    if (generation !== loadGeneration) return;
    setStatus(viewer.model.children.length ? 'Load failed; previous model retained' : 'Load failed', 'stale');
    showError(error.message);
  }
}

window.addEventListener('message', event => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'load') void load(message);
  else if (message.type === 'loading') { messages.hidden = true; setStatus('Tessellating STEP...', 'busy'); }
  else if (message.type === 'saved') { if (convertButton) convertButton.disabled = !currentMesh; setStatus(`Saved ${message.name}`, 'ready'); }
  else if (message.type === 'saveCancelled') { if (convertButton) convertButton.disabled = !currentMesh; setStatus('Loaded', 'ready'); }
  else if (message.type === 'saveError') { if (convertButton) convertButton.disabled = !currentMesh; setStatus('Conversion failed', 'stale'); showError(message.message); }
  else if (message.type === 'error') { loadGeneration++; setStatus(viewer.model.children.length ? 'Load failed; previous model retained' : 'Load failed', 'stale'); showError(message.message); }
  else if (message.type === 'deleted') { loadGeneration++; setStatus('File deleted', 'stale'); }
});

document.querySelector('#fit').addEventListener('click', () => viewer.fit());
document.querySelector('#use-reference').addEventListener('click', () => host.postMessage({ type: 'useReference' }));
document.querySelector('#zoom-in').addEventListener('click', () => viewer.zoomBy(1.25));
document.querySelector('#zoom-out').addEventListener('click', () => viewer.zoomBy(0.8));
document.querySelector('#reset-view').addEventListener('click', () => viewer.resetView());
for (const button of document.querySelectorAll('[data-direction]')) button.addEventListener('click', () => viewer.setDirection(button.dataset.direction));
document.querySelector('#projection').setAttribute('aria-pressed', 'false');
document.querySelector('#projection').addEventListener('click', event => {
  viewer.setProjection(viewer.projection === 'perspective' ? 'orthographic' : 'perspective');
  event.currentTarget.setAttribute('aria-pressed', String(viewer.projection === 'orthographic'));
});
document.querySelector('#show-axes').addEventListener('change', event => {
  viewer.setAxesVisible(event.currentTarget.checked);
  if (!event.currentTarget.checked) document.querySelector('#show-marks').checked = false;
});
document.querySelector('#show-marks').addEventListener('change', event => {
  viewer.setMarksVisible(event.currentTarget.checked);
  if (event.currentTarget.checked) document.querySelector('#show-axes').checked = true;
});
document.querySelector('#wireframe').setAttribute('aria-pressed', 'false');
document.querySelector('#wireframe').addEventListener('click', event => {
  viewer.setWireframe(!viewer.wireframe);
  event.currentTarget.setAttribute('aria-pressed', String(viewer.wireframe));
});
if (convertButton) convertButton.disabled = true;
convertButton?.addEventListener('click', () => {
  if (!currentMesh) return;
  convertButton.disabled = true;
  messages.hidden = true;
  setStatus('Converting...', 'busy');
  try {
    const bytes = exportStl(currentMesh, { omitDegenerate: true });
    host.postMessage({ type: 'saveStl', data: bytesToBase64(bytes), size: bytes.byteLength });
  } catch (error) {
    convertButton.disabled = false;
    setStatus('Conversion failed', 'stale');
    showError(error.message);
  }
});
window.addEventListener('unload', () => viewer.dispose());
host.postMessage({ type: 'ready' });
