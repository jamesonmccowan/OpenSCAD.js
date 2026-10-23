import { decodeModel } from './model-formats.js';

export function referenceControls(viewer, host) {
  const list = document.querySelector('#reference-list');
  const status = document.querySelector('#reference-status');
  const records = new Map();
  let requestId = 0;
  document.querySelector('#reference-add').addEventListener('click', () => { status.textContent = ''; host.postMessage({ type: 'referenceAdd' }); });

  function sync(record) {
    for (const [key, input] of record.inputs) {
      const [name, axis] = key.split(':');
      if (name === 'visible') input.checked = record.settings.visible;
      else input.value = axis === undefined ? record.settings[name] : record.settings[name][Number(axis)];
    }
    viewer.updateReference(record.id, record.settings);
  }
  function save(record) {
    status.textContent = '';
    sync(record);
    record.requestId = ++requestId;
    host.postMessage({ type: 'referenceUpdate', id: record.id, settings: structuredClone(record.settings), requestId: record.requestId });
  }
  function row(record) {
    const fieldset = document.createElement('fieldset');
    fieldset.dataset.referenceId = record.id;
    fieldset.setAttribute('aria-label', record.name);
    const legend = document.createElement('legend');
    legend.textContent = record.name; legend.title = record.path;
    fieldset.append(legend);
    record.inputs = new Map();
    const toolbar = document.createElement('div'); toolbar.className = 'toolbar reference-toolbar';
    const input = (name, label, type, options = {}, axis) => {
      const wrapper = document.createElement('label'); wrapper.textContent = label;
      const control = Object.assign(document.createElement('input'), { type, ...options });
      const key = axis === undefined ? name : `${name}:${axis}`;
      record.inputs.set(key, control);
      control.setAttribute('aria-label', label);
      control.addEventListener('change', () => {
        if (!control.checkValidity() || (type !== 'checkbox' && !Number.isFinite(control.valueAsNumber))) { control.reportValidity(); sync(record); return; }
        if (type === 'checkbox') record.settings[name] = control.checked;
        else if (axis === undefined) record.settings[name] = control.valueAsNumber;
        else record.settings[name][axis] = control.valueAsNumber;
        save(record);
      });
      if (name === 'opacity') control.addEventListener('input', () => {
        record.settings.opacity = control.valueAsNumber;
        viewer.updateReference(record.id, record.settings);
      });
      wrapper.append(control);
      return wrapper;
    };
    toolbar.append(input('visible', 'Visible', 'checkbox'), input('opacity', 'Opacity', 'range', { min: '0', max: '1', step: '0.01' }));
    const button = (text, action) => {
      const element = document.createElement('button'); element.textContent = text;
      element.addEventListener('click', action);
      return element;
    };
    record.fit = button('Fit Reference', () => viewer.fitReference(record.id)); record.fit.disabled = !record.loaded;
    toolbar.append(record.fit, button('Reset Placement', () => {
      Object.assign(record.settings, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }); save(record);
    }),
      button('Reload', () => host.postMessage({ type: 'referenceReload', id: record.id })),
      button('Remove', () => host.postMessage({ type: 'referenceRemove', id: record.id })));
    fieldset.append(toolbar);
    for (const [name, label, units] of [['position', 'Position', 'mm'], ['rotation', 'Rotation', 'degrees'], ['scale', 'Scale', 'factor']]) {
      const group = document.createElement('div'); group.className = 'toolbar reference-transform';
      const title = document.createElement('span'); title.textContent = `${label} (${units})`; group.append(title);
      for (const [axis, letter] of ['X', 'Y', 'Z'].entries()) group.append(input(name, `${label} ${letter}`, 'number', { min: name === 'scale' ? '0.000001' : '-1000000', max: '1000000', step: 'any', required: true }, axis));
      fieldset.append(group);
    }
    record.statusElement = document.createElement('div'); record.statusElement.className = 'reference-message'; record.statusElement.setAttribute('role', 'status');
    record.statusElement.textContent = record.message ?? 'Loading...'; fieldset.append(record.statusElement);
    record.statusElement.classList.toggle('error', record.failed ?? false);
    list.append(fieldset);
    sync(record);
  }
  function report(record, text, failed = false) {
    record.message = text;
    record.failed = failed;
    record.statusElement.textContent = text;
    record.statusElement.classList.toggle('error', failed);
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'referenceFocus' || message.type === 'referenceError') document.querySelector('#references-tab').click();
    if (message.type === 'referenceFocus') return;
    if (message.type === 'referenceList') {
      const ids = new Set(message.references.map(record => record.id));
      for (const id of records.keys()) if (!ids.has(id)) { viewer.removeReference(id); records.delete(id); }
      list.replaceChildren();
      for (const descriptor of message.references) {
        const record = records.get(descriptor.id) ?? { loaded: false };
        Object.assign(record, descriptor);
        records.set(record.id, record); row(record);
      }
      if (!records.size) list.textContent = 'No reference models. Add an STL, STEP or 3MF file.';
      return;
    }
    if (message.type === 'referenceError' && !message.id) { status.textContent = message.message; status.className = 'error'; return; }
    const record = records.get(message.id);
    if (!record) return;
    if (message.type === 'referenceLoading') report(record, 'Loading reference...');
    else if (message.type === 'referenceError') report(record, message.message, true);
    else if (message.type === 'referenceSettings') {
      if (message.requestId !== record.requestId) return;
      record.settings = message.settings; sync(record);
    } else if (message.type === 'referenceLoad') {
      try {
        const mesh = decodeModel(message, message.format);
        if (!mesh.triVerts.length) throw new Error('Reference contains no non-degenerate triangles');
        viewer.setReference(record.id, mesh, record.settings);
        record.loaded = true; record.fit.disabled = false;
        report(record, 'Loaded - preview only');
      } catch (error) {
        document.querySelector('#references-tab').click();
        report(record, `${error.message}; any previous reference geometry is retained.`, true);
      }
    }
  });
}
