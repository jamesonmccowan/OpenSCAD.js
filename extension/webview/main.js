import { createWorkerEngine } from '../../src/core/worker-engine.js';
import { Viewer } from '../../src/viewer/viewer.js';
import { Customizer } from '../../src/studio/customizer.js';
import { Animation } from '../../src/studio/animation.js';
import { referenceControls } from './references.js';
import { fontControls } from './fonts.js';
import * as THREE from 'three';
import { createIcons, Eye, Box, Square, Scan, View, Grid3x3, Download, Play, Pause, Save, Trash2, Upload, RotateCcw, Camera, Ruler, Copy, X, ScanSearch, ZoomIn, ZoomOut } from 'lucide';

const icons = {
  ZoomIn, ZoomOut, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
  Eye, Box, Square, Scan, View, Grid3x3, Download, Play, Pause, Save, Trash2, Upload, RotateCcw, Camera, Ruler, Copy, X, ScanSearch,
  eye: Eye, box: Box, square: Square, scan: Scan, view: View, 'grid-3x3': Grid3x3, download: Download, play: Play, pause: Pause, save: Save, 'trash-2': Trash2, upload: Upload, 'rotate-ccw': RotateCcw, camera: Camera, ruler: Ruler, copy: Copy, x: X, 'scan-search': ScanSearch,
};

