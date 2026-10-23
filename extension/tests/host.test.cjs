const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function event() {
  const listeners = new Set();
  return { subscribe: callback => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; }, fire: value => Promise.all([...listeners].map(callback => callback(value))) };
}

async function setup(t, { occt = false } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'openscad-extension-'));
  const root = path.join(temporary, 'workspace');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'main.scad'), 'cube(1);');
  await fs.writeFile(path.join(root, 'part.scad'), 'cube(2);');
  class Uri {
    constructor(value) { this.path = value; this.fsPath = value; this.scheme = 'file'; this.authority = ''; }
    static file(value) { return new Uri(value); }
    static parse(value) { return new Uri(value.replace(/^file:\/\//, '')); }
    static joinPath(base, ...parts) { return new Uri(path.posix.join(base.path, ...parts)); }
    with(changes) { return new Uri(changes.path ?? this.path); }
    toString() { return `file://${this.path}`; }
  }
  const change = event();
  const configuration = event();
  const panels = [];
  const watchers = [];
  const collections = [];
  const documents = [];
  const writes = [];
  const libraryPaths = [];
  const fontDirectories = [];
  const experimentalFeatures = [];
  const registeredCommands = new Map();
  const customEditors = new Map();
  const storage = new Map();
  const errors = [];
  let openDestination;
  let pick;
  let saveDestination;
  let writeFailure;
  let clipboard = '';
  const document = (name, text) => {
    const value = { uri: new Uri(path.join(root, name)), text, getText() { return this.text; }, lineCount: 1, lineAt: () => ({ text: value.text }) };
    documents.push(value);
    return value;
  };
  const main = document('main.scad', 'include <part.scad>\ncube(3);');
  const part = document('part.scad', 'cube(7);');
  const vscode = {
    Uri, ViewColumn: { Beside: 2, One: 1 }, DiagnosticSeverity: { Warning: 1, Error: 0 },
    Range: class { constructor(...args) { this.values = args; } },
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
    env: { clipboard: { writeText: async text => { clipboard = text; } } },
    commands: {
      registerCommand(name, callback) { registeredCommands.set(name, callback); return { dispose() { registeredCommands.delete(name); } }; },
      async executeCommand(name, ...args) { return registeredCommands.get(name)?.(...args); }
    },
    languages: { createDiagnosticCollection() { const value = { values: new Map(), disposed: false, set(uri, issues) { this.values.set(uri.toString(), issues); }, clear() { this.values.clear(); }, dispose() { this.disposed = true; } }; collections.push(value); return value; } },
    workspace: {
      isTrusted: true, textDocuments: documents, getWorkspaceFolder: () => ({ uri: new Uri(root) }), getConfiguration: () => ({ get: (key, fallback) => key === 'fontDirectories' ? fontDirectories : key === 'systemFonts' ? false : key === 'libraryPaths' ? libraryPaths : key === 'experimentalFeatures' ? experimentalFeatures : fallback }),
      onDidChangeTextDocument: change.subscribe, onDidSaveTextDocument: event().subscribe, onDidChangeConfiguration: configuration.subscribe,
      async openTextDocument(uri) { return documents.find(value => value.uri.toString() === uri.toString()) ?? document(path.relative(root, uri.path), await fs.readFile(uri.path, 'utf8')); },
      fs: { stat: uri => fs.stat(uri.path), readFile: uri => fs.readFile(uri.path), writeFile: async (uri, bytes) => { if (uri.path.endsWith(writeFailure ?? '\0')) throw new Error('Snapshot destination is read-only'); writes.push({ uri, bytes }); } },
      createFileSystemWatcher() { const change = event(); const create = event(); const remove = event(); const value = { onDidChange: change.subscribe, onDidCreate: create.subscribe, onDidDelete: remove.subscribe, change, create, remove, disposed: false, dispose() { this.disposed = true; } }; watchers.push(value); return value; },
    },
    window: {
      activeTextEditor: { document: main }, showWarningMessage: async () => {}, showInformationMessage: async () => {}, showTextDocument: async () => {}, showSaveDialog: async () => saveDestination,
      showErrorMessage: async message => errors.push(message), showOpenDialog: async () => openDestination ? [openDestination] : undefined,
      showQuickPick: async choices => choices.find(choice => (choice.uri ?? choice.state?.entry)?.path === pick),
      registerCustomEditorProvider(viewType, provider, options) { customEditors.set(viewType, { provider, options }); return { dispose() { customEditors.delete(viewType); } }; },
      createWebviewPanel() {
        const dispose = event(); const view = event(); const message = event();
        const panel = { visible: true, active: false, sent: [], reveals: 0, reveal() { this.reveals++; }, view, onDidDispose: dispose.subscribe, onDidChangeViewState: view.subscribe, dispose: () => dispose.fire(), receive: message.fire };
        panel.webview = { cspSource: 'https://assets.example', asWebviewUri: uri => uri, postMessage: async value => { panel.sent.push(value); return true; }, onDidReceiveMessage: message.subscribe };
        panels.push(panel);
        return panel;
      },
    },
  };
  const original = Module._load;
  let activate;
  try {
    Module._load = function(name, ...args) { return name === 'vscode' ? vscode : original.call(this, name, ...args); };
    delete require.cache[require.resolve('../src/extension.cjs')];
    ({ activate } = require('../src/extension.cjs'));
  } finally { Module._load = original; }
  let extensionPath = '/extension';
  if (occt) {
    extensionPath = path.join(temporary, 'extension');
    await fs.mkdir(path.join(extensionPath, 'media', 'vendor'), { recursive: true });
    await fs.symlink(path.dirname(require.resolve('occt-import-js')), path.join(extensionPath, 'media', 'vendor', 'occt'));
  }
  const context = { extensionUri: new Uri(extensionPath), subscriptions: [], workspaceState: {
    get: (key, fallback) => structuredClone(storage.get(key) ?? fallback),
    update: async (key, value) => { storage.set(key, structuredClone(value)); },
  } };
  activate(context);
  t.after(async () => { for (const value of context.subscriptions) value.dispose(); await fs.rm(temporary, { recursive: true, force: true }); });
  const open = async () => { await registeredCommands.get('openscadJs.openPreview')(main.uri); const panel = panels.at(-1); await panel.receive({ type: 'ready' }); return panel; };
  const openStl = async (name, viewType = 'openscadJs.stlViewer') => {
    const { provider } = customEditors.get(viewType);
    const document = await provider.openCustomDocument(new Uri(path.join(root, name)));
    const panel = vscode.window.createWebviewPanel();
    await provider.resolveCustomEditor(document, panel);
    return panel;
  };
  return { root, temporary, Uri, panels, customEditors, openStl, watchers, collections, writes, libraryPaths, fontDirectories, experimentalFeatures, main, part, change, open, registeredCommands, storage, errors, context, vscode,
    failWrite: suffix => { writeFailure = suffix; },
    chooseFile: name => { openDestination = name ? new Uri(path.join(root, name)) : undefined; },
    choosePreview: name => { pick = path.join(root, name); },
    clipboard: () => clipboard, command: (target = main.uri) => registeredCommands.get('openscadJs.openPreview')(target), saveTo: name => { saveDestination = new Uri(path.join(root, name)); } };
}

const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const snapshotReply = requestId => ({ type: 'snapshotCaptured', requestId, dataUrl: `data:image/png;base64,${base64Png}` });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('host resolves fonts from configured directories and reports missing faces without treating names as source paths', async t => {
  const fixture = await setup(t);
  const { runtimeFont } = await import('../../tests/helpers/fonts.js');
  const bytes = await runtimeFont('Bold Italic');
  await fs.mkdir(path.join(fixture.root, 'fonts'));
  await fs.writeFile(path.join(fixture.root, 'fonts', 'example.otf'), bytes);
  fixture.fontDirectories.push('fonts');
  const panel = await fixture.open();
  await panel.receive({ type: 'requestCompile', revision: 0 });
  const job = panel.sent.findLast(message => message.type === 'compile').job;
  await panel.receive({ type: 'read', kind: 'font', path: 'Runtime Test Sans:style=Bold Italic', id: 1, job });
  assert.deepEqual(panel.sent.at(-1).value, Array.from(bytes));
  await panel.receive({ type: 'read', kind: 'font', path: 'Absent Font', id: 2, job });
  assert.equal(panel.sent.at(-1).value, undefined);
  await panel.receive({ type: 'read', kind: 'font', path: '../private.ttf', id: 3, job });
  assert.equal(panel.sent.at(-1).value, undefined);
});

test('font browser lists readable bundled and directory faces, refreshes and copies exact SCAD assignments', async t => {
  const fixture = await setup(t);
  fixture.vscode.env.remoteName = 'ssh-remote';
  await fs.mkdir(path.join(fixture.root, 'fonts'));
  fixture.fontDirectories.push('fonts');
  const panel = await fixture.open();
  assert.equal(panel.sent.some(message => message.type === 'fontListResult'), false);
  await panel.receive({ type: 'fontList', requestId: 1 });
  const bundled = panel.sent.at(-1);
  assert.equal(bundled.requestId, 1);
  assert.equal(bundled.fonts.length, 12);
  assert.match(bundled.host, /Remote extension host.*ssh-remote/);
  const { runtimeFont } = await import('../../tests/helpers/fonts.js');
  await fs.writeFile(path.join(fixture.root, 'fonts', 'new.otf'), await runtimeFont('Bold Italic'));
  await panel.receive({ type: 'fontList', requestId: 2 });
  const result = panel.sent.at(-1);
  assert.equal(result.fonts.length, 13);
  const name = 'Runtime Test Sans:style=Bold Italic';
  assert.equal(result.fonts.find(face => face.name === name).source, 'directory');
  assert.equal(result.fonts.some(face => 'file' in face), false);
  await panel.receive({ type: 'fontCopy', name });
  assert.equal(fixture.clipboard(), `font="${name}"`);
  assert.equal(panel.sent.at(-1).type, 'fontCopied');
  await panel.receive({ type: 'fontCopy', name: 'not in the list' });
  assert.match(panel.sent.at(-1).error, /current available-font list/);
  fixture.vscode.env.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); };
  await panel.receive({ type: 'fontCopy', name });
  assert.equal(panel.sent.at(-1).error, 'Clipboard unavailable');
});

