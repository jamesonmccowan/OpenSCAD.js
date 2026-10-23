# OpenSCAD.js Project Specification

Status: requirements and roadmap with an implemented, explicitly partial distribution candidate. This is not a full-conformance or release-certification claim.

Prepared: 2026-10-02. Implementation status refreshed: 2026-10-04.

## 1. Purpose

Create an embeddable, browser-capable OpenSCAD implementation with a shared compilation engine usable from JavaScript, a command-line tool, and a future VS Code extension. Users must be able to edit SCAD, preview models, and export printable STL without installing desktop OpenSCAD or relying on a remote compilation service.

The deliverable is a reusable compiler and viewer, not just a standalone editor or a port of the desktop interface. A model must work in a small embedded display, a full browser workspace, a headless Node.js process, and eventually a VS Code webview.

This document uses **MUST**, **SHOULD**, and **MAY** as requirement levels. Requirements apply when their assigned milestone ships. Proposed APIs and numerical targets remain subject to review. No implementation work is authorized by this document alone.

## 2. Reference Baseline and Evidence

| Reference | Role and limitations |
| --- | --- |
| Local `./references/openscad/build/openscad --version`: OpenSCAD 2026.10.02 | Primary executable oracle, built from the latest main branch at the pinned revision below. This is a development build, not a claim of an official stable release. |
| Local `./references/openscad/build/openscad --help` | Verified camera forms, projection, definitions, exports, animation, backend selection, JSON summaries, warning controls, and available experimental flags. |
| Vendored OpenSCAD source, revision `7d44e5796cd489bcbfb8cef0720abe4db60ce35e`, dated 2026-10-02 | Source reference corresponding to the local 2026 build; explains the primary oracle's behavior. |
| System `openscad`: OpenSCAD 2021.01 | Secondary historical/regression oracle only; does not define the target when it disagrees with 2026.10.02. |
| [Studio entry point](openscad.js) and [project overview](README.md) | The former prototype has been replaced by a worker-backed controller; implementation support claims do not define native compatibility. |
| [Existing tests](tests/interpreter.spec.js) and [doughnut fixture](tests/fixtures/doughnut.scad) | Browser smoke tests and a useful regression model, not a complete conformance suite. |
| [Language reference](references/language_features.scad) and [capability audit](references/CAPABILITY_AUDIT.md) | Maintained feature fixtures and evidence; semantic claims require verification against the pinned version. The former research export and local cheat sheet copy have been removed. |
| [Upstream examples](references/openscad/examples) and [test data](references/openscad/tests/data) | Candidates for a versioned compatibility corpus, subject to license review. |

