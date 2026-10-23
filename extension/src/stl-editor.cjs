const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { gcodeHtml, stlHtml } = require('./html.cjs');

const STL_VIEW_TYPE = 'openscadJs.stlViewer';
const GCODE_VIEW_TYPE = 'openscadJs.gcodeViewer';
const MAX_STL_BYTES = 100_000_000;
const MAX_CONVERTED_STL_BYTES = 84 + 2_000_000 * 50;
const RELOAD_DELAY_MS = 200;
const STEP_TIMEOUT_MS = 120_000;
const STEP_TESSELLATION = Object.freeze({ linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.1 });
const FORMATS = { '.stl': 'stl', '.step': 'step', '.stp': 'step', '.3mf': '3mf' };

function modelFormat(name) {
  return FORMATS[path.posix.extname(name).toLowerCase()] ?? 'stl';
}

function validateBinaryStl(data, size) {
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_CONVERTED_STL_BYTES / 3) * 4) throw new Error('Converted STL is missing or too large');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length !== size || bytes.length < 84 || bytes.length !== 84 + bytes.readUInt32LE(80) * 50) throw new Error('Converted STL is malformed');
  return bytes;
}

// Each STEP file gets a fresh worker: OpenCascade's heap only grows, and
// terminating is the only way to cancel a long tessellation.
function tessellateStep(bytes, script) {
  const worker = new Worker(path.join(__dirname, 'occt-worker.cjs'), { workerData: { bytes, script, params: STEP_TESSELLATION } });
  let cancel;
  let timer;
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('STEP tessellation timed out')), STEP_TIMEOUT_MS);
    cancel = () => reject(new Error('STEP loading cancelled'));
    worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result.meshes));
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`STEP reader exited with code ${code}`)));
  }).finally(() => { clearTimeout(timer); void worker.terminate(); });
  return { promise, cancel: () => cancel() };
}

const toBase64 = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');

async function readModel(vscode, uri, stepReader, onStep = () => {}) {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > MAX_STL_BYTES) throw new Error(`File exceeds the ${MAX_STL_BYTES / 1_000_000} MB viewer limit`);
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > MAX_STL_BYTES) throw new Error(`File exceeds the ${MAX_STL_BYTES / 1_000_000} MB viewer limit`);
  if (modelFormat(uri.path) !== 'step') return { data: toBase64(bytes), size: bytes.byteLength };
  const job = tessellateStep(bytes, stepReader);
  onStep(job);
  const meshes = await job.promise;
  return { meshes: meshes.map(mesh => ({ position: toBase64(mesh.position), index: toBase64(mesh.index) })), size: bytes.byteLength };
}

function viewerProvider(vscode, context, { gcode = false, occtScript } = {}) {
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const stepReader = occtScript ?? path.join(media.fsPath, 'vendor', 'occt', 'occt-import-js.js');
  return {
    openCustomDocument(uri) { return { uri, dispose() {} }; },
    resolveCustomEditor(document, panel) {
      const { uri } = document;
      const name = path.posix.basename(uri.path);
      const resource = file => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
      panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
      panel.iconPath = vscode.Uri.joinPath(media, 'icon.png');
      const format = gcode ? 'gcode' : modelFormat(name);
      panel.webview.html = gcode
        ? gcodeHtml(panel.webview.cspSource, resource('gcode.js'), resource('style.css'), name)
        : stlHtml(panel.webview.cspSource, resource('stl.js'), resource('style.css'), name, { format });
      let generation = 0;
      let reloadTimer;
      let closed = false;
      let stepJob;
      const cancelStep = () => { stepJob?.cancel(); stepJob = undefined; };
      const send = message => closed ? Promise.resolve(false) : panel.webview.postMessage(message);
      async function load(reload = false) {
        const current = ++generation;
        cancelStep();
        try {
          const data = await readModel(vscode, uri, stepReader, job => {
            if (current !== generation || closed) { job.cancel(); return; }
            stepJob = job;
            void send({ type: 'loading' });
          });
          if (current === generation && !closed) {
            stepJob = undefined;
            await send({ type: 'load', name, ...data, reload });
          }
        } catch (error) {
          if (current !== generation) return;
          const missing = error.code === 'ENOENT' || error.code === 'FileNotFound';
          await send(missing ? { type: 'deleted' } : { type: 'error', message: error.message });
        }
      }
      async function saveStl(message) {
        try {
          if (format === 'stl') throw new Error('File is already an STL');
          const bytes = validateBinaryStl(message.data, message.size);
          const destination = await vscode.window.showSaveDialog({
            defaultUri: uri.with({ path: uri.path.slice(0, uri.path.length - path.posix.extname(uri.path).length) + '.stl' }),
            filters: { 'STL files': ['stl'] },
            saveLabel: 'Save STL',
            title: `Convert ${name} to STL`,
          });
          if (!destination) return void await send({ type: 'saveCancelled' });
          await vscode.workspace.fs.writeFile(destination, bytes);
          await send({ type: 'saved', name: path.posix.basename(destination.path) });
        } catch (error) {
          await send({ type: 'saveError', message: error.message });
        }
      }
      const scheduleReload = () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => void load(true), RELOAD_DELAY_MS);
      };
      const directory = uri.with({ path: path.posix.dirname(uri.path) });
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, name));
      const subscriptions = [
        watcher,
        watcher.onDidChange(scheduleReload),
        watcher.onDidCreate(scheduleReload),
        watcher.onDidDelete(() => { clearTimeout(reloadTimer); generation++; cancelStep(); void send({ type: 'deleted' }); }),
        panel.webview.onDidReceiveMessage(message => {
          if (message?.type === 'ready') return load();
          if (message?.type === 'saveStl' && !gcode) return saveStl(message);
          if (message?.type === 'openText' && gcode) return vscode.commands.executeCommand('vscode.openWith', uri, 'default');
          if (message?.type === 'useReference' && !gcode) return vscode.commands.executeCommand('openscadJs.useAsReference', uri);
        }),
      ];
      panel.onDidDispose(() => {
        closed = true;
        generation++;
        cancelStep();
        clearTimeout(reloadTimer);
        for (const subscription of subscriptions) subscription.dispose();
      });
    },
  };
}

function registerStlEditor(vscode, context, options = {}) {
  return vscode.window.registerCustomEditorProvider(STL_VIEW_TYPE, viewerProvider(vscode, context, options), { supportsMultipleEditorsPerDocument: true });
}

function registerGcodeEditor(vscode, context) {
  return vscode.window.registerCustomEditorProvider(GCODE_VIEW_TYPE, viewerProvider(vscode, context, { gcode: true }), { supportsMultipleEditorsPerDocument: true });
}

module.exports = { registerStlEditor, registerGcodeEditor, readModel, tessellateStep, modelFormat, STL_VIEW_TYPE, GCODE_VIEW_TYPE, MAX_STL_BYTES, STEP_TESSELLATION };
