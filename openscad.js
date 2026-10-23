import { createWorkerEngine } from "./src/index.js";
import { Viewer } from "./src/viewer/viewer.js";
import { StudioProject } from "./src/studio/project.js";
import { Customizer } from "./src/studio/customizer.js";
import { Animation } from "./src/studio/animation.js";
import { inspectionControls } from "./src/studio/inspection.js";
import { paneLayout } from "./src/studio/layout.js";
import { uiPreferences } from "./src/studio/preferences.js";
import { createBrowserFonts } from "./src/studio/fonts.js";
import { FONT_FACES } from "./src/geometry/font-faces.js";
import { createSourceEditor } from "./src/studio/editor-bundle.js";
import { zipSync } from "./node_modules/fflate/esm/browser.js";

const runtimeFonts = createBrowserFonts();

const EXAMPLES = {
	motion: `/* [Dimensions] */
// Block width
width = 14; // [4:2:30]
height = 8; // [2:2:20]
/* [Appearance] */
shade = "green"; // [green:Green,red:Red,blue:Blue]
centered = true;
travel = [20, 0, 0]; // [-40:1:40]
color(shade) translate(travel * sin(360 * $t))
  rotate([0, 0, 360 * $t]) cube([width, width, height], center = centered);`,
	bracket: `// Parametric mounting bracket
$fn = 48;
width = 52;
depth = 28;
height = 8;
module mounting_hole(x) {
  translate([x, depth / 2, -1]) cylinder(h = height + 2, d = 6);
}
color("#badf67") difference() {
  union() {
    cube([width, depth, height]);
    translate([0, depth - 6, 0]) cube([width, 6, 30]);
  }
  mounting_hole(10);
  mounting_hole(width - 10);
  translate([width / 2, depth + 1, 20]) rotate([90, 0, 0]) cylinder(h = 8, d = 10);
}`,
	tower: `// Rotation and iteration
$fn = 36;
levels = 18;
color([0.93, 0.73, 0.28])
for (level = [0 : levels - 1]) {
  translate([0, 0, level * 3.2]) rotate([0, 0, level * 8])
    cube([26 - level * 0.55, 26 - level * 0.55, 2.6], center = true);
}`,
	rings: `// Nested transforms
$fn = 64;
module orbit(radius, tilt, shade) {
  color(shade) rotate([tilt, 0, 0])
    for (angle = [0 : 30 : 330])
      rotate([0, 0, angle]) translate([radius, 0, 0]) sphere(r = 2.2);
}
color("#e9d56f") sphere(r = 8);
orbit(18, 22, "#67b7dc");
orbit(29, -34, "#e77755");`,
	basics: `// Core primitives and boolean operations
$fn = 48;
color("#79c6a3") difference() {
  cube([34, 34, 12], center = true);
  cylinder(h = 16, r = 10, center = true);
}
color("#e9b958") translate([26, 0, 0]) sphere(d = 18);
color("#df7e68") translate([-26, 0, -6]) cylinder(h = 18, r1 = 9, r2 = 3);`,
};

export const editor = createSourceEditor(document.querySelector("#source-editor"));
const status = document.querySelector("#status");
const sceneInfo = document.querySelector("#scene-info");
const errorPanel = document.querySelector("#error-panel");
const cancelButton = document.querySelector("#cancel-button");
const downloadButton = document.querySelector("#download-button");
const preferences = uiPreferences();
const layout = paneLayout(preferences);
export const viewer = new Viewer(document.querySelector("#viewport"));
let enginePromise;
let generation = 0;
let exporting = false;
let auditing = false;
const active = new Set();
export let project = new StudioProject(EXAMPLES.bracket);
let loadGeneration = 0;
let previewTimer;
let loading = false;
let loadingFonts = false;
const entrySelect = document.querySelector("#entry-select");
const sourceSelect = document.querySelector("#source-select");
const customizers = new Map();
let parameterSource;
let displayedPreview;
const presetSelect = document.querySelector("#preset-select");
export const animation = new Animation({ render: () => preview(), onChange: animationControls });
const inspection = inspectionControls(viewer, {
	preferences,
	basename: () => project.entry.split("/").at(-1).replace(/\.scad$/i, ""),
	reportError: (error) => diagnostics([{ severity: "error", code: "inspection-error", message: error.message }]),
});

function previewSettings() {
	return JSON.stringify({ entry: project.entry, defines: customizer().defines(), time: animation.time, roof: document.querySelector("#experimental-roof").checked });
}