test('font discovery failures stay in the font panel and allow retry', async t => {
  const fixture = await setup(t);
  fixture.fontDirectories.push('missing-fonts');
  const panel = await fixture.open();
  await panel.receive({ type: 'fontList', requestId: 1 });
  assert.equal(panel.sent.at(-1).type, 'fontListResult');
  assert.match(panel.sent.at(-1).error, /ENOENT/);
  await fs.mkdir(path.join(fixture.root, 'missing-fonts'));
  await panel.receive({ type: 'fontList', requestId: 2 });
  assert.equal(panel.sent.at(-1).fonts.length, 12);
});

test('panels are pinned per URI and use captured unsaved dependency text', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  assert.equal(panel.iconPath.path, '/extension/media/icon.png');
  await fixture.command();
  assert.equal(fixture.panels.length, 1);
  assert.equal(panel.reveals, 1);
  await panel.receive({ type: 'requestCompile', mode: 'preview' });
  const compile = panel.sent.find(value => value.type === 'compile');
  assert.equal(compile.files['project/main.scad'], fixture.main.text);
  fixture.part.text = 'cube(99);';
  await fixture.change.fire({ document: fixture.part, contentChanges: [{}] });
  await panel.receive({ type: 'read', job: compile.job, id: 1, kind: 'source', path: 'project/part.scad' });
  assert.equal(panel.sent.at(-1).value, 'cube(7);');
  assert.ok(panel.sent.some(value => value.type === 'stale'));
  await fixture.change.fire({ document: fixture.part, contentChanges: [{}] });
  assert.equal(panel.sent.at(-1).type, 'stale');
  await panel.dispose();
  assert.ok(fixture.watchers.every(value => value.disposed));
  assert.ok(fixture.collections[0].disposed);
});

