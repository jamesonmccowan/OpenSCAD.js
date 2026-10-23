const { randomBytes } = require('node:crypto');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

const button = (id, icon, label, text = '') => `<button id="${id}" title="${label}" aria-label="${label}"><i data-lucide="${icon}"></i>${text}</button>`;

function cameraControls() {
  return `<div class="camera-controls" role="toolbar" aria-label="Camera controls">
${button('fit', 'scan', 'Fit view: center and frame model, keeping rotation')}
${button('zoom-in', 'zoom-in', 'Zoom in')}${button('zoom-out', 'zoom-out', 'Zoom out')}
${button('reset-view', 'rotate-ccw', 'Reset view: default angle and fitted zoom')}
<span class="camera-separator" aria-hidden="true"></span>
<button id="view-right" data-direction="right" title="Right: look from +X toward -X" aria-label="Right view">Right</button>
<button id="view-left" data-direction="left" title="Left: look from -X toward +X" aria-label="Left view">Left</button>
<button id="view-back" data-direction="back" title="Back: look from +Y toward -Y" aria-label="Back view">Back</button>
<button id="view-front" data-direction="front" title="Front: look from -Y toward +Y" aria-label="Front view">Front</button>
<button id="view-top" data-direction="top" title="Top: look from +Z toward -Z" aria-label="Top view">Top</button>
<button id="view-bottom" data-direction="bottom" title="Bottom: look from -Z toward +Z" aria-label="Bottom view">Bottom</button>
<span class="camera-separator" aria-hidden="true"></span>
${button('projection', 'view', 'Toggle orthographic projection')}
<label class="camera-toggle" title="Show world X, Y, and Z axes"><input id="show-axes" type="checkbox">Axes</label>
<label class="camera-toggle" title="Show axis ticks and labels with adaptive 10, 100, or 1000 mm spacing"><input id="show-marks" type="checkbox">Marks</label>
</div>`;
}

