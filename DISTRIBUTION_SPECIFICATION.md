# OpenSCAD.js Distribution and Preview Windows Specification

Status: Phase 1 distribution contract and Phase 2 preview windows implemented.
Prepared: 2026-10-16.

This document specifies the distribution and embedding work. Phase 1 provides
the packaged core/CLI entries, lower-level viewer entry, automatic browser worker
asset locations, full editor, and core demo. Phase 2 adds the typed preview
component, independent read-only/editable examples, lifecycle controls, and
multi-file source editing. This is not a full-project release certification.
It supplements the [project specification](SPECIFICATION.md); language support
remains defined by the [capability audit](references/CAPABILITY_AUDIT.md) and
the runtime capability manifest.

**MUST**, **SHOULD**, and **MAY** indicate requirement levels for the milestone
that delivers the relevant feature. API examples below describe the public
contract; additions must be documented and typed when implemented.

## 1. Goals

1. Let a JavaScript consumer compile supported OpenSCAD scripts and export STL
   through one public module import, without constructing a viewer.
2. Ship a self-contained runtime directory with automatic supporting-asset
   resolution, rather than require consumers to understand internal files.
3. Offer lightweight, interactive preview windows that a host page can place
   alongside ordinary content, including several independent models per page.
4. Package the full studio and CLI using the same compiler and export behavior.
5. Provide working examples, declarations, notices, and verification that make
   the exported directory useful outside this repository.

This is packaging and integration work, not a new compiler or geometry backend.
The distribution MUST expose all currently supported language features without
implying full native OpenSCAD compatibility. Existing experimental features MUST
retain their explicit opt-in behavior.

## 2. Existing Foundation

The repository already provides:

- A [public compilation API](src/index.js) and
  [typed engine/project contracts](src/index.d.ts).
- A [worker engine](src/core/worker-engine.js) for asynchronous browser work.
- A [viewer](src/viewer/viewer.js) with camera, fit, projection, and disposal.
- A [CLI](bin/openscad-js.js) and full [studio](index.html).
- A [distribution builder](scripts/build-distribution.js) that packages local
  dependencies, workers, WASM, fonts, notices, declarations, and an inventory.
- [Node distribution tests](tests/distribution.node.test.js) and
  [browser distribution tests](tests/distribution.spec.js).

Before Phase 1, the artifact exposed source-oriented paths and required explicit
Manifold module configuration for normal browser worker creation. Phase 1 hides
those implementation details behind the packaged entries and automatic defaults,
while retaining documented legacy entry paths.
The existing viewer remains a lower-level rendering API, distinct from the
preview-window component implemented in [src/preview/](src/preview/).

## 3. Artifact Layout

The intended exported tree is:

```text
export/
  openscad.js/
    core.js
    core.d.ts
    preview.js
    preview.d.ts
    cli.js
    runtime/
      ...workers, WASM, bundled dependencies, fonts, supporting modules...
  demo.html
  editor.html
  README.md
  package.json
  LICENSE
  THIRD_PARTY_NOTICES.md
  licenses/
  distribution-manifest.json
```

`export/` denotes the artifact root, not a required build-directory name.
The builder MAY continue producing `dist/`. `openscad.js/` is a directory.
Additional declaration dependencies and generated legal-comment sidecars MUST
be retained where required.

### 3.1 Public entry points

The tree above describes both phases. The artifact also exposes
`openscad.js/viewer.js` and its declaration as the lower-level viewer API.
Phase 2 now includes `preview.js` and `preview.d.ts`.

| Entry | Responsibility |
| --- | --- |
| `openscad.js/core.js` | Compilation, project resolution, capability information, worker creation, and STL export; no viewer or page initialization. |
| `openscad.js/preview.js` | Browser preview-window component and its viewer dependencies. |
| `openscad.js/cli.js` | Node CLI using the shared compiler and existing filesystem policy. |
| `demo.html` | Small, readable example of public imports, headless compilation, and independent preview windows. |
| `editor.html` | Packaged full studio, preserving its current functionality. |

Consumers MUST NOT need to import anything beneath `runtime/` for ordinary use.
Its internal layout is not a public API. The artifact's README MUST distinguish
stable public entries from implementation details.

Browser consumers MUST NOT need an import map, a CDN, `node_modules`, or a
native OpenSCAD installation. Node consumers MUST NOT need a DOM, WebGL, or a
browser for compilation and STL export.