test('missing dependencies are watched and symlink escapes are rejected', async t => {
  const fixture = await setup(t);
  await fs.writeFile(path.join(fixture.temporary, 'secret.scad'), 'sphere(9);');
  await fs.symlink(path.join(fixture.temporary, 'secret.scad'), path.join(fixture.root, 'escape.scad'));
  const panel = await fixture.open();
  await panel.receive({ type: 'requestCompile' });
  const { job } = panel.sent.at(-1);
  await panel.receive({ type: 'read', job, id: 1, kind: 'source', path: 'project/escape.scad' });
  assert.match(panel.sent.at(-1).error, /symlink escapes/);
  await panel.receive({ type: 'read', job, id: 2, kind: 'source', path: 'project/missing.scad' });
  assert.equal(panel.sent.at(-1).value, undefined);
  await fixture.watchers[0].create.fire(new fixture.Uri(path.join(fixture.root, 'missing.scad')));
  assert.equal(panel.sent.at(-1).type, 'stale');
});

test('separate entries get separate panels; configured libraries and binary assets are resolved and watched', async t => {
  const fixture = await setup(t);
  await fs.mkdir(path.join(fixture.root, 'libs'));
  await fs.writeFile(path.join(fixture.root, 'libs/shapes.scad'), 'module shape() { cube(4); }');
  await fs.writeFile(path.join(fixture.root, 'piece.stl'), Uint8Array.from([0, 255, 128, 20]));
  await fs.writeFile(path.join(fixture.root, 'second.scad'), 'sphere(2);');
  fixture.libraryPaths.push('libs');
  fixture.experimentalFeatures.push('roof');
  const panel = await fixture.open();
  await panel.receive({ type: 'requestCompile', revision: 17, time: 0.75, defines: { width: 14 } });
  const compile = panel.sent.at(-1);
  assert.deepEqual(compile.libraryPaths, ['library0']);
  assert.deepEqual(compile.experimental, ['roof']);
  assert.equal(compile.requestRevision, 17);
  assert.equal(compile.time, 0.75);
  assert.deepEqual(compile.defines, { width: 14 });
  await panel.receive({ type: 'read', job: compile.job, id: 1, kind: 'source', path: 'library0/shapes.scad' });
  assert.match(panel.sent.at(-1).value, /module shape/);
  await panel.receive({ type: 'read', job: compile.job, id: 2, kind: 'asset', path: 'project/piece.stl' });
  assert.deepEqual(panel.sent.at(-1).value, [0, 255, 128, 20]);
  await fixture.watchers[0].change.fire(new fixture.Uri(path.join(fixture.root, 'piece.stl')));
  assert.equal(panel.sent.at(-1).type, 'stale');
  await fixture.command(new fixture.Uri(path.join(fixture.root, 'second.scad')));
  assert.equal(fixture.panels.length, 2);
});