function documentHead(source, stylesheet, nonce, title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${escapeHtml(source)} 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src ${escapeHtml(source)}; connect-src ${escapeHtml(source)}; worker-src blob:; font-src ${escapeHtml(source)}; img-src ${escapeHtml(source)} data:;">
<link rel="stylesheet" href="${escapeHtml(stylesheet)}"><title>${escapeHtml(title)}</title></head>`;
}

const MODEL_FORMAT_LABELS = { stl: 'STL', step: 'STEP', '3mf': '3MF' };

function stlHtml(source, script, stylesheet, name, { format = 'stl' } = {}) {
  const nonce = randomBytes(18).toString('base64');
  const kind = MODEL_FORMAT_LABELS[format] ?? 'STL';
  const convertible = format !== 'stl';
  return `${documentHead(source, stylesheet, nonce, `${name} ${kind} Viewer`)}
<body class="stl-viewer" data-format="${escapeHtml(MODEL_FORMAT_LABELS[format] ? format : 'stl')}"><header><div class="compilation-controls">
<span id="stl-name" class="stl-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
<span id="status" role="status" aria-live="polite" data-state="busy">Loading...</span>
</div><div class="view-controls">${button('use-reference', 'upload', 'Use this model as a reference in a SCAD preview', 'Use as Reference')}${convertible ? button('convert-stl', 'download', `Convert ${kind} to STL and save`, 'Convert to STL') : ''}${button('wireframe', 'grid-3x3', 'Toggle wireframe')}</div></header>
<main id="viewport"></main><footer>${cameraControls()}<div id="summary">No ${kind} loaded</div></footer>
<section id="messages" aria-label="${kind} messages" hidden></section>
<script nonce="${nonce}" type="module" src="${escapeHtml(script)}"></script></body></html>`;
}

function gcodeHtml(source, script, stylesheet, name) {
  const nonce = randomBytes(18).toString('base64');
  const view = (direction, label, title) => `<button data-direction="${direction}" title="${title}" aria-label="${label} view">${label}</button>`;
  return `${documentHead(source, stylesheet, nonce, `${name} G-code Viewer`)}
<body class="stl-viewer gcode-viewer"><header><div class="compilation-controls">
<span id="stl-name" class="stl-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
<span id="status" role="status" aria-live="polite" data-state="busy">Loading...</span>
</div><div class="view-controls">
<label class="camera-toggle" title="Show non-printing travel moves"><input id="show-travel" type="checkbox">Travel</label>
<label class="camera-toggle" title="Render extrusions as shaded 3D tubes (slower for large files)"><input id="show-tubes" type="checkbox">Tubes</label>
${button('open-text', 'file-text', 'Open the G-code in the text editor', 'Open as Text')}</div></header>
<main id="viewport"><canvas id="gcode-canvas" aria-label="G-code toolpath preview" tabindex="0"></canvas></main>
<footer><div class="gcode-layers" role="group" aria-label="Visible layers">
<label for="layer-start">Layers</label><input id="layer-start" type="range" min="1" max="1" value="1" aria-label="First visible layer" disabled>
<input id="layer-end" type="range" min="1" max="1" value="1" aria-label="Last visible layer" disabled><span id="layer-label">-</span></div>
<div class="camera-controls" role="toolbar" aria-label="Camera controls">
${button('fit', 'scan', 'Fit view: frame the print')}${button('zoom-in', 'zoom-in', 'Zoom in')}${button('zoom-out', 'zoom-out', 'Zoom out')}
${button('reset-view', 'rotate-ccw', 'Reset view: default angle and fitted zoom')}
<span class="camera-separator" aria-hidden="true"></span>
${view('right', 'Right', 'Right: look from +X toward -X')}${view('left', 'Left', 'Left: look from -X toward +X')}${view('back', 'Back', 'Back: look from +Y toward -Y')}
${view('front', 'Front', 'Front: look from -Y toward +Y')}${view('top', 'Top', 'Top: look from +Z toward -Z')}
</div><div id="summary">No G-code loaded</div></footer>
<section id="messages" aria-label="G-code messages" hidden></section>
<script nonce="${nonce}" type="module" src="${escapeHtml(script)}"></script></body></html>`;
}

function previewHtml(source, script, stylesheet) {
  const nonce = randomBytes(18).toString('base64');
  return `${documentHead(source, stylesheet, nonce, 'OpenSCAD Preview')}
<body><header><div class="compilation-controls">
${button('preview', 'eye', 'Preview (F5 / Ctrl+Enter)', 'Preview')}${button('render', 'box', 'Render (F6)', 'Render')}
<label class="auto-preview-label" title="Automatically recompile preview on edit or parameter change"><input id="auto-preview" type="checkbox">Auto</label>
<span id="status" role="status" aria-live="polite" data-state="stale">Out of Date</span>
</div><div class="view-controls">
${button('cancel', 'square', 'Cancel compilation')}${button('wireframe', 'grid-3x3', 'Toggle wireframe')}
${button('measure-toggle', 'ruler', 'Measure between two visible points')}
<label class="measure-target-label" for="measure-tolerance" title="Optional reference when measuring a mating-part gap">Gap target<select id="measure-tolerance" aria-label="Reference gap tolerance"><option value="0">Off</option><option value="0.2">0.20 mm</option><option value="0.3" selected>0.30 mm</option><option value="0.4">0.40 mm</option></select></label>
${button('measure-copy', 'copy', 'Copy measurement as JSON')}
${button('measure-clear', 'x', 'Clear measurement')}
${button('snapshot', 'camera', 'Capture Viewport Snapshot to Workspace')}
${button('export', 'download', 'Export current source as STL')}
</div></header><main id="viewport"></main><footer>
${cameraControls()}<div id="summary">No compiled model</div></footer>
<div id="measurement-readout" role="status" aria-live="polite" hidden></div>
<section id="messages" aria-label="Compiler messages" hidden></section>
<section id="tool-controls" aria-label="Preview tools">
<div class="tool-tabs" role="tablist" aria-label="Preview tools">
<button id="audit-tab" role="tab" aria-controls="interference-audit-controls" aria-selected="false" tabindex="-1" title="Interference Audit (Sampled Animation)">Audit</button>
<button id="slice-tab" role="tab" aria-controls="cross-section-controls" aria-selected="false" tabindex="-1" title="Cross Section (Slicing Plane)">Cross Section</button>
<button id="animation-tab" role="tab" aria-controls="animation-controls" aria-selected="false" tabindex="-1">Animation</button>
<button id="customizer-tab" role="tab" aria-controls="customizer-controls" aria-selected="false" tabindex="-1">Customizer</button>
<button id="references-tab" role="tab" aria-controls="references-controls" aria-selected="false" tabindex="-1">References</button>
<button id="fonts-tab" role="tab" aria-controls="fonts-controls" aria-selected="false" tabindex="-1">Fonts</button>
<button id="collapse-tab" role="tab" aria-controls="collapsed-controls" aria-selected="true" tabindex="0" title="Hide tool panels" aria-label="Hide tool panels">&#9660;</button>
</div>
<div id="interference-audit-controls" class="tool-panel" role="tabpanel" aria-labelledby="audit-tab" hidden><div class="toolbar audit-toolbar">
${button('audit-run', 'scan-search', 'Audit named component interference over sampled animation', 'Audit')}
<label>Samples<input id="audit-samples" type="number" min="2" max="20" step="1" value="5" aria-label="Animation audit sample count"></label>
<label>Overlap threshold<input id="audit-epsilon" type="number" min="0" max="100" step="0.0001" value="0.0001" aria-label="Minimum overlap volume in cubic millimeters"></label>
<label>Clearance (mm)<input id="audit-clearance" type="number" min="0" max="100" step="0.1" value="0.2" aria-label="Minimum component clearance in millimeters"></label>
<span id="audit-status" role="status" aria-live="polite">Uses audit_part("name") markers</span>
</div><div id="audit-results" aria-live="polite"></div></div>
<div id="cross-section-controls" class="tool-panel" role="tabpanel" aria-labelledby="slice-tab" hidden><div class="toolbar slice-toolbar">
<label class="auto-preview-label"><input id="slice-enabled" type="checkbox">Enable</label>
<label for="slice-axis">Axis<select id="slice-axis" aria-label="Slice axis">
<option value="x">X (YZ plane)</option>
<option value="y">Y (XZ plane)</option>
<option value="z" selected>Z (XY plane)</option>
</select></label>
<label for="slice-offset">Position</label><input id="slice-offset" type="range" min="0" max="100" step="0.1" value="50" aria-label="Slice plane position">
<span id="slice-value" class="slice-value-label">0.0 mm</span>
<label class="auto-preview-label"><input id="slice-invert" type="checkbox">Invert</label>
</div></div>
<div id="animation-controls" class="tool-panel" role="tabpanel" aria-labelledby="animation-tab" hidden><div class="toolbar animation-toolbar">
${button('animation-play', 'play', 'Play animation')}
<label for="animation-scrub">$t</label><input id="animation-scrub" type="range" min="0" max="1" step="0.001" value="0" aria-label="Animation time">
<input id="animation-time" type="number" min="0" max="1" step="0.001" value="0" aria-label="Animation time value">
<label>FPS<input id="animation-fps" type="number" min="1" max="60" value="12" aria-label="Animation frames per second"></label>
<label>Steps<input id="animation-steps" type="number" min="1" max="1000" value="60" aria-label="Animation steps"></label>
<label>Frame<input id="animation-frame" type="number" min="0" max="59" value="0" aria-label="Animation frame"></label>
</div></div>
<div id="customizer-controls" class="tool-panel" role="tabpanel" aria-labelledby="customizer-tab" hidden><div class="toolbar preset-toolbar">
<select id="preset-select" aria-label="Parameter preset"><option value="">Default</option></select>
<input id="preset-name" type="text" maxlength="128" placeholder="Preset name" aria-label="Preset name">
${button('preset-save', 'save', 'Save preset')}${button('preset-delete', 'trash-2', 'Delete selected preset')}
${button('preset-import', 'upload', 'Import presets')}${button('preset-export', 'download', 'Export presets')}${button('parameter-reset', 'rotate-ccw', 'Reset parameters')}
<input id="preset-input" type="file" accept=".json,application/json" hidden>
</div><div id="parameter-controls"><span id="parameter-message">Compile to inspect parameters</span></div></div>
<div id="references-controls" class="tool-panel" role="tabpanel" aria-labelledby="references-tab" hidden>
<div class="toolbar">${button('reference-add', 'upload', 'Add an STL, STEP or 3MF reference', 'Add Reference')}<span>Preview only; not included in exports or metrics.</span></div>
<div id="reference-status" role="status" aria-live="polite"></div><div id="reference-list"></div>
</div>
<div id="fonts-controls" class="tool-panel" role="tabpanel" aria-labelledby="fonts-tab" hidden>
<div class="toolbar">
<label for="font-search">Search fonts<input id="font-search" type="text" placeholder="Family or style" aria-label="Search fonts"></label>
${button('font-refresh', 'rotate-ccw', 'Refresh available fonts', 'Refresh')}
</div>
<p id="font-host">Bundled fonts and fonts on the extension/workspace host, not necessarily this PC.</p>
<div id="font-status" role="status" aria-live="polite">Open this panel to discover available fonts.</div>
<div id="font-list" role="list" aria-label="Available font faces"></div>
</div>
<div id="collapsed-controls" role="tabpanel" aria-labelledby="collapse-tab"></div>
</section>
<script nonce="${nonce}" type="module" src="${escapeHtml(script)}"></script></body></html>`;
}

module.exports = { previewHtml, stlHtml, gcodeHtml };