function updateFeedback() {
	const stale = displayedPreview && (displayedPreview.project !== project || project.compileDirty || displayedPreview.settings !== previewSettings());
	document.querySelector("#preview-state").hidden = !stale;
	const state = status.textContent.split(" ")[0];
	status.dataset.state = ["COMPILING", "LOADING", "EXPORTING", "AUDITING"].includes(state) ? "busy" : state.toLowerCase();
	document.querySelector("#viewport-pane").setAttribute("aria-busy", String(status.dataset.state === "busy"));
}

function setStatus(value) {
	if (value === "READY" && displayedPreview && (displayedPreview.project !== project || project.compileDirty || displayedPreview.settings !== previewSettings())) value = "MODIFIED";
	status.textContent = value;
	updateFeedback();
}

function customizer() {
	if (!customizers.has(project.entry)) customizers.set(project.entry, new Customizer());
	return customizers.get(project.entry);
}

function hasSettings() { return [...customizers.values()].some((model) => model.overrides.size || model.presets.size); }

function commitEditor() { if (project.edit(editor.value)) refreshCustomizer(); }

function animationControls() {
	const button = document.querySelector("#animation-play");
	const label = animation.playing ? "Pause animation" : "Play animation";
	if (button.title !== label) { button.title = label; button.setAttribute("aria-label", label); button.innerHTML = `<i data-lucide="${animation.playing ? "pause" : "play"}"></i>`; window.lucide.createIcons(); }
	button.setAttribute("aria-pressed", String(animation.playing));
	document.querySelector("#animation-time").value = String(animation.time);
	document.querySelector("#animation-scrub").value = String(animation.time);
	document.querySelector("#animation-frame").max = String(animation.steps - 1);
	document.querySelector("#animation-frame").value = String(Math.min(animation.steps - 1, Math.floor(animation.time * animation.steps + 1e-6)));
	if (displayedPreview) updateFeedback();
}

function presetControls(selected = presetSelect.value) {
	presetSelect.replaceChildren(new Option("Default", ""), ...[...customizer().presets.keys()].map((name) => new Option(name, name)));
	presetSelect.value = customizer().presets.has(selected) ? selected : "";
	document.querySelector("#preset-delete").disabled = exporting || loading || !presetSelect.value;
	document.querySelector("#preset-export").disabled = exporting || loading || !customizer().presets.size;
}

function refreshCustomizer(force = false) {
	const source = project.files.get(project.entry);
	const key = `${project.entry}\0${source}`;
	if (!force && key === parameterSource) return;
	parameterSource = key;
	const model = customizer(), container = document.querySelector("#parameter-controls");
	try { model.update(source); } catch (error) { container.textContent = `Parameters unavailable: ${error.message}`; return; }
	container.replaceChildren();
	const groups = new Map();
	for (const parameter of model.parameters) {
		if (!groups.has(parameter.group)) {
			const fieldset = document.createElement("fieldset"), legend = document.createElement("legend");
			legend.textContent = parameter.group; fieldset.append(legend); container.append(fieldset); groups.set(parameter.group, fieldset);
		}
		const row = document.createElement("div"), label = document.createElement("label"), values = document.createElement("div");
		row.className = "parameter-row"; label.className = "parameter-label"; values.className = "parameter-value";
		label.textContent = parameter.label; row.append(label, values); groups.get(parameter.group).append(row);
		const current = model.value(parameter), inputs = [];
		const update = (value, input) => {
			try {
				model.set(parameter.name, value); input.setCustomValidity(""); presetSelect.value = ""; presetControls();
				animation.pause(); project.compileDirty = true;
				setStatus("MODIFIED");
				clearTimeout(previewTimer); previewTimer = setTimeout(() => void preview(), 150);
			} catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
		};
		if (parameter.choices) {
			const select = document.createElement("select"); select.id = `parameter-${parameter.name}`;
			parameter.choices.forEach((choice, index) => select.add(new Option(choice.label, String(index))));
			select.value = String(parameter.choices.findIndex((choice) => choice.value === current));
			select.addEventListener("change", () => update(parameter.choices[Number(select.value)].value, select)); inputs.push(select);
		} else if (parameter.type === "boolean") {
			const input = document.createElement("input"); input.type = "checkbox"; input.checked = current; inputs.push(input);
			input.addEventListener("change", () => update(input.checked, input));
		} else if (parameter.type === "string") {
			const input = document.createElement("input"); input.type = "text"; input.value = current; input.maxLength = 4096; inputs.push(input);
			input.addEventListener("change", () => update(input.value, input));
		} else {
			if (parameter.type === "number" && parameter.min !== undefined) {
				const slider = document.createElement("input"); slider.type = "range"; slider.min = parameter.min; slider.max = parameter.max; slider.step = parameter.step; slider.value = current;
				slider.setAttribute("aria-label", `${parameter.label} slider`); inputs.push(slider);
				slider.addEventListener("input", () => { inputs.at(-1).value = slider.value; update(Number(slider.value), slider); });
			}
			(Array.isArray(current) ? current : [current]).forEach((value, component) => {
				const input = document.createElement("input"); input.type = "number"; input.value = value; input.step = parameter.step ?? "any";
				if (parameter.min !== undefined) { input.min = parameter.min; input.max = parameter.max; }
				if (parameter.type === "vector") input.setAttribute("aria-label", `${parameter.label} ${component + 1}`);
				inputs.push(input);
				input.addEventListener("change", () => {
					if (!input.value || !input.checkValidity()) { input.reportValidity(); return; }
					const next = parameter.type === "vector" ? inputs.map((item) => Number(item.value)) : Number(input.value);
					if (inputs[0].type === "range") inputs[0].value = input.value;
					update(next, input);
				});
			});
		}
		inputs.forEach((input, index) => { input.classList.add("studio-input"); if (!input.id) input.id = `parameter-${parameter.name}${index ? `-${index}` : ""}`; input.disabled = exporting || loading; values.append(input); });
		label.htmlFor = inputs.find((input) => input.type !== "range")?.id ?? inputs[0]?.id;
	}
	if (!model.parameters.length) container.textContent = "No parameters";
	presetControls();
}