test('audit clearance is validated and forwarded to the webview compiler', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  await panel.receive({ type: 'requestCompile', auditComponents: true, auditOnly: true, auditClearance: 0.2 });
  assert.equal(panel.sent.at(-1).type, 'compile');
  assert.equal(panel.sent.at(-1).auditClearance, 0.2);
  assert.equal(panel.sent.at(-1).auditOnly, true);
  for (const auditClearance of [-1, 101, '0.2', NaN, Infinity]) {
    const count = panel.sent.filter(message => message.type === 'compile').length;
    await panel.receive({ type: 'requestCompile', auditComponents: true, auditOnly: true, auditClearance });
    assert.equal(panel.sent.filter(message => message.type === 'compile').length, count);
    assert.match(panel.sent.at(-1).message, /Invalid audit clearance distance/);
  }
});

test('diagnostics link to dependencies and stale exports cannot write files', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  await panel.receive({ type: 'requestCompile', mode: 'render', export: true });
  const { job } = panel.sent.at(-1);
  await panel.receive({ type: 'diagnostics', job, diagnostics: [{ severity: 'error', message: 'Bad syntax', code: 'syntax', location: { file: 'project/part.scad', line: 1, column: 2 } }] });
  assert.equal(fixture.collections[0].values.get(fixture.part.uri.toString())[0].message, 'Bad syntax');
  await panel.receive({ type: 'diagnostics', job, diagnostics: [{ severity: 'error', message: 'Failed to load runtime asset', code: 'runtime-error' }] });
  assert.equal(fixture.collections[0].values.size, 0);
  fixture.saveTo('main.stl');
  await fixture.change.fire({ document: fixture.main, contentChanges: [{}] });
  assert.equal(fixture.collections[0].values.size, 0);
  await panel.receive({ type: 'export', job, bytes: [0, 1, 2] });
  assert.equal(fixture.writes.length, 0);
  assert.match(panel.sent.at(-1).message, /Source changed/);
  await panel.receive({ type: 'requestCompile', mode: 'render', export: true });
  await panel.receive({ type: 'export', job: panel.sent.at(-1).job, bytes: [0, 1, 2] });
  assert.equal(fixture.writes.length, 1);
  assert.deepEqual([...fixture.writes[0].bytes], [0, 1, 2]);
});

test('openscadJs.preview and openscadJs.render commands trigger compilation on open panel', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  await fixture.registeredCommands.get('openscadJs.preview')();
  assert.equal(panel.sent.at(-1).type, 'triggerCompile');
  assert.equal(panel.sent.at(-1).mode, 'preview');
  await fixture.registeredCommands.get('openscadJs.render')();
  assert.equal(panel.sent.at(-1).type, 'triggerCompile');
  assert.equal(panel.sent.at(-1).mode, 'render');
});

test('model metrics and snapshot commands update workspace and trigger webview capture', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  const sampleMetrics = {
    triangles: 12,
    volume: 27,
    size: { x: 3, y: 3, z: 3 },
    bounds: { min: [0, 0, 0], max: [3, 3, 3], center: [1.5, 1.5, 1.5] },
    layers: { solid: 1, background: 0, debug: 0, total: 1 }
  };
  await panel.receive({ type: 'modelMetrics', job: 1, metrics: sampleMetrics });
  const modelJsonWrite = fixture.writes.find(w => w.uri.path.endsWith('.openscad-model.json'));
  assert.ok(modelJsonWrite);
  const parsedMetrics = JSON.parse(new TextDecoder().decode(modelJsonWrite.bytes));
  assert.equal(parsedMetrics.volume, 27);
  assert.equal(parsedMetrics.size.x, 3);

  const inspected = await fixture.registeredCommands.get('openscadJs.inspectGeometry')();
  assert.deepEqual(inspected, sampleMetrics);

  let completed = false;
  const capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')().then(uri => { completed = true; return uri; });
  await flush();
  assert.equal(panel.sent.at(-1).type, 'captureSnapshot');
  assert.equal(completed, false);
  await panel.receive(snapshotReply(panel.sent.at(-1).requestId));
  const uri = await capture;
  assert.equal(uri.path, path.join(fixture.root, 'main-preview.png'));
  const snapshotWrite = fixture.writes.find(w => w.uri.path.endsWith('main-preview.png'));
  assert.ok(snapshotWrite);
  const standardWrite = fixture.writes.find(w => w.uri.path.endsWith('.openscad-preview.png'));
  assert.ok(standardWrite);
});

test('visibility changes neither stale nor cancel the pinned preview', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  await panel.receive({ type: 'requestCompile', mode: 'preview' });
  const before = panel.sent.length;
  panel.visible = false;
  await panel.view.fire({ webviewPanel: panel });
  panel.visible = true;
  await panel.view.fire({ webviewPanel: panel });
  assert.equal(panel.sent.length, before);
});

