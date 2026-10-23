const vscode = require('vscode');
const path = require('node:path');
const { realpath } = require('node:fs/promises');
const { within, projectPath, resolveVirtual } = require('./paths.cjs');
const { previewHtml } = require('./html.cjs');
const { registerGcodeEditor, registerStlEditor } = require('./stl-editor.cjs');
const { createReferences, MODEL_FILTER } = require('./references.cjs');

const MAX_BYTES = 25_000_000;
const MAX_EXPORT_BYTES = 50_000_000;

function activate(context) {
  const previews = new Map();
  let nextSnapshot = 0;

  async function snapshotPreview(target) {
    if (target instanceof vscode.Uri) {
      const state = previews.get(target.toString());
      if (!state) throw new Error('Open a preview for the requested SCAD file before capturing it.');
      return state;
    }
    const active = [...previews.values()].find(state => state.panel.active);
    if (active) return active;
    const editor = previews.get(vscode.window.activeTextEditor?.document.uri.toString());
    if (editor) return editor;
    if (previews.size === 1) return [...previews.values()][0];
    if (!previews.size) {
      await vscode.window.showWarningMessage('No active OpenSCAD preview to capture snapshot from.');
      return;
    }
    const choice = await vscode.window.showQuickPick([...previews.values()].map(state => ({
      label: path.posix.basename(state.entry.path), description: state.entry.path, state,
    })), { placeHolder: 'Choose the OpenSCAD preview to capture' });
    return choice?.state;
  }

  function finishSnapshot(state, requestId, error, uri) {
    const request = state.pendingSnapshots.get(requestId);
    if (!request) return;
    state.pendingSnapshots.delete(requestId);
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(uri);
  }
  context.subscriptions.push(registerStlEditor(vscode, context), registerGcodeEditor(vscode, context));
    context.subscriptions.push(vscode.commands.registerCommand('openscadJs.openPreview', async target => {
    if (!vscode.workspace.isTrusted) return;
    const entry = target instanceof vscode.Uri ? target : vscode.window.activeTextEditor?.document.uri;
    if (!entry || !entry.path.toLowerCase().endsWith('.scad')) {
      await vscode.window.showWarningMessage('Open a .scad file before opening its preview.');
      return;
    }
    const key = entry.toString();
    if (previews.has(key)) { previews.get(key).panel.reveal(vscode.ViewColumn.Beside); return; }
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel('openscadJs.preview', `${path.posix.basename(entry.path)} Preview`, vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media],
    });
    panel.iconPath = vscode.Uri.joinPath(media, 'icon.png');
    const diagnostics = vscode.languages.createDiagnosticCollection(`openscad-js:${key}`);
    const state = { panel, entry, diagnostics, roots: new Map(), revision: 0, job: 0, changeSerial: 0, changes: new Map(), dependencies: new Set([key]), watchers: [], subscriptions: [], pendingSnapshots: new Map(), closed: false };
    previews.set(key, state);
    const send = message => panel.webview.postMessage(message);
    state.references = createReferences(vscode, context, entry, send);
    const stale = (reason = 'edit') => {
      state.revision++;
      diagnostics.clear();
      void send({ type: 'stale', revision: state.revision, reason });
    };
    const changed = (uri, reason = 'edit') => {
      const key = uri.toString();
      state.changes.set(key, ++state.changeSerial);
      if (state.dependencies.has(key)) stale(reason);
    };
    const resource = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
    panel.webview.html = previewHtml(panel.webview.cspSource, resource('main.js'), resource('style.css'));

    async function configure() {
      const folder = vscode.workspace.getWorkspaceFolder(entry)?.uri ?? entry.with({ path: path.posix.dirname(entry.path) });
      const roots = new Map([['project', folder]]);
      const config = vscode.workspace.getConfiguration('openscadJs', entry);
      const libraries = config.get('libraryPaths', []);
      state.fontOptions = {
        fontDirectories: config.get('fontDirectories', []).map(directory => path.resolve(folder.fsPath, directory)),
        systemFonts: config.get('systemFonts', true),
        onWarning: message => { void vscode.window.showWarningMessage(message); },
      };
      state.fontListController?.abort();
      state.availableFonts = undefined;
      state.fontResolver = undefined;
      libraries.forEach((directory, index) => {
        const uri = path.isAbsolute(directory) ? folder.with({ path: vscode.Uri.file(directory).path }) : vscode.Uri.joinPath(folder, directory);
        roots.set(`library${index}`, uri);
      });
      state.roots = roots;
      for (const watcher of state.watchers) watcher.dispose();
      state.watchers = [];
      for (const root of roots.values()) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
        state.watchers.push(watcher, watcher.onDidChange(uri => changed(uri, 'edit')), watcher.onDidCreate(uri => changed(uri, 'create')), watcher.onDidDelete(uri => changed(uri, 'delete')));
      }
      const autoPreview = config.get('autoPreview', 'off');
      const autoPreviewDelay = config.get('autoPreviewDelay', 400);
      await send({ type: 'init', workerUrl: resource('worker.js'), manifoldModuleUrl: resource('runtime/vendor/manifold.js'), wasmUrl: resource('runtime/vendor/manifold.wasm'), fontBase: `${resource('runtime/assets/fonts')}/`, revision: state.revision, autoPreview, autoPreviewDelay });
    }

    async function checkedUri(name) {
      const uri = resolveVirtual(state.roots, name);
      const root = state.roots.get(name.split('/')[0]);
      if (!['file', 'vscode-remote'].includes(uri.scheme)) throw new Error('Only filesystem workspaces are supported');
      const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root.fsPath), realpath(uri.fsPath)]);
      if (!within(canonicalRoot.replaceAll('\\', '/'), canonicalFile.replaceAll('\\', '/'))) throw new Error('Dependency symlink escapes an allowed root');
      return uri;
    }

    async function compile(message) {
      const job = ++state.job;
      const revision = state.revision;
      const snapshotSerial = state.changeSerial;
      const files = Object.create(null);
      const snapshot = new Map();
      for (const document of vscode.workspace.textDocuments) {
        if (document.uri.scheme !== entry.scheme || document.uri.authority !== entry.authority) continue;
        for (const root of state.roots.values()) {
          if (within(root.path, document.uri.path)) {
            snapshot.set(document.uri.toString(), document.getText());
            break;
          }
        }
      }
      const document = await vscode.workspace.openTextDocument(entry);
      const name = projectPath(state.roots.get('project').path, entry.path);
      await checkedUri(name);
      files[name] = snapshot.get(entry.toString()) ?? document.getText();
      snapshot.set(entry.toString(), files[name]);
      if (state.closed || job !== state.job) return;
      state.snapshot = snapshot;
      state.snapshotSerial = snapshotSerial;
      state.reads = new Map();
      state.readBudget = { bytes: 0 };
      state.exportJob = message.export === true ? job : undefined;
      state.compileRevision = revision;
      state.dependencies = new Set([key]);
      const defines = message.defines ?? {};
      if (!defines || typeof defines !== 'object' || Array.isArray(defines) || Object.keys(defines).length > 128 || Buffer.byteLength(JSON.stringify(defines)) > 65536) throw new Error('Invalid or oversized parameter overrides');
      const time = message.time ?? 0;
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > 1) throw new Error('Animation time must be between 0 and 1');
      if (message.auditComponents !== undefined && typeof message.auditComponents !== 'boolean') throw new Error('Invalid auditComponents option');
      if (message.auditOnly && !message.auditComponents) throw new Error('Audit-only compile requires component auditing');
      const maxAuditComponents = message.maxAuditComponents ?? 32;
      const interferenceEpsilon = message.interferenceEpsilon ?? 1e-4;
      const auditClearance = message.auditClearance ?? 0;
      if (!Number.isSafeInteger(maxAuditComponents) || maxAuditComponents < 2 || maxAuditComponents > 64) throw new Error('Audit component limit must be from 2 to 64');
      if (typeof interferenceEpsilon !== 'number' || !Number.isFinite(interferenceEpsilon) || interferenceEpsilon < 0 || interferenceEpsilon > 100) throw new Error('Invalid interference volume threshold');
      if (typeof auditClearance !== 'number' || !Number.isFinite(auditClearance) || auditClearance < 0 || auditClearance > 100) throw new Error('Invalid audit clearance distance');
      const experimental = vscode.workspace.getConfiguration('openscadJs', entry).get('experimentalFeatures', []);
      if (!Array.isArray(experimental) || experimental.some(feature => !['roof', 'object-function', 'import-function', 'vector-swizzle'].includes(feature))) throw new Error('Invalid experimental feature setting');
      await send({ type: 'compile', job, revision, requestRevision: message.revision, requestId: message.requestId, auditId: message.auditId, auditOnly: message.auditOnly === true, auditComponents: message.auditComponents === true, maxAuditComponents, interferenceEpsilon, auditClearance, entry: name, source: files[name], files, defines, time, experimental, libraryPaths: [...state.roots.keys()].filter(root => root !== 'project'), mode: message.mode === 'render' ? 'render' : 'preview', export: message.export === true });
    }

    async function listFonts(message) {
      if (!Number.isSafeInteger(message.requestId) || message.requestId < 1) throw new Error('Invalid font list request');
      state.fontListController?.abort();
      const controller = new AbortController();
      state.fontListController = controller;
      const timer = setTimeout(() => controller.abort(), 25_000);
      try {
        const resolver = require('../media/font-resolver.cjs').createSystemFontResolver(state.fontOptions);
        const fonts = await resolver.listFonts({ signal: controller.signal });
        if (state.closed || state.fontListController !== controller) return;
        state.fontResolver = resolver;
        state.availableFonts = new Set(fonts.map(face => face.name));
        const host = vscode.env.remoteName
          ? `Remote extension host (${vscode.env.remoteName}, ${process.platform}). These are not your client PC's fonts.`
          : `Extension host (${process.platform}). Bundled fonts are included; directory and installed fonts were checked by the font parser.`;
        await send({ type: 'fontListResult', requestId: message.requestId, fonts, host });
      } catch (error) {
        if (!state.closed && state.fontListController === controller) await send({ type: 'fontListResult', requestId: message.requestId, error: controller.signal.aborted ? 'Font discovery timed out' : error.message });
      } finally { clearTimeout(timer); }
    }

    async function copyFont(message) {
      try {
        if (typeof message.name !== 'string' || !state.availableFonts?.has(message.name)) throw new Error('Choose a font from the current available-font list');
        await vscode.env.clipboard.writeText(`font=${JSON.stringify(message.name)}`);
        await send({ type: 'fontCopied', name: message.name });
      } catch (error) { await send({ type: 'fontCopied', error: error.message }); }
    }

    async function read(message) {
      if (message.job !== state.job || !Number.isSafeInteger(message.id) || !['source', 'asset', 'font'].includes(message.kind)) return;
      try {
        if (message.kind === 'font') {
          state.fontResolver ??= require('../media/font-resolver.cjs').createSystemFontResolver(state.fontOptions);
          const bytes = await state.fontResolver(message.path);
          if (message.job === state.job && !state.closed) await send({ type: 'readResult', id: message.id, job: message.job, value: bytes === undefined ? undefined : Array.from(bytes) });
          return;
        }
        const requested = resolveVirtual(state.roots, message.path);
        if (!state.dependencies.has(requested.toString()) && state.changes.get(requested.toString()) > state.snapshotSerial) stale();
        state.dependencies.add(requested.toString());
        const cacheKey = `${message.kind}:${message.path}`;
        const reads = state.reads;
        const snapshot = state.snapshot;
        const budget = state.readBudget;
        if (!reads.has(cacheKey)) reads.set(cacheKey, (async () => {
          const uri = await checkedUri(message.path);
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > MAX_BYTES) throw new Error('Dependency exceeds file byte limit');
          const open = snapshot.get(uri.toString());
          const bytes = open !== undefined ? new TextEncoder().encode(open) : await vscode.workspace.fs.readFile(uri);
          budget.bytes += bytes.length;
          if (budget.bytes > MAX_BYTES) throw new Error('Dependencies exceed total byte limit');
          return message.kind === 'source' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : Array.from(bytes);
        })());
        const value = await reads.get(cacheKey);
        if (message.job === state.job && !state.closed) await send({ type: 'readResult', id: message.id, job: message.job, value });
      } catch (error) {
        if (message.job !== state.job) return;
        const missing = error.code === 'ENOENT' || error.code === 'FileNotFound';
        await send({ type: 'readResult', id: message.id, job: message.job, ...(missing ? {} : { error: error.message }) });
      }
    }

    function publish(message) {
      if (message.job !== state.job || state.compileRevision !== state.revision || !Array.isArray(message.diagnostics)) return;
      const grouped = new Map();
      for (const issue of message.diagnostics.slice(0, 1000)) {
        if (typeof issue.message !== 'string') continue;
        const location = issue.location;
        if (!Number.isSafeInteger(location?.line) || !Number.isSafeInteger(location?.column)) continue;
        let uri = entry;
        try { if (location?.file) uri = resolveVirtual(state.roots, location.file); } catch { continue; }
        const line = Number.isSafeInteger(location?.line) ? Math.max(0, location.line - 1) : 0;
        const column = Number.isSafeInteger(location?.column) ? Math.max(0, location.column - 1) : 0;
        const diagnostic = new vscode.Diagnostic(new vscode.Range(line, column, line, column + 1), issue.message.slice(0, 10000), issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'OpenSCAD.js';
        diagnostic.code = issue.code;
        const key = uri.toString();
        if (!grouped.has(key)) grouped.set(key, { uri, issues: [] });
        grouped.get(key).issues.push(diagnostic);
      }
      diagnostics.clear();
      for (const { uri, issues } of grouped.values()) diagnostics.set(uri, issues);
    }

    async function save(message) {
      if (message.job !== state.job || state.exportJob !== message.job || state.compileRevision !== state.revision) throw new Error('Source changed during export. Export again to use the current source.');
      state.exportJob = undefined;
      if (!Array.isArray(message.bytes) || message.bytes.length > MAX_EXPORT_BYTES || !message.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new Error('Invalid STL export');
      const destination = await vscode.window.showSaveDialog({ defaultUri: entry.with({ path: entry.path.replace(/\.scad$/i, '.stl') }), filters: { STL: ['stl'] } });
      if (!destination) return;
      if (message.job !== state.job || state.compileRevision !== state.revision) throw new Error('Source changed while choosing the export destination. Export again.');
      await vscode.workspace.fs.writeFile(destination, Uint8Array.from(message.bytes));
      await vscode.window.showInformationMessage(`Exported ${path.posix.basename(destination.path)}.`);
    }

    state.subscriptions.push(panel.webview.onDidReceiveMessage(async message => {
      if (state.closed || !message || typeof message.type !== 'string') return;
      try {
        if (message.type === 'ready') { await configure(); await state.references.ready(); }
        else if (['referenceAdd', 'referenceUpdate', 'referenceRemove', 'referenceReload'].includes(message.type)) await state.references.handle(message);
        else if (message.type === 'requestCompile') await compile(message);
        else if (message.type === 'fontList') await listFonts(message);
        else if (message.type === 'fontCopy') await copyFont(message);
        else if (message.type === 'read') await read(message);
        else if (message.type === 'diagnostics') publish(message);
        else if (message.type === 'export') await save(message);
        else if (message.type === 'cancel') { state.job++; state.exportJob = undefined; }
        else if (message.type === 'modelMetrics') {
          state.metrics = message.metrics;
          try {
            const folder = vscode.workspace.getWorkspaceFolder(entry)?.uri ?? entry.with({ path: path.posix.dirname(entry.path) });
            const metricsUri = vscode.Uri.joinPath(folder, '.openscad-model.json');
            const data = JSON.stringify({ file: path.posix.basename(entry.path), ...message.metrics, timestamp: new Date().toISOString() }, null, 2) + '\n';
            await vscode.workspace.fs.writeFile(metricsUri, Buffer.from(data, 'utf8'));
          } catch {}
        }
        else if (message.type === 'measurement') {
          const value = message.measurement;
          if (!value || value.units !== 'mm' || !Number.isFinite(value.distance) || value.distance < 0 || !value.delta || !['x', 'y', 'z'].every(axis => Number.isFinite(value.delta[axis])) || !Array.isArray(value.points) || value.points.length !== 2 || value.points.some(point => !Array.isArray(point) || point.length !== 3 || point.some(component => !Number.isFinite(component)))) throw new Error('Invalid 3D measurement');
          const tolerance = value.tolerance ?? null;
          if (tolerance !== null && ![0.2, 0.3, 0.4].includes(tolerance)) throw new Error('Invalid measurement tolerance');
          state.measurement = {
            distance: value.distance,
            delta: { x: value.delta.x, y: value.delta.y, z: value.delta.z },
            points: value.points.map(point => [...point]),
            units: 'mm',
            tolerance,
            withinTolerance: tolerance === null ? null : value.distance <= tolerance,
          };
        }
        else if (message.type === 'copyMeasurement') {
          if (!state.measurement) throw new Error('No 3D measurement is available to copy');
          await vscode.env.clipboard.writeText(JSON.stringify(state.measurement, null, 2));
          await vscode.window.showInformationMessage('3D measurement copied as JSON.');
        }
        else if (message.type === 'snapshotCaptured') {
          if (message.requestId !== undefined && !state.pendingSnapshots.has(message.requestId)) return;
          if (typeof message.dataUrl !== 'string' || !message.dataUrl.startsWith('data:image/png;base64,')) throw new Error('Invalid snapshot image format');
          const base64 = message.dataUrl.slice('data:image/png;base64,'.length);
          if (base64.length > Math.ceil(MAX_EXPORT_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Invalid or oversized snapshot image');
          const bytes = Buffer.from(base64, 'base64');
          if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) throw new Error('Snapshot is not a nonempty PNG');
          const folder = vscode.workspace.getWorkspaceFolder(entry)?.uri ?? entry.with({ path: path.posix.dirname(entry.path) });
          const baseName = path.posix.basename(entry.path).replace(/\.scad$/i, '');
          const targetName = `${baseName}-preview.png`;
          const snapshotUri = vscode.Uri.joinPath(folder, targetName);
          await vscode.workspace.fs.writeFile(snapshotUri, bytes);
          const standardUri = vscode.Uri.joinPath(folder, '.openscad-preview.png');
          await vscode.workspace.fs.writeFile(standardUri, bytes);
          finishSnapshot(state, message.requestId, undefined, snapshotUri);
          const openAction = 'Open Image';
          const choice = await vscode.window.showInformationMessage(`Snapshot saved to ${targetName}.`, openAction);
          if (choice === openAction) {
            await vscode.commands.executeCommand('vscode.open', snapshotUri);
          }
        }
        else if (message.type === 'snapshotFailed') {
          if (state.pendingSnapshots.has(message.requestId)) finishSnapshot(state, message.requestId, new Error(message.message || 'Snapshot capture failed.'));
          else if (message.requestId === undefined) await vscode.window.showErrorMessage(`Snapshot capture failed: ${message.message}`);
        }
        else if (message.type === 'navigate' && message.job === state.job) {
          const location = message.location;
          if (!Number.isSafeInteger(location?.line) || !Number.isSafeInteger(location?.column)) return;
          const uri = await checkedUri(location.file);
          const document = await vscode.workspace.openTextDocument(uri);
          const line = Math.max(0, Math.min(document.lineCount - 1, location.line - 1));
          const column = Math.max(0, Math.min(document.lineAt(line).text.length, location.column - 1));
          await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(line, column, line, column) });
        }
      } catch (error) {
        if (message.type === 'snapshotCaptured') {
          const pending = state.pendingSnapshots.has(message.requestId);
          finishSnapshot(state, message.requestId, error);
          if (!pending) await vscode.window.showErrorMessage(`Snapshot capture failed: ${error.message}`);
          await send({ type: 'snapshotSaveFailed', message: error.message });
          return;
        }
        await send({ type: 'hostError', requestId: message.requestId, message: error.message });
      }
    }), vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) changed(event.document.uri, 'edit'); }),
    vscode.workspace.onDidSaveTextDocument(document => { changed(document.uri, 'save'); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('openscadJs.fontDirectories', entry) || event.affectsConfiguration('openscadJs.systemFonts', entry) || event.affectsConfiguration('openscadJs.libraryPaths', entry) || event.affectsConfiguration('openscadJs.experimentalFeatures', entry) || event.affectsConfiguration('openscadJs.autoPreview', entry) || event.affectsConfiguration('openscadJs.autoPreviewDelay', entry)) {
        state.job++;
        stale('config');
        void send({ type: 'cancel' });
        void configure().catch(error => send({ type: 'hostError', message: error.message }));
      }
    }), panel.onDidDispose(() => {
      state.closed = true;
      state.fontListController?.abort();
      for (const requestId of state.pendingSnapshots.keys()) finishSnapshot(state, requestId, new Error('Preview closed before the snapshot was saved.'));
      state.references.dispose();
      state.job++;
      previews.delete(key);
      diagnostics.dispose();
      for (const disposable of [...state.watchers, ...state.subscriptions]) disposable.dispose();
    }));
  }), vscode.commands.registerCommand('openscadJs.useAsReference', async source => {
    if (!vscode.workspace.isTrusted) return;
    try {
      if (!(source instanceof vscode.Uri)) {
        const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: MODEL_FILTER, title: 'Choose a reference model' });
        source = files?.[0];
      }
      if (!source) return;
      const entries = new Map([...previews.values()].map(state => [state.entry.toString(), state.entry]));
      for (const document of vscode.workspace.textDocuments) if (/\.scad$/i.test(document.uri.path)) entries.set(document.uri.toString(), document.uri);
      const choices = [...entries.values()].map(uri => ({ label: path.posix.basename(uri.path), description: uri.path, uri }));
      choices.push({ label: 'Choose a SCAD file...', description: 'Open a preview for another design' });
      const choice = await vscode.window.showQuickPick(choices, { title: 'Use as Reference: choose the SCAD preview' });
      if (!choice) return;
      let target = choice.uri;
      if (!target) {
        const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'OpenSCAD files': ['scad'] }, title: 'Choose the SCAD design' });
        target = files?.[0];
      }
      if (!target) return;
      await vscode.commands.executeCommand('openscadJs.openPreview', target);
      const state = previews.get(target.toString());
      if (!state || state.closed) return;
      await state.references.add(source);
      state.panel.reveal(vscode.ViewColumn.Beside);
    } catch (error) { await vscode.window.showErrorMessage(`Cannot add reference: ${error.message}`); }
  }), vscode.commands.registerCommand('openscadJs.preview', async () => {
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    if (!editorUri) return;
    const key = editorUri.toString();
    const existing = previews.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn);
      await existing.panel.webview.postMessage({ type: 'triggerCompile', mode: 'preview' });
    } else {
      await vscode.commands.executeCommand('openscadJs.openPreview', editorUri);
    }
  }), vscode.commands.registerCommand('openscadJs.render', async () => {
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    if (!editorUri) return;
    const key = editorUri.toString();
    const existing = previews.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn);
      await existing.panel.webview.postMessage({ type: 'triggerCompile', mode: 'render' });
    } else {
      await vscode.commands.executeCommand('openscadJs.openPreview', editorUri);
    }
  }), vscode.commands.registerCommand('openscadJs.captureSnapshot', async target => {
    let existing;
    let requestId;
    try {
      existing = await snapshotPreview(target);
      if (!existing) return;
      if (existing.closed) throw new Error('The selected preview has been closed.');
      existing.panel.reveal(existing.panel.viewColumn);
      requestId = `snapshot-${++nextSnapshot}`;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finishSnapshot(existing, requestId, new Error('Snapshot capture timed out. Check that the preview is visible and ready, then retry.')), 15_000);
        existing.pendingSnapshots.set(requestId, { resolve, reject, timer });
        existing.panel.webview.postMessage({ type: 'captureSnapshot', requestId }).then(delivered => {
          if (!delivered) finishSnapshot(existing, requestId, new Error('Unable to deliver the snapshot request to the preview.'));
        }).catch(error => finishSnapshot(existing, requestId, error));
      });
    } catch (error) {
      if (existing) finishSnapshot(existing, requestId, error);
      await vscode.window.showErrorMessage(`Snapshot capture failed: ${error.message}`);
      throw error;
    }
  }), vscode.commands.registerCommand('openscadJs.copyMeasurement', async () => {
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    const key = editorUri?.toString();
    const existing = (key && previews.get(key)) || [...previews.values()].find(state => state.measurement);
    if (!existing?.measurement) {
      await vscode.window.showWarningMessage('No 3D measurement is available to copy.');
      return;
    }
    await vscode.env.clipboard.writeText(JSON.stringify(existing.measurement, null, 2));
    await vscode.window.showInformationMessage('3D measurement copied as JSON.');
  }), vscode.commands.registerCommand('openscadJs.inspectGeometry', async () => {
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    const key = editorUri?.toString();
    const existing = (key && previews.get(key)) || [...previews.values()][0];
    if (!existing || !existing.metrics) {
      await vscode.window.showWarningMessage('No compiled model geometry available to inspect. Compile preview first.');
      return;
    }
    const m = existing.metrics;
    const summary = `Model: ${path.posix.basename(existing.entry.path)} | Dimensions: ${m.size.x} × ${m.size.y} × ${m.size.z} mm | Volume: ${m.volume} mm³ | Triangles: ${m.triangles}`;
    const choice = await vscode.window.showInformationMessage(summary, 'Copy JSON');
    if (choice === 'Copy JSON') {
      await vscode.env.clipboard.writeText(JSON.stringify(m, null, 2));
      await vscode.window.showInformationMessage('Model metrics copied to clipboard.');
    }
    return m;
  }), { dispose() { for (const state of previews.values()) state.panel.dispose(); } });
}

module.exports = { activate };