function projectControls() {
	for (const [select, selected] of [[entrySelect, project.entry], [sourceSelect, project.active]]) {
		select.replaceChildren(...[...project.files.keys()].map((path) => { const option = document.createElement("option"); option.value = path; option.textContent = path; return option; }));
		select.value = selected;
	}
	const info = document.querySelector("#project-info");
	info.textContent = `${project.files.size} source${project.files.size === 1 ? "" : "s"}${project.assets.size ? ` · ${project.assets.size} asset${project.assets.size === 1 ? "" : "s"}` : ""}`;
	info.title = [...project.files.keys(), ...project.assets.keys()].join("\n");
	refreshCustomizer(true);
	modified();
}

function modified() {
	document.querySelector("#dirty-marker").classList.toggle("modified", project.dirty());
	document.querySelector("#dirty-marker").title = project.dirty() ? "Project has edited sources" : "No source edits";
	if (status.textContent === "READY") setStatus("READY");
	else updateFeedback();
}

function openSource(path) {
	commitEditor(); editor.select(path, project.select(path)); sourceSelect.value = path; modified(); updateCursor();
}

function schedulePreview() {
	clearTimeout(previewTimer);
	if (document.querySelector("#auto-preview").checked && project.needsCompile(project.active)) previewTimer = setTimeout(() => void preview(), 600);
}

export async function loadFiles(files, options = {}) {
	commitEditor();
	if (!options.merge && (project.dirty() || hasSettings()) && !confirm("Replace this project and discard source edits and Customizer settings?")) return false;
	animation.pause();
	const load = ++loadGeneration; ++generation; clearTimeout(previewTimer);
	for (const controller of active) controller.abort();
	loading = true; controls(); setStatus("LOADING");
	try {
		const next = await project.withFiles(files, options);
		if (load !== loadGeneration) return false;
		project = next; if (!options.merge) { customizers.clear(); animation.seek(0); editor.reset(); } editor.clearDiagnostics(); editor.select(project.active, project.files.get(project.active)); projectControls(); updateCursor();
		if (!viewer.locked) viewer.fitted = false;
		loading = false; controls();
		await preview();
		return true;
	} catch (error) {
		if (load === loadGeneration) { setStatus("ERROR"); diagnostics([{ severity: "error", code: "project-load", message: error.message }]); }
		return false;
	} finally { if (load === loadGeneration) { loading = false; controls(); } }
}

function engine() {
	enginePromise ??= createWorkerEngine({ manifoldModuleUrl: new URL("./node_modules/manifold-3d/manifold.js", import.meta.url) }).catch((error) => { enginePromise = undefined; throw error; });
	return enginePromise;
}