test('snapshot targets active preview, explicit URI or user choice, never an arbitrary panel', async t => {
  const fixture = await setup(t);
  const first = await fixture.open();
  await fixture.command(fixture.part.uri);
  const second = fixture.panels.at(-1);
  await second.receive({ type: 'ready' });
  second.active = true;
  let capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')();
  await flush();
  assert.equal(second.sent.at(-1).type, 'captureSnapshot');
  second.active = false;
  first.active = true;
  await second.receive(snapshotReply(second.sent.at(-1).requestId));
  assert.equal((await capture).path, path.join(fixture.root, 'part-preview.png'));

  capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')(fixture.part.uri);
  await flush();
  await second.receive(snapshotReply(second.sent.at(-1).requestId));
  assert.equal((await capture).path, path.join(fixture.root, 'part-preview.png'));

  first.active = false;
  fixture.vscode.window.activeTextEditor = undefined;
  fixture.choosePreview('part.scad');
  capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')();
  await flush();
  await second.receive(snapshotReply(second.sent.at(-1).requestId));
  assert.equal((await capture).path, path.join(fixture.root, 'part-preview.png'));
  fixture.choosePreview('missing.scad');
  const count = first.sent.length + second.sent.length;
  assert.equal(await fixture.registeredCommands.get('openscadJs.captureSnapshot')(), undefined);
  assert.equal(first.sent.length + second.sent.length, count);
});

test('snapshot failures reject the command and surface errors without cancelling compilation', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  let capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')();
  let rejected = assert.rejects(capture, /Compilation is in progress/);
  await flush();
  await panel.receive({ type: 'snapshotFailed', requestId: panel.sent.at(-1).requestId, message: 'Compilation is in progress' });
  await rejected;
  assert.match(fixture.errors.at(-1), /Compilation is in progress/);

  fixture.failWrite('.openscad-preview.png');
  capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')();
  rejected = assert.rejects(capture, /read-only/);
  await flush();
  await panel.receive(snapshotReply(panel.sent.at(-1).requestId));
  await rejected;
  assert.equal(panel.sent.at(-1).type, 'snapshotSaveFailed');
  assert.match(fixture.errors.at(-1), /read-only/);

  fixture.failWrite(undefined);
  capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')();
  rejected = assert.rejects(capture, /nonempty PNG/);
  await flush();
  await panel.receive({ type: 'snapshotCaptured', requestId: panel.sent.at(-1).requestId, dataUrl: 'data:image/png;base64,AAAA' });
  await rejected;
});

test('snapshot requests fail on disposal, failed delivery and timeout; late replies are ignored', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  panel.webview.postMessage = async () => false;
  await assert.rejects(fixture.registeredCommands.get('openscadJs.captureSnapshot')(), /Unable to deliver/);
  panel.webview.postMessage = async value => { panel.sent.push(value); return true; };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')();
  let rejected = assert.rejects(capture, /timed out/);
  await flush();
  const requestId = panel.sent.at(-1).requestId;
  t.mock.timers.tick(15_000);
  await rejected;
  await panel.receive(snapshotReply(requestId));
  assert.equal(fixture.writes.length, 0);
  capture = fixture.registeredCommands.get('openscadJs.captureSnapshot')();
  rejected = assert.rejects(capture, /Preview closed/);
  await flush();
  await panel.dispose();
  await rejected;
});