The source revision above was read from the vendored repository. The [historical sample directory](references/scad%20sample%20files/README.md) is present and has a 13-model assessed corpus with hashed preview/final baselines. Four originals are rejected by both parsers; they are preserved rather than silently corrected. See [corpus results and limitations](references/LANGUAGE_CONFORMANCE.md#captured-baselines).

Reference priority MUST be explicit: the pinned 2026.10.02 executable establishes target behavior; matching source and upstream tests explain it. When 2021.01 and 2026.10.02 disagree, the project MUST follow 2026.10.02 unless a serious problem is demonstrated. An exception requires a reproducible case, documented impact and proposed behavior, a regression test, and user approval; it MUST NOT become an undocumented fallback to 2021.01. Disagreements become recorded compatibility cases, not guessed semantics.

Oracle commands MUST use `./references/openscad/build/openscad` explicitly rather than an ambiguous `openscad` from `PATH`. Test records MUST capture version, source revision, relevant build configuration, backend, and enabled experimental features. Geometry comparisons SHOULD select `--backend=Manifold` explicitly, matching the new build's advertised default; CGAL comparisons are supplementary where available. Later upstream updates require a deliberate baseline revision and regression review, not automatic tracking of moving main.

The verified build advertises `--enable` flags for `roof`, `input-driver-dbus`, `lazy-union`, `vertex-object-renderers-indexing`, `import-function`, `object-function`, `predictible-output`, `vector-swizzle`, `discretization-by-error`, `ai-features`, and `unicode-identifiers`. Availability does not mean enabled or selected for this project. The initial baseline uses no explicit `--enable` flags; optional feature sets MUST be named and recorded individually, not enabled indiscriminately with `--enable=all`. Desktop-only features are not automatically browser requirements.

### 2.1 Historical Prototype Findings

These findings describe the replaced prototype, not the current worker-backed
implementation. Current support and restrictions are recorded in the
[capability audit](references/CAPABILITY_AUDIT.md).

- Parser, evaluator, Three.js scene construction, editor controls, and page startup share one module; importing it requires a DOM and WebGL.
- It implements a useful subset but lacks core practical features such as user functions, conditionals, indexing, file inclusion, 2D geometry, extrusion, and STL export.
- Assignments execute sequentially instead of implementing OpenSCAD's scope-level binding behavior; `$fn` mutates interpreter-wide state rather than remaining scoped.
- CSG operands are flattened into descendant meshes, losing some child boundaries. A module or transform producing several meshes cannot generally be treated as several independent subtraction operands.
- `%` is only classified on immediate returned objects; nested propagation and final-export exclusion are not comprehensively specified or tested.
- The original renderer lacked conformance checks for color nesting/alpha and scalar/Euler rotation. First-valid outer color precedence is native behavior, not inherently a bug; cylinder/cone endpoint orientation required a reference test.
- Every successful compile resets the camera; bounds fitting does not account fully for narrow viewport aspect ratios.
- Dependencies load from runtime CDN URLs, and tests mainly assert successful compilation or mesh counts.

The implementation MAY reuse verified portions or restart the core. Existing fixtures SHOULD be preserved, but a test's incidental mesh count MUST NOT prevent a more correct representation.

## 3. Product Scope

### 3.1 Required experiences

| Host | Required outcome |
| --- | --- |
| Browser studio | Edit local SCAD projects, inspect diagnostics, preview/render, adjust parameters and camera, animate, and download STL. |
| Embedded viewer | Render source or a compiled preview into a host-owned element of arbitrary practical size, without forcing an editor or page layout. |
| JavaScript consumer | Compile and export through a documented asynchronous API without constructing a viewer. |
| Node.js CLI | Compile `.scad` and its dependencies into STL without DOM, GPU, browser automation, or the native OpenSCAD executable. |
| Future VS Code extension | Reuse the same engine, diagnostics, viewer, and exporter through workspace and webview adapters. |

### 3.2 Non-goals for the first release

- Exact reproduction of the desktop GUI, OpenCSG internals, or CGAL algorithms.
- Byte-identical STL, triangle ordering, or raster output compared with native OpenSCAD.
- All development-snapshot language features or complete parity with every upstream CLI switch.
- Remote hosting, accounts, collaboration, a cloud compilation dependency, or a language server.
- Video encoding, STEP/parametric B-rep export, or editing geometry directly in the viewport.

Full coverage of the pinned target's non-experimental SCAD language is a roadmap objective, not a claim attached to an early subset release.

## 4. Compatibility Contract

The engine MUST expose its own version, a named language profile, kernel/backend identity, and a machine-readable feature manifest. A capability is `supported`, `partial`, `unsupported`, or `experimental`, with restrictions and applicable tests. Public support claims MUST identify the profile and limitations.

The initial profile MUST target the pinned OpenSCAD 2026.10.02 build, provisionally named `openscad-2026.10.02`. Its default non-experimental behavior is the baseline. Features requiring experimental flags belong in explicit opt-in capability sets for that profile and are prioritized separately; newer non-experimental features MUST NOT be excluded merely because they were absent in 2021.01. A legacy 2021.01 profile MAY be added later but is not required. OpenSCAD's `version()` and `version_num()` MUST describe the selected compatibility profile; engine build information belongs in the host API.

Unknown syntax or unavailable functionality MUST yield a useful diagnostic rather than a successful substitute shape. Native behaviors that legitimately warn and continue, such as some undefined-value or unknown-call cases, MUST be distinguished from fatal failures and tested against the selected oracle. Strict mode MAY promote warnings to failures.

### 4.1 Language and evaluation

The pinned target's language inventory includes:

- Tokens, comments, numbers, strings and verified escapes, identifiers, source spans, and Unicode handling.
- Numbers, booleans, strings, vectors, distinct range values, `undef`, and special numeric values.
- Arithmetic and precedence, degree-based trigonometry, comparisons, short-circuit logic, ternary expressions, indexing, vector aliases, and vector/matrix arithmetic.
- Scope-level last-assignment behavior, lexical bindings, declaration lookup, shadowing, and dynamically inherited `$` variables. Native edge cases, self-reference, defaults, and file scopes require explicit fixtures.
- User modules and functions, named/positional/default arguments, recursion, and module child access through `children()`, legacy `child()`, and `$children`.
- `if`/`else`, `for`, `intersection_for`, `let`, legacy `assign`, and list comprehensions including `each`.
- `include` and `use`, preserving their different top-level execution and definition-import behavior.
- `echo`, `assert`, type predicates, and introspection functions applicable to the profile.

JavaScript coercion MUST NOT define SCAD semantics. For example, an empty vector is false in SCAD Boolean contexts, while JavaScript arrays are truthy. Equality, vector operations, modulo, rounding, indexing, argument binding, range endpoints, and `undef` propagation require their own verified rules.

Argument-order restrictions MUST come from the profile's parser and fixtures, not solely from the collected research. Similarly, nested color precedence and combinations of modifiers require executable reference cases before being claimed compatible.

### 4.2 Built-in inventory

Every built-in MUST have a manifest entry covering signature, defaults, dimensions, version, limitations, and tests. Inventory families are:

| Family | Target inventory |
| --- | --- |
| Numeric | `abs`, `sign`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `floor`, `round`, `ceil`, `sqrt`, `exp`, `ln`, `log`, `pow`, `min`, `max` |
| Vectors and lists | `concat`, `cross`, `len`, `norm`, `lookup`, `rands`, `search`; comprehensions and matrix operators |
| Strings | `str`, `chr`, `ord`, string indexing and search |
| Types | `is_undef`, `is_bool`, `is_num`, `is_string`, `is_list`, `is_function`, and other predicates actually present in the profile |
| Diagnostics/context | `echo`, `assert`, `version`, `version_num`, `parent_module`, `$parent_modules`, `$children` |
| Specialized | `dxf_cross`, `dxf_dim`, font/text metrics, and version-specific data functions, only where applicable |

Objects, object access, anonymous functions, `is_range`, `is_object`, `is_nan`, `is_integer`, `sort`, `reverse`, `mod`, and similar advertised features MUST be checked individually against the 2026.10.02 executable, matching source, and applicable flags. Non-experimental features belong in the target inventory; experimental ones need explicit capability sets. A mathematical concept or documentation entry alone is not evidence that a named built-in exists or is enabled in this build.

### 4.3 Geometry inventory

| Family | Pinned target inventory |
| --- | --- |
| 3D primitives | `cube`, `sphere`, `cylinder`, `polyhedron`, including applicable legacy aliases |
| 2D primitives | `square`, `circle`, `polygon`, `text` |
| Transforms | `translate`, vector and axis-angle `rotate`, `scale`, `mirror`, `multmatrix`, `resize` |
| CSG | `union`, `difference`, `intersection`, `hull`, `minkowski`, `render` |
| 2D operations | `offset`, applicable `fill`, 2D Booleans, holes and winding |
| Dimensional conversion | `linear_extrude`, `rotate_extrude`, `projection` |
| External geometry | `import`, `surface`, with explicit per-format capabilities |

Transforms MUST preserve OpenSCAD's ordered composition and Z-up coordinates. A scalar `rotate(a)` defaults to the native axis; axis-angle `rotate(a, v)` and Euler `rotate([x,y,z])` MUST be independently tested. Reflection MUST preserve correct mesh winding and normals for export.

Booleans MUST operate on semantic child geometry, not an arbitrary flattening of render meshes. `difference()` subtracts subsequent child operands from the first; modules, loops, groups, backgrounds, and empty results MUST retain the grouping rules established by native fixtures. Multiple top-level solids MUST receive the correct final-solid combination before STL export.

Mixed 2D/3D operands, invalid polyhedra, degenerate dimensions, touching faces, coincident surfaces, zero thickness, self-intersections, and non-manifold results MUST have defined outcomes and diagnostics. Invalid solids MUST NOT be advertised as printable just because they can be drawn.

### 4.4 Special variables and tessellation

The core target is `$fa`, `$fs`, `$fn`, `$t`, `$preview`, `$vpr`, `$vpt`, `$vpd`, `$vpf`, `$children`, and `$parent_modules`. Call-level and local overrides MUST remain scoped and inherit according to native special-variable rules.

Verified source defaults include `$fn=0`, `$fa=12`, `$fs=2`, and `$t=0`. Camera defaults MUST be host-context specific: the source's built-in viewport values and interactive camera reset values differ. `$preview` MUST be explicitly set by the evaluation mode, not left to a page-global flag.

For an ordinary full circle of positive radius, the inspected source's adaptive segment rule, excluding newer extensions and degenerate cases, is:

$$
n = \left\lceil \max\left(5, \min\left(\frac{360}{\$fa}, \frac{2\pi r}{\$fs}\right)\right) \right\rceil.
$$

Positive `$fn` bypasses adaptive selection and has a minimum of three segments. Fractional counts, invalid values, primitive-specific discretization, and target-version rounding MUST be oracle-tested. The collected research's suggestion to choose the stricter/larger estimate is not the inspected native rule. `$fe` behavior associated with `--enable=discretization-by-error` MUST be evaluated as an opt-in capability, not silently included in the default profile or rejected simply for being newer than 2021.01.

## 5. Preview, Final Render, and Appearance

The architecture MUST distinguish evaluation mode from presentation. Preview may use approximations where declared; final render/export MUST evaluate the actual solid through the selected kernel. `$preview=true` for preview and `false` for final render/export.

The intermediate representation MUST retain geometry operations, dimensions, transforms, source identity, appearance, and modifier flags. A preview result MUST distinguish solid geometry from background/debug presentation so it cannot accidentally be exported as one combined visible scene.

| Construct | Required behavior |
| --- | --- |
| `color()` | Native named/hex/RGB/RGBA forms, alpha behavior, nesting, and warnings for the selected profile; appearance does not change geometry. |
| `*` | Disabled subtree does not contribute geometry; any parsing or diagnostic behavior follows native fixtures. |
| `!` | Native root-selection behavior, including nested and multiple roots. |
| `#` | Geometry still contributes normally; preview additionally shows the native-style highlighted subtree, including subtracted regions where appropriate. |
| `%` | Ghosted reference geometry in preview, excluded from normal CSG and final mesh export, including when nested under transforms or user modules. |

In the matching 2026 source, an explicitly numeric `alpha` argument overrides alpha parsed from the color vector/string. This MUST be verified through the primary 2026.10.02 oracle rather than inheriting the prototype's opposite precedence. A different 2021.01 result does not override the target. Nested colors MUST be resolved from scene semantics, not by indiscriminately repainting descendant meshes.

STL does not carry standard color/material information. Debug and background styles are presentation classifications, not user materials. A future color-capable exporter MUST document its own appearance policy.

## 6. Architecture and Packaging

### 6.1 Logical components

These are responsibility boundaries, not a requirement to create many packages immediately:

1. **Language core:** lexer/parser, source maps, environments, values, evaluator, capability manifest, and diagnostics.
2. **Project resolver:** virtual files, includes, library paths, binary assets, font resources, and dependency tracking.
3. **Geometry backend:** 2D/3D operations, tessellation, final-solid construction, validation, and mesh serialization.
4. **Compiler service:** asynchronous jobs, cancellation, progress, limits, caching, and transferable results.
5. **Viewer:** camera, controls, preview layers, picking hooks, image capture, and resource lifecycle.
6. **Host adapters:** browser editor, embedding, Node CLI, and later VS Code integration.

Core compilation and STL export MUST be importable without `document`, `window`, Three.js scene startup, or a GPU. The viewer MUST not own language semantics. Browser and Node hosts MUST run the same compiler/profile and share fixtures.

An ESM library with documented TypeScript declarations SHOULD be the primary distribution. Published artifacts MUST use pinned, bundled or locally resolvable dependencies rather than mandatory runtime CDN imports. Compiler instances MUST not share mutable model, scope, camera, or job state.

### 6.2 JavaScript versus WebAssembly

The public product is a JavaScript API. WebAssembly is approved for use where it supports the browser, embedding, Node.js CLI, and future VS Code hosts; there is no pure-JavaScript-only constraint. A JavaScript/TypeScript language implementation with a proven geometry library, potentially WebAssembly, is the recommended starting architecture. Approval accepts the possible additional build toolchain but does not select a backend or approve a full upstream port.

Kernel evaluation MUST cover nested Booleans, coplanar/touching cases, extrusion with holes, reflected solids, browser/Node export, cancellation, and memory cleanup. Following the initial proof, `manifold-3d@3.5.4` is selected for continued implementation. The previous mesh-CSG library is not the selected final-solid backend. A GPL-derived OpenSCAD/WASM port is not part of the agreed Apache-2.0 implementation plan.

Current evidence is recorded in [BACKEND_FEASIBILITY.md](BACKEND_FEASIBILITY.md). The host-independent sphere/cylinder/cone adapter matches the tested native tessellation cases, including scoped special variables. Resource/cancellation measurements, three-engine Linux browser tests and standalone packaging now have recorded results. Comprehensive job-wide memory accounting, real-device/deployment checks and embedded-component license provenance remain open. Backend selection and passing fixtures do not establish complete language conformance or close every release gate.

The reusable parser/evaluator and semantic-tree compiler run in Node and browser workers, with an explicitly partial capability manifest. Typed services resolve virtual `include`/`use` projects and export render-mode STL; the worker supervisor adds scheduling, supersession, cancellation/replacement and transferable results. The Node filesystem/CLI path provides authorized roots/libraries, source-aware overrides, atomic output and diagnostics. The studio shares that core with preview materials/overlays, native source-camera settings, camera persistence/locking, project loading, animation and literal Customizer presets. Experimental roof/object features require explicit opt-in.

`npm run build` creates a private standalone distribution candidate with local JS/WASM/fonts, declarations, licenses/notices and a hashed inventory. Offline packed-consumer installation and distribution-only browser loading are tested. The latest compatibility gate (2026-10-12) passed 368 Node tests, 216 browser tests (72 each on Chromium/Firefox/WebKit) and strict declarations. Broader language/project workflows, appearance edge cases and final distribution provenance remain open. Hosted Actions verification is deliberately deferred until a push; real Safari/iOS, strict CSP and VS Code webviews are not certified. This checkpoint does not imply milestone acceptance or full native compatibility.

A native/WASM port may improve fidelity but changes download size, licensing, build complexity, and runtime integration. No backend may require a server or a system OpenSCAD executable for ordinary use. Native OpenSCAD remains a development oracle only.

### 6.3 Implemented Compiler Contract

API and worker protocol versions are both 1. The following Node example uses
the shared worker service; see [the declarations](src/index.d.ts) and
[service/worker contracts](BACKEND_FEASIBILITY.md#public-service-contract) for
browser initialization, cancellation and ownership:

```js
import { createWorkerEngine } from "./src/index.js";

const engine = await createWorkerEngine({ profile: "openscad-2026.10.02" });
try {
  const result = await engine.compile({
    entry: "main.scad",
    files: { "main.scad": "cube(width);" },
    mode: "render",
    defines: { width: 40 },
    context: { time: 0 },
  });
  try {
    if (result.status !== "success") throw new Error(JSON.stringify(result.diagnostics));
    const bytes = await engine.export(result, { format: "stl", encoding: "binary" });
    console.log(bytes.byteLength, result.volume);
  } finally { result.dispose?.(); }
} finally { await engine.dispose(); }
```

For preview, compile with `mode: "preview"` and pass the successful result
itself to `viewer.setModel(result)`. The viewer copies mesh/overlay data; the
result can then be disposed. There is no separate `result.preview` property.
Empty render results are valid but export fails by default; API `allowEmpty`
or CLI `--allow-empty` explicitly permits a zero-triangle STL.

Results MUST include status, diagnostics, dependencies, mode/profile/backend, timing statistics, and relevant bounds. Preview data and final-solid handles MUST be explicitly distinguished. Failed compilation MUST not masquerade as an empty successful model. Empty valid geometry needs its own documented export policy.

Ownership MUST be documented: results, backend objects, workers, and viewers need disposal or bounded managed lifetimes. A disposed engine or result MUST fail predictably when reused. The exporter MUST reject preview-only results or explicitly recompile in final mode; it MUST NOT export display meshes accidentally.

### 6.4 Work scheduling

Browser compilation SHOULD run off the UI thread. Node SHOULD offer equivalent isolation for bounded jobs. Superseded results MUST not replace newer results. Cancellation MUST interrupt or terminate computation within the declared job policy, including synchronous WASM operations that cannot cooperate.

Caches MUST include source/dependency content, profile, defines, relevant dynamic context, mode, and kernel settings. Dependency-aware optimizations MAY follow correctness; caching only by main-file text is insufficient.

## 7. Files, Libraries, and Parameters

- Browser projects MUST support a main source plus explicitly supplied virtual files and assets; includes and imports resolve against a documented project root.
- Resolution MUST specify relative-file precedence, ordered library roots, normalized paths, cycles, missing files, and dependency reports. `use` MUST not execute a library's top-level geometry.
- Node MAY use a filesystem adapter; embedders and VS Code MUST be able to provide a resolver without granting unrestricted filesystem access.
- Network resolution MUST be opt-in through a host resolver, not implicit fetching of arbitrary paths in untrusted SCAD.
- CLI `-D` values MUST be parsed as SCAD expressions under a documented safe binding policy; API callers MAY supply structured values instead. Native definition precedence requires tests.
- Browser parameter controls SHOULD support Customizer comment metadata, defaults, numeric ranges, booleans, choices, strings, vectors, and named JSON presets in the practical-model milestone.
- Fonts and import formats MUST be explicit dependencies. Missing fonts MUST produce deterministic fallback diagnostics; offline builds must not depend on host-installed fonts or network font availability.

## 8. Viewer and Embedding

### 8.1 Embedding contract

Provide a viewer-only API accepting a host element, compiled preview/model, camera configuration, and control options. It MUST not create a global editor, modify the host page's layout, or require fixed element IDs. Multiple independent viewers MUST work on one page.

Required operations include model replacement, get/set camera, fit, projection switching, resize, image capture, control enablement, and disposal. Events SHOULD include camera change, ready, error, and selection hooks with source-node identity where available.

The host chooses whether controls, grid, axes, background, and overlays are visible. Toolbar-free/read-only embedding MUST be supported. Shadow DOM or scoped styling SHOULD prevent collisions. An iframe adapter MAY additionally expose an origin-checked, versioned `postMessage` protocol; arbitrary cross-origin commands are not permitted.

### 8.2 Camera support already present in OpenSCAD

No new SCAD syntax is needed for the basic camera requirement:

```scad
$vpt = [0, 0, 10];    // View target / translation in OpenSCAD user coordinates
$vpr = [55, 0, 25];   // View rotation in degrees, OpenSCAD convention
$vpd = 140;           // View distance
$vpf = 22.5;          // Field of view in degrees
cube([20, 20, 20], center = true);
```

The primary 2026.10.02 CLI accepts:

```sh
./references/openscad/build/openscad --camera=0,0,10,55,0,25,140 --projection=p -o view.png model.scad
./references/openscad/build/openscad --camera=80,-80,60,0,0,10 --projection=o -o view.png model.scad
```

The first form has seven values: target/translation XYZ, rotation XYZ, distance. The second has six: eye XYZ and target XYZ. These options configure image exports. `--autocenter`, `--viewall`, and `--imgsize` are also available.

The inspected [camera implementation](references/openscad/src/glview/Camera.cc) confirms top-level `$vp*` assignments can set the view and an explicit locked CLI camera prevents those assignments from changing it. Its rotation mapping includes offsets and sign changes; direct Three.js Euler assignment is not a compatibility implementation.

### 8.3 Host Camera Policy

- Camera state MUST be serializable and versioned. It SHOULD expose both native gimbal form and a host-friendly eye/target/up form, with tested conversion and documented roll limitations.
- Projection is an explicit host option, `perspective` or `orthographic`; do not invent a silently supported SCAD projection variable.
- A locked host camera overrides source camera assignments. Otherwise, applicable top-level source assignments update the view; absent assignments preserve the current user view after the first successful fit.
- The host MUST be able to disable source-driven camera changes for embeds. Recompilation and animation MUST not silently reset an established camera.
- `$vp*` reads MUST receive a snapshot of the current evaluation context. Source-driven changes MUST not trigger an unbounded camera/evaluation feedback loop; automatic recompilation on interactive camera changes is opt-in and debounced.
- Fit MUST use viewport aspect ratio, projection, model bounds, and padding. Both very wide and very tall viewports MUST keep the model visible.
- Automatic fit uses final-solid bounds by default; including background/reference geometry is an explicit option.

Camera presets, lock, orbit, pan, zoom, fit, and view persistence are host features. They extend integration ergonomics without changing existing SCAD geometry syntax.

### 8.4 Responsive behavior

The viewer MUST observe its container rather than only the browser window, account for device pixel ratio, and recover from hidden/zero-sized containers and WebGL context loss. Resizing MUST preserve camera intent and projection, not unexpectedly rotate or recenter the scene.

Acceptance sizes include 160x120, 320x240, 800x600, 1200x300, 300x900, and a 375x812 mobile page with the studio layout. Tiny embeds MAY omit controls, but the canvas must remain usable and correctly framed. Keyboard access, accessible control names, and touch gestures are required for exposed controls.

## 9. Animation

Animation MUST drive the existing dynamic `$t` variable, inherited into modules/functions. For `N` loop steps, frames use $t_i=i/N$ for $i=0,\ldots,N-1$, avoiding a duplicate endpoint. Manual time selection MAY include `$t=1`.

The host MUST provide play/pause, FPS, steps, frame/time selection, and scrubbing. Geometry MUST be reevaluated per frame unless dependency-aware caching proves reuse correct. Preview playback MAY skip obsolete frames when compilation is slow, but MUST not accumulate an unbounded queue. Frame-sequence export MUST compile every requested frame with deterministic names and preserve camera settings.

Background tabs and invisible embeds SHOULD suspend playback. Preview animation uses `$preview=true`; an STL captured at a selected time uses final mode. Video encoding is deferred. The [upstream animation example](references/openscad/examples/Advanced/animation.scad) remains a candidate integration fixture, not an implicitly certified model. Functions, indexing, hull, extrusion, comprehensions and offset now have selected implementations; that does not replace fixture-specific verification.

## 10. Command-Line Interface

The executable name is `openscad-js`; it MUST not replace the installed `openscad` command. The package binary is implemented at [bin/openscad-js.js](bin/openscad-js.js); direct checkout invocation and exit codes are documented in the [CLI contract](BACKEND_FEASIBILITY.md#node-filesystem-and-cli).

```sh
openscad-js model.scad -o model.stl
openscad-js model.scad -D 'width=40' --export-format binstl -o model.stl
openscad-js model.scad --time 0.5 -o frame.stl
openscad-js model.scad --diagnostics=json -o model.stl
```

The CLI milestone MUST support input files, documented library paths, `-o`, `-D`, ASCII/binary STL selection, profile selection, diagnostics, warning policy, limits, cancellation, and stdin/stdout conventions. `--help` and `--version` MUST report actual support, not reproduce native options that do nothing.

Binary STL SHOULD be the new tool's default; ASCII and binary MUST be selectable explicitly. Logs and diagnostics go to stderr when stdout carries an artifact. Failure MUST return a nonzero status and MUST not leave a misleading successful or truncated output; filesystem writes SHOULD be atomic. Exit statuses MUST distinguish success, compilation failure, invocation/I/O failure, and cancellation in the CLI reference.

Native switches SHOULD be reused where semantics match. New options such as `--time`, JSON diagnostics, and resource limits MUST be labeled extensions. Customizer presets, dependency output, multiple outputs, SVG/OFF/3MF, and PNG/camera/animation exports are later capabilities, not first-milestone promises.

The primary oracle also offers `--backend`, `--enable`, `-O`/`--help-export`, `--summary`, `--summary-file` for JSON summaries, and `--animate_sharding`. These are reference capabilities, not automatic requirements for the JavaScript CLI. Its machine-readable summaries SHOULD inform conformance tooling; unsupported backend names, export settings, and feature flags MUST NOT be accepted as no-ops. Export format inventories MUST come from the new executable rather than the 2021 help text.

STL compilation MUST never require WebGL. PNG export MAY require a separately declared headless-rendering adapter and MUST not introduce a hidden browser requirement into mesh compilation.

## 11. Future VS Code Integration

The first implementation MUST preserve the interfaces needed for an extension, without shipping an extension initially:

- Workspace-backed resolver with include/library dependencies and trust-aware access restrictions.
- Versioned requests/results with document versions, cancellation, progress, and source diagnostics suitable for the Problems panel.
- Reusable viewer assets deployable under a webview content security policy, without runtime CDNs, inline evaluation, or unrestricted messaging.
- Preview-on-save or debounced edits, camera retention, parameter inputs, and explicit STL export commands.
- Desktop extension workers/processes and a future web-extension host, distinguished by their filesystem capabilities.
- Machine-readable compilation and mesh summaries so agents can inspect results through CLI/API as well as screenshots.

The extension MUST use the same profile and mesh exporter as the library, not maintain a second language implementation. Extension marketplace packaging, language-server features, and agent-specific tools remain a separate project phase.

## 12. Safety, Deployment, and Performance

SCAD is untrusted input. Execution MUST NOT use JavaScript `eval`, arbitrary native shell commands, or unrestricted imports. Resolvers MUST enforce allowed roots and origin policy. Configure limits for source/file size, include depth, recursion, iterations, range expansion, triangles, memory, and compilation time, with identifiable diagnostics rather than a hanging page.

The browser release targets desktop Chromium-based browsers and Firefox, with actual tested versions recorded. Safari and iOS browsers are explicitly unsupported for this release; volunteer compatibility contributions MAY inform future support. Playwright WebKit remains regression coverage, not Safari/iOS certification, and narrow viewport tests do not establish physical-device support. WebGL2 and WebAssembly are declared prerequisites. Unsupported environments MUST report missing capabilities explicitly; literal support for every browser ever released is not a requirement.

Ordinary compilation SHOULD work without cross-origin isolation or shared memory. Any threaded backend requiring COOP/COEP MUST offer a documented compatible fallback or make that deployment restriction explicit before selection. CSP-compatible worker/WASM loading, base URLs, self-hosting, offline assets, and worker paths MUST be documented.

Proposed performance acceptance targets, to be approved after a baseline benchmark:

- A simple primitive compile and warmed preview update completes within 250 ms on the documented reference machine.
- While a heavy job runs, controls remain responsive and cancellation/stale-result handling completes within 500 ms, including worker replacement where needed.
- Repeated compile/dispose cycles and multiple viewers do not retain an ever-growing set of live geometry/backend resources.
- Publish cold-start/download size, parse/evaluate/kernel time, peak memory, and representative model timings. No universal real-time CAD or animation guarantee is implied.

Benchmarks MUST record hardware, runtime/browser, backend, profile, model, facet settings, and cold/warm state. Performance shortcuts MUST not silently change final geometry.

Initial [resource/lifecycle measurements](references/LANGUAGE_CONFORMANCE.md#resource-and-lifecycle-measurements)
record startup, compile/export timing, sampled process RSS, cancellation
settlement versus observed worker exit, restart and disposal. They are
machine/model-specific observations, not proof of leak freedom, a WASM heap
meter or approval of universal performance/memory budgets.

## 13. Licensing and Distribution

Apache-2.0 is the selected license for original project code and documentation, as recorded in the root [LICENSE](LICENSE). The project is intended to remain open source and permit broad reuse, including commercial and proprietary integration. Apache-2.0 does not require downstream modifications to be published or remain open source. Third-party dependencies, reference sources, and externally sourced assets/fixtures retain their own licenses; this decision does not relicense them.

The vendored [OpenSCAD license](references/openscad/COPYING) contains the GPL v2 text and a CGAL linking exception. Individual source headers, bundled libraries, fonts, examples, and fixtures require separate provenance checks; this is not a blanket conclusion about every file.

The initial license review establishes these boundaries, not a complete dependency audit:

| Component / use | Verified license evidence | Project consequence |
| --- | --- | --- |
| Three.js 0.180.0, current viewer dependency | [MIT license at r180](https://github.com/mrdoob/three.js/blob/r180/LICENSE) | Preserve copyright and permission notices when redistributing; does not require our own code to use MIT or be open source. |
| JavaScript bundles, Lucide/Feather icons and fonts | [Scoped notices and source links](THIRD_PARTY_NOTICES.md#javascript-icons-and-fonts) | Discover npm bundle inputs and retain hashed package notices, including both extension Three.js versions. Preserve embedded OpenType helper notices, icon permissions, and unmodified fonts' OFL/reserved-name declarations. |
| three-bvh-csg 0.0.17, historical prototype dependency, no longer shipped | [MIT license at v0.0.17](https://github.com/gkjohnson/three-bvh-csg/blob/v0.0.17/LICENSE) | Historical provenance only; the selected standalone artifact does not include this library. |
| Manifold 3.5.4, selected JS/WASM kernel | [Pinned source and embedded notices](licenses/wasm/provenance.json), [review scope](THIRD_PARTY_NOTICES.md#manifold-354-and-embedded-components) | Retain Apache-2.0 and embedded-component notices. Reviewed binaries are hash-gated; the published build graph is traced, not independently rebuilt or attestation-signature verified. |
| OpenSCAD implementation code, if copied or ported | The inspected [ColorNode source header](references/openscad/src/core/ColorNode.cc) specifies GPL-2.0-or-later plus the CGAL exception | A derivative port cannot simply be relicensed as MIT/Apache-only. Assess the complete combined distribution and corresponding-source obligations, including browser-delivered WASM. |
| Native OpenSCAD used only as a development oracle | Separate reference executable, not shipped as part of the runtime | Running it for comparisons does not by itself require independently authored project code to adopt GPL. Copied source, assets, and fixtures remain separate questions. |
| Retained models, fixtures and source reference materials | [Current-tree provenance review](references/README.md) and author confirmations | Original retained models follow Apache-2.0. The research export and slicer export with embedded printer profiles were removed; the G-code viewer now uses an original synthetic fixture. The upstream submodule retains its own licenses. Old history and the eventual publication tree still require separate inspection. |

The selected Apache-2.0 distribution requires independently authored implementation code and dependencies whose terms permit that distribution. Reproducing behavior does not authorize copying GPL-covered implementation text. Apache-2.0 is compatible with GPLv3, but not GPLv2-only; a GPL-derived source port or combined distribution would require explicit reconsideration and user approval of the distribution plan. The CGAL exception is not a general waiver of OpenSCAD's GPL obligations.

WASM approval does not change dependency licenses. Compiler choice does not automatically license every project output under the compiler's license, but linked runtime code and bundled assets still require review. Generated STL is not automatically GPL merely because a GPL tool generated it; model/library content can have its own license restrictions.

Before choosing a source port, copying implementation code, or distributing WASM, the project MUST assess applicable obligations against the selected Apache-2.0 distribution plan. A behavioral reimplementation, a derivative port, and a redistributed binary are different distribution choices. Dependency notices, source-delivery obligations where applicable, and fixture licenses MUST be tracked. Release artifacts MUST include the project license and required third-party licenses/notices. Legal uncertainty is a release blocker, not a reason to assume a permissive license.

The package name and branding MUST communicate an independent implementation and must not imply upstream endorsement.

## 14. Verification and Acceptance

### 14.1 Test layers

1. **Language fixtures:** values, scopes, dynamic variables, parsing, precedence, functions, loops, diagnostics, and source spans, independent of the viewer.
2. **Native differential tests:** pinned local 2026.10.02 executable, captured `echo`/warnings/exports and useful JSON summaries, explicit backend/feature metadata, and recorded intentional deviations. Optional 2021.01 comparisons document historical differences but do not determine pass/fail for the target profile.
3. **Geometry tests:** bounds, dimensions, connected components, signed/absolute volume where meaningful, winding, watertightness, and Boolean/extrusion adversarial cases.
4. **Export tests:** ASCII/binary STL reimport, finite coordinates, triangle records, final-mode evaluation, transformed solids, and exclusion of background/disabled geometry.
5. **Cross-host tests:** identical inputs through browser and Node produce equivalent semantics and geometry within documented backend tolerances.
6. **Viewer tests:** Playwright screenshots and canvas-pixel checks for nonblank, correctly framed desktop/mobile/embedded scenes; orbit, zoom, resize, camera lock, overlays, animation, and multiple viewers.
7. **Integration tests:** library imports without DOM, CLI status/stdout/stderr, file resolution, workers, cancellation, limits, context recovery, and disposal.

Mesh comparisons MUST not rely on triangle order or counts alone. Tolerances MUST be selected per fixture/scale and documented before declaring a match. Use analytic solids where possible and geometric distance/symmetric-difference measures where volume and bounds alone could conceal a wrong shape. Native STL coordinate precision must be accounted for.

The agreed triage policy accepts a relative volume difference of **0.1% or
less** for a nonempty native solid without a volume-only repair. It does not
waive bounds, shape, topology/kernel status or semantic checks, loosen existing
tighter fixtures, or apply by division to an empty/zero-volume reference.
Approximate cases retain their documented fixture-specific shape tolerances.

The original [Playwright suite](tests/interpreter.spec.js) remains smoke coverage, including its `3 meshes` doughnut expectation; mesh count is not a shape-equivalence claim. [Viewer tests](tests/viewer.spec.js), [native geometry tests](tests/backend.node.test.js) and [distribution tests](tests/distribution.spec.js) add selected overlay, geometry and actual canvas-pixel checks. Upstream fixtures MUST be curated against the pinned 2026 revision and explicit feature sets rather than importing every development test or preserving 2021 behavior indiscriminately.

### 14.2 Mandatory representative cases

- Last assignment wins in a scope; lexical versus dynamic lookup; modules/functions called before declaration; parameter defaults and named arguments.
- Degree trigonometry, negative modulo/rounding, vectors/matrices, truthiness, ranges, Unicode, `undef`, and short-circuit expressions.
- Bottom/top cone radii, scalar and Euler rotation, nested transforms, reflection, and module-generated multi-solid CSG operands.
- Nested `%`, `#`, `!`, `*`, modifier combinations, nested colors, and explicit alpha precedence.
- Scoped `$fn/$fa/$fs`, local primitive overrides, `$preview` branches, and `$t` inheritance.
- Include/use with relative paths, library roots, missing dependencies, cycles, and restricted paths.
- Extrusions with holes/twist/scale, polygon paths, concave geometry, touching/coplanar Booleans, and invalid inputs.
- Source camera versus locked host camera, aspect-aware fit, orthographic views, animation without camera resets, and hidden-to-visible resize.
- Export at a selected time, overlapping top-level solids, stdout binary output, warnings/failures, and cancellation with no partial artifact.

## 15. Delivery Milestones

| Milestone | Scope | Exit gate |
| --- | --- | --- |
| M0: Agreement and feasibility | Record the agreed 2026.10.02 baseline, WASM approval, and Apache-2.0 license; approve experimental feature priorities, backend integration boundary, dependency licensing review, kernel experiment, fixture set, and performance baseline. | Reproducible oracle configuration, written remaining decisions, and a backend proof demonstrating browser and headless Node mesh viability. |
| M1: Correct reusable 3D foundation | Host-independent language core for variables/scopes, modules/functions, conditionals/loops, expressions/indexing, core math; 3D primitives, transforms, CSG, special variables; viewer-only API, basic editor, files/includes, preview/render separation, modifiers/colors, and STL API/CLI. | Curated foundation cases pass in browser/Node; headless STL is valid; responsive embedding/camera/lifecycle tests pass; omissions are in the manifest. |
| M2: Practical model coverage | 2D primitives/Booleans, extrusion, comprehensions, children/let, hull, offset, STL import, Customizer basics, animation, and project workflows. | Agreed real-world model corpus passes semantic/geometry tests and offline browser workflows. |
| M3: Broad target compatibility | Remaining non-experimental 2026.10.02 built-ins and geometry including text/fonts, projection, resize, Minkowski, surface and additional import/export formats as prioritized. | Published target-profile coverage and deviation report; broad adversarial conformance and benchmarks. |
| M4: VS Code integration | Extension adapter, webview packaging, workspace diagnostics/dependencies, preview and export commands. | Extension/browser/CLI use the same core and pass shared fixtures. |
| Later: Optional extensions | Selected experimental capability sets, features beyond the pinned baseline, advanced exporters, frame-image CLI, optimized dependency tracking, and additional host tools. | Each capability has a named profile/extension and tests; no silent dialect drift. |

Milestones are capability gates, not dates. M1 is deliberately a qualified subset; it MUST NOT be marketed as complete OpenSCAD compatibility. M0/M1 foundations and selected M2/M3 families are implemented with documented restrictions; the presence of later features does not automatically close earlier acceptance gates. M4's extension adapter and automated packaging checks are implemented; exact-candidate Desktop/Remote SSH sign-off and Marketplace publication remain release tasks. Current evidence is in the capability audit, corpus baselines and packaging checkpoint; release scope and unresolved gates still require explicit acceptance.

## 16. Decisions for Review

| Decision | Recommendation / open question |
| --- | --- |
| WASM use (decided) | WASM is allowed, including its possible additional build toolchain, provided it supports every intended host. The public API remains JavaScript; the selected backend remains subject to the Apache-2.0 distribution plan. |
| Compatibility version (decided) | Target local OpenSCAD 2026.10.02 at the recorded revision; defer to it over 2021.01 except for documented, user-approved serious-problem exceptions. |
| Experimental feature priorities (selected subset) | Roof and object-function have bounded opt-in implementations and tests. Additional experiments remain separate decisions; no implicit enable-all. |
| Project license (decided) | Apache-2.0 for original code and documentation, with third-party licenses preserved. GPL-derived source reuse requires explicit review and approval of any changed distribution plan. |
| Geometry backend (decided) | Continue with `manifold-3d@3.5.4`, using SCAD-specific primitive tessellation. Remaining robustness, deployment, memory, and licensing checks are release gates. |
| First release boundary | Explicitly accept a named partial-profile release and its restrictions; standalone packaging is implemented but publication and final release approval are pending. |
| Real model corpus (established) | Thirteen samples have hashed preview/final baselines; preserve four native-invalid originals and the documented missing/restricted background asset. Broader shape equivalence remains separate. |
| Camera policy (implemented subset) | Native `$vp*`, locked host override, persistent user view and host-only projection have tests. Broader appearance/device behavior remains unverified. |
| Browser/deployment targets | Desktop Chromium/Firefox are intended browser targets; three Playwright engines on Linux provide regression evidence. Safari/iOS is unsupported for this release. Physical mobile devices, arbitrary strict-CSP/cross-origin embedding and real extension-host sign-off remain separate checks; service-worker installation is unimplemented. Hosted Actions awaits a public push. |
| Performance targets | Initial timings and resource/lifecycle measurements are published; approve hardware/model-specific budgets rather than infer universal guarantees. |

## 17. Source Pointers

- [Studio controller](openscad.js), [browser shell](index.html), [test configuration](playwright.config.js), and [browser smoke suite](tests/interpreter.spec.js).
- [OpenSCAD camera semantics](references/openscad/src/glview/Camera.cc), [viewport context injection](references/openscad/src/core/RenderVariables.cc), and [built-in defaults](references/openscad/src/core/Builtins.cc).
- [Color argument handling](references/openscad/src/core/ColorNode.cc) and [curve discretization](references/openscad/src/core/CurveDiscretizer.cc).
- [Animation example](references/openscad/examples/Advanced/animation.scad), [upstream testing guidance](references/openscad/doc/testing.md), and [upstream test data](references/openscad/tests/data).
- [Maintained capability audit](references/CAPABILITY_AUDIT.md), [source-asset provenance](references/README.md), [OpenSCAD overview](references/openscad/README.md), and [license text](references/openscad/COPYING).

These pointers document the review evidence; they do not authorize copying upstream implementation or establish untested compatibility claims.