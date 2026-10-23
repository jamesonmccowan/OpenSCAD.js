import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const extension = fileURLToPath(new URL('../', import.meta.url));
export const provenance = {
  version: '0.0.23',
  importerRevision: 'c2148e54b456b571238d35cac037d304053d64b2',
  occtRevision: 'd2abb6d844231cb8f29be6894440874a4700e4a5',
  occtVersion: '7.6.1',
  emscriptenVersion: '3.1.69',
  patches: [],
  rebuildVerification: {
    date: '2026-10-19',
    platform: 'linux-x64',
    generator: 'Ninja',
    configuration: 'Release',
    sourcePatches: [],
    jsSha256: '8b090be386bc8ffba32222aa19f38742ae8ed35707819beb7f8ab4938a28c97a',
    wasmSha256: '80571420c869c559ddd01183ebbd47171a07e6b54893664648d6f56bf93bc2c3',
    byteIdenticalToNpm: false,
    workerChecks: 'STEP dimensions, volume, nondegenerate triangles and invalid-input rejection',
    chromiumChecks: '4 focused STEP viewer tests passed with the rebuilt library',
  },
  binaries: {
    'occt-import-js.js': '3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379',
    'occt-import-js.wasm': '33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952',
  },
  sources: [
    {
      file: 'importer.tar.gz',
      url: 'https://codeload.github.com/kovacsv/occt-import-js/tar.gz/c2148e54b456b571238d35cac037d304053d64b2',
      sha256: '2bd3799b2ac56cbf3f0df6300a51c8890e137bd001462702b356f621e33ff192',
      prefix: 'occt-import-js-c2148e54b456b571238d35cac037d304053d64b2',
    },
    {
      file: 'occt.tar.gz',
      url: 'https://codeload.github.com/Open-Cascade-SAS/OCCT/tar.gz/d2abb6d844231cb8f29be6894440874a4700e4a5',
      sha256: '2715d89a1bc44dfd34dab88f729c445ea93f6b57d6539b0c89614a80ae144a6c',
      prefix: 'OCCT-d2abb6d844231cb8f29be6894440874a4700e4a5',
    },
    {
      file: 'emscripten.tar.gz',
      url: 'https://codeload.github.com/emscripten-core/emscripten/tar.gz/refs/tags/3.1.69',
      sha256: '3ceb2acbf3551146753c1abef8feb24347403bf13713820ea9dddbd946f9e4ac',
      prefix: 'emscripten-3.1.69',
    },
  ],
};

export function verifyHash(bytes, expected, label) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`${label}: SHA-256 mismatch (expected ${expected}, got ${actual}); review provenance before rebuilding`);
}

async function cachedArchive(source, cache) {
  const filename = path.join(cache, source.file);
  let bytes;
  try {
    bytes = await readFile(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(`Downloading reviewed OCCT source: ${source.url}`);
    const response = await fetch(source.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`Source download failed: ${response.status} ${source.url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    verifyHash(bytes, source.sha256, source.file);
    const temporary = `${filename}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  verifyHash(bytes, source.sha256, filename);
  return filename;
}

async function member(archive, prefix, name) {
  const { stdout } = await exec('tar', ['-xOzf', archive, `${prefix}/${name}`], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

export async function prepareOcct() {
  const installed = path.join(extension, 'node_modules/occt-import-js');
  const metadata = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  if (metadata.version !== provenance.version) throw new Error('OCCT package version changed; update and review its source provenance');
  for (const [name, hash] of Object.entries(provenance.binaries)) {
    verifyHash(await readFile(path.join(installed, 'dist', name)), hash, name);
  }
  const cache = path.join(extension, '.occt-cache');
  const output = path.join(extension, 'licenses/occt-import-js');
  await mkdir(cache, { recursive: true });
  const archives = [];
  for (const source of provenance.sources) archives.push(await cachedArchive(source, cache));
  const importer = name => member(archives[0], provenance.sources[0].prefix, name);
  const normalize = bytes => bytes.toString('utf8').replaceAll('\r\n', '\n');
  for (const name of ['CMakeLists.txt', 'tools/setup_emscripten_win.bat', 'tools/build_wasm_win.bat', 'tools/build_wasm_win_release.bat', 'tools/build_wasm_win_dist.bat', 'dist/occt-import-js.js']) {
    if (normalize(await importer(name)) !== normalize(await readFile(path.join(installed, name)))) {
      throw new Error(`Installed ${name} differs from reviewed source`);
    }
  }
  verifyHash(await importer('dist/occt-import-js.wasm'), provenance.binaries['occt-import-js.wasm'], 'Source archive WASM');
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'sources'), { recursive: true });
  for (const [index, source] of provenance.sources.entries()) {
    await cp(archives[index], path.join(output, 'sources', source.file));
  }
  await cp(path.join(extension, 'OCCT-SOURCES.txt'), path.join(output, 'OCCT-SOURCES.txt'));
  await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  const notices = [
    [0, 'LICENSE.md', 'license.occt-import-js.txt'],
    [1, 'LICENSE_LGPL_21.txt', 'license.occt.txt'],
    [1, 'OCCT_LGPL_EXCEPTION.txt', 'OCCT_LGPL_EXCEPTION.txt'],
    [2, 'LICENSE', 'runtime/Emscripten.LICENSE'],
    [2, 'AUTHORS', 'runtime/Emscripten.AUTHORS'],
    [2, 'system/lib/libc/musl/COPYRIGHT', 'runtime/musl.COPYRIGHT'],
    [2, 'system/lib/libcxx/LICENSE.TXT', 'runtime/libcxx.LICENSE'],
    [2, 'system/lib/libcxxabi/LICENSE.TXT', 'runtime/libcxxabi.LICENSE'],
    [2, 'system/lib/compiler-rt/LICENSE.TXT', 'runtime/compiler-rt.LICENSE'],
    [2, 'system/lib/libunwind/LICENSE.TXT', 'runtime/libunwind.LICENSE'],
    [2, 'system/lib/dlmalloc.c', 'runtime/dlmalloc.c'],
  ];
  for (const [index, name, target] of notices) {
    await mkdir(path.dirname(path.join(output, target)), { recursive: true });
    await writeFile(path.join(output, target), await member(archives[index], provenance.sources[index].prefix, name));
  }
  console.log('Prepared pinned OCCT sources, LGPL exception and runtime notices for the VSIX.');
}
