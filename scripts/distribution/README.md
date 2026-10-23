# OpenSCAD.js Standalone Distribution

A self-contained, partial OpenSCAD `openscad-2026.10.02` compiler, full studio,
viewer and STL CLI. The package version is recorded in `package.json` and
`distribution-manifest.json`. This private distribution candidate is not a full
OpenSCAD implementation or a completed licensing certification.

## Serve the examples

Serve this directory over HTTP, for example:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173/demo.html` for independent read-only/editable previews
and a core worker/STL example, or `http://localhost:4173/editor.html` for the full studio.
The directory index remains a compatibility copy of the studio.

All required runtime JS, WASM and fonts are local. No native OpenSCAD,
`node_modules`, CDN, import map, or cross-origin isolation is needed for the
core API. Keep the entire `openscad.js/` directory together; supporting assets
resolve relative to its modules even when hosted beneath a nested URL.
Opening HTML directly through `file://` is not supported. Offline means local
assets served over HTTP, not service-worker installation or caching.

## Embed a preview window

```html
<div id="model" style="height: 400px"></div>
<script type="module">
  import { createPreview } from "./openscad.js/preview.js";

  const preview = await createPreview(document.querySelector("#model"), {
    source: 'difference() { cube(20,center=true); sphere(13); }',
    editable: false,
  });

  // Later, when removing the component:
  // await preview.dispose();
</script>
```

Each instance owns its source, camera, worker and WebGL viewer. Overlay buttons
provide Preview, Render, Download STL, Reset view / fit, Source, and Stop while
busy. Shadow DOM keeps styles local to the component. Supply container width
and height; 320px wide by 360px high or larger is recommended for source editing.
The source viewer is a plain textarea. Read-only is the default and still allows
copying; it does not hide or protect the script. With `editable: true`, edits
remain in memory. Ctrl+Enter/Cmd+Enter previews; Escape closes the source panel.

For named sources, assets, fonts, definitions, and explicit resolvers, supply
`project` **instead of** `source`, using the core request fields:

```js
const preview = await createPreview(element, {
  editable: true,
  project: {
    entry: "models/main.scad",
    files: {
      "models/main.scad": "use <shape.scad> shape();",
      "models/shape.scad": "module shape() { cube(10); }",
    },
  },
});
```

The source selector edits named files without changing the compilation entry.
Sources obtained through an explicit resolver join that selector when resolved;
unresolved entries are not editable until loaded. Binary assets are not text
buffers. Resolved sources are retained in memory for subsequent compiles and edits.
Inputs are copied on mount, and resolver callbacks remain host-owned;
they should honor their supplied abort signal. No arbitrary URLs are fetched
automatically. The component owns mode, cancellation signal, and viewport context;
project `mode`, `signal`, `auditOnly`, and `auditComponents` are not accepted.
Other project fields, including experimental opt-ins and resource limits,
follow the core contract. Advanced runtime overrides go in `workerOptions`.

`createPreview()` resolves with a handle after mounting, **not** after compilation.
Worker/WebGL creation and initial preview are deferred until a nonzero-size
container becomes visible. An explicit `preview()`, `render()`, or `downloadStl()`
also starts initialization, including when offscreen. Drawing pauses while
offscreen, zero-sized, or in a hidden document; each visible instance still has
its own worker and WebGL context, so simultaneous previews are not unlimited.

Handle lifecycle and outcomes:

- `ready` settles after the first automatic attempt, explicit operation, or
  disposal. It can remain pending while an instance is offscreen.
- `preview()`, `render()`, and `downloadStl()` return outcomes with `status`:
  `success`, `error`, `cancelled`, `superseded`, or `disposed`, plus diagnostics.
  A newer explicit operation cancels an older one.
- Invalid mount/options reject `createPreview()`. Operational failures,
  including worker/WebGL startup errors, are displayed and returned as outcomes,
  not silently ignored or thrown as unhandled event-listener rejections.
- `state` is a read-only snapshot with `status`, `stale`, `diagnostics`, `echoes`,
  and, after a successful display, `volume` and `mode`. Status distinguishes
  waiting, initializing, ready, busy, modified, cancelled, error, and disposed.
- `stop()` cancels active work. `dispose()` is idempotent, removes owned UI,
  observers and listeners, disposes the viewer and workers, and releases download
  URLs. During startup it waits for the bounded worker-startup attempt to settle.
  Call it explicitly when removing a component; detaching DOM alone is not disposal.

Failures retain the last successful geometry and located diagnostics are visible
in the Messages panel. Edits mark the display out of date. Stale completions
cannot replace a newer model. Preview/render preserve the user's camera unless
the source supplies camera settings. Reset view fits the displayed geometry
without recompiling.

Download STL always compiles a fresh render-mode snapshot of the current inputs.
It excludes preview overlays, does not update the displayed model or clear a
stale indicator, and produces no download on failure, cancellation, or an edit
that supersedes the export. No changes are persisted automatically.

## Browser compilation