const host = acquireVsCodeApi();
export const viewer = new Viewer(document.querySelector('#viewport'));
viewer.locked = true;
referenceControls(viewer, host);
fontControls(host);
viewer.renderer.localClippingEnabled = true;
const slicePlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
createIcons({ icons });
const toolTabs = [...document.querySelectorAll('.tool-tabs [role="tab"]')];
function selectToolTab(selected) {
  for (const tab of toolTabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
}
for (const tab of toolTabs) {
  tab.addEventListener('click', () => selectToolTab(tab));
  tab.addEventListener('keydown', event => {
    let index = toolTabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % toolTabs.length;
    else if (event.key === 'ArrowLeft') index = (index + toolTabs.length - 1) % toolTabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = toolTabs.length - 1;
    else return;
    event.preventDefault();
    selectToolTab(toolTabs[index]);
    toolTabs[index].focus();
  });
}
const status = document.querySelector('#status');
const summary = document.querySelector('#summary');
const messages = document.querySelector('#messages');
let config;
let enginePromise;
let controller;
let revision = 0;
let sourceRevision = 0;
let compiledRevision = -1;
let currentJob = 0;
let lastResult;
let currentMetrics;
let measuring = false;
let measurementPoints = [];
let currentMeasurement;
let pointerStart;
const raycaster = new THREE.Raycaster();
const measurementOverlay = new THREE.Group();
measurementOverlay.name = 'measurement-annotation';
measurementOverlay.renderOrder = 1000;
viewer.scene.add(measurementOverlay);
let mode = 'preview';
let busy = false;
let customizerSource;
let previewTimer;
let autoPreviewTimer;
let nextRead = 0;
const pending = new Map();
const workerUrls = new Set();
const animationWaiters = new Map();
const auditWaiters = new Map();
const customizer = new Customizer();
let animation;
let auditGeneration = 0;
let auditRunning = false;

function update() {
  status.textContent = busy ? 'Compiling...' : compiledRevision !== revision ? 'Out of Date' : mode === 'render' ? 'Render ready' : 'Preview ready';
  status.dataset.state = busy ? 'busy' : compiledRevision !== revision ? 'stale' : 'ready';
  for (const name of ['preview', 'render']) document.querySelector(`#${name}`).disabled = !config;
  document.querySelector('#export').disabled = !config || busy;
  document.querySelector('#cancel').disabled = !busy;
  document.querySelector('#animation-play').disabled = !config;
  document.querySelector('#preset-export').disabled = !customizer.presets.size;
  document.querySelector('#preset-delete').disabled = !document.querySelector('#preset-select').value;
  document.querySelector('#measure-copy').disabled = !currentMeasurement;
  document.querySelector('#measure-clear').disabled = !currentMeasurement && measurementPoints.length === 0;
  document.querySelector('#measure-toggle').disabled = !config || viewer.model.children.length === 0;
  document.querySelector('#audit-run').disabled = !config || !auditRunning && busy;
  document.querySelector('#audit-run').setAttribute('aria-pressed', String(auditRunning));
  document.querySelector('#audit-run').title = auditRunning ? 'Stop interference audit' : 'Audit named component interference';
  document.querySelector('#audit-samples').disabled = auditRunning;
  document.querySelector('#audit-epsilon').disabled = auditRunning;
  document.querySelector('#audit-clearance').disabled = auditRunning;
}

function settleAudit(requestId, result) {
  const resolve = auditWaiters.get(requestId);
  if (!resolve) return;
  auditWaiters.delete(requestId);
  resolve(result);
}

function stopAudit(message = 'Audit cancelled') {
  if (!auditRunning) return;
  auditGeneration++;
  auditRunning = false;
  for (const requestId of auditWaiters.keys()) settleAudit(requestId, { success: false, cancelled: true });
  cancel(true, false, true);
  document.querySelector('#audit-status').textContent = message;
  document.querySelector('#audit-results').replaceChildren();
  update();
}

function auditMessage(text, state = '') {
  const status = document.querySelector('#audit-status');
  status.textContent = text;
  const results = document.querySelector('#audit-results');
  results.dataset.state = state;
}

async function runInterferenceAudit() {
  const samples = Number(document.querySelector('#audit-samples').value);
  const epsilon = Number(document.querySelector('#audit-epsilon').value);
  const clearance = Number(document.querySelector('#audit-clearance').value);
  if (!Number.isInteger(samples) || samples < 2 || samples > 20 || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 100 || !Number.isFinite(clearance) || clearance < 0 || clearance > 100) {
    auditMessage('Choose 2–20 samples, a finite overlap threshold from 0–100 mm³ and clearance from 0–100 mm.', 'collision');
    return;
  }
  const auditId = ++auditGeneration;
  auditRunning = true;
  animation.pause();
  clearMeasurement();
  const results = [];
  document.querySelector('#audit-results').replaceChildren();
  const button = document.querySelector('#audit-run');
  button.querySelector('span')?.remove();
  auditMessage(`Sampling ${samples} poses from $t = 0 to 1…`);
  update();
  try {
    for (let sample = 0; sample < samples; sample++) {
      if (auditId !== auditGeneration) return;
      const time = sample / (samples - 1);
      const requestId = `audit-${auditId}-${sample}`;
      auditMessage(`Checking sample ${sample + 1}/${samples} at $t = ${time.toFixed(3)}…`);
      const frame = await new Promise(resolve => {
        auditWaiters.set(requestId, resolve);
        request('preview', false, { time, requestId, auditOnly: true, auditComponents: true, auditId, maxAuditComponents: 64, interferenceEpsilon: epsilon, auditClearance: clearance });
      });
      if (auditId !== auditGeneration || frame.cancelled) return;
      if (!frame.success) throw new Error(frame.error ?? 'Audit compilation failed');
      results.push(frame);
      if (sample === 0 && frame.report.components.length < 2) {
        auditMessage('Mark at least two 3D parts with unique audit_part("name") wrappers, then run the audit again.', 'collision');
        return;
      }
    }
    const pairs = new Map();
    for (const frame of results) for (const [kind, entries] of [
      ['interference', frame.report.interferences],
      ['clearance', frame.report.clearances],
      ['contact', frame.report.contacts],
    ]) for (const entry of entries) {
      const parts = [...entry.parts].sort();
      const key = JSON.stringify([kind, parts]);
      let finding = pairs.get(key);
      if (!finding) pairs.set(key, finding = { kind, parts, samples: [], maxVolume: 0, minGap: Infinity });
      finding.samples.push(frame.time);
      if (kind === 'interference' && entry.volume > finding.maxVolume) {
        finding.maxVolume = entry.volume;
        finding.worstTime = frame.time;
      } else if (kind === 'clearance' && entry.gap < finding.minGap) {
        finding.minGap = entry.gap;
        finding.worstTime = frame.time;
      }
    }
    const kinds = ['interference', 'clearance', 'contact'];
    const findings = [...pairs.values()].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
    const count = kind => findings.filter(finding => finding.kind === kind).length;
    const container = document.querySelector('#audit-results');
    container.replaceChildren();
    const overlapSummary = count('interference')
      ? `Found ${count('interference')} overlapping component pair${count('interference') === 1 ? '' : 's'}`
      : `No overlap above ${epsilon} mm³`;
    auditMessage(`${overlapSummary}; ${count('clearance')} under-clearance and ${count('contact')} touching pair(s) across ${results.length} samples. This is a sampled audit, not continuous collision detection.`,
      count('interference') ? 'collision' : count('clearance') ? 'clearance' : 'clear');
    for (const finding of findings.slice(0, 100)) {
      const row = document.createElement('div');
      row.dataset.kind = finding.kind;
      const times = finding.samples.map(time => time.toFixed(3)).join(', ');
      const detail = finding.kind === 'interference' ? `max overlap ${finding.maxVolume.toFixed(4)} mm³`
        : finding.kind === 'clearance' ? `min gap ${finding.minGap.toFixed(4)} mm (< ${clearance} mm)`
        : `touching within ${results[0].report.contactTolerance} mm; overlap at or below ${epsilon} mm³`;
      const worst = finding.worstTime === undefined ? '' : ` | worst at $t = ${finding.worstTime.toFixed(3)}`;
      row.textContent = `${finding.kind.toUpperCase()}: ${finding.parts.join(' ↔ ')} | ${detail}${worst} | $t = ${times}`;
      container.append(row);
    }
    if (findings.length > 100) {
      const remainder = document.createElement('div');
      remainder.textContent = `${findings.length - 100} additional findings omitted.`;
      container.append(remainder);
    }
  } catch (error) {
    auditMessage(error.message, 'collision');
  } finally {
    if (auditId === auditGeneration) {
      auditRunning = false;
      compiledRevision = revision;
      update();
    }
  }
}

function clearMeasurement(clearReadout = true) {
  for (const object of measurementOverlay.children) {
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) material.dispose();
  }
  measurementOverlay.clear();
  measurementPoints = [];
  currentMeasurement = undefined;
  if (clearReadout) {
    const readout = document.querySelector('#measurement-readout');
    readout.hidden = true;
    readout.textContent = '';
  }
  update();
}