The package manifest MUST map installed ESM imports, declarations, and the
`openscad-js` executable to the packaged public entries. Existing documented
package exports and CLI behavior MUST be preserved or explicitly migrated;
reorganizing the artifact alone is not permission to remove public APIs.

### 3.2 One import, not necessarily one physical file

The primary delivery promise is one public import backed by a copied directory.
A literal single-file build with embedded workers, fonts, and WASM is not a
requirement. Separate supporting assets permit caching and avoid requiring
embedded-data or blob-worker loading as the normal integration path.

The core import MUST NOT initialize a canvas or load the studio UI. Viewer and
editor dependencies MUST remain outside the core's required runtime graph.
Importing a module MUST NOT automatically mount a UI or start compiling.

## 4. Runtime and Distribution Contract

### 4.1 Asset resolution and hosting

- Default worker, kernel, WASM, font, and supporting-module locations MUST
  resolve relative to the distribution module, not the host document URL.
- Ordinary browser `createWorkerEngine()` use MUST work without a caller-supplied
  `manifoldModuleUrl`, worker URL, or WASM URL.
- Existing explicit asset-location and worker-factory overrides SHOULD remain
  available for advanced hosts.
- Moving the complete artifact to a nested HTTP path MUST require no rewriting.
- Required runtime assets MUST be local to the artifact. Model-specific remote
  resources are a separate, explicit host choice.
- HTTP serving is required; opening HTML through `file://` is not supported.
  Offline operation means local assets served over HTTP, not a service worker.
- The build MUST NOT introduce a cross-origin-isolation requirement.
- Unsupported workers, WebGL failure, asset-load errors, and startup timeouts
  MUST be reported explicitly, not replaced with a success-shaped fallback.

Safari and iOS browsers are explicitly unsupported for this release. Volunteer
testing MAY inform future support; Linux Playwright WebKit MUST NOT be presented
as Safari/iOS certification. Strict-CSP, cross-origin hosting and VS Code webviews
remain separate verification work. Documentation MUST state
tested environments and hosting requirements without implying certification.

### 4.2 Compilation API

The packaged core MUST reuse the existing engine/request/result contracts:
preview and render modes, diagnostics, echoes, capabilities, cancellation,
project inputs, resource limits, and explicit result/engine disposal.

Source files, imported assets, fonts, definitions, library paths, and resolver
callbacks MUST remain available through the existing project API. Packaging
MUST NOT narrow the language to what a single source string can express.
STL remains the supported export format; a new artifact layout does not add
other output formats.

### 4.3 Editor, CLI, and notices

`editor.html` MUST preserve the current full studio rather than replace it with
the preview component. The CLI MUST preserve its existing options, diagnostics,
stdin/stdout behavior, exit codes, filesystem boundaries, and atomic output.

The artifact MUST include project and dependency/font licenses, required
notices and legal sidecars, and a versioned file inventory with hashes.
The inventory MUST NOT be presented as a signature or completed transitive
licensing certification.

The artifact README MUST explain browser imports, Node usage, CLI invocation,
HTTP hosting, asset layout, cleanup, supported language/profile limitations,
experimental flags, and redistribution obligations. Examples MUST use public
entries and require no repository checkout at runtime.

## 5. Preview Window

### 5.1 Component boundary

A preview window is an independently mounted browser component containing a
canvas, compact overlay controls, source panel, and status/diagnostic UI.
It MUST use the packaged public compiler and shared viewer, not studio
controller internals or an iframe containing the full editor.

The host supplies a container and its dimensions. The component MUST resize to
that container without taking over page layout. Its styles MUST NOT modify
unrelated host elements. Scoped styles or a small Shadow DOM wrapper are
acceptable; the exact isolation mechanism is an implementation choice.

### 5.2 Simple API

```html
<div id="model" style="height: 360px"></div>
<script type="module">
  import { createPreview } from "./openscad.js/preview.js";

  const preview = await createPreview(document.querySelector("#model"), {
    source: `
      difference() {
        cube(20, center=true);
        sphere(13);
      }
    `,
    editable: false,
  });

  // When removing the component:
  // await preview.dispose();
</script>
```

`createPreview(container, options)` MUST return an independently owned component
handle. It SHOULD initially preview the supplied source when the component is
visible. Offscreen initialization SHOULD be deferred.

The first API MUST support:

- A convenience `source` string for a single script.
- An alternative project input using existing named source files, entry,
  assets, and resolver contracts; ambiguous source/project input MUST be
  rejected explicitly rather than silently choosing one.
- An `editable` option, defaulting to `false`.
- Explicit disposal of component-owned resources.

