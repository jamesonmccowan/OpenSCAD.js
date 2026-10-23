const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Registry } = require('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma');

test('TextMate highlights SCAD paths, declarations, builtins, strings and multiline comments', async () => {
  const wasm = await readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner: patterns => new OnigScanner(patterns), createOnigString: text => new OnigString(text) }),
    loadGrammar: async () => JSON.parse(await readFile(path.join(__dirname, '../syntaxes/scad.tmLanguage.json'), 'utf8')),
  });
  const grammar = await registry.loadGrammar('source.scad');
  const scopes = (line, text, state) => {
    const index = line.indexOf(text);
    const result = grammar.tokenizeLine(line, state);
    return result.tokens.find(token => token.startIndex <= index && token.endIndex > index).scopes;
  };
  assert.ok(scopes('include <lib/model.scad>;', 'include').includes('keyword.control.import.scad'));
  assert.ok(scopes('use <lib/model.scad>;', 'model').includes('string.other.path.scad'));
  assert.ok(scopes('module bracket(size=2) { cube(size); }', 'module').includes('storage.type.scad'));
  assert.ok(scopes('module bracket(size=2) { cube(size); }', 'bracket').includes('entity.name.function.scad'));
  assert.ok(scopes('$fn=32; cube(5);', '$fn').includes('variable.language.scad'));
  assert.ok(scopes('$fn=32; cube(5);', 'cube').includes('support.function.scad'));
  assert.ok(scopes('echo("cube(5)");', 'cube').includes('string.quoted.double.scad'));
  const state = grammar.tokenizeLine('/* unfinished').ruleStack;
  assert.ok(scopes('cube(2); */ cube(3);', 'cube(2)', state).includes('comment.block.scad'));
  assert.ok(scopes('cube(2); */ cube(3);', 'cube(3)', state).includes('support.function.scad'));
  registry.dispose();
});