test('validated measurements can be copied to the host clipboard', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  const measurement = { distance: 12.5, delta: { x: 3, y: 4, z: 11.5 }, points: [[0, 0, 0], [3, 4, 11.5]], units: 'mm', tolerance: 0.3, withinTolerance: false };
  await panel.receive({ type: 'measurement', measurement });
  await panel.receive({ type: 'copyMeasurement' });
  assert.deepEqual(JSON.parse(fixture.clipboard()), measurement);
});
test('STL custom editor sends bytes, reloads on change, reports errors and cleans up', async t => {
  const fixture = await setup(t);
  assert.equal(fixture.customEditors.get('openscadJs.stlViewer').options.supportsMultipleEditorsPerDocument, true);
  const file = path.join(fixture.root, 'part one.stl');
  await fs.writeFile(file, 'solid a\nendsolid a\n');
  const panel = await fixture.openStl('part one.stl');
  assert.equal(panel.iconPath.path, '/extension/media/icon.png');
  assert.match(panel.webview.html, /part one\.stl/);
  assert.match(panel.webview.html, /stl\.js/);
  assert.deepEqual(panel.webview.options.localResourceRoots.map(value => value.path), ['/extension/media']);
  await panel.receive({ type: 'ready' });
  const load = panel.sent.at(-1);
  assert.equal(load.type, 'load');
  assert.equal(load.reload, false);
  assert.equal(Buffer.from(load.data, 'base64').toString(), 'solid a\nendsolid a\n');
  assert.equal(load.size, 19);
  assert.equal(load.bytes, undefined);
  const watcher = fixture.watchers.at(-1);
  await fs.writeFile(file, 'solid b\nendsolid b\n');
  await watcher.change.fire();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(panel.sent.at(-1).reload, true);
  assert.equal(Buffer.from(panel.sent.at(-1).data, 'base64').toString(), 'solid b\nendsolid b\n');
  await watcher.remove.fire();
  assert.equal(panel.sent.at(-1).type, 'deleted');
  await fs.rm(file);
  await panel.receive({ type: 'ready' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(panel.sent.at(-1).type, 'deleted');
  await panel.dispose();
  assert.equal(watcher.disposed, true);
  const count = panel.sent.length;
  await panel.receive({ type: 'ready' });
  assert.equal(panel.sent.length, count);
});

test('STL custom editor rejects files above the size limit before reading', async t => {
  const fixture = await setup(t);
  await fs.writeFile(path.join(fixture.root, 'huge.stl'), '');
  await fs.truncate(path.join(fixture.root, 'huge.stl'), 100_000_001);
  const panel = await fixture.openStl('huge.stl');
  await panel.receive({ type: 'ready' });
  assert.equal(panel.sent.at(-1).type, 'error');
  assert.match(panel.sent.at(-1).message, /100 MB/);
});

test('G-code viewer sends text bytes, reloads, offers Open as Text and ignores STL conversion', async t => {
  const fixture = await setup(t);
  assert.equal(fixture.customEditors.get('openscadJs.gcodeViewer').options.supportsMultipleEditorsPerDocument, true);
  const opened = [];
  fixture.registeredCommands.set('vscode.openWith', (...args) => opened.push(args));
  const file = path.join(fixture.root, 'print.gcode');
  await fs.writeFile(file, 'G1 X1 Y1 E1\n');
  const panel = await fixture.openStl('print.gcode', 'openscadJs.gcodeViewer');
  assert.match(panel.webview.html, /gcode\.js/);
  assert.match(panel.webview.html, /id="open-text"/);
  assert.doesNotMatch(panel.webview.html, /convert-stl/);
  await panel.receive({ type: 'ready' });
  assert.equal(panel.sent.at(-1).type, 'load');
  assert.equal(Buffer.from(panel.sent.at(-1).data, 'base64').toString(), 'G1 X1 Y1 E1\n');
  await fs.writeFile(file, 'G1 X2 Y2 E2\n');
  await fixture.watchers.at(-1).change.fire();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(panel.sent.at(-1).reload, true);
  const count = panel.sent.length;
  await panel.receive({ type: 'saveStl', data: '', size: 0 });
  assert.equal(panel.sent.length, count);
  await panel.receive({ type: 'openText' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0].fsPath, file);
  assert.equal(opened[0][1], 'default');
});

const stepFixture = name => fs.readFile(path.join(path.dirname(require.resolve('occt-import-js')), '..', 'test', 'testfiles', name));
const waitFor = async (predicate, timeout = 30_000) => {
  for (const start = Date.now(); !predicate(); await new Promise(resolve => setTimeout(resolve, 20))) if (Date.now() - start > timeout) throw new Error('Timed out');
};

test('model viewer detects formats and only offers conversion for STEP and 3MF', async t => {
  const fixture = await setup(t);
  for (const [name, format] of [['a.STL', 'stl'], ['b.step', 'step'], ['c.STP', 'step'], ['d.3mf', '3mf']]) {
    await fs.writeFile(path.join(fixture.root, name), '');
    const html = (await fixture.openStl(name)).webview.html;
    assert.match(html, new RegExp(`data-format="${format}"`));
    assert.equal(html.includes('id="convert-stl"'), format !== 'stl');
  }
});

test('references load, persist per design, reload without compiling, and dispose their watchers', async t => {
  const fixture = await setup(t);
  await fs.writeFile(path.join(fixture.root, 'reference.stl'), 'solid reference\nendsolid reference\n');
  const panel = await fixture.open();
  fixture.chooseFile('reference.stl');
  await panel.receive({ type: 'referenceAdd' });
  await waitFor(() => panel.sent.some(message => message.type === 'referenceLoad'));
  const list = panel.sent.findLast(message => message.type === 'referenceList');
  assert.equal(list.references.length, 1);
  const { id, settings } = list.references[0];
  const watcher = fixture.watchers.at(-1);
  const load = panel.sent.findLast(message => message.type === 'referenceLoad');
  assert.equal(load.format, 'stl');
  assert.equal(Buffer.from(load.data, 'base64').toString(), 'solid reference\nendsolid reference\n');
  const changed = { ...settings, visible: false, opacity: 0.6, position: [4, 5, 6], rotation: [10, 20, 30], scale: [2, 3, 4] };
  await panel.receive({ type: 'referenceUpdate', id, settings: changed, requestId: 7 });
  assert.deepEqual(panel.sent.at(-1), { type: 'referenceSettings', id, settings: changed, requestId: 7 });
  assert.deepEqual(fixture.storage.get(`references:${fixture.main.uri}`).map(record => record.settings), [changed]);
  await fixture.command(fixture.part.uri);
  const other = fixture.panels.at(-1);
  await other.receive({ type: 'ready' });
  assert.deepEqual(other.sent.findLast(message => message.type === 'referenceList').references, []);
  await fs.writeFile(path.join(fixture.root, 'reference.stl'), 'updated');
  const loads = panel.sent.filter(message => message.type === 'referenceLoad').length;
  await watcher.change.fire();
  await waitFor(() => panel.sent.filter(message => message.type === 'referenceLoad').length > loads);
  assert.equal(Buffer.from(panel.sent.findLast(message => message.type === 'referenceLoad').data, 'base64').toString(), 'updated');
  assert.equal(panel.sent.some(message => message.type === 'compile' || message.type === 'stale'), false);
  await watcher.remove.fire();
  assert.match(panel.sent.at(-1).message, /deleted.*retained/);
  await panel.dispose();
  assert.equal(watcher.disposed, true);
  const reopened = await fixture.open();
  await waitFor(() => reopened.sent.some(message => message.type === 'referenceLoad'));
  assert.deepEqual(reopened.sent.findLast(message => message.type === 'referenceList').references[0].settings, changed);
  await reopened.receive({ type: 'referenceRemove', id });
  assert.deepEqual(reopened.sent.at(-1).references, []);
  assert.deepEqual(fixture.storage.get(`references:${fixture.main.uri}`), []);
  assert.equal(fixture.watchers.at(-1).disposed, true);
});

test('reference settings, duplicate files, file limits and persistence failures produce explicit errors', async t => {
  const fixture = await setup(t);
  await fs.writeFile(path.join(fixture.root, 'reference.stl'), '');
  const panel = await fixture.open();
  fixture.chooseFile('reference.stl');
  await panel.receive({ type: 'referenceAdd' });
  await waitFor(() => panel.sent.some(message => message.type === 'referenceLoad'));
  const { id, settings } = panel.sent.findLast(message => message.type === 'referenceList').references[0];
  for (const invalid of [{ ...settings, opacity: 2 }, { ...settings, scale: [0, 1, 1] }, { ...settings, position: [Infinity, 0, 0] }, { ...settings, rotation: [1, 2] }]) {
    await panel.receive({ type: 'referenceUpdate', id, settings: invalid });
    assert.equal(panel.sent.at(-1).type, 'referenceError');
    assert.match(panel.sent.at(-1).message, /Invalid reference/);
  }
  await panel.receive({ type: 'referenceAdd' });
  await waitFor(() => panel.sent.at(-1).message?.includes('already a reference'));
  assert.match(fixture.errors.at(-1), /already a reference/);
  const update = fixture.context.workspaceState.update;
  fixture.context.workspaceState.update = async () => { throw new Error('Storage unavailable'); };
  await panel.receive({ type: 'referenceUpdate', id, settings: { ...settings, opacity: 0.5 }, requestId: 9 });
  assert.deepEqual(panel.sent.findLast(message => message.type === 'referenceSettings').settings, settings);
  assert.match(panel.sent.at(-1).message, /Storage unavailable/);
  await panel.receive({ type: 'referenceRemove', id });
  assert.match(panel.sent.at(-1).message, /Storage unavailable/);
  fixture.context.workspaceState.update = update;
  const large = await fs.open(path.join(fixture.root, 'large.stl'), 'w');
  await large.truncate(100_000_001); await large.close();
  fixture.chooseFile('large.stl');
  await panel.receive({ type: 'referenceAdd' });
  await waitFor(() => panel.sent.some(message => message.type === 'referenceError' && message.message.includes('100 MB')));
  assert.equal(panel.sent.filter(message => message.type === 'referenceLoad').length, 1);
});

test('Use as Reference targets the chosen preview and the model viewer forwards its own URI', async t => {
  const fixture = await setup(t);
  await fs.writeFile(path.join(fixture.root, 'reference.3mf'), 'test archive bytes');
  const panel = await fixture.openStl('reference.3mf');
  fixture.choosePreview('part.scad');
  await panel.receive({ type: 'useReference' });
  const preview = fixture.panels.at(-1);
  // The command can add the reference before the newly opened webview is ready.
  await preview.receive({ type: 'ready' });
  await waitFor(() => preview.sent.some(message => message.type === 'referenceLoad'));
  const list = preview.sent.findLast(message => message.type === 'referenceList');
  assert.equal(list.references.length, 1);
  assert.equal(list.references[0].format, '3mf');
  assert.equal(list.references[0].path, path.join(fixture.root, 'reference.3mf'));
  assert.equal(fixture.storage.has(`references:${fixture.main.uri}`), false);
  assert.equal(fixture.storage.get(`references:${fixture.part.uri}`).length, 1);
});

test('reference count is capped at eight and cancelled selection does not change saved settings', async t => {
  const fixture = await setup(t);
  const panel = await fixture.open();
  await panel.receive({ type: 'referenceAdd' });
  assert.equal(fixture.storage.size, 0);
  for (let index = 0; index < 9; index++) {
    await fs.writeFile(path.join(fixture.root, `reference-${index}.stl`), '');
    fixture.chooseFile(`reference-${index}.stl`);
    await panel.receive({ type: 'referenceAdd' });
    if (index < 8) await waitFor(() => panel.sent.filter(message => message.type === 'referenceLoad').length === index + 1);
    else await waitFor(() => panel.sent.at(-1).message?.includes('at most 8'));
  }
  assert.equal(fixture.storage.get(`references:${fixture.main.uri}`).length, 8);
  assert.equal(panel.sent.findLast(message => message.type === 'referenceList').references.length, 8);
});

test('STEP references use host tessellation and cancelled loads cannot reach a closed preview', async t => {
  const fixture = await setup(t, { occt: true });
  await fs.writeFile(path.join(fixture.root, 'cube.step'), await stepFixture('rounded-cube/rounded-cube.step'));
  const panel = await fixture.open();
  fixture.chooseFile('cube.step');
  await panel.receive({ type: 'referenceAdd' });
  await waitFor(() => panel.sent.some(message => message.type === 'referenceLoad'));
  const load = panel.sent.findLast(message => message.type === 'referenceLoad');
  assert.equal(load.format, 'step'); assert.ok(load.meshes.length > 0);
  const id = load.id;
  await panel.receive({ type: 'referenceReload', id });
  const count = panel.sent.length;
  await panel.dispose();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(panel.sent.length, count);
});

test('STEP files are tessellated on the host and sent as mesh arrays', async t => {
  const fixture = await setup(t, { occt: true });
  await fs.writeFile(path.join(fixture.root, 'cube.step'), await stepFixture('rounded-cube/rounded-cube.step'));
  await fs.writeFile(path.join(fixture.root, 'bad.step'), 'ISO-10303-21;\nnot a step file\n');
  const panel = await fixture.openStl('cube.step');
  await panel.receive({ type: 'ready' });
  assert.equal(panel.sent[0].type, 'loading');
  await waitFor(() => panel.sent.at(-1).type !== 'loading');
  const load = panel.sent.at(-1);
  assert.equal(load.type, 'load');
  assert.equal(load.data, undefined);
  assert.ok(load.meshes.length > 0);
  const positions = new Float32Array(new Uint8Array(Buffer.from(load.meshes[0].position, 'base64')).buffer);
  const indices = new Uint32Array(new Uint8Array(Buffer.from(load.meshes[0].index, 'base64')).buffer);
  assert.ok(indices.every(index => index < positions.length / 3));
  assert.ok(Math.max(...positions) - Math.min(...positions) > 9);
  const bad = await fixture.openStl('bad.step');
  await bad.receive({ type: 'ready' });
  await waitFor(() => bad.sent.at(-1).type !== 'loading');
  assert.equal(bad.sent.at(-1).type, 'error');
  assert.match(bad.sent.at(-1).message, /STEP/);
});

test('disposing a STEP viewer cancels tessellation without posting results', async t => {
  const fixture = await setup(t, { occt: true });
  await fs.writeFile(path.join(fixture.root, 'big.stp'), await stepFixture('cax-if/as1_pe_203.stp'));
  const panel = await fixture.openStl('big.stp');
  const pending = panel.receive({ type: 'ready' });
  await waitFor(() => panel.sent.length > 0);
  await panel.dispose();
  await pending;
  assert.deepEqual(panel.sent.map(message => message.type), ['loading']);
});

test('Convert to STL validates the binary STL and writes it through the save dialog', async t => {
  const fixture = await setup(t);
  await fs.writeFile(path.join(fixture.root, 'part.3mf'), '');
  await fs.writeFile(path.join(fixture.root, 'plain.stl'), '');
  const panel = await fixture.openStl('part.3mf');
  const stl = Buffer.alloc(84 + 50);
  stl.writeUInt32LE(1, 80);
  const request = { type: 'saveStl', data: stl.toString('base64'), size: stl.length };
  await panel.receive(request);
  assert.equal(panel.sent.at(-1).type, 'saveCancelled');
  assert.equal(fixture.writes.length, 0);
  fixture.saveTo('converted.stl');
  await panel.receive(request);
  assert.deepEqual(panel.sent.at(-1), { type: 'saved', name: 'converted.stl' });
  assert.deepEqual([...fixture.writes[0].bytes], [...stl]);
  await panel.receive({ ...request, size: stl.length + 1 });
  assert.equal(panel.sent.at(-1).type, 'saveError');
  await panel.receive({ type: 'saveStl', data: Buffer.alloc(90).toString('base64'), size: 90 });
  assert.match(panel.sent.at(-1).message, /malformed/);
  const plain = await fixture.openStl('plain.stl');
  await plain.receive(request);
  assert.match(plain.sent.at(-1).message, /already an STL/);
  assert.equal(fixture.writes.length, 1);
});
