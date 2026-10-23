# OpenSCAD.js Studio

A browser-based OpenSCAD subset compiler and interactive Three.js viewer. The studio and CLI share the JavaScript evaluator and Manifold WASM geometry engine; browser compilation and STL export run in workers.

## Current Status

The shared API, worker service, studio, embeddable viewer, CLI and private standalone distribution are implemented for the partial `openscad-2026.10.02` profile. The complete local release gate passed on 2026-10-19: **390 root Node/native tests, 336 browser tests (112 each on Chromium, Firefox and WebKit), strict TypeScript declaration checks, 40 extension unit tests, five payload checks and 50 extension Chromium browser tests**. The final standalone tarball and VSIX also passed archive verification. These are Linux Playwright/local-candidate results, not certification of shipping Safari/iOS, actual VS Code extension-host transport, or complete native compatibility.

Use [build instructions](#build-distribution) for the standalone artifact, [capability restrictions](references/CAPABILITY_AUDIT.md) for actual support, and [remaining release checks](#remaining-release-checks) for unfinished work. The [specification](SPECIFICATION.md) distinguishes requirements/roadmap from implemented evidence; [backend contracts and results](BACKEND_FEASIBILITY.md) describe integration and ownership.

**Safari and iOS browsers are unsupported for this release.** Volunteer
compatibility testing/contributions are welcome for a future support decision.
Linux Playwright WebKit remains regression coverage, not Safari/iOS support;
narrow viewport tests do not establish physical-device support. Use the
[release smoke-test checklist](RELEASE_CHECKLIST.md) to record the exact
Desktop/Remote SSH candidate and environments tested.

The [distribution and preview-window specification](DISTRIBUTION_SPECIFICATION.md)
defines the packaging contract and lightweight embeddable preview component.
Both phases are implemented: packaged core/CLI entries, editor, demo, and
independent worker-backed preview windows with optional textarea source editing.

## Run Studio

An original blue-cube [icon study](branding/README.md), modeled in OpenSCAD.js
itself, is available at `/branding/`. Run `npm run build:icon` to regenerate its
transparent PNG sizes from [the SCAD source](branding/icon.scad).

Install dependencies, then serve the checkout over HTTP:

```sh
npm install
npm run build:editor
python3 -m http.server 4173
```

Open `http://localhost:4173`, edit the source, and press **Preview** or `Ctrl+Enter`. The download icon recompiles in final mode and downloads STL; the stop icon cancels active work. Camera state is preserved between previews, with fit, projection, and source-camera lock controls. Runtime viewer, icon, font, and WASM assets are local.

The source editor uses locally bundled CodeMirror 6 with OpenSCAD syntax
highlighting, line numbers, active-line highlighting, bracket matching and
two-space indentation. Tab/Shift+Tab indent/unindent; Enter follows block
indentation. Ctrl+Z (Cmd+Z on macOS) undoes edits, with separate undo history and
cursor positions for each source buffer. Ctrl+Enter or Cmd+Enter previews.
Press Escape, then Tab to move keyboard focus out of the editor without indenting.
Compiler errors and warnings appear as inline underlines and gutter markers;
Console links open the relevant file and source position. Editing clears stale
markers until the next compilation. Highlighting tolerates incomplete source;
autocomplete and code folding are not included in this first pass.
Re-run `npm run build:editor` after changing the editor implementation or its
dependencies. `npm run build` also rebuilds it and includes all editor assets
and dependency licenses in the standalone distribution; no CDN is required.

Use the files/folder icons in the editor header to load SCAD sources and STL assets. Folder loading retains relative paths; individual files load by basename. **Entry** chooses the compiled script and **Edit** chooses the source buffer. Switching files preserves in-memory edits. Auto preview recompiles after edits to the entry or a known dependency; it can be disabled. The plus icon adds missing sources/assets without replacing the project, and the save icon downloads the active SCAD source. Project replacement asks before discarding edited sources. Nothing is written back to your original files automatically.

For the Pico import test example, load `pico.scad`, `parts.scad`, and `import-base.stl`, then choose `pico.scad` as Entry. The imported solid is an original calibration fixture, not a Pico case. STL downloads use the entry basename (`pico.stl`). See the [project-loading contract](BACKEND_FEASIBILITY.md#studio-project-loading) for paths, limits and persistence caveats.

Drag the divider between code and model to adjust their space. On narrow screens,
the panes stack and the divider adjusts their heights. Focus the divider and use
Left/Right (desktop) or Up/Down (stacked) to resize in 2% steps; Shift uses 10%
steps, Home/End choose the usable limits, and double-click restores the default.
Each layout retains its own split across reloads. Minimum pane sizes keep
the editor and viewport usable; resizing does not recompile or reset the camera.

### Viewport inspection

The viewport toolbar provides six axis-aligned camera views, an isometric reset,
zoom, fit, projection, source-camera lock, and wireframe. **Marks** enables world
axes with adaptive ticks; turning **Axes** off also hides marks. The corner XYZ
indicator follows the camera independently. Dimensions (X × Y × Z, mm), solid
volume (mm³), and solid triangle count describe the last successful compilation,
excluding background/debug overlays. Errors retain that model and its metrics.
The camera icon downloads the current rendered viewport as `model-preview.png`
(using the entry basename), including preview annotations but not HTML controls.

**Cross section**, **Measure**, **Animation**, **Customizer**, and **Audit** share a collapsible panel beneath the viewer.
Tabs support Left/Right and Home/End; hiding or switching panels preserves settings.
The tab strip scrolls horizontally on narrow screens, and keyboard selection scrolls
the selected tab into view. The selected tab, desktop/mobile pane proportions,
projection, and axes/marks are saved in browser local storage for this origin.
Project sources, assets, parameters, and presets are not saved automatically.
Blocked storage or invalid saved preferences show a warning; the studio still works.

The footer distinguishes Ready, Modified, busy operations, cancellation, and errors.
An **Out of date** viewport badge identifies geometry from the last successful
preview when source, parameters, time, entry, or experimental options change.
Only a successful preview updates that geometry; exporting or auditing cannot
make a stale viewport current. The collapsible **Console** below the tools shows
errors, warnings, and `echo()` output without covering the model. Each available
source location is a button that opens the corresponding source and cursor position.
Messages replace the previous operation's output and automatically expand the
console; collapse it at any time to reclaim space.

Cross sections cut along X, Y, or Z at a percentage of the compiled bounds, with an
invert option. Cuts, axes, and measurement annotations do not change STL exports.
Measure selects two visible surface points and reports distance and signed axis
deltas in mm. Clipped-away hits are excluded. Optional 0.20/0.30/0.40 mm gap
targets are reference comparisons, not automatic clearance or fit analysis.
Copy downloads no file: it writes typed measurement JSON to the clipboard
(requiring browser clipboard permission). Source edits, successful recompilation,
or slice changes clear measurements.

Audit wraps independently moving solids with unique `audit_part("name")` markers:

```scad
audit_part("fixed") cube(10);
translate([15 - 10 * $t, 0, 0]) audit_part("moving") cube(10);
```

Run 2–20 samples from `$t = 0` through `1` with a 0–100 mm³ overlap threshold.
The audit freezes the project, parameters, experimental options, and source-camera
context and compiles in final mode, leaving the displayed geometry and camera
unchanged. Findings list each part pair, sample times, maximum overlap volume,
and bounds at maximum overlap. At most 32 named parts are accepted; duplicate
names and nested markers are rejected. Cancel stops the worker and retains no
partial findings. The preview audit detects sampled solid-volume overlap only; the CLI audit
(below) also reports touching faces and gaps under a clearance. Neither detects
collisions between sample times. Settings are in memory only;
reference overlays and standalone STEP/3MF viewing remain extension-only.

## Build Distribution

```sh
git submodule update --init --recursive
npm install
npm run build
npm run test:distribution
npm pack ./dist --pack-destination /tmp
```

After a regular `git clone`, initialize the pinned OpenSCAD reference submodule before building; cloning with `--recurse-submodules` does this automatically. The submodule supplies the Liberation font and license used in the artifact. The build produces an ignored `dist/` tree: serve that directory over HTTP for the studio, or pack/install it for the ESM API, viewer and CLI. Required JS dependencies are bundled or vendored locally, UI/geometry fonts and both WASM kernels are included, and relative worker/asset paths are preserved. The artifact has no npm runtime dependencies and does not contain the native reference source, tests, build tooling or the full development dependency tree. It remains a private distribution candidate; no publication is performed. Node 22 is recommended for installation and CLI use.

The packaged public entries are:

```text
dist/
  openscad.js/
    core.js / core.d.ts
    viewer.js / viewer.d.ts
    preview.js / preview.d.ts
    cli.js
    runtime/
  demo.html
  editor.html
  README.md
  package.json
  LICENSE
  THIRD_PARTY_NOTICES.md
  licenses/
  distribution-manifest.json
```

Open `/demo.html` for read-only/editable previews and a core compile/STL example or `/editor.html`
for the full studio. Browser code imports `./openscad.js/core.js` and calls
`createWorkerEngine()` without configuring worker/kernel URLs. Supporting assets
resolve relative to the modules, not the hosting page. Copy the whole
`openscad.js/` directory together. Core imports do not initialize UI or load
Three.js/editor dependencies. The existing lower-level viewer is available from
`./openscad.js/viewer.js`. The ready-made preview component is available from
`./openscad.js/preview.js` (or installed `openscad-js-studio/preview`):

```html
<div id="model" style="height: 400px"></div>
<script type="module">
  import { createPreview } from "./openscad.js/preview.js";
  const preview = await createPreview(document.querySelector("#model"), {
    source: "cube(20);",
    editable: false,
  });
  // When removing the component: await preview.dispose();
</script>
```

Previews initialize when visible, pause hidden drawing, and keep independent
source/camera/worker state. Controls provide preview, render, final-mode STL
download, reset/fit, source, and cancellation. Use `editable: true` for in-memory
textarea edits; Ctrl+Enter/Cmd+Enter previews. Alternatively pass a `project`
with named sources/assets/resolvers; its source selector preserves edits across
files. Errors retain the previous model, and edits mark it out of date.
Await `preview.ready` for the initial attempt and inspect its outcome or
`preview.state`; creation returns before compilation. Explicit operations also
return structured outcomes. Dispose handles explicitly when removing them.
See the [artifact API documentation](scripts/distribution/README.md#embed-a-preview-window)
for lifecycle, input, and hosting details.

Use `node dist/openscad.js/cli.js model.scad -o model.stl` for the packaged CLI.
Installed package exports and the `openscad-js` executable are retained, as are
the old `src/index.js`, `src/viewer/viewer.js`, `bin/openscad-js.js`, and explicit
`vendor/manifold.js` paths for compatibility. The directory index remains a copy
of the studio. Internal `runtime/` paths are not public API. The generated
artifact [README template](scripts/distribution/README.md) documents projects,
cleanup, overrides, language restrictions, and redistribution requirements.

Build from the development checkout with its pinned Liberation font available. The resulting artifact needs neither the reference checkout nor `node_modules` at runtime. `distribution-manifest.json` inventories selected dependency versions, source URLs and file hashes; repeated local builds are checked for identical inventories. Dependency resolution during development remains subject to the existing ignored-lockfile policy.

Distribution tests install a packed tarball offline into a temporary clean consumer, exercise the public API/worker/viewer/CLI and text/roofs, and test nested-path studio/API loading on all three browser engines with all requests outside the artifact blocked. Desktop/mobile screenshots and geometry-pixel changes verify rendering; imports, exports and fonts are exercised. Browser prerequisites are the same as the full test gate below. Run `npm run test:browser -- tests/distribution.spec.js --project=chromium` for a single engine.

Retain the artifact's project license, dependency/font licenses, legal-comment sidecars and third-party notices when redistributing. The [Manifold/roof provenance record](licenses/wasm/provenance.json) pins reviewed runtime inputs and retained embedded-component notices; builds reject changed inputs pending review. Roof outputs were reproduced byte-for-byte. Manifold was traced through an integrity-checked npm archive and its published source/build graph, not independently rebuilt or attestation-signature verified. This bounded review is not legal certification of all project assets. Safari/iOS is unsupported. Strict CSP/deployment integration and a hosted CI run remain separate checks. Self-hosted local assets are supported; service-worker offline installation is not implemented.

## Animation And Customizer

Open the **Animation** tab beneath the viewer. The play/pause control drives `$t`; select time with the slider, numeric input or frame field. FPS is bounded to 1-60 and loop steps to 1-1000. A loop uses `i / steps`, without a duplicate endpoint; manual time can reach 1. Switching tabs or hiding the controls does not stop playback. Playback waits for each worker preview, pauses on errors, cancellation, source edits or hidden views, and preserves the established camera when the source does not author a new one. Source camera assignments still follow the existing camera-lock policy.

STL download uses the selected time and parameters in final mode. The archive icon compiles every frame in final mode into one ZIP with deterministic `model-0000.stl` filenames. It freezes the project/parameter/camera snapshot, retains no more than 64 MiB of STL data, and cancellation or failure produces no partial download. ZIP construction is synchronous and may briefly block the UI near that limit; video encoding is not implemented.

Open the **Customizer** tab beneath the viewer to edit top-level literal numbers, booleans, strings and numeric vectors of 1-4 components in the entry source. OpenSCAD-style comments supply groups, descriptions, ranges and choices:

```scad
/* [Dimensions] */
// Block width
width = 14; // [4:2:30]
shade = "green"; // [green:Green,red:Red]
centered = true;
travel = [20, 0, 0]; // [-40:1:40]
/* [Hidden] */
internal = 2;
```

Controls pass structured overrides to compilation without rewriting SCAD. Computed defaults, special variables and nested assignments are not exposed. Presets are per entry and support save/delete, OpenSCAD `fileFormatVersion: "1"` JSON import/export, and reset to source defaults. Imported values are typed literals, not executable expressions. Up to 128 parameters/presets and 1 MB of preset JSON are supported. Parameter edits recompile independently of the source auto-preview checkbox. Settings remain in memory until downloaded; project replacement asks before discarding them. Choose **Animated block** for a working parameter/time example.

## Compile STL

Run the CLI directly from this checkout, without a browser or native OpenSCAD:

```sh
./bin/openscad-js.js model.scad -o model.stl
npm run cli -- model.scad -D 'width=40' --export-format=asciistl -o model.stl
./bin/openscad-js.js - -o - --diagnostics=json < model.scad > model.stl
```

The package also declares the `openscad-js` executable. After installing or linking the package into a writable npm prefix (`npm link`), use `openscad-js model.scad -o model.stl`. No global installation or PATH change has been performed automatically.

Binary STL is the default. `-D` expressions can reference script variables; repeat `-D` and `-I` for overrides and explicitly authorized library directories. The input directory is the default project root; use `--root` when includes legitimately refer to a wider project. File output is atomic, and diagnostics/echoes go to stderr. See `./bin/openscad-js.js --help` and the [CLI contract](BACKEND_FEASIBILITY.md#node-filesystem-and-cli) for limits, exit codes, stdin/stdout, and cancellation. The CLI and studio use the same supported language subset.

### CLI interference audit

`--audit` runs the same `audit_part` check from the command line, which also
lets an assistant such as Copilot run it without the preview:

```sh
./bin/openscad-js.js --audit model.scad --audit-samples 5
./bin/openscad-js.js --audit model.scad --audit-times 0,1 \
  --audit-pose 'curl=0; spread=0' --audit-pose 'curl=1; spread=1' \
  --audit-clearance 0.2 --audit-format json -o audit.json
```

Each `--audit-pose` is a `;`-separated list of `-D`-style overrides, and every
pose is combined with every sampled `$t` (`--time` when no samples or times are
given). Pairs are reported as **interference** (overlap above `--audit-epsilon`,
default 0.0001 mm³, with maximum volume and bounds), **clearance** (separate but
closer than `--audit-clearance` mm; off by default), or **contact** (touching
within 0.001 mm, e.g. stacked link layers). The exit code is `4` when any
interference is found, `0` otherwise; up to 64 parts and 1000 frames are
accepted. Use `-q` to keep per-frame echoes out of stderr.

## Set Up Native Tests

The native reference is a development/test dependency, not part of the deployed JavaScript distribution. On Debian/Ubuntu (CI uses Ubuntu 24.04), initialize its pinned submodules, install build dependencies, and build a headless reference with:

```sh
npm run setup:reference -- --install-deps
```

Package installation uses `apt-get` and requires root or passwordless `sudo`. To install packages interactively, run the dependency commands from [CI](.github/workflows/verify.yml) yourself, then omit `--install-deps`. Without that flag, setup never installs system packages:

```sh
npm run setup:reference
```

The script builds locally at `references/openscad/build/openscad`, checks the pinned version and experimental CLI support, and does not install OpenSCAD globally. It clears the old dependency-library environment and cached GMP selections that can cause `libhogweed` symbol errors. Existing build generators are retained; new builds use Ninja. A checkout at a different revision or with tracked source changes is rejected rather than overwritten. Other platforms require equivalent build dependencies and Bash.

`REFERENCE_BUILD_JOBS=1` reduces build memory use (default: 2, maximum: 4). `REFERENCE_BUILD_DIR` selects another build directory, but the current native tests expect the default binary path. Setup does not install npm dependencies or Playwright browsers; follow the test prerequisites below. Compilation may take substantial time and memory.

## Test

```sh
npm install
npm run test:all
```

`test:all` runs the Node/native suites (including clean packed-consumer checks), all three browser projects (four workers total), and strict public TypeScript declaration checks in sequence, stopping at the first failure. `npm test` invokes browser tests directly; run `npm run build` first so distribution fixtures exist. Individual aggregate stages are `test:node`, `test:browser`, and `test:types`; npm's `test:browser` automatically builds the artifact. Node tests disable forced terminal colors so child-process output comparisons stay stable.

Use Node 22 for the full gate. It requires installed dependencies, Playwright Chromium/Firefox/WebKit (`npx playwright install chromium firefox webkit`), their host libraries, Python 3 for the automatically managed HTTP server, and the pinned native OpenSCAD build at `references/openscad/build/openscad`. On a supported Linux host, `npx playwright install --with-deps chromium firefox webkit` also installs OS dependencies and may require administrator privileges. Native tests are required rather than silently skipped. Select Node 22 before installing dependencies and running the gate; older runtime measurements in development reports are historical evidence, not the release setup instructions.

In a displayless Linux session, Firefox may fail to create the WebGL2 context required by the viewer, leaving the studio at `LOADING`. With Xvfb installed, run the gate using a virtual display:

```sh
xvfb-run -a npm run test:all
```

The native reference must be built with `-DEXPERIMENTAL=ON`, as configured by the reference build script; otherwise roof and object conformance checks fail because native OpenSCAD rejects `--enable`.

Run a single engine with `npm run test:browser -- --project=firefox` (or `chromium`/`webkit`). [CI](.github/workflows/verify.yml) runs Node/native/types and a three-engine browser matrix separately, provisioning the pinned reference checkout explicitly. A separate extension job builds both packages, runs extension unit/payload/Chromium checks, packages and inspects a VSIX, and uploads its verified CI candidate/checksum plus available failure traces. It does not publish or certify a manual host smoke pass. The [headless oracle build script](scripts/build-reference.sh) requires native build dependencies; `REFERENCE_BUILD_DIR` can select a separate build directory. See [browser parity and CI notes](references/LANGUAGE_CONFORMANCE.md#cross-browser-parity-and-ci) for scope and caveats.

The Playwright suite runs bundled examples and OpenSCAD compatibility fixtures through the real browser renderer. Completed verification stages and their bounded scope are recorded in the [compatibility and robustness plan](references/LANGUAGE_CONFORMANCE.md#compatibility-and-robustness-plan); additional coverage is not implied by a green suite.

Focused suites cover the shared core, CLI, worker service, and viewer:

```sh
npm run test:backend
npm run test:evaluator
npm run test:language-reference
npm run test:import
npm run test:text-roof
npm run test:project
npm run test:service
npm run test:worker
npm run test:cli
npm run test:viewer
npm run test:studio-project
npm run test:backend:browser
```

### Complete local release gate

After installing root and extension dependencies, Playwright's three browsers
and host libraries, and building the pinned native reference:

```sh
npm run release:check
```

This is the repeatable **local candidate** gate, broader than `test:all`.
It checks prerequisites, cleans generated outputs, builds the standalone
distribution, runs all root Node/native tests, strict declarations and all
three browser projects, then builds and tests the extension (unit,
payload/source-license checks and Chromium webview harness). Finally it
packages and inspects a real VSIX and standalone npm tarball, comparing
archive contents to the built outputs/inventories. Browser suites use two
workers; on displayless Linux the gate automatically uses `xvfb-run`.
It refuses to reuse a running test server on ports 4173/4189.

The command stops on failure and returns a nonzero status. Logs and a
stage-by-stage `report.json` persist under ignored `.release-check/`.
A successful run also leaves `extension.vsix`, the standalone `.tgz`, and
`SHA256SUMS` there. Old checksums/candidate files are invalidated when a new
run starts; partial outputs after a failure are **not** validated releases.
Concurrent gate runs are rejected by `running.lock`. After an interrupted
run, verify its recorded PID is no longer running before removing that exact
lock file and retrying.

For a build-only reset, without running tests:

```sh
npm run clean && npm run build
npm --prefix extension run build
```

Use `&&`, not `;`, so a failure stops the sequence. `clean` removes only
enumerated generated distribution/editor/extension outputs and test reports.
It preserves dependencies, the native reference/build, OCCT download cache,
tracked branding/roof binaries, source fixtures, local user files and previous
release-gate results. It does not install dependencies, rebuild native tools,
regenerate baselines, alter Git history or publish anything.

The VSIX uses normal README-link rewriting for the planned
`https://github.com/jamesonmccowan/openscad.js` repository and `main` branch.
The publisher identity is still provisional until a Marketplace publisher is
registered. A green local gate does not clear that publication blocker,
replace installed Desktop/Remote SSH extension-host
smoke tests, run hosted CI, inspect the eventual fresh-history publication,
or certify physical mobile devices or arbitrary CSP/deployment environments.
Safari/iOS is explicitly unsupported, not a pending release gate.

Browser tests require a Playwright-supported Node version and the selected engines (all three by default). npm's `test:browser` command builds the standalone artifact first; direct Playwright invocations of distribution tests require `npm run build` beforehand. Native conformance checks require the pinned local OpenSCAD 2026 build. See [BACKEND_FEASIBILITY.md](BACKEND_FEASIBILITY.md) for setup, results, limitations, and the geometry adapter API. The adapter implements sphere/cylinder/cone tessellation with scoped `$fn/$fa/$fs`, resolves the recorded default-sphere mismatch, and supplies the studio through the worker service.

The [public ESM API](src/index.js) provides asynchronous virtual-project compilation, `include`/`use` resolution, structured diagnostics, owned mesh results, and final-mode ASCII/binary STL export, with [TypeScript declarations](src/index.d.ts). The studio uses this service. See the [public service contract](BACKEND_FEASIBILITY.md#public-service-contract), [viewer integration](BACKEND_FEASIBILITY.md#studio-and-viewer), and [core limitations](BACKEND_FEASIBILITY.md#reusable-core-api).

[The capability audit](references/CAPABILITY_AUDIT.md) records tested restrictions and known discrepancies for every advertised family. [Captured corpus baselines](references/LANGUAGE_CONFORMANCE.md#captured-baselines) record preview/final outcomes, native STL metrics, configuration and hashed inputs. Generate them with `node scripts/assess-models.js --baseline`; experiments require explicit `--enable=roof` or `--enable=object-function`. Successful bounds/volume comparisons are not shape-equivalence claims.

[Malformed/boundary regressions](references/LANGUAGE_CONFORMANCE.md#malformed-and-boundary-coverage) use shared deterministic cases in direct and worker hosts, including cyclic/oversized bindings, prototype-like names, malformed syntax and STL inputs, exact limits and recovery. They run in `test:all`; they are not a complete sandbox or memory-budget guarantee.

`npm run measure:resources -- --cycles=30` measures bounded worker startup, compile/export, observed process memory, cancellation, restart and cleanup. Add `--output=references/resource-baseline.json` to save a snapshot. See [resource measurements and caveats](references/LANGUAGE_CONFORMANCE.md#resource-and-lifecycle-measurements); RSS is not a WASM heap meter or a leak-free guarantee.

`createWorkerEngine()` moves compile/export work into Node or browser workers with bounded scheduling, latest-job supersession, hard cancellation/replacement, and transferable buffers. See the [worker-backed API](BACKEND_FEASIBILITY.md#worker-backed-api) for browser asset configuration, deadlines, cleanup, and result invalidation on restart.

## Studio syntax

- Lexical variables, dynamic specials, arithmetic, vectors/matrices, ranges, and indexing
- User modules/functions with positional, named, and default parameters
- `if`, range `for`, `intersection_for`, `let`, recursion, and module `children()`
- `cube`, compatible `sphere`/`cylinder`/cones, and 2D profiles with `linear_extrude`
- `rotate_extrude`, 2D/3D `hull`, 3D `minkowski`, and 3D `projection`
- 2D `offset`, `fill`, and 2D/3D `resize`
- `translate`, `rotate`, `scale`, `mirror`, and `color`
- `union`, `difference`, and `intersection` using Manifold CSG
- Common trigonometric and mathematical functions, including `cross`, `lookup`, `search`, `chr`, `ord`, `rands`, and `version_num`; bounded `dxf_dim()` and `dxf_cross()` helpers for authorized ASCII DXF files
- Anonymous `function(...) expression` closures with captured scope/default parameters
- First-class function calls, including immediate closures, indexed/member values, and built-ins
- Experimental object methods with native-style explicit `this` parameters; experimental vector swizzling (`.zyx`, `.xz`, `.w`) requires `--enable=vector-swizzle` or `experimental: ["vector-swizzle"]`
- `parent_module()` stack lookup and experimental object values (`is_object()` is always available)
- `textmetrics()` and `fontmetrics()` for bundled and runtime-loaded font faces
- Experimental `import()` for JSON data with project-relative paths (`--enable=import-function` or `experimental: ["import-function"]`)
- `$fn/$fa/$fs`, source `$vp*` camera settings, comments, `echo`, and preview modifiers

`linear_extrude()` defaults to height 100, matching the pinned native profile; `h` is an alias for `height`. Positional parameters follow the 2026 order (height, v, scale, center, twist, slices, segments), not the old subset's order. Prefer named parameters. Direction `v` and nonzero `segments` are not implemented and fail explicitly; twisted extrusion still requires explicit slices.

This remains a partial implementation. STL imports, indexed polyhedra, bounded list comprehensions, and printable Latin text using bundled Liberation Sans/Serif/Mono regular, bold, italic, and bold-italic faces or runtime-loaded fonts are supported. `dxf_dim()` supports selected dimension entities, and `dxf_cross()` intersects two-point DXF line paths; both require authorized ASCII DXF inputs. Unicode text and complex shaping remain unsupported. Explicitly seeded `rands()` matches the native MT19937 sequence; unseeded calls advance a shared runtime stream, and the API `randomSeed` option makes its initial state reproducible per evaluation. The default initial seed source is runtime-specific and does not reproduce native time/process seeding. `minkowski()` currently accepts 3D children only; projection produces a 2D profile, typically used with `linear_extrude`. Named labels on built-in functions are accepted but, matching the pinned native evaluator, values remain in source order rather than being reordered by label. The studio loads multi-file SCAD/STL projects and uses the same `include`/`use` and asset resolution as the API. `roof()` is explicitly experimental: enable **Experimental roof** in the studio, `--enable=roof` in the CLI, or `experimental: ["roof"]` in the API. Distinct `voronoi` (default) and `straight` methods support concave profiles, holes and disconnected regions, including the numeral stencil sample. Roofs remain bounded and approximately native-compatible, not an unrestricted compatibility claim. See [roof verification and rebuild instructions](BACKEND_FEASIBILITY.md#experimental-roof). Standalone 2D preview and other features remain gaps. Unsupported syntax produces located diagnostics without replacing the previous model.

`object()` and `has_key()` require `object-function` opt-in (`experimental: ["object-function"]` or CLI `--enable=object-function`). The current subset supports map/list merge, named assignment, one-key deletion entries, property/string-key reads, and function-valued methods that bind their receiver to an explicitly declared `this` parameter. Structured API `defines` accept nested JSON-like object values. Experimental `import()` requires `import-function`; it reads JSON from project files, assets, or the authorized resolver, converts JSON null to `undef`, and records imported files as dependencies. Missing or malformed JSON warns and evaluates to `undef`. Non-JSON data formats and import-function behavior beyond JSON are unsupported.

Text metrics and geometry share runtime font resolution, in addition to bundled Liberation Sans, Serif, and Mono regular/bold/italic faces. Specify styles as `Family:style=Bold Italic`. Text remains printable Latin ASCII/LTR; Unicode and complex shaping are unsupported. Outline bounds can differ slightly from native FreeType grid fitting.

### Runtime fonts

Fonts are loaded at runtime, not compiled into the implementation. `Arial:style=Bold Italic` works when that face is available through one of the following mechanisms:

- **CLI:** installed fonts are discovered by default. Linux uses `fc-match` (fontconfig), with standard-directory scanning if unavailable; Windows and macOS scan standard system/user font directories. Add recursive `.ttf`/`.otf` directories using repeatable `--font-dir DIR`. Use `--no-system-fonts` to restrict discovery to those directories and bundled fonts. Directories are matched by embedded family/style, not filename; symlinked directories/files are not scanned.
- **VS Code:** installed fonts are read on the extension/workspace host. Open the preview's **Fonts** tab for a searchable list of bundled and parser-readable host faces, exact SCAD font assignments, **Copy**, and **Refresh**. Add `openscadJs.fontDirectories` or disable discovery with `openscadJs.systemFonts`. With SSH, WSL or containers, the host is not necessarily the PC displaying VS Code; the panel labels remote hosts. Client-PC font forwarding is not implemented. See [extension font settings](extension/README.md#fonts).
- **Browser studio:** **Load font files** accepts `.ttf`/`.otf` files. **Use local fonts** explicitly requests access through `queryLocalFonts()` where supported; HTTPS/localhost and browser permission are required. Font-loading errors show contextual help explaining secure-context/browser/permission limits, all 12 bundled Liberation face names, and buttons for file loading and local access where available. The original diagnostic remains visible, no source is changed, and the help clears when the error clears. Fonts stay in page memory, are not uploaded, and must be loaded again after a page reload.
- **API:** `CompileRequest.fonts` maps font names to `Uint8Array`/`ArrayBuffer` data. Alternatively, `fontResolver(name, {signal})` returns bytes asynchronously (or `undefined` if absent); both direct and worker engines support it. Node callers can import `createSystemFontResolver` from `openscad-js-studio/node/fonts` and pass its result as `fontResolver`; the returned function's `listFonts({signal})` method enumerates bundled and parser-readable faces with `family`, `style`, `name`, and `source` (`bundled`, `directory`, or `system`). Create a fresh resolver to rescan directories. The core never scans the filesystem on its own.

```js
const result = await engine.compile({
  files: { "main.scad": 'linear_extrude(1) text("Hello", font="Arial:style=Bold Italic");' },
  fonts: { "Arial:style=Bold Italic": fontBytes },
});
```

Names/styles are case-insensitive, with `Regular` as the default style. Supplied API font data takes precedence over bundled faces; bundled faces take precedence over resolver lookups. There is no automatic Arial-to-Liberation substitution or synthesized bold/italic. Missing faces and malformed/unsupported supplied font data fail explicitly and preserve the previous preview. Unparseable files encountered during directory discovery are reported as warnings and skipped; CLI `--hardwarnings` promotes those warnings to failure. Use appropriately licensed fonts. Font collections (`.ttc`), variable-font axes, color/bitmap fonts, and formats beyond what the existing OpenType parser can read are not supported. Runtime font bytes default to a 20,000,000-byte total per compile (`maxFontBytes` / CLI `--max-font-bytes`), with at most 128 loaded faces. Directory scans are bounded to 4096 directories, 4096 font files, and 16 levels.

If Arial is unavailable, explicitly select `Liberation Sans:style=Bold Italic` as an alternative. `text()` requires a string and reports non-string values separately from unsupported characters. When indexing a list of labels, use `for (i=[0:len(labels)-1])` for a nonempty list: OpenSCAD ranges include both endpoints, so `[0:len(labels)]` also visits an out-of-range index and passes `undef` to `text()`.

`cross()` returns a scalar determinant for two 2D vectors and a vector for two finite numeric 3D vectors. Matching the pinned native profile, nonnumeric 2D components become zero; 3D invalid/nonfinite components, mismatched dimensions and incorrect argument counts warn and return `undef`. Tested `cross()` diagnostics match native message text for argument conversion, vector size, component type, NaN, and infinity. `norm()` requires one numeric vector, returns zero for an empty vector, and preserves native sum-of-squares overflow/NaN behavior rather than JavaScript coercion. `rands()` matches tested native validation and recovery warnings. Nonfinite echoes and `str()` use `inf`, `-inf` and `nan`; warning wording outside the covered built-ins remains partial.

## Conformance References

[references/language_features.scad](references/language_features.scad) is a selectable assertion/echo/geometry reference for supported language features. [references/language_features_pending.scad](references/language_features_pending.scad) separates deprecated/restricted/experimental cases, which now have initial implementations. Run `npm run test:language-reference` for explicit/native expectations, `npm run assess:models` for source assessment, or `npm run assess:models -- --compile` for actual final-render checks. Current restrictions and next priorities are documented in [references/LANGUAGE_CONFORMANCE.md](references/LANGUAGE_CONFORMANCE.md).

## Remaining Release Checks

- Keep the reviewed Manifold/roof input hashes and embedded notices current; finish any remaining selected generated/vendored asset review. The current inventory is not legal certification.
- Verify real deployment: iframe embedding, strict CSP, worker/WASM base paths in the intended host, and VS Code webviews before claiming support there.
- Safari/iOS is excluded from this release's support scope. Volunteer testing
  may inform future support, but is not a blocker for this release. Actual
  mobile devices remain unverified; WebKit and mobile-sized screenshots do not
  establish device support.
- Record Desktop and Remote SSH results against the exact final VSIX using the
  [release checklist](RELEASE_CHECKLIST.md); prior exploratory use is not
  automatically a pass for a rebuilt candidate.
- Explicitly accept the partial-profile release scope and its documented omissions. Keep publication/private-package decisions separate from building a local artifact.
- Run hosted GitHub Actions after a future push; this verification is deliberately deferred while the repository stays local.

Broader font shaping, standalone 2D preview, additional language/geometry families and file formats, project persistence and service-worker offline installation remain roadmap work, not hidden promises of this subset. The VS Code extension is implemented; Marketplace publication and structured extension-host smoke checks remain release tasks. Longer-run memory accounting and job-wide allocation budgets also remain open. No corpus/benchmark snapshot is silently recaptured by a documentation refresh.

## License

Original OpenSCAD.js Studio code and documentation are licensed under the [Apache License 2.0](LICENSE), permitting reuse, modification, and redistribution, including commercial use, subject to its terms.

Third-party dependencies, the upstream OpenSCAD reference tree, and externally sourced examples, fixtures, fonts, and other assets retain their respective licenses. The project license does not relicense those materials. See the [licensing specification](SPECIFICATION.md#13-licensing-and-distribution) for the current review and distribution requirements.

The [source-asset review](references/README.md) records authorship confirmations
for retained models and fixtures, the upstream submodule boundary, and removed
research/slicer exports. Samples are development inputs, not part of the
standalone runtime corpus. The original synthetic G-code fixture is for viewer
testing only, not printing. Current-tree cleanup does not remove old Git
history; inspect the actual fresh-history publication separately.

The bundled roof backends have [third-party notices](THIRD_PARTY_NOTICES.md). Retain them when distributing the generated roof assets.
