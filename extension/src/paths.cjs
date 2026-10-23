const path = require('node:path');

function within(root, candidate) {
  const relative = path.posix.relative(root, candidate);
  return relative === '' || (!relative.startsWith('../') && relative !== '..' && !path.posix.isAbsolute(relative));
}

function projectPath(root, file) {
  if (!within(root, file)) throw new Error('File is outside the project root');
  return `project/${path.posix.relative(root, file)}`;
}

function resolveVirtual(roots, name) {
  if (typeof name !== 'string' || name.length > 4096 || /[\\\x00-\x1f]/.test(name)) throw new Error('Invalid dependency path');
  const [prefix, ...parts] = name.split('/');
  const root = roots.get(prefix);
  if (!root || !parts.length || parts.some(part => !part || part === '.' || part === '..')) throw new Error('Dependency path is outside allowed roots');
  const resolved = path.posix.join(root.path, ...parts);
  if (!within(root.path, resolved)) throw new Error('Dependency path escapes allowed root');
  return root.with({ path: resolved });
}

module.exports = { within, projectPath, resolveVirtual };