function drawMeasurementPoint(point, color) {
  const radius = Math.max((viewer.bounds?.getSize(new THREE.Vector3()).length() ?? 50) * 0.006, 0.3);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })
  );
  marker.position.copy(point);
  marker.renderOrder = 1001;
  measurementOverlay.add(marker);
}

function formatDelta(value) { return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`; }

function measureAtPointer(event) {
  if (!measuring || event.button !== 0 || !viewer.model.children.length) return;
  const rect = viewer.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, viewer.camera);
  const hit = raycaster.intersectObjects(viewer.model.children, true).find(intersection => {
    const materials = Array.isArray(intersection.object.material) ? intersection.object.material : [intersection.object.material];
    const material = materials[intersection.face?.materialIndex ?? 0] ?? materials[0];
    return !material?.clippingPlanes?.some(plane => plane.distanceToPoint(intersection.point) < -1e-5);
  });
  const readout = document.querySelector('#measurement-readout');
  readout.hidden = false;
  if (!hit) {
    readout.textContent = 'No visible model surface at that point. Try another spot.';
    return;
  }

  if (measurementPoints.length === 0) {
    clearMeasurement(false);
    measurementPoints = [hit.point.clone()];
    drawMeasurementPoint(hit.point, '#ff4f78');
    readout.textContent = `First point: ${hit.point.x.toFixed(3)}, ${hit.point.y.toFixed(3)}, ${hit.point.z.toFixed(3)} mm. Select the second point.`;
    return;
  }

  const first = measurementPoints[0];
  const second = hit.point.clone();
  const delta = second.clone().sub(first);
  const distance = first.distanceTo(second);
  const tolerance = Number(document.querySelector('#measure-tolerance').value) || null;
  measurementPoints = [first, second];
  drawMeasurementPoint(second, '#ffd166');
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([first, second]),
    new THREE.LineBasicMaterial({ color: '#ffcf4a', depthTest: false, depthWrite: false })
  );
  line.renderOrder = 1002;
  measurementOverlay.add(line);
  currentMeasurement = {
    distance: Number(distance.toFixed(4)),
    delta: { x: Number(delta.x.toFixed(4)), y: Number(delta.y.toFixed(4)), z: Number(delta.z.toFixed(4)) },
    points: [first.toArray().map(value => Number(value.toFixed(4))), second.toArray().map(value => Number(value.toFixed(4)))],
    units: 'mm',
    tolerance,
    withinTolerance: tolerance === null ? null : distance <= tolerance
  };
  const toleranceStatus = tolerance === null ? '' : ` | ${distance <= tolerance ? 'Within' : 'Over'} ${tolerance.toFixed(2)} mm gap target`;
  readout.textContent = `Distance ${distance.toFixed(3)} mm | ΔX ${formatDelta(delta.x)} mm | ΔY ${formatDelta(delta.y)} mm | ΔZ ${formatDelta(delta.z)} mm${toleranceStatus}`;
  host.postMessage({ type: 'measurement', measurement: currentMeasurement });
  measuring = false;
  viewer.element.classList.remove('measuring');
  document.querySelector('#measure-toggle').setAttribute('aria-pressed', 'false');
  update();
}

function updateSlicing() {
  const enabled = document.querySelector('#slice-enabled')?.checked;
  const axis = document.querySelector('#slice-axis')?.value ?? 'z';
  const invert = document.querySelector('#slice-invert')?.checked;
  const slider = document.querySelector('#slice-offset');
  const valueLabel = document.querySelector('#slice-value');

  const box = viewer.bounds;
  let min = 0, max = 100;
  if (box && !box.isEmpty()) {
    if (axis === 'x') { min = box.min.x; max = box.max.x; }
    else if (axis === 'y') { min = box.min.y; max = box.max.y; }
    else { min = box.min.z; max = box.max.z; }
  }

  const percent = Number(slider?.value ?? 50) / 100;
  const currentPos = min + percent * (max - min);
  if (valueLabel) valueLabel.textContent = `${currentPos.toFixed(1)} mm`;

  const normal = new THREE.Vector3(
    axis === 'x' ? (invert ? 1 : -1) : 0,
    axis === 'y' ? (invert ? 1 : -1) : 0,
    axis === 'z' ? (invert ? 1 : -1) : 0
  );
  // Plane equation: normal . p + constant = 0
  // If normal is -1 (facing negative), points with p > currentPos have normal . p = -p < -currentPos,
  // so distance = -p + currentPos. Points with p < currentPos are kept when distance > 0.
  const constant = invert ? -currentPos : currentPos;
  slicePlane.normal.copy(normal);
  slicePlane.constant = constant;

  const planes = enabled ? [slicePlane] : [];
  viewer.model.traverse(object => {
    if (object.isMesh && object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of materials) {
        mat.clippingPlanes = planes;
        mat.clipShadows = true;
        mat.needsUpdate = true;
      }
    }
  });
}

function animationControls() {
  const button = document.querySelector('#animation-play');
  const label = animation.playing ? 'Pause animation' : 'Play animation';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(animation.playing));
  button.innerHTML = `<i data-lucide="${animation.playing ? 'pause' : 'play'}"></i>`;
  createIcons({ icons });
  document.querySelector('#animation-time').value = String(animation.time);
  document.querySelector('#animation-scrub').value = String(animation.time);
  const frame = document.querySelector('#animation-frame');
  frame.max = String(animation.steps - 1);
  frame.value = String(Math.min(animation.steps - 1, Math.floor(animation.time * animation.steps + 1e-6)));
  document.querySelector('#animation-fps').value = String(animation.fps);
  document.querySelector('#animation-steps').value = String(animation.steps);
  update();
}

function presetControls(selected = document.querySelector('#preset-select').value) {
  const select = document.querySelector('#preset-select');
  select.replaceChildren(new Option('Default', ''), ...[...customizer.presets.keys()].map(name => new Option(name, name)));
  select.value = customizer.presets.has(selected) ? selected : '';
  update();
}

function renderParameters(source, force = false) {
  if (!force && source === customizerSource) return;
  customizerSource = source;
  const container = document.querySelector('#parameter-controls');
  try { customizer.update(source); }
  catch (error) { container.replaceChildren(Object.assign(document.createElement('span'), { textContent: error.message })); return; }
  container.replaceChildren();
  const groups = new Map();
  for (const parameter of customizer.parameters) {
    if (!groups.has(parameter.group)) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = parameter.group;
      fieldset.append(legend);
      container.append(fieldset);
      groups.set(parameter.group, fieldset);
    }
    const row = document.createElement('div');
    row.className = 'parameter-row';
    const label = document.createElement('label');
    label.className = 'parameter-label';
    label.textContent = parameter.label;
    const values = document.createElement('div');
    values.className = 'parameter-value';
    row.append(label, values);
    groups.get(parameter.group).append(row);
    const current = customizer.value(parameter);
    const inputs = [];
    const updateParameter = (value, input) => {
      try {
        customizer.set(parameter.name, value);
        input.setCustomValidity('');
        presetControls('');
        animation.pause();
        revision++;
        update();
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => request('preview'), 250);
      } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
    };
    if (parameter.choices) {
      const select = document.createElement('select');
      parameter.choices.forEach((choice, index) => select.add(new Option(choice.label, String(index))));
      select.value = String(parameter.choices.findIndex(choice => choice.value === current));
      select.addEventListener('change', () => updateParameter(parameter.choices[Number(select.value)].value, select));
      inputs.push(select);
    } else if (parameter.type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = current;
      input.addEventListener('change', () => updateParameter(input.checked, input));
      inputs.push(input);
    } else if (parameter.type === 'string') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = current;
      input.maxLength = 4096;
      input.addEventListener('change', () => updateParameter(input.value, input));
      inputs.push(input);
    } else {
      if (parameter.type === 'number' && parameter.min !== undefined) {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = parameter.min;
        slider.max = parameter.max;
        slider.step = parameter.step;
        slider.value = current;
        slider.setAttribute('aria-label', `${parameter.label} slider`);
        slider.addEventListener('input', () => { inputs.at(-1).value = slider.value; updateParameter(Number(slider.value), slider); });
        inputs.push(slider);
      }
      (Array.isArray(current) ? current : [current]).forEach((value, component) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = value;
        input.step = parameter.step ?? 'any';
        if (parameter.min !== undefined) { input.min = parameter.min; input.max = parameter.max; }
        if (parameter.type === 'vector') input.setAttribute('aria-label', `${parameter.label} ${component + 1}`);
        input.addEventListener('change', () => {
          const next = Array.isArray(current) ? inputs.filter(item => item.type === 'number').map(item => Number(item.value)) : Number(input.value);
          updateParameter(next, input);
        });
        inputs.push(input);
      });
    }
    for (const input of inputs) values.append(input);
  }
  if (!customizer.parameters.length) {
    const message = document.createElement('span');
    message.id = 'parameter-message';
    message.textContent = 'No public parameters found';
    container.append(message);
  }
  presetControls();
}

function scheduleCustomizerCompile() {
  revision++;
  update();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => request('preview'), 250);
}

function showMessages(diagnostics = [], echoes = [], job = currentJob) {
  messages.replaceChildren();
  for (const issue of diagnostics) {
    const row = document.createElement('div');
    row.className = issue.severity ?? 'error';
    if (issue.location) {
      const link = document.createElement('button');
      link.className = 'source-link';
      link.textContent = `${issue.location.file}:${issue.location.line}:${issue.location.column}`;
      link.addEventListener('click', () => host.postMessage({ type: 'navigate', job, location: issue.location }));
      row.append(link);
    }
    const text = document.createElement('span');
    text.textContent = issue.message;
    row.append(text);
    messages.append(row);
  }
  for (const echo of echoes) {
    const row = document.createElement('div');
    row.textContent = String(echo);
    messages.append(row);
  }
  messages.hidden = !messages.childElementCount;
}

function cancel(notify = true, stopAnimation = true, preserveAuditWaiters = false) {
  if (stopAnimation && animation?.playing) animation.pause();
  if (!preserveAuditWaiters) for (const requestId of auditWaiters.keys()) settleAudit(requestId, { success: false, cancelled: true });
  controller?.abort();
  controller = undefined;
  busy = false;
  if (notify) host.postMessage({ type: 'cancel' });
  update();
}

// Webview workers are not controlled by VS Code's resource service worker, so the document fetches media on their behalf.
const resourcePrelude = base => `{
const base = ${JSON.stringify(base)}, nativeFetch = self.fetch.bind(self), waiting = new Map();
let nextId = 0;
const port = new Promise(resolve => self.addEventListener('message', function listen(event) {
  if (event.data?.type !== 'openscad-resource-port') return;
  event.stopImmediatePropagation();
  self.removeEventListener('message', listen);
  const channel = event.ports[0];
  channel.onmessage = ({ data }) => {
    const request = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error) request.reject(new TypeError(data.error));
    else request.resolve(new Response(data.body, { headers: { 'Content-Type': data.contentType } }));
  };
  resolve(channel);
}));
self.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href).href;
  if (!url.startsWith(base)) return nativeFetch(input, init);
  return port.then(channel => new Promise((resolve, reject) => { const id = ++nextId; waiting.set(id, { resolve, reject }); channel.postMessage({ id, url }); }));
};
}\n`;

function serveResources(port, base) {
  port.onmessage = async ({ data }) => {
    try {
      if (typeof data?.url !== 'string' || !data.url.startsWith(base)) throw new Error('Resource is outside the extension media folder');
      const response = await fetch(data.url);
      if (!response.ok) throw new Error(`Could not load ${data.url}`);
      const body = await response.arrayBuffer();
      const contentType = data.url.endsWith('.wasm') ? 'application/wasm' : response.headers.get('Content-Type') ?? '';
      port.postMessage({ id: data.id, body, contentType }, [body]);
    } catch (error) {
      port.postMessage({ id: data.id, error: error.message });
    }
  };
}

async function engine() {
  if (!enginePromise) {
    const options = config;
    enginePromise = (async () => {
      const response = await fetch(options.workerUrl);
      if (!response.ok) throw new Error('Could not load the packaged compilation worker');
      const base = new URL('.', options.workerUrl).href;
      const source = `self.__openscadFontBase = ${JSON.stringify(options.fontBase)};\nself.__openscadRoofWasmUrl = ${JSON.stringify(new URL('runtime/vendor/roof-voronoi-wasm.wasm', base).href)};\n${resourcePrelude(base)}${await response.text()}`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      workerUrls.add(url);
      const workerFactory = () => {
        const worker = new Worker(url, { type: 'module' });
        const channel = new MessageChannel();
        serveResources(channel.port1, base);
        worker.postMessage({ type: 'openscad-resource-port' }, [channel.port2]);
        return worker;
      };
      return createWorkerEngine({ workerFactory, manifoldModuleUrl: options.manifoldModuleUrl, wasmUrl: options.wasmUrl, timeoutMs: 120_000 });
    })().catch(error => { enginePromise = undefined; throw error; });
  }
  return enginePromise;
}

function read(path, kind, job, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Compilation cancelled')); return; }
    const id = ++nextRead;
    const abort = () => { pending.delete(id); reject(new Error('Compilation cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    pending.set(id, { job, kind, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) });
    host.postMessage({ type: 'read', id, job, path, kind });
  });
}

async function compile(message) {
  cancel(false, false, message.auditOnly === true);
  currentJob = message.job;
  const active = new AbortController();
  controller = active;
  busy = true;
  showMessages();
  update();
  renderParameters(message.source);
  try {
    const backend = await engine();
    if (active.signal.aborted) return;
    const result = await backend.compileLatest({ entry: message.entry, files: message.files, libraryPaths: message.libraryPaths, mode: message.mode, time: message.time, defines: message.defines, experimental: message.experimental, signal: active.signal,
      auditOnly: message.auditOnly, auditComponents: message.auditComponents, maxAuditComponents: message.maxAuditComponents, interferenceEpsilon: message.interferenceEpsilon, auditClearance: message.auditClearance,
      context: { time: message.time, viewport: viewer.viewport() },
      resolver: (path, { signal }) => read(path, 'source', message.job, signal),
      assetResolver: (path, { signal }) => read(path, 'asset', message.job, signal),
      fontResolver: (name, { signal }) => read(name, 'font', message.job, signal),
    }, 'preview');
    if (active.signal.aborted || message.job !== currentJob || message.requestRevision !== revision || message.revision !== sourceRevision) {
      if (result.status === 'success') result.dispose();
      if (message.export && (message.requestRevision !== revision || message.revision !== sourceRevision)) showMessages([{ severity: 'error', message: 'Source or parameters changed before the export completed. Export again to use the current source.' }]);
      if (message.auditOnly) settleAudit(message.requestId, { success: false, cancelled: true });
      if (message.requestId) animationWaiters.get(message.requestId)?.(false);
      return;
    }
    showMessages(result.diagnostics, result.echoes, message.job);
    host.postMessage({ type: 'diagnostics', job: message.job, diagnostics: result.diagnostics });
    if (result.status !== 'success') {
      summary.textContent = result.status === 'cancelled' ? 'Compilation cancelled' : 'Compilation failed; previous model retained';
      if (message.auditOnly) settleAudit(message.requestId, { success: false, error: result.diagnostics?.[0]?.message ?? 'Audit frame failed to compile' });
      if (message.requestId) animationWaiters.get(message.requestId)?.(false);
      return;
    }
    if (message.auditOnly) {
      const report = result.componentAudit;
      result.dispose?.();
      if (!report) {
        settleAudit(message.requestId, { success: false, error: 'Compiler did not return component audit data' });
        return;
      }
      settleAudit(message.requestId, { success: true, time: message.time, report });
      return;
    }
    clearMeasurement();
    measuring = false;
    viewer.element.classList.remove('measuring');
    document.querySelector('#measure-toggle').setAttribute('aria-pressed', 'false');
    viewer.setModel(result);
    lastResult?.dispose();
    lastResult = result;
    compiledRevision = message.requestRevision;
    mode = message.mode;

    const stats = viewer.stats();
    const mesh = result.empty ? null : result.getMesh();
    const triangles = mesh ? mesh.triVerts.length / 3 : 0;
    const box = viewer.bounds;
    const size = box ? [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map(v => Number(v.toFixed(2))) : [0, 0, 0];
    const min = box ? [box.min.x, box.min.y, box.min.z].map(v => Number(v.toFixed(2))) : [0, 0, 0];
    const max = box ? [box.max.x, box.max.y, box.max.z].map(v => Number(v.toFixed(2))) : [0, 0, 0];
    const center = box ? [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2].map(v => Number(v.toFixed(2))) : [0, 0, 0];
    currentMetrics = {
      triangles,
      volume: Number(result.volume.toFixed(2)),
      size: { x: size[0], y: size[1], z: size[2] },
      bounds: { min, max, center },
      layers: { solid: stats.solid, background: stats.background, debug: stats.debug, total: stats.meshes },
      empty: Boolean(result.empty),
      timings: result.timings
    };

    summary.textContent = result.empty ? 'Empty model' : `${triangles} triangles | ${size[0]} × ${size[1]} × ${size[2]} mm | ${result.volume.toFixed(2)} mm³ | ${Math.round(result.timings.totalMs)} ms`;
    host.postMessage({ type: 'modelMetrics', job: message.job, metrics: currentMetrics });
    updateSlicing();

    if (message.export) {
      const bytes = await backend.export(result, { format: 'stl', encoding: 'binary', signal: active.signal });
      if (revision !== message.requestRevision || sourceRevision !== message.revision) throw new Error('Source or parameters changed during export. Export again to use the current source.');
      if (active.signal.aborted) return;
      if (bytes.length > 50_000_000) throw new Error('STL exceeds the export byte limit');
      host.postMessage({ type: 'export', job: message.job, bytes: Array.from(bytes) });
    }
    if (message.requestId) animationWaiters.get(message.requestId)?.(true);
  } catch (error) {
    if (!active.signal.aborted) showMessages([{ severity: 'error', message: error.message }]);
    if (message.auditOnly) settleAudit(message.requestId, { success: false, error: error.message });
    if (message.requestId) animationWaiters.get(message.requestId)?.(false);
  } finally {
    if (message.requestId) animationWaiters.delete(message.requestId);
    if (controller === active) { controller = undefined; busy = false; update(); }
  }
}

window.addEventListener('message', event => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'init') {
    cancel(false, false);
    if (enginePromise) void enginePromise.then(backend => backend.dispose()).catch(() => {});
    enginePromise = undefined;
    config = message;
    sourceRevision = message.revision;
    revision++;
    if (config.autoPreview && config.autoPreview !== 'off') {
      const autoCheckbox = document.querySelector('#auto-preview');
      if (autoCheckbox) autoCheckbox.checked = true;
    }
    update();
    request('preview');
  } else if (message.type === 'stale') {
    if (auditRunning) stopAudit('Source changed; audit stopped.');
    animation.pause();
    cancel(false, false);
    sourceRevision = message.revision;
    revision++;
    update();
    const autoCheckbox = document.querySelector('#auto-preview');
    const autoSetting = config?.autoPreview ?? 'off';
    const isAuto = autoCheckbox?.checked || autoSetting === 'onEdit' || (autoSetting === 'onSave' && message.reason === 'save');
    if (isAuto && !animation?.playing) {
      clearTimeout(autoPreviewTimer);
      const delay = config?.autoPreviewDelay ?? 400;
      autoPreviewTimer = setTimeout(() => {
        if (!busy && !animation?.playing) request('preview');
      }, delay);
    }
  }
  else if (message.type === 'triggerCompile') {
    animation.pause();
    request(message.mode === 'render' ? 'render' : 'preview');
  }
  else if (message.type === 'captureSnapshot') captureSnapshot(message.requestId);
  else if (message.type === 'snapshotSaveFailed') showMessages([{ severity: 'error', message: `Snapshot save failed: ${message.message}` }]);
  else if (message.type === 'compile') void compile(message);
  else if (message.type === 'cancel') cancel(false);
  else if (message.type === 'hostError') {
    cancel(false);
    if (message.requestId) animationWaiters.get(message.requestId)?.(false);
    showMessages([{ severity: 'error', message: message.message }]);
  }
  else if (message.type === 'readResult') {
    const request = pending.get(message.id);
    if (!request || request.job !== message.job) return;
    pending.delete(message.id);
    request.cleanup();
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(request.kind !== 'source' && message.value !== undefined ? Uint8Array.from(message.value) : message.value);
  }
});

function request(mode = 'preview', exporting = false, options = {}) {
  if (auditRunning && !options.auditOnly) stopAudit('Audit stopped by another preview request.');
  clearTimeout(previewTimer);
  clearTimeout(autoPreviewTimer);
  cancel(false, false, options.auditOnly === true);
  revision++;
  busy = true;
  update();
  host.postMessage({
    type: 'requestCompile', mode, export: exporting, revision,
    requestId: options.requestId, time: options.time ?? animation.time, defines: customizer.defines(),
    auditOnly: options.auditOnly === true, auditComponents: options.auditComponents === true,
    auditId: options.auditId, maxAuditComponents: options.maxAuditComponents,
    interferenceEpsilon: options.interferenceEpsilon,
    auditClearance: options.auditClearance,
  });
}

animation = new Animation({
  render: time => new Promise(resolve => {
    const requestId = `animation-${Date.now()}-${Math.random()}`;
    animationWaiters.set(requestId, resolve);
    request('preview', false, { time, requestId });
  }),
  onChange: animationControls,
});

document.querySelector('#animation-play').addEventListener('click', () => {
  if (animation.playing) animation.pause();
  else animation.play();
});
document.querySelector('#audit-run').addEventListener('click', () => {
  if (auditRunning) stopAudit();
  else void runInterferenceAudit();
});
for (const id of ['animation-time', 'animation-scrub', 'animation-frame']) {
  document.querySelector(`#${id}`).addEventListener(id === 'animation-scrub' ? 'input' : 'change', event => {
    const input = event.currentTarget;
    if (!input.value || !input.checkValidity()) { input.reportValidity(); return; }
    const time = id === 'animation-frame' ? Number(input.value) / animation.steps : Number(input.value);
    try { animation.seek(time); request('preview', false, { time }); }
    catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
  });
}
for (const id of ['animation-fps', 'animation-steps']) {
  document.querySelector(`#${id}`).addEventListener('change', () => {
    const fps = Number(document.querySelector('#animation-fps').value);
    const steps = Number(document.querySelector('#animation-steps').value);
    if (fps === animation.fps && steps === animation.steps) return;
    try { animation.pause(); animation.configure({ fps, steps }); }
    catch (error) { showMessages([{ severity: 'error', message: error.message }]); animationControls(); }
  });
}
document.querySelector('#preset-save').addEventListener('click', () => {
  const input = document.querySelector('#preset-name');
  try { customizer.save(input.value.trim()); input.setCustomValidity(''); presetControls(input.value.trim()); }
  catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
});
document.querySelector('#preset-select').addEventListener('change', event => {
  try {
    animation.pause();
    if (event.currentTarget.value) customizer.apply(event.currentTarget.value);
    else customizer.reset();
    renderParameters(customizerSource, true);
    scheduleCustomizerCompile();
  } catch (error) { showMessages([{ severity: 'error', message: error.message }]); }
});
document.querySelector('#preset-delete').addEventListener('click', () => {
  customizer.presets.delete(document.querySelector('#preset-select').value);
  presetControls('');
});
document.querySelector('#parameter-reset').addEventListener('click', () => {
  animation.pause();
  customizer.reset();
  renderParameters(customizerSource, true);
  scheduleCustomizerCompile();
});
document.querySelector('#preset-import').addEventListener('click', () => {
  const input = document.querySelector('#preset-input');
  input.value = '';
  input.click();
});
document.querySelector('#preset-input').addEventListener('change', async event => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new RangeError('Preset byte limit exceeded');
    await file.text().then(text => customizer.import(text));
    presetControls();
  } catch (error) { showMessages([{ severity: 'error', message: error.message }]); }
});
document.querySelector('#preset-export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([customizer.export()], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'openscad-parameters.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.querySelector('#slice-enabled')?.addEventListener('change', updateSlicing);
document.querySelector('#slice-axis')?.addEventListener('change', updateSlicing);
document.querySelector('#slice-offset')?.addEventListener('input', updateSlicing);
document.querySelector('#slice-invert')?.addEventListener('change', updateSlicing);

function captureSnapshot(requestId) {
  try {
    if (!lastResult) throw new Error('Compile a model before capturing a snapshot.');
    if (busy) throw new Error('Compilation is in progress. Wait for it to finish before capturing a snapshot.');
    if (!viewer.element.clientWidth || !viewer.element.clientHeight) throw new Error('The preview viewport is hidden or has no size.');
    if (viewer.renderer.getContext().isContextLost()) throw new Error('The preview graphics context was lost. Reopen the preview and retry.');
    // A reveal or resize can precede the ResizeObserver callback.
    viewer.resize();
    viewer.renderer.render(viewer.scene, viewer.camera);
    const dataUrl = viewer.renderer.domElement.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('The viewport did not produce a PNG image.');
    host.postMessage({ type: 'snapshotCaptured', requestId, dataUrl });
  } catch (error) {
    showMessages([{ severity: 'error', message: `Snapshot capture failed: ${error.message}` }]);
    host.postMessage({ type: 'snapshotFailed', requestId, message: error.message });
  }
}

document.querySelector('#auto-preview')?.addEventListener('change', event => {
  clearTimeout(autoPreviewTimer);
  if (event.currentTarget.checked && compiledRevision !== revision && !busy && !animation?.playing) {
    request('preview');
  }
});

document.querySelector('#preview').addEventListener('click', () => { animation.pause(); request('preview'); });
document.querySelector('#render').addEventListener('click', () => { animation.pause(); request('render'); });
document.querySelector('#export').addEventListener('click', () => { animation.pause(); request('render', true); });
document.querySelector('#snapshot')?.addEventListener('click', () => captureSnapshot());
document.querySelector('#measure-toggle').addEventListener('click', event => {
  if (measuring) {
    measuring = false;
    viewer.element.classList.remove('measuring');
    event.currentTarget.setAttribute('aria-pressed', 'false');
    if (measurementPoints.length === 1) clearMeasurement();
  } else {
    clearMeasurement();
    measuring = true;
    viewer.element.classList.add('measuring');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    const readout = document.querySelector('#measurement-readout');
    readout.hidden = false;
    readout.textContent = 'Select the first point on the model.';
  }
});
document.querySelector('#measure-copy').addEventListener('click', () => {
  if (currentMeasurement) host.postMessage({ type: 'copyMeasurement', measurement: currentMeasurement });
});
document.querySelector('#measure-clear').addEventListener('click', () => {
  measuring = false;
  viewer.element.classList.remove('measuring');
  document.querySelector('#measure-toggle').setAttribute('aria-pressed', 'false');
  clearMeasurement();
});
viewer.renderer.domElement.addEventListener('pointerdown', event => {
  pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
viewer.renderer.domElement.addEventListener('pointerup', event => {
  const start = pointerStart;
  pointerStart = undefined;
  if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
  measureAtPointer(event);
});
viewer.renderer.domElement.addEventListener('pointercancel', () => { pointerStart = undefined; });
document.querySelector('#cancel').addEventListener('click', () => cancel());
document.querySelector('#fit').addEventListener('click', () => viewer.fit());
document.querySelector('#zoom-in').addEventListener('click', () => viewer.zoomBy(1.25));
document.querySelector('#zoom-out').addEventListener('click', () => viewer.zoomBy(0.8));
document.querySelector('#reset-view').addEventListener('click', () => viewer.resetView());
for (const button of document.querySelectorAll('[data-direction]')) button.addEventListener('click', () => viewer.setDirection(button.dataset.direction));
document.querySelector('#projection').setAttribute('aria-pressed', 'false');
document.querySelector('#show-axes').addEventListener('change', event => {
  viewer.setAxesVisible(event.currentTarget.checked);
  if (!event.currentTarget.checked) document.querySelector('#show-marks').checked = false;
});
document.querySelector('#show-marks').addEventListener('change', event => {
  viewer.setMarksVisible(event.currentTarget.checked);
  if (event.currentTarget.checked) document.querySelector('#show-axes').checked = true;
});
document.querySelector('#projection').addEventListener('click', event => {
  viewer.setProjection(viewer.projection === 'perspective' ? 'orthographic' : 'perspective');
  event.currentTarget.setAttribute('aria-pressed', String(viewer.projection === 'orthographic'));
});
document.querySelector('#wireframe').addEventListener('click', event => {
  viewer.setWireframe(!viewer.wireframe);
  event.currentTarget.setAttribute('aria-pressed', String(viewer.wireframe));
});
window.addEventListener('unload', () => {
  animation.dispose();
  clearMeasurement();
  for (const resolve of animationWaiters.values()) resolve(false);
  animationWaiters.clear();
  cancel(false);
  viewer.dispose();
  if (enginePromise) void enginePromise.then(backend => backend.dispose()).catch(() => {});
  for (const url of workerUrls) URL.revokeObjectURL(url);
});
update();
host.postMessage({ type: 'ready' });