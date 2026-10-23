import { createWorkerEngine } from "../index.js";
import { Viewer } from "../viewer/viewer.js";

const styles = `
:host { display:block; height:100%; min-height:0; font:14px/1.4 system-ui,sans-serif; color:#fff; color-scheme:dark; }
* { box-sizing:border-box; }
.window { position:relative; height:100%; min-height:0; overflow:hidden; background:#293331; border-radius:8px; }
.viewport { position:absolute; inset:0; }
canvas { display:block; width:100%; height:100%; }
.orientation-indicator { position:absolute; right:8px; bottom:40px; width:70px; height:70px; pointer-events:none; }
.toolbar { position:absolute; inset:8px 8px auto; display:flex; flex-wrap:wrap; gap:4px; pointer-events:none; }
button,select { font:inherit; color:inherit; background:rgba(25,33,32,.82); border:1px solid #adb9b0; border-radius:5px; min-height:36px; padding:6px 9px; }
button { cursor:pointer; pointer-events:auto; }
button:hover,button:focus-visible { background:#172621; }
button:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible { outline:3px solid #c2f878; outline-offset:1px; }
button:disabled { opacity:.55; cursor:default; }
.source { position:absolute; inset:98px 8px 42px; display:flex; flex-direction:column; gap:5px; padding:8px; background:rgba(24,32,29,.96); border-radius:6px; }
.source label { display:flex; gap:8px; align-items:center; }
select { min-width:0; flex:1; width:100%; }
textarea { flex:1; min-height:40px; width:100%; resize:none; font:13px/1.45 monospace; color:#fff; background:#14221d; border:1px solid #adb9b0; border-radius:4px; padding:8px; }
.footer { position:absolute; bottom:0; left:0; right:0; padding:6px 9px; background:rgba(24,32,29,.9); max-height:42%; overflow:auto; }
.status { margin:0; }
.stale { color:#ffdf8a; margin-left:6px; }
details { margin-top:4px; }
summary { cursor:pointer; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:4px 0; font:12px/1.4 monospace; }
[hidden] { display:none !important; }
@media (pointer:coarse) { button,select { min-height:44px; } .source { top:112px; } }
`;

function outcome(status, diagnostics = []) {
	return Object.freeze({ status, diagnostics: Object.freeze([...diagnostics]) });
}

