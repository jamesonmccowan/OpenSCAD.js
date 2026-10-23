import { expect } from "@playwright/test";

export function editorValue(page) {
	return page.evaluate(async () => (await import(new URL("openscad.js", location.href).href)).editor.value);
}

export function editorSelection(page) {
	return page.evaluate(async () => (await import(new URL("openscad.js", location.href).href)).editor.selectionStart);
}

export function expectEditor(page) {
	return expect.poll(() => editorValue(page));
}
