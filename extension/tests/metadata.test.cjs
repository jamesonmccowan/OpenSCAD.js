const assert = require('node:assert/strict');
const test = require('node:test');
const root = require('../../package.json');
const extension = require('../package.json');

test('publication metadata agrees across packages and resolves monorepo documentation links', () => {
  const repository = 'https://github.com/jamesonmccowan/openscad.js';
  for (const manifest of [root, extension]) {
    assert.equal(manifest.author, 'Jameson McCowan');
    assert.equal(manifest.repository.url, repository + '.git');
    assert.equal(manifest.bugs.url, repository + '/issues');
    assert.ok(manifest.description.length > 0);
    assert.ok(manifest.keywords.length > 0);
    assert.equal(manifest.license, 'Apache-2.0');
  }
  assert.equal(extension.version, root.version);
  assert.equal(extension.publisher, 'OuroborosProductions');
  assert.equal(`${extension.publisher}.${extension.name}`, 'OuroborosProductions.openscad-js-preview');
  assert.equal(root.private, true, 'No npm registry publication is intended');
  assert.equal(extension.repository.directory, 'extension');
  assert.equal(extension.homepage, repository + '/tree/main/extension#readme');
  assert.doesNotMatch(extension.scripts.package, /allow-missing-repository|no-rewrite-relative-links/);
  const base = /--baseContentUrl (\S+)/.exec(extension.scripts.package)[1];
  assert.equal(new URL('OCCT-SOURCES.txt', base + '/').href, repository + '/blob/main/extension/OCCT-SOURCES.txt');
  assert.equal(new URL('../THIRD_PARTY_NOTICES.md', base + '/').href, repository + '/blob/main/THIRD_PARTY_NOTICES.md');
});