```js
import { createWorkerEngine } from "./openscad.js/core.js";

const engine = await createWorkerEngine();
let result;
try {
  result = await engine.compile({
    mode: "render",
    files: {
      "main.scad": "use <shape.scad> shape();",
      "shape.scad": "module shape() { cube([1, 2, 3]); }",
    },
  });
  if (result.status !== "success") {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  const stlBytes = await engine.export(result);
  console.log(result.volume, stlBytes.byteLength);
} finally {
  result?.dispose?.();
  await engine.dispose();
}
```

Use worker compilation in browser applications to keep geometry work off the
UI thread. `createEngine()` is also exported for direct compilation; it uses
the same request/result contract but does not move computation off that thread.
Importing core does not mount UI or initialize an engine.

Requests support named `files`, `entry`, library paths, imported `assets`,
runtime `fonts`, definitions, and explicit source/asset/font resolvers.
Resolvers control access to additional resources: there is no automatic
arbitrary-URL fetching. Preview and final/render modes use the same language
profile. Structured results expose diagnostics with source locations, echoes,
bounds and volume. Always check `status` before exporting or reading geometry.
The declarations reachable from `core.d.ts` document the complete API.

Pass an `AbortSignal` to compilation/export for cancellation. Dispose successful
results when no longer needed and dispose engines to release workers and
geometry. Cancellation/timeouts can invalidate worker-owned results; do not
reuse them after a worker reset. Engine startup and export failures reject;
compilation errors/cancellation are structured results. Surface these errors
in the host UI. Worker and WebGL availability must be handled by the host;
there is no silent main-thread compilation fallback.

Advanced hosts can still supply `workerUrl`, `workerFactory`,
`manifoldModuleUrl`, and `wasmUrl`. Normal usage requires none of these.

## Node, installed package, and CLI

Use Node 22. From a copied artifact:

```sh
node openscad.js/cli.js model.scad -o model.stl
node openscad.js/cli.js --help
```

Node can import `./openscad.js/core.js` and use `createEngine()` or
`createWorkerEngine()` without a DOM, GPU, browser, or native OpenSCAD.

After installing the packed artifact, the package exposes:

- `openscad-js-studio`: the same core API and TypeScript declarations.
- `openscad-js-studio/worker`: the worker entry for custom worker factories.
- `openscad-js-studio/viewer`: the existing lower-level `Viewer` class.
- `openscad-js-studio/preview`: `createPreview()` and its TypeScript declarations.
- `openscad-js-studio/node`: filesystem project loading.
- `openscad-js-studio/node/fonts`: system-font discovery.
- `openscad-js`: the executable, preserving existing options and exit codes.

For direct browser use, the lower-level viewer is available from
`./openscad.js/viewer.js`; it requires a DOM and WebGL. Use this for custom
rendering UI, or `./openscad.js/preview.js` for the ready-made preview window.

The old `src/index.js`, `src/viewer/viewer.js`, and `bin/openscad-js.js` paths
remain compatibility entries. The old explicit `vendor/manifold.js` URL and its
WASM companion remain available for existing worker configurations. New code
should use public entries and automatic asset locations. Files beneath
`openscad.js/runtime/` are private implementation details, not public imports.

## Scope, testing, and notices

The exported `CAPABILITIES` value describes the supported subset and restrictions.
Text uses bundled Liberation faces or supplied fonts, with ASCII layout.
Roof and other experimental features retain explicit opt-in through the request's
`experimental` list or the CLI's `--enable` flag. STL is the supported
import/export geometry format. Packaging does not expand language compatibility.

Distribution verification targets Linux Playwright Chromium, Firefox, and WebKit
plus clean Node consumers. Safari and iOS browsers are explicitly unsupported
for this release; volunteer compatibility testing is welcome for future support.
Playwright WebKit is regression coverage, not Safari/iOS support. Physical mobile
devices, strict-CSP/webview integration, cross-origin deployment, and hosted CI
results require separate verification.
No service-worker caching, full font shaping, native oracle, or VS Code extension
is included.

Original code is Apache-2.0; see [LICENSE](LICENSE). Retain dependency/font
licenses in `licenses/`, generated `*.LEGAL.txt` files, and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when redistributing.
[distribution-manifest.json](distribution-manifest.json) records selected
dependency versions and SHA-256 hashes of every other file. It is an inventory,
not a signature, complete transitive WASM audit, or compatibility guarantee.
Its dependency records also hash the retained license/notice files. Bundle
inputs are discovered from esbuild metadata, alongside explicitly copied
runtime/font packages. Embedded OpenType.js helper notices and the Feather
MIT notice supplement npm package licenses in `licenses/javascript/`.
The 12 Liberation TTF faces and six UI WOFF/WOFF2 assets are unmodified and
retain their SIL OFL 1.1 texts and applicable reserved-name declarations.
The reviewed Manifold/roof build inputs and embedded-component notices are
retained in [licenses/wasm/](licenses/wasm/), with hashes and source URLs in
its provenance.json. Builds reject unreviewed changes to those inputs.
The roof outputs were reproduced byte-for-byte; Manifold's npm archive was
integrity-checked and traced to its published source/build graph, not
independently rebuilt or cryptographically attestation-verified. This is
bounded provenance evidence, not legal certification of all project assets.
