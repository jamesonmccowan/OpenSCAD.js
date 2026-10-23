const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readModel, modelFormat } = require('./stl-editor.cjs');

const MAX_REFERENCES = 8;
const MODEL_FILTER = { 'Reference models': ['stl', 'step', 'stp', '3mf'] };
const isModel = uri => /\.(stl|step|stp|3mf)$/i.test(uri.path);
const defaultSettings = () => ({ visible: true, opacity: 0.28, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

function validateSettings(value) {
  if (!value || typeof value.visible !== 'boolean' || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) throw new Error('Invalid reference visibility or opacity');
  for (const name of ['position', 'rotation', 'scale']) {
    if (!Array.isArray(value[name]) || value[name].length !== 3 || value[name].some(number => !Number.isFinite(number) || Math.abs(number) > 1_000_000 || (name === 'scale' && number <= 0))) throw new Error(`Invalid reference ${name}: use three finite values (positive for scale), at most 1,000,000 in magnitude`);
  }
  return { visible: value.visible, opacity: value.opacity, position: [...value.position], rotation: [...value.rotation], scale: [...value.scale] };
}

function createReferences(vscode, context, entry, post) {
  const storageKey = `references:${entry.toString()}`;
  const records = new Map();
  const stepReader = path.join(context.extensionUri.fsPath, 'media/vendor/occt/occt-import-js.js');
  let closed = false;
  let restored = false;
  let mutation = Promise.resolve();
  const send = message => closed ? Promise.resolve(false) : post(message);
  const descriptors = () => [...records.values()].map(record => ({ id: record.id, name: path.posix.basename(record.uri.path), path: record.uri.path, format: modelFormat(record.uri.path), settings: record.settings }));
  const publish = () => send({ type: 'referenceList', references: descriptors() });
  const persist = () => context.workspaceState.update(storageKey, [...records.values()].map(({ id, uri, settings }) => ({ id, uri: uri.toString(), settings })));
  const error = async (id, message) => {
    await send({ type: 'referenceError', id, message });
    if (!id && !closed) await vscode.window.showErrorMessage(`Reference models: ${message}`);
  };
  function stop(record) {
    record.generation++;
    clearTimeout(record.timer);
    record.job?.cancel();
    record.job = undefined;
  }
  async function load(record) {
    stop(record);
    const generation = record.generation;
    await send({ type: 'referenceLoading', id: record.id });
    try {
      const data = await readModel(vscode, record.uri, stepReader, job => {
        if (closed || generation !== record.generation) job.cancel();
        else record.job = job;
      });
      if (closed || generation !== record.generation) return;
      record.job = undefined;
      await send({ type: 'referenceLoad', id: record.id, format: modelFormat(record.uri.path), ...data });
    } catch (cause) {
      if (!closed && generation === record.generation) await error(record.id, `${cause.message}; any previous reference geometry is retained.`);
    }
  }
  function track(id, uri, settings) {
    const record = { id, uri, settings, generation: 0, disposables: [] };
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri.with({ path: path.posix.dirname(uri.path) }), path.posix.basename(uri.path)));
    const reload = () => {
      stop(record);
      record.timer = setTimeout(() => void load(record), 200);
    };
    record.disposables.push(watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(() => {
      stop(record);
      void error(id, 'Reference file deleted; any previous geometry is retained. Restore the file or remove the reference.');
    }));
    records.set(id, record);
    return record;
  }
  function disposeRecord(record) {
    stop(record);
    for (const disposable of record.disposables) disposable.dispose();
  }
  function serialize(action) {
    const next = mutation.then(() => closed ? undefined : action());
    mutation = next.catch(cause => error(undefined, cause.message));
    return mutation;
  }
  async function restore() {
    if (restored) return;
    restored = true;
    try {
      const saved = context.workspaceState.get(storageKey, []);
      if (!Array.isArray(saved) || saved.length > MAX_REFERENCES) throw new Error('Saved reference list is invalid');
      for (const item of saved) {
        if (typeof item?.id !== 'string' || !item.id || records.has(item.id) || typeof item.uri !== 'string') throw new Error('Saved reference entry is invalid');
        const uri = vscode.Uri.parse(item.uri);
        if (!isModel(uri) || !['file', 'vscode-remote'].includes(uri.scheme)) throw new Error('Saved reference file is unsupported');
        track(item.id, uri, validateSettings(item.settings));
      }
    } catch (cause) { await error(undefined, `Cannot restore references: ${cause.message}`); }
  }
  async function add(uri) {
    await restore();
    if (!isModel(uri) || !['file', 'vscode-remote'].includes(uri.scheme)) throw new Error('Choose an STL, STEP, STP or 3MF file on the workspace host');
    if ([...records.values()].some(record => record.uri.toString() === uri.toString())) throw new Error('This model is already a reference in this preview');
    if (records.size >= MAX_REFERENCES) throw new Error(`A preview supports at most ${MAX_REFERENCES} references`);
    const record = track(randomUUID(), uri, defaultSettings());
    try { await persist(); }
    catch (cause) { records.delete(record.id); disposeRecord(record); throw cause; }
    await publish();
    await send({ type: 'referenceFocus' });
    void load(record);
  }
  return {
    ready() {
      return serialize(async () => {
        await restore();
        await publish();
        for (const record of records.values()) void load(record);
      });
    },
    add(uri) {
      return serialize(() => add(uri));
    },
    handle(message) {
      return serialize(async () => {
        if (message.type === 'referenceAdd') {
          const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: MODEL_FILTER, title: 'Add a reference model', defaultUri: entry.with({ path: path.posix.dirname(entry.path) }) });
          if (files?.[0] && !closed) await add(files[0]);
          return;
        }
        const record = records.get(message.id);
        if (!record) throw new Error('Reference no longer exists');
        if (message.type === 'referenceReload') { void load(record); return; }
        if (message.type === 'referenceUpdate') {
          const previous = record.settings;
          record.settings = validateSettings(message.settings);
          try { await persist(); }
          catch (cause) { record.settings = previous; await send({ type: 'referenceSettings', id: record.id, settings: previous, requestId: message.requestId }); throw cause; }
          await send({ type: 'referenceSettings', id: record.id, settings: record.settings, requestId: message.requestId });
        } else if (message.type === 'referenceRemove') {
          records.delete(record.id);
          try { await persist(); }
          catch (cause) { records.set(record.id, record); throw cause; }
          disposeRecord(record);
          await publish();
        }
      });
    },
    dispose() { closed = true; for (const record of records.values()) disposeRecord(record); },
  };
}

module.exports = { createReferences, validateSettings, MODEL_FILTER };
