const { test } = require('node:test');
const assert = require('node:assert/strict');
const { within, projectPath, resolveVirtual } = require('../src/paths.cjs');
const uri = path => ({ path, with: changes => uri(changes.path) });

test('entry paths retain subdirectories and source-relative dependency layout', () => {
  assert.equal(projectPath('/work', '/work/models/main.scad'), 'project/models/main.scad');
  const roots = new Map([['project', uri('/work')], ['library0', uri('/shared')]]);
  assert.equal(resolveVirtual(roots, 'project/lib/part.scad').path, '/work/lib/part.scad');
  assert.equal(resolveVirtual(roots, 'library0/shapes.scad').path, '/shared/shapes.scad');
});

test('reject sibling prefixes, traversal, absolute and unknown paths', () => {
  assert.equal(within('/work', '/workspace/file'), false);
  const roots = new Map([['project', uri('/work')]]);
  for (const value of ['project/../secret', '/etc/passwd', 'project/a/../../secret', 'other/main.scad', 'project/a\\b', 'project/./main.scad']) assert.throws(() => resolveVirtual(roots, value));
  assert.throws(() => projectPath('/work', '/outside/main.scad'));
});