The implementation MUST document and type the public lifecycle, initialization
errors, and diagnostic behavior. Additional imperative methods or events SHOULD
be added only where needed for embedding, not as a second competing engine API.

The implemented handle exposes `ready`, a read-only `state` snapshot,
`preview()`, `render()`, `downloadStl()`, `stop()`, and async idempotent `dispose()`.
Creation returns after mounting; visible, nonzero-size instances initialize and
compile automatically. Offscreen instances wait until visible or explicitly
operated. `ready` settles after the first attempt/operation or disposal.
Operations return structured outcomes (`success`, `error`, `cancelled`,
`superseded`, or `disposed`) and diagnostics. Invalid creation inputs reject;
operational failures are displayed and returned, including startup failures.
Advanced worker/asset overrides are accepted through `workerOptions`.
See the [artifact API documentation](scripts/distribution/README.md#embed-a-preview-window)
and [declarations](src/preview/preview.d.ts).

### 5.3 Overlay controls

The initial controls MUST include:

| Control | Behavior |
| --- | --- |
| Preview | Compile the current source/project in preview mode and display the successful result. |
| Render | Compile in final/render mode and display the successful result. |
| Download STL | Compile a snapshot of the current source/project in render mode, then export and download STL. |
| Reset view / fit | Restore a useful view fitted to the displayed model, reusing existing camera behavior. |
| Source | Toggle the source panel without discarding the model or edits. |
| Stop | Cancel active compilation/export; available while work is in progress. |

Controls SHOULD be semi-transparent over the viewport, becoming fully legible
on hover or keyboard focus. They MUST remain discoverable on touch devices.
Use real keyboard-operable buttons with accessible names, visible focus, and
adequate contrast and touch targets; hover-only discovery is not sufficient.

Normal recompilation SHOULD preserve the user's camera, following existing
source-camera behavior. Reset/fit MUST NOT recompile the script.

### 5.4 Source panel

- Use a plain `<textarea>`; CodeMirror is not required for this component.
- Read-only mode MUST still allow selecting and copying source. It is not
  source protection.
- Editable mode MUST retain in-memory edits when the panel is closed/reopened.
- Preview and Render MUST be explicit actions. Automatic per-keystroke
  recompilation is not required.
- Ctrl+Enter and Cmd+Enter MUST request preview while editing.
- A multi-file project MUST allow the user to select which source file to
  view/edit, preserving named paths and edits; imported binary assets are not
  editable text buffers. The entry file remains the compilation entry.
- Editing MUST NOT write to original files or persist changes automatically.

### 5.5 State, diagnostics, and export correctness

The component MUST visibly distinguish initialization, ready, busy, cancelled,
error, and modified/out-of-date states.

Source/project changes MUST mark the displayed model out of date. A failed or
cancelled operation MUST retain the last successful model. Errors and warnings
MUST be visible, including source path, line, and column when supplied.
Echo output SHOULD be available without obscuring the model.

Only a successful display compilation for the current input snapshot may clear
the out-of-date indication. An older operation finishing after edits MUST NOT
replace a newer model or claim that edited source is current.

STL download MUST compile the current input snapshot in render mode, even if
the displayed preview is older or was compiled in preview mode. Export failure
or cancellation MUST produce no partial download. Export alone MUST NOT mark
an outdated viewport current. Preview-only overlays and viewer annotations MUST
not enter the STL.

### 5.6 Resource ownership and multiple instances

Each instance MUST have independent source/project state, camera, controls,
diagnostics, cancellation, and model ownership. Compilation and STL export
MUST run in workers so that geometry work does not block the host UI.

Start with independent instance-owned engines. A shared-worker scheduler is not
part of the first implementation; add one only if measurements justify it.
Offscreen previews SHOULD defer expensive initialization, and hidden previews
SHOULD avoid unnecessary drawing. There is no promise of unlimited simultaneous
workers or WebGL contexts.

`dispose()` MUST release owned workers, compilation results, viewer/WebGL
resources, observers, event handlers, component DOM, and temporary download
URLs. Disposal MUST be safe during initialization or active work and safe to
call more than once. Disposing one instance MUST NOT affect another.

## 6. Delivery Sequence

### Phase 1: Polish the distribution contract

1. Establish the public artifact entry points and matching declarations.
2. Resolve worker/kernel/assets automatically relative to the packaged modules.
3. Package the full studio as `editor.html` and wire the CLI/package exports.
4. Add a minimal runnable core API demo and artifact README.
5. Verify clean-consumer and nested-path behavior before building preview UI.

The preview entry and preview sections of the demo arrive in Phase 2; Phase 1
documentation MUST NOT advertise an unimplemented component.

Phase 1 verification (2026-10-16): 31 focused Node distribution/worker/CLI/
filesystem tests, 12 distribution browser checks across Chromium/Firefox/WebKit,
and strict public and clean-consumer declaration checks passed. The final
import-only/nested-assets assertions also passed on all three engines.
The browser suite required the documented Xvfb workaround for Firefox WebGL in
this displayless environment. The extension build and one focused browser
worker/font integration check passed after updating its distribution asset paths.
These are targeted results, not a new full-project compatibility gate.

### Phase 2: Deliver preview windows

1. Implement the component against the packaged contract and shared viewer.
2. Add overlay controls, textarea source panel, diagnostics, and stale-state
   handling.
3. Add independent instances, cancellation, resizing, and lifecycle cleanup.
4. Extend the demo and verification with read-only and editable previews.

Phase 2 verification (2026-10-16): 66 focused browser checks passed across
Chromium/Firefox/WebKit (36 distribution/preview checks and 30 shared-viewer
regressions), using Xvfb. Coverage includes geometry pixels, independent models,
multi-file and resolved-source edits, camera preservation, stale completions,
final-mode download bounds/volume, worker/geometry cancellation, touch and
keyboard controls, zero-size/offscreen deferral, hidden drawing, startup errors
and retry, and disposal during worker startup and compilation. Seventeen
focused Node distribution/viewer/worker tests and strict public/clean-consumer
declaration checks passed. The extension build and a focused worker/font browser
integration check also passed. These results do not replace the full-project gate
or certify shipping Safari/iOS, cross-origin, or strict-CSP deployments.

Language expansion, a reduced-feature replacement studio, rich source editing,
automatic persistence, customizer/animation/audit panels, new export formats,
and a worker pool are outside these two phases.

## 7. Acceptance Criteria

The repeatable local candidate command is `npm run release:check`; its
[instructions](README.md#complete-local-release-gate) describe prerequisites,
cleaning boundaries, retained stage logs/reports, inspected standalone/VSIX
archives, and publication/manual-host checks outside this automated gate.
It does not automatically regenerate baseline evidence or publish artifacts.
The [release checklist](RELEASE_CHECKLIST.md) records exact-candidate Desktop,
Remote SSH and standalone smoke tests. Safari/iOS testing is not required for
this release's deliberately narrower support scope.

### 7.1 Distribution contract gate

- Build and run the artifact without runtime access to the development checkout,
  `node_modules`, a CDN, or native OpenSCAD.
- Compile and export valid STL from the packaged core in a clean Node consumer
  and through a browser worker with default asset-location options.
- Serve the artifact beneath a nested URL, with the host page at a different
  directory depth, and verify module-relative worker, WASM, and font loading.
- Exercise named includes, imported assets, bundled text fonts, and existing
  opt-in roof support without weakening existing capability restrictions.
- Run the packaged CLI and studio with their established behavior preserved.
- Type-check public declarations and example imports.
- Verify retained notices, inventory integrity, and repeatable build inventories.
- Extend existing focused distribution tests rather than introduce a parallel
  test framework.

### 7.2 Preview-window gate

The decisive integration example is a plain HTML page served from a nested
directory that imports the packaged preview entry and displays two independent
models: one read-only and one editable.

Tests MUST verify:

- Both canvases contain actual rendered geometry, not just successful imports
  or empty canvas elements.
- Editing/recompiling, moving the camera, cancelling, or disposing one preview
  does not alter or break the other.
- Read-only source can be selected/copied but not edited; editable source and
  multi-file selections retain in-memory changes.
- Preview, render, reset/fit, keyboard shortcuts, source visibility, and
  touch/keyboard-discoverable controls work.
- An invalid edit retains the previous model and displays located diagnostics;
  stale completions cannot overwrite newer results.
- Download after an unpreviewed edit produces valid final-mode STL matching
  the edited geometry, measured by bounds or volume, not merely file existence.
- Cancellation or failure during export produces no partial download.
- Container resize, narrow layouts, deferred initialization, and disposal
  during active work behave correctly without leaking owned resources.
- All required runtime requests remain within the exported directory, with
  outside requests blocked and no unexpected browser errors.

Browser coverage SHOULD extend the existing Chromium, Firefox, and WebKit
distribution suite. Results MUST distinguish those tests from certification on
shipping Safari/iOS or strict-CSP hosts.
