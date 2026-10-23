// Slicer metadata from G-code comments. PrusaSlicer, OrcaSlicer and Bambu Studio
// write `; key = value` or `; key: value`; Cura writes `;KEY:value`.
const COMMENT_SETTING = /^;\s*([A-Za-z][\w ()[\].-]*?)\s*[=:]\s*(.*?)\s*$/gm;

function settings(text) {
  const values = new Map();
  for (const [, key, value] of text.matchAll(COMMENT_SETTING)) {
    const name = key.toLowerCase();
    if (!values.has(name)) values.set(name, value);
  }
  return values;
}

function number(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const sum = value => value?.split(/[,;]/).reduce((total, part) => total + (number(part) ?? 0), 0);

function parseDuration(value) {
  if (!value) return undefined;
  let seconds = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) {
    seconds += Number(amount) * { d: 86400, h: 3600, m: 60, s: 1 }[unit.toLowerCase()];
    matched = true;
  }
  return matched ? seconds : undefined;
}

function bedSize(value) {
  if (!value) return undefined;
  const points = [...value.matchAll(/(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)/gi)].map(([, x, y]) => [Number(x), Number(y)]);
  if (points.length < 3) return undefined;
  const x = Math.max(...points.map(point => point[0])), y = Math.max(...points.map(point => point[1]));
  return x > 0 && y > 0 ? { x, y } : undefined;
}

export function parseGcodeInfo(text) {
  const values = settings(text);
  const get = (...keys) => keys.map(key => values.get(key)).find(value => value !== undefined && value !== '');
  const generator = /^;\s*generated (?:by|with)\s+(.+?)(?:\s+on\s+\d{4}-\d\d-\d\d.*)?$/im.exec(text)?.[1];
  const curaTime = number(values.get('time'));
  const curaFilament = /^;Filament used:\s*([\d.]+)m/im.exec(text);
  const colours = get('filament_colour', 'extruder_colour')?.split(/[;,]/).map(colour => colour.trim()).filter(colour => /^#[0-9a-f]{6}$/i.test(colour)) ?? [];
  return {
    slicer: generator ?? (values.has('flavor') ? 'Cura' : undefined),
    printer: get('printer_model', 'machine_name', 'printer_settings_id'),
    seconds: parseDuration(get('estimated printing time (normal mode)', 'total estimated time', 'model printing time')) ?? curaTime,
    filamentMm: sum(get('filament used [mm]')) || (curaFilament ? Number(curaFilament[1]) * 1000 : undefined),
    filamentG: number(get('total filament used [g]')) ?? (sum(get('filament used [g]')) || undefined),
    colours,
    bed: bedSize(get('bed_shape', 'printable_area')),
    printableHeight: number(get('printable_height', 'max_print_height')),
    layerCount: number(get('total layers count', 'total layer number')),
  };
}

export function formatDuration(seconds) {
  const total = Math.round(seconds);
  const days = Math.floor(total / 86400), hours = Math.floor(total % 86400 / 3600), minutes = Math.floor(total % 3600 / 60);
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes}m`, !days && !hours && `${total % 60}s`].filter(Boolean).join(' ');
}

const FEATURE_COMMENT = /^\s*(?:TYPE|FEATURE):\s*(.*?)\s*$/i;

// Mirrors gcode-preview's move tracking: absolute coordinates, extrusion when E > 0
// with XY motion. layers[0] is the start G-code preamble and is excluded from bounds.
// Slicer "Custom" extrusions (purge lines) are excluded when the print has other features.
export function analyzeToolpath(layers) {
  const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const printed = { min: [...all.min], max: [...all.max] };
  const include = (box, point) => {
    for (let axis = 0; axis < 3; axis++) {
      box.min[axis] = Math.min(box.min[axis], point[axis]);
      box.max[axis] = Math.max(box.max[axis], point[axis]);
    }
  };
  const state = [0, 0, 0];
  let feature = '';
  const layerZ = layers.map((layer, index) => {
    let z = null;
    for (const command of layer.commands) {
      const type = command?.comment && FEATURE_COMMENT.exec(command.comment);
      if (type) feature = type[1].toLowerCase();
      if (!/^g0?[0-3]$/.test(command?.gcode ?? '')) continue;
      const { x, y, z: nextZ, e } = command.params;
      const next = [x ?? state[0], y ?? state[1], nextZ ?? state[2]];
      if (index > 0 && (e ?? 0) > 0 && (next[0] !== state[0] || next[1] !== state[1])) {
        z ??= next[2];
        for (const point of [state, next]) {
          include(all, point);
          if (feature !== 'custom') include(printed, point);
        }
      }
      state.splice(0, 3, ...next);
    }
    return z;
  });
  const bounds = Number.isFinite(printed.min[0]) ? printed : Number.isFinite(all.min[0]) ? all : null;
  return { bounds, layerZ };
}
