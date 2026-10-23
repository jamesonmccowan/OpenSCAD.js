import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, simplifySelection, temporarilySetTabFocusMode } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { scadLanguage } from "./scad-language.js";

const colors = HighlightStyle.define([
	{ tag: tags.keyword, color: "#c6a7ff" },
	{ tag: [tags.standard(tags.name), tags.function(tags.variableName)], color: "#88cff4" },
	{ tag: [tags.string, tags.special(tags.string)], color: "#b8ee62" },
	{ tag: tags.number, color: "#e8cb65" },
	{ tag: [tags.bool, tags.atom], color: "#f2b183" },
	{ tag: tags.special(tags.variableName), color: "#ffadce" },
	{ tag: tags.comment, color: "#91a098", fontStyle: "italic" },
	{ tag: tags.operator, color: "#a2d7c6" },
]);

export function createSourceEditor(parent) {
	const readonly = new Compartment(), buffers = new Map();
	let active, frozen = false, changingBuffer = false, diagnostics = [];
	let onChange = () => {}, onSelection = () => {}, onPreview = () => {};
	const extensions = [
		lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(),
		history(), bracketMatching(), indentOnInput(), indentUnit.of("  "),
		scadLanguage, syntaxHighlighting(colors), lintGutter(),
		keymap.of([
			{ key: "Mod-Enter", run: () => { if (!frozen) onPreview(); return true; } },
			{ key: "Escape", run: (view) => { simplifySelection(view); return temporarilySetTabFocusMode(view); } },
			indentWithTab, ...defaultKeymap, ...historyKeymap,
		]),
		readonly.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
		EditorView.contentAttributes.of({
			id: "editor", "aria-label": "OpenSCAD source",
			"aria-description": "Press Escape then Tab to leave the editor. Control or Command plus Enter previews.",
			spellcheck: "false", autocapitalize: "off",
		}),
		EditorView.updateListener.of((update) => {
			if (update.docChanged && !changingBuffer) onChange();
			if (update.docChanged || update.selectionSet) onSelection();
		}),
		EditorView.theme({
			"&": { height: "100%", color: "#dce7df", backgroundColor: "#151b18" },
			"&.cm-focused": { outline: "1px solid #7f9c68", outlineOffset: "-1px" },
			".cm-scroller": { overflow: "auto", fontFamily: '"DM Mono", monospace', fontSize: "14px", lineHeight: "1.72" },
			".cm-content": { padding: "16px 0 40px", caretColor: "#b8ee62" },
			".cm-line": { padding: "0 12px" },
			".cm-gutters": { backgroundColor: "#151b18", color: "#65726b", borderRight: "1px solid #2c3832" },
			".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#1b231f" },
			".cm-cursor": { borderLeftColor: "#b8ee62" },
			"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#3e513a !important" },
			".cm-matchingBracket": { backgroundColor: "#3e513a", outline: "1px solid #91a098" },
			".cm-panels, .cm-tooltip": { backgroundColor: "#1b231f", color: "#edf2ec", borderColor: "#2c3832" },
			".cm-diagnostic": { fontFamily: '"Manrope", sans-serif' },
			"@media (max-width: 760px)": { ".cm-scroller": { fontSize: "12px" } },
		}, { dark: true }),
	];
	const view = new EditorView({ parent, state: EditorState.create({ extensions }) });
	function applyDiagnostics() {
		const length = view.state.doc.length;
		const items = diagnostics.filter((item) => item.location?.file === active).map((item) => {
			const location = item.location;
			const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, location.line ?? 1)));
			const from = Math.max(0, Math.min(length, location.offset ?? line.from + (location.column ?? 1) - 1));
			return { from, to: Math.min(length, from + 1), severity: item.severity === "error" ? "error" : "warning", message: `[${item.code}] ${item.message}` };
		});
		view.dispatch(setDiagnostics(view.state, items));
	}
	return {
		view,
		get value() { return view.state.doc.toString(); },
		set value(text) {
			if (text === view.state.doc.toString()) return;
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: text },
				selection: { anchor: Math.min(text.length, view.state.selection.main.head) },
				annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")],
			});
		},
		get selectionStart() { return view.state.selection.main.from; },
		get readOnly() { return frozen; },
		set readOnly(value) {
			if (value === frozen) return;
			frozen = value;
			view.dispatch({ effects: readonly.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]) });
			view.contentDOM.setAttribute("aria-readonly", String(value));
		},
		select(path, text) {
			if (active) buffers.set(active, view.state);
			active = path;
			changingBuffer = true;
			try {
				const saved = buffers.get(path);
				view.setState(saved?.doc.toString() === text ? saved : EditorState.create({ doc: text, extensions }));
				view.dispatch({ effects: readonly.reconfigure([EditorState.readOnly.of(frozen), EditorView.editable.of(!frozen)]) });
				view.contentDOM.setAttribute("aria-readonly", String(frozen));
				applyDiagnostics();
			} finally { changingBuffer = false; }
		},
		reset() { buffers.clear(); active = undefined; diagnostics = []; },
		setDiagnostics(items) { diagnostics = items; applyDiagnostics(); },
		clearDiagnostics() { diagnostics = []; applyDiagnostics(); },
		focus() { view.focus(); },
		setSelectionRange(from, to = from) {
			const length = view.state.doc.length;
			view.dispatch({ selection: { anchor: Math.min(length, from), head: Math.min(length, to) }, scrollIntoView: true });
		},
		onChange(callback) { onChange = callback; },
		onSelection(callback) { onSelection = callback; },
		onPreview(callback) { onPreview = callback; },
		dispose() { view.destroy(); buffers.clear(); },
	};
}