export async function createPreview(container, options) {
	if (!(container instanceof HTMLElement)) throw new TypeError("Expected an HTML container");
	if (!options || typeof options !== "object") throw new TypeError("Expected preview options");
	if (("source" in options) === ("project" in options)) throw new TypeError("Supply either source or project, not both");
	if ("source" in options && typeof options.source !== "string") throw new TypeError("source must be a string");
	if (options.editable !== undefined && typeof options.editable !== "boolean") throw new TypeError("editable must be a boolean");
	if (options.workerOptions !== undefined && (!options.workerOptions || typeof options.workerOptions !== "object" || Array.isArray(options.workerOptions))) throw new TypeError("workerOptions must be an object");
	const editable = options.editable ?? false;
	const project = "source" in options ? { files: { "main.scad": options.source } } : options.project;
	if (!project || typeof project !== "object" || Array.isArray(project)) throw new TypeError("project must be a compilation project");
	for (const key of ["signal", "mode", "auditOnly", "auditComponents"]) {
		if (key in project) throw new TypeError(`Preview project cannot set ${key}`);
	}
	const { resolver, assetResolver, fontResolver, ...data } = project;
	const request = structuredClone(data);
	if (request.files !== undefined && (!request.files || typeof request.files !== "object" || Array.isArray(request.files))) throw new TypeError("Project files must be a source map");
	const sources = new Map(request.files instanceof Map ? request.files : Object.entries(request.files ?? {}));
	for (const [path, text] of sources) {
		if (typeof path !== "string" || typeof text !== "string") throw new TypeError("Project files must contain named text sources");
	}
	for (const callback of [resolver, assetResolver, fontResolver]) {
		if (callback !== undefined && typeof callback !== "function") throw new TypeError("Project resolvers must be functions");
	}
	const entry = request.entry ?? "main.scad";
	if (typeof entry !== "string") throw new TypeError("Project entry must be a string");
	const workerOptions = { ...options.workerOptions };
	const host = document.createElement("div");
	host.style.height = "100%";
	const root = host.attachShadow({ mode: "open" });
	root.innerHTML = `<style>${styles}</style>
<section class="window" aria-label="OpenSCAD preview">
  <div class="viewport"></div>
  <div class="toolbar" role="toolbar" aria-label="Model actions">
    <button type="button" data-action="preview">Preview</button>
    <button type="button" data-action="render">Render</button>
    <button type="button" data-action="download">Download STL</button>
    <button type="button" data-action="reset">Reset view / fit</button>
    <button type="button" data-action="source" aria-expanded="false" aria-controls="source-panel">Source</button>
    <button type="button" data-action="stop" hidden>Stop</button>
  </div>
  <div class="source" id="source-panel" hidden>
    <label>Source file <select aria-label="Source file"></select></label>
    <textarea aria-label="OpenSCAD source" spellcheck="false"></textarea>
  </div>
  <div class="footer">
    <p class="status" role="status" aria-live="polite"><span class="message">Waiting for visibility</span><span class="stale" hidden>Out of date</span></p>
    <details hidden><summary>Messages</summary><pre></pre></details>
  </div>
</section>`;
	container.append(host);
	const viewport = root.querySelector(".viewport");
	const textarea = root.querySelector("textarea");
	const select = root.querySelector("select");
	const panel = root.querySelector(".source");
	const messages = root.querySelector("details");
	const buttons = Object.fromEntries([...root.querySelectorAll("button")].map(button => [button.dataset.action, button]));
	const listeners = new AbortController();
	let selected = entry, revision = 0, displayedRevision = -1, disposed = false;
	let viewer, engine, startup, active, disposal, automatic = false, visible = false;
	let state = Object.freeze({ status: "waiting", stale: true, diagnostics: Object.freeze([]), echoes: Object.freeze([]) });
	let settleReady;
	const ready = new Promise(resolve => { settleReady = resolve; });
	const downloads = new Map();
	const update = (status, text, diagnostics = [], echoes = []) => {
		state = Object.freeze({
			status, stale: displayedRevision !== revision,
			diagnostics: Object.freeze([...diagnostics]), echoes: Object.freeze([...echoes]),
			...(state.volume !== undefined ? { volume: state.volume, mode: state.mode } : {}),
		});
		root.querySelector(".window").dataset.state = status;
		root.querySelector(".message").textContent = text;
		root.querySelector(".stale").hidden = !state.stale;
		root.querySelector(".window").setAttribute("aria-busy", String(status === "initializing" || status === "busy"));
		buttons.stop.hidden = !active;
		for (const name of ["preview", "render", "download"]) buttons[name].disabled = Boolean(active);
		buttons.reset.disabled = !viewer;
		const lines = diagnostics.map(diagnostic => {
			const at = diagnostic.location;
			return `${at ? `${at.file}:${at.line}:${at.column}: ` : ""}${diagnostic.severity}: ${diagnostic.message}`;
		});
		lines.push(...echoes);
		messages.hidden = !lines.length;
		messages.querySelector("pre").textContent = lines.join("\n");
		if (lines.length) messages.open = true;
	};
	const refreshSources = () => {
		const names = [...new Set([entry, ...sources.keys()])];
		select.replaceChildren(...names.map(path => {
			const option = document.createElement("option");
			option.value = path; option.textContent = path;
			return option;
		}));
		select.value = selected;
		textarea.value = sources.get(selected) ?? "";
		textarea.readOnly = !editable;
		textarea.disabled = !sources.has(selected);
	};
	const pause = () => viewer?.setPaused(!visible || document.hidden || !viewport.clientWidth || !viewport.clientHeight);
	const initialize = () => {
		if (disposed) return Promise.resolve(undefined);
		if (engine) return Promise.resolve(engine);
		if (!startup) {
			startup = (async () => {
				if (!disposed && !viewer) { viewer = new Viewer(viewport); pause(); }
				const next = await createWorkerEngine(workerOptions);
				if (disposed) { await next.dispose(); return undefined; }
				engine = next;
				return engine;
			})().finally(() => { startup = undefined; });
		}
		return startup;
	};
	const run = async (mode, download = false) => {
		if (disposed) return outcome("disposed");
		automatic = true;
		active?.controller.abort();
		const job = { controller: new AbortController(), revision, promise: undefined };
		active = job;
		const current = () => !disposed && active === job && job.revision === revision && !job.controller.signal.aborted;
		update(engine ? "busy" : "initializing", engine ? (download ? "Exporting STL..." : `${mode === "render" ? "Rendering" : "Previewing"}...`) : "Initializing...");
		const files = new Map(sources);
		job.promise = Promise.resolve().then(async () => {
			let result;
			try {
				const worker = await initialize();
				if (!current()) return outcome(disposed ? "disposed" : job.controller.signal.aborted ? "cancelled" : "superseded");
				update("busy", download ? "Exporting STL..." : `${mode === "render" ? "Rendering" : "Previewing"}...`);
				result = await worker.compile({
					...request, files, mode, signal: job.controller.signal,
					assetResolver, fontResolver,
					context: { ...request.context, viewport: viewer.viewport() },
					resolver: resolver && (async (path, context) => {
						const text = await resolver(path, context);
						if (typeof text === "string" && current() && !sources.has(path)) {
							sources.set(path, text); refreshSources();
						}
						return text;
					}),
				});
				if (!current()) return outcome(disposed ? "disposed" : job.controller.signal.aborted ? "cancelled" : "superseded");
				if (result.status !== "success") {
					update(result.status === "cancelled" ? "cancelled" : "error", result.status === "cancelled" ? "Cancelled" : "Compilation failed", result.diagnostics, result.echoes);
					return outcome(result.status, result.diagnostics);
				}
				if (download) {
					const bytes = await worker.export(result, { signal: job.controller.signal });
					if (!current()) return outcome(disposed ? "disposed" : job.controller.signal.aborted ? "cancelled" : "superseded");
					const url = URL.createObjectURL(new Blob([bytes], { type: "model/stl" }));
					const link = document.createElement("a");
					link.href = url; link.download = entry.split("/").pop().replace(/\.scad$/i, "") + ".stl";
					host.append(link); link.click(); link.remove();
					downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000));
				} else {
					viewer.setModel(result);
					displayedRevision = job.revision;
					state = { ...state, volume: result.volume, mode };
				}
				update(displayedRevision === revision ? "ready" : "modified", download ? "STL downloaded" : "Ready", result.diagnostics, result.echoes);
				return outcome("success", result.diagnostics);
			} catch (error) {
				const diagnostics = [{ severity: "error", code: error.code ?? "preview-error", message: error.message ?? String(error), ...(error.location ? { location: error.location } : {}) }];
				if (!current()) return outcome(disposed ? "disposed" : job.controller.signal.aborted ? "cancelled" : "superseded", diagnostics);
				update("error", "Operation failed", diagnostics);
				return outcome("error", diagnostics);
			} finally {
				result?.dispose?.();
				if (active === job) {
					active = undefined;
					if (!disposed) {
						if (job.controller.signal.aborted) update("cancelled", "Cancelled");
						else if (job.revision !== revision) update("modified", "Modified");
						else update(state.status, root.querySelector(".message").textContent, state.diagnostics, state.echoes);
					}
				}
			}
		});
		const result = await job.promise;
		settleReady(result);
		return result;
	};
	const stop = () => {
		if (!disposed && active) {
			active.controller.abort();
			update("cancelled", "Cancelling...");
		}
	};
	const actions = {
		preview: () => run("preview"), render: () => run("render"), download: () => run("render", true),
		reset: () => viewer?.resetView(),
		source: () => {
			panel.hidden = !panel.hidden;
			buttons.source.setAttribute("aria-expanded", String(!panel.hidden));
			if (!panel.hidden) textarea.focus();
			else buttons.source.focus();
		},
		stop,
	};
	for (const [name, button] of Object.entries(buttons)) button.addEventListener("click", actions[name], { signal: listeners.signal });
	select.addEventListener("change", () => { selected = select.value; refreshSources(); }, { signal: listeners.signal });
	textarea.addEventListener("input", () => {
		if (!editable) return;
		sources.set(selected, textarea.value); revision++;
		update(active ? state.status : "modified", active ? "Compiling older source..." : "Modified");
	}, { signal: listeners.signal });
	textarea.addEventListener("keydown", event => {
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void run("preview"); }
		if (event.key === "Escape") { panel.hidden = true; buttons.source.setAttribute("aria-expanded", "false"); buttons.source.focus(); }
	}, { signal: listeners.signal });
	const activate = () => {
		pause();
		if (visible && !document.hidden && viewport.clientWidth && viewport.clientHeight && !automatic && !disposed) void run("preview");
	};
	document.addEventListener("visibilitychange", activate, { signal: listeners.signal });
	const resize = new ResizeObserver(() => { viewer?.resize(); activate(); });
	resize.observe(viewport);
	const intersection = new IntersectionObserver(entries => {
		visible = entries[0].isIntersecting;
		activate();
	});
	intersection.observe(host);
	refreshSources();
	update("waiting", "Waiting for visibility");
	return Object.freeze({
		ready,
		get state() { return state; },
		preview: actions.preview, render: actions.render, downloadStl: actions.download, stop,
		dispose() {
			if (disposal) return disposal;
			disposed = true;
			const pending = active?.promise;
			active?.controller.abort();
			listeners.abort(); intersection.disconnect(); resize.disconnect();
			viewer?.dispose();
			for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
			downloads.clear();
			update("disposed", "Disposed");
			host.remove();
			settleReady(outcome("disposed"));
			disposal = (async () => {
				if (engine) await engine.dispose();
				await pending;
			})();
			return disposal;
		},
	});
}