function controls() {
	const frozen = exporting || loading || loadingFonts || auditing;
	cancelButton.disabled = active.size === 0; downloadButton.disabled = frozen;
	for (const id of ["load-font-button", "local-fonts-button", "open-files-button", "open-folder-button", "add-files-button", "example-select", "render-button", "format-button", "save-source-button", "audit-run", "audit-samples", "audit-epsilon"]) document.querySelector(`#${id}`).disabled = frozen;
	entrySelect.disabled = frozen; sourceSelect.disabled = frozen;
	editor.readOnly = frozen;
	for (const input of document.querySelectorAll(".animation-row input, #animation-play, #animation-export, #parameter-controls input, #parameter-controls select, .parameter-toolbar input, .parameter-toolbar button, #preset-select, #experimental-roof")) input.disabled = frozen;
	presetControls();
	if (frozen) for (const input of document.querySelectorAll(".parameter-toolbar button")) input.disabled = true;
}

function diagnostics(items = [], echoes = []) {
	editor.setDiagnostics(items);
	fontHelp(items);
	errorPanel.replaceChildren();
	for (const item of items) {
		const row = document.createElement("div"); row.className = `diagnostic-row ${item.severity}`;
		const location = item.location;
		if (location) {
			const link = document.createElement("button"); link.type = "button"; link.className = "source-location";
			link.textContent = `${location.file}:${location.line}:${location.column}`;
			link.disabled = !project.files.has(location.file);
			link.addEventListener("click", () => {
				openSource(location.file); editor.focus();
				const offset = location.offset ?? project.files.get(location.file).split("\n").slice(0, location.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + location.column - 1;
				editor.setSelectionRange(offset, offset); updateCursor();
			});
			row.append(link, " ");
		}
		row.append(`${item.severity.toUpperCase()} [${item.code}]: ${item.message}${location ? ` at line ${location.line}, column ${location.column}` : ""}`);
		errorPanel.append(row);
	}
	for (const echo of echoes) {
		const row = document.createElement("div"); row.className = "diagnostic-row echo"; row.textContent = echo; errorPanel.append(row);
	}
	const count = items.length + echoes.length;
	errorPanel.classList.toggle("visible", Boolean(count));
	const errors = items.filter((item) => item.severity === "error").length, warnings = items.filter((item) => item.severity === "warning").length;
	const summary = document.querySelector("#console-summary");
	const counts = [[errors, "error", "errors"], [warnings, "warning", "warnings"], [echoes.length, "echo", "echoes"]]
		.filter(([total]) => total).map(([total, singular, plural]) => `${total} ${total === 1 ? singular : plural}`);
	summary.textContent = count ? `Console · ${counts.join(" · ")}` : "Console · No messages";
	summary.dataset.state = errors ? "error" : warnings ? "warning" : "info";
	if (count) document.querySelector("#diagnostics-console").open = true;
}

function fontHelp(items) {
	const help = document.querySelector("#font-help");
	help.replaceChildren();
	help.hidden = !items.some(item => item.severity === "error" && ["missing-font", "invalid-font", "font-load"].includes(item.code));
	if (help.hidden) return;
	const title = document.createElement("strong");
	title.textContent = "Font unavailable? Bundled fonts work without access to your PC's fonts.";
	const explanation = document.createElement("p");
	explanation.textContent = !window.isSecureContext
		? "This page is not a secure context, so local font access is unavailable. Use HTTPS or localhost (a forwarded localhost port also works), or load a .ttf/.otf file."
		: typeof window.queryLocalFonts !== "function"
			? "This browser does not expose local font access. Load a .ttf/.otf file instead; installed fonts are not automatically available to the compiler."
			: "Installed fonts require permission through Use local fonts. If permission is denied or the face is absent, load a .ttf/.otf file instead.";
	const alternative = document.createElement("p");
	alternative.textContent = 'Try font="Liberation Sans:style=Bold Italic". Liberation Sans, Liberation Serif, and Liberation Mono include Regular, Bold, Italic, and Bold Italic. No automatic font substitution is performed.';
	const details = document.createElement("details");
	const summary = document.createElement("summary");
	summary.textContent = "Included font names";
	details.append(summary);
	for (const face of FONT_FACES) {
		const code = document.createElement("code");
		code.textContent = `font=${JSON.stringify(`${face.family}:style=${face.style}`)}`;
		const row = document.createElement("div");
		row.append(code);
		details.append(row);
	}
	const load = document.createElement("button");
	load.type = "button";
	load.className = "tool-button";
	load.textContent = "Load font files";
	load.addEventListener("click", () => document.querySelector("#load-font-button").click());
	help.append(title, explanation, alternative, load);
	if (window.isSecureContext && typeof window.queryLocalFonts === "function") {
		const local = document.createElement("button");
		local.type = "button";
		local.className = "tool-button";
		local.textContent = "Use local fonts";
		local.addEventListener("click", () => document.querySelector("#local-fonts-button").click());
		help.append(local);
	}
	help.append(details);
}

function request(snapshot, mode, signal) {
	return { ...snapshot, mode, signal, fontResolver: runtimeFonts.resolve, defines: customizer().defines(), experimental: document.querySelector("#experimental-roof").checked ? ["roof"] : [], context: { time: animation.time, viewport: viewer.viewport() } };
}

export async function preview() {
	if (auditing || exporting || loading) return false;
	clearTimeout(previewTimer); commitEditor();
	if (document.querySelector("#audit-status").textContent !== "No audit run.") {
		document.querySelector("#audit-status").textContent = "Preview changed; run audit again.";
		document.querySelector("#audit-results").replaceChildren();
	}
	const version = ++generation;
	const controller = new AbortController(); active.add(controller); controls();
	const snapshot = project.snapshot();
	const currentProject = project; const revision = project.revision;
	const settings = previewSettings();
	setStatus("COMPILING"); diagnostics();
	const started = performance.now();
	let result;
	try {
		const compiler = await engine();
		if (version !== generation) return;
		result = await compiler.compileLatest(request(snapshot, "preview", controller.signal), "studio-preview");
		if (version !== generation || project !== currentProject) return;
		if (project.revision !== revision) { project.compileDirty = true; schedulePreview(); setStatus(exporting ? "EXPORTING" : "MODIFIED"); return; }
		project.accept(result);
		if (result.status !== "success") {
			setStatus(result.status === "cancelled" ? "CANCELLED" : "ERROR");
			if (result.status !== "cancelled") diagnostics(result.diagnostics, result.echoes);
			return false;
		}
		viewer.setModel(result);
		displayedPreview = { project: currentProject, settings };
		inspection.modelChanged();
		const info = viewer.stats();
		sceneInfo.textContent = `${info.meshes} mesh${info.meshes === 1 ? "" : "es"} · ${Math.round(performance.now() - started)} ms`;
		diagnostics(result.diagnostics, result.echoes);
		setStatus(exporting ? "EXPORTING" : "READY");
		return true;
	} catch (error) {
		if (version === generation) { project.compileDirty = true; setStatus("ERROR"); diagnostics([{ severity: "error", code: error.code ?? "viewer-error", message: error.message, location: error.location }]); }
	} finally { result?.dispose?.(); active.delete(controller); controls(); }
	return false;
}

async function runAudit() {
	if (auditing || exporting || loading) return;
	const message = document.querySelector("#audit-status"), container = document.querySelector("#audit-results");
	const samplesInput = document.querySelector("#audit-samples"), epsilonInput = document.querySelector("#audit-epsilon");
	for (const input of [samplesInput, epsilonInput]) {
		if (!input.value || !input.checkValidity()) { input.reportValidity(); message.textContent = "Choose 2-20 samples and a threshold from 0-100 mm³."; return; }
	}
	animation.pause(); clearTimeout(previewTimer); commitEditor();
	const snapshot = project.snapshot(), samples = Number(samplesInput.value), epsilon = Number(epsilonInput.value);
	const controller = new AbortController(), version = ++generation;
	const previousStatus = project.compileDirty ? "MODIFIED" : "READY";
	for (const pending of active) pending.abort();
	const job = { ...request(snapshot, "render", controller.signal), auditOnly: true, auditComponents: true, maxAuditComponents: 32, interferenceEpsilon: epsilon };
	auditing = true; active.add(controller); controls(); container.replaceChildren();
	let outcome = previousStatus;
	try {
		const compiler = await engine(), pairs = new Map();
		for (let sample = 0; sample < samples; sample++) {
			const time = sample / (samples - 1);
			setStatus(`AUDITING ${sample + 1}/${samples}`);
			message.textContent = `Checking sample ${sample + 1}/${samples} at $t = ${time.toFixed(3)}...`;
			const result = await compiler.compile({ ...job, context: { ...job.context, time } });
			if (result.status !== "success") {
				outcome = result.status === "cancelled" ? "CANCELLED" : "ERROR";
				message.textContent = outcome === "CANCELLED" ? "Audit cancelled. No partial findings retained." : result.diagnostics.map((item) => item.message).join("\n");
				if (outcome === "ERROR") diagnostics(result.diagnostics, result.echoes);
				return;
			}
			const report = result.componentAudit;
			if (!report) throw new Error("Compiler did not return component audit data");
			if (report.components.length < 2) {
				message.textContent = 'Mark at least two 3D parts with unique audit_part("name") wrappers.';
				return;
			}
			for (const overlap of report.interferences) {
				const key = JSON.stringify([...overlap.parts].sort());
				if (!pairs.has(key)) pairs.set(key, { parts: overlap.parts, times: [], volume: 0, bounds: overlap.bounds });
				const finding = pairs.get(key);
				finding.times.push(time);
				if (overlap.volume > finding.volume) { finding.volume = overlap.volume; finding.bounds = overlap.bounds; }
			}
		}
		if (controller.signal.aborted) { outcome = "CANCELLED"; message.textContent = "Audit cancelled. No partial findings retained."; return; }
		message.textContent = pairs.size
			? `Found ${pairs.size} overlapping component pair${pairs.size === 1 ? "" : "s"} across ${samples} samples.`
			: `No overlap above ${epsilon} mm³ in ${samples} sampled poses. This is not continuous collision detection.`;
		for (const finding of pairs.values()) {
			const row = document.createElement("div");
			row.textContent = `${finding.parts.join(" / ")} | Max overlap ${finding.volume.toFixed(4)} mm³ | $t: ${finding.times.map((time) => time.toFixed(3)).join(", ")} | Bounds at max overlap: ${finding.bounds.map((point) => `[${point.map((value) => value.toFixed(3)).join(", ")}]`).join(" to ")} mm`;
			container.append(row);
		}
	} catch (error) {
		outcome = controller.signal.aborted || error.code === "cancelled" ? "CANCELLED" : "ERROR";
		message.textContent = outcome === "CANCELLED" ? "Audit cancelled. No partial findings retained." : error.message;
		if (outcome === "ERROR") diagnostics([{ severity: "error", code: "audit-error", message: error.message }]);
	} finally {
		active.delete(controller); auditing = false; controls();
		if (version === generation) setStatus(outcome);
	}
}

async function download() {
	if (exporting) return;
	animation.pause();
	exporting = true;
	const controller = new AbortController(); active.add(controller); controls();
	const version = generation;
	commitEditor(); const snapshot = project.snapshot();
	setStatus("EXPORTING"); diagnostics();
	let result;
	try {
		const compiler = await engine();
		result = await compiler.compile(request(snapshot, "render", controller.signal));
		if (result.status !== "success") {
			if (version === generation) { setStatus(result.status === "cancelled" ? "CANCELLED" : "ERROR"); diagnostics(result.diagnostics, result.echoes); }
			return;
		}
		const bytes = await compiler.export(result, { signal: controller.signal });
		const url = URL.createObjectURL(new Blob([bytes], { type: "model/stl" }));
		const link = document.createElement("a"); link.href = url; link.download = snapshot.entry.split("/").at(-1).replace(/\.scad$/i, ".stl"); link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		if (version === generation) { setStatus("READY"); diagnostics(result.diagnostics, result.echoes); }
	} catch (error) {
		if (version === generation) { setStatus(error.code === "cancelled" ? "CANCELLED" : "ERROR"); if (error.code !== "cancelled") diagnostics([{ severity: "error", code: error.code ?? "export-error", message: error.message }]); }
	} finally { result?.dispose?.(); active.delete(controller); exporting = false; controls(); }
}

async function downloadSequence() {
	if (exporting || loading) return;
	animation.pause(); clearTimeout(previewTimer); commitEditor();
	const snapshot = project.snapshot(), steps = animation.steps;
	const controller = new AbortController();
	const job = request(snapshot, "render", controller.signal);
	const basename = snapshot.entry.split("/").at(-1).replace(/\.scad$/i, "");
	const version = ++generation;
	for (const pending of active) pending.abort();
	exporting = true; active.add(controller); controls(); diagnostics();
	try {
		const compiler = await engine(), frames = Object.create(null);
		let bytes = 0;
		for (let frame = 0; frame < steps; frame++) {
			setStatus(`EXPORTING ${frame + 1}/${steps}`);
			const result = await compiler.compile({ ...job, context: { ...job.context, time: frame / steps } });
			try {
				if (result.status !== "success") {
					setStatus(result.status === "cancelled" ? "CANCELLED" : "ERROR"); diagnostics(result.diagnostics, result.echoes); return;
				}
				const data = await compiler.export(result, { signal: controller.signal }); bytes += data.byteLength;
				if (bytes > 64 * 1024 * 1024) throw new RangeError("Frame sequence exceeds the 64 MiB STL budget");
				frames[`${basename}-${String(frame).padStart(4, "0")}.stl`] = data;
			} finally { result.dispose?.(); }
		}
		if (controller.signal.aborted) throw Object.assign(new Error("Export cancelled"), { code: "cancelled" });
		const archive = zipSync(frames, { level: 0, mtime: new Date(1980, 0, 1) });
		const url = URL.createObjectURL(new Blob([archive], { type: "application/zip" }));
		const link = document.createElement("a"); link.href = url; link.download = `${basename}-frames.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
		setStatus("READY");
	} catch (error) {
		if (version === generation) { setStatus(error.code === "cancelled" ? "CANCELLED" : "ERROR"); if (error.code !== "cancelled") diagnostics([{ severity: "error", code: error.code ?? "sequence-export", message: error.message }]); }
	} finally { active.delete(controller); exporting = false; controls(); }
}

function updateCursor() {
	const lines = editor.value.slice(0, editor.selectionStart).split("\n");
	document.querySelector("#cursor-position").textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

window.lucide.createIcons();
document.querySelector("#audit-run").addEventListener("click", () => void runAudit());
for (const id of ["audit-samples", "audit-epsilon"]) document.querySelector(`#${id}`).addEventListener("input", () => {
	document.querySelector("#audit-status").textContent = "Audit settings changed; run audit again.";
	document.querySelector("#audit-results").replaceChildren();
});
document.querySelector("#render-button").addEventListener("click", () => { animation.pause(); void preview(); });
downloadButton.addEventListener("click", () => void download());
cancelButton.addEventListener("click", () => { animation.pause(); for (const controller of active) controller.abort(); });
document.querySelector("#fit-button").addEventListener("click", () => viewer.fit());
document.querySelector("#wireframe-button").addEventListener("click", (event) => { viewer.setWireframe(!viewer.wireframe); event.currentTarget.setAttribute("aria-pressed", String(viewer.wireframe)); });
document.querySelector("#projection-button").addEventListener("click", (event) => { viewer.setProjection(viewer.projection === "perspective" ? "orthographic" : "perspective"); event.currentTarget.setAttribute("aria-pressed", String(viewer.projection === "orthographic")); preferences.set({ projection: viewer.projection }); });
document.querySelector("#camera-lock-button").addEventListener("click", (event) => { viewer.locked = !viewer.locked; event.currentTarget.setAttribute("aria-pressed", String(viewer.locked)); });
document.querySelector("#format-button").addEventListener("click", () => { editor.value = editor.value.split("\n").map((line) => line.trimEnd()).join("\n").trim() + "\n"; commitEditor(); modified(); schedulePreview(); });
let selectedExample = "bracket";
document.querySelector("#example-select").addEventListener("change", (event) => {
	commitEditor(); if ((project.dirty() || hasSettings()) && !confirm("Load example and discard source edits and Customizer settings?")) { event.target.value = selectedExample; return; }
	selectedExample = event.target.value;
	animation.seek(0); customizers.clear(); ++loadGeneration; project = new StudioProject(EXAMPLES[selectedExample]); editor.reset(); editor.select(project.active, project.files.get(project.active)); projectControls(); updateCursor(); void preview();
});
entrySelect.addEventListener("change", () => { animation.pause(); commitEditor(); project.setEntry(entrySelect.value); openSource(project.entry); projectControls(); if (!viewer.locked) viewer.fitted = false; void preview(); });
sourceSelect.addEventListener("change", () => openSource(sourceSelect.value));
document.querySelector("#auto-preview").addEventListener("change", () => { clearTimeout(previewTimer); if (document.querySelector("#auto-preview").checked) schedulePreview(); });
document.querySelector("#experimental-roof").addEventListener("change", () => { animation.pause(); void preview(); });
document.querySelector("#animation-play").addEventListener("click", () => { clearTimeout(previewTimer); if (animation.playing) animation.pause(); else animation.play(); });
for (const id of ["animation-time", "animation-scrub", "animation-frame"]) {
	document.querySelector(`#${id}`).addEventListener(id === "animation-scrub" ? "input" : "change", (event) => {
		const input = event.target; if (!input.value || !input.checkValidity()) { input.reportValidity(); return; }
		animation.seek(id === "animation-frame" ? Number(input.value) / animation.steps : Number(input.value)); void preview();
	});
}
for (const id of ["animation-fps", "animation-steps"]) document.querySelector(`#${id}`).addEventListener("change", (event) => {
	for (const input of [document.querySelector("#animation-fps"), document.querySelector("#animation-steps")]) if (!input.checkValidity() || !input.value) { input.reportValidity(); return; }
	animation.pause(); animation.configure({ fps: Number(document.querySelector("#animation-fps").value), steps: Number(document.querySelector("#animation-steps").value) });
});
document.querySelector("#animation-export").addEventListener("click", () => void downloadSequence());
document.querySelector("#parameter-reset").addEventListener("click", () => { animation.pause(); customizer().reset(); presetSelect.value = ""; refreshCustomizer(true); void preview(); });
document.querySelector("#preset-save").addEventListener("click", () => {
	const input = document.querySelector("#preset-name");
	try { customizer().save(input.value.trim()); input.setCustomValidity(""); presetControls(input.value.trim()); }
	catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
});
presetSelect.addEventListener("change", () => {
	animation.pause();
	try { if (presetSelect.value) customizer().apply(presetSelect.value); else customizer().reset(); refreshCustomizer(true); void preview(); }
	catch (error) { diagnostics([{ severity: "error", code: "preset-invalid", message: error.message }]); }
});
document.querySelector("#preset-delete").addEventListener("click", () => { customizer().presets.delete(presetSelect.value); presetControls(""); });
document.querySelector("#preset-import").addEventListener("click", () => { const input = document.querySelector("#preset-input"); input.value = ""; input.click(); });
document.querySelector("#preset-input").addEventListener("change", async (event) => {
	const file = event.target.files[0]; if (!file) return;
	const model = customizer(), currentProject = project, entry = project.entry;
	try { if (file.size > 1_000_000) throw new RangeError("Preset byte limit exceeded"); const text = await file.text(); if (project !== currentProject || project.entry !== entry) return; model.import(text); presetControls(); }
	catch (error) { diagnostics([{ severity: "error", code: "preset-invalid", message: error.message }]); }
});
document.querySelector("#preset-export").addEventListener("click", () => {
	const url = URL.createObjectURL(new Blob([customizer().export()], { type: "application/json" }));
	const link = document.createElement("a"); link.href = url; link.download = project.entry.split("/").at(-1).replace(/\.scad$/i, ".json"); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener("visibilitychange", () => { if (document.hidden) animation.pause(); });
const visibilityObserver = new IntersectionObserver((entries) => { if (!entries[0].isIntersecting) animation.pause(); });
visibilityObserver.observe(document.querySelector("#viewport"));
for (const [button, input, options] of [["open-files-button", "project-files-input", {}], ["open-folder-button", "project-folder-input", { folder: true }], ["add-files-button", "project-add-input", { merge: true }]]) {
	const picker = document.querySelector(`#${input}`);
	document.querySelector(`#${button}`).addEventListener("click", () => { picker.value = ""; picker.click(); });
	picker.addEventListener("change", () => { if (picker.files.length) void loadFiles(picker.files, options); });
}
async function updateFonts(action) {
	if (loadingFonts) return;
	loadingFonts = true;
	controls();
	animation.pause();
	try {
		await action();
		document.querySelector("#font-info").textContent = `${runtimeFonts.count} loaded / ${runtimeFonts.localCount} local fonts`;
		loadingFonts = false;
		await preview();
	} catch (error) {
		setStatus("ERROR");
		diagnostics([{ severity: "error", code: "font-load", message: error.message }]);
	} finally { loadingFonts = false; controls(); }
}
const fontInput = document.querySelector("#font-files-input");
document.querySelector("#load-font-button").addEventListener("click", () => { fontInput.value = ""; fontInput.click(); });
fontInput.addEventListener("change", () => { if (fontInput.files.length) void updateFonts(() => runtimeFonts.addFiles(fontInput.files)); });
document.querySelector("#local-fonts-button").addEventListener("click", () => void updateFonts(() => runtimeFonts.enableLocalFonts()));
document.querySelector("#save-source-button").addEventListener("click", () => {
	commitEditor(); const path = project.active; const text = project.files.get(path);
	const url = URL.createObjectURL(new Blob([text], { type: "text/plain" })); const link = document.createElement("a"); link.href = url; link.download = path.split("/").at(-1); link.click();
	project.original.set(path, text); modified(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
editor.onChange(() => { editor.clearDiagnostics(); animation.pause(); inspection.clearMeasurement(); document.querySelector("#audit-status").textContent = "Source changed; run audit again."; document.querySelector("#audit-results").replaceChildren(); commitEditor(); modified(); updateCursor(); if (!active.size && !exporting) setStatus("MODIFIED"); schedulePreview(); });
editor.onSelection(updateCursor);
editor.onPreview(() => { animation.pause(); void preview(); });
window.addEventListener("pagehide", (event) => { animation.pause(); if (event.persisted) return; animation.dispose(); visibilityObserver.disconnect(); for (const controller of active) controller.abort(); layout.dispose(); inspection.dispose(); editor.dispose(); viewer.dispose(); void enginePromise?.then((compiler) => compiler.dispose()); });
editor.select(project.active, EXAMPLES.bracket);
projectControls();
controls();
void preview();