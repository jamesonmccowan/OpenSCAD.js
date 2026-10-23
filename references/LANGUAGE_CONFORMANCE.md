# Language References and Model Corpus

Source assessment started 2026-10-02; preview/final corpus baselines captured 2026-10-03. Native oracle: OpenSCAD 2026.10.02 at the pinned project revision. These are measured configurations, not certification of every model's geometry.

Documentation refreshed 2026-10-12. The current packaging/full-test checkpoint
is separate from those captured corpus results; see [current status](../README.md#current-status).

## Supported Reference

[language_features.scad](language_features.scad) is a deliberately small, independently authored reference model with assertions, tagged echoes, and visible geometry. It separates language behavior from the larger historical sample projects. `case_id=0` runs the default supported groups; other values select a group. Cases 10-12 isolate experimental or restricted features.

| Case | Feature Group |
| --- | --- |
| `1` | Arithmetic precedence, exponentiation, degree trigonometry, ternary expression. |
| `2` | Truthiness, heterogeneous vectors, `undef`, type predicates, invalid indexing. |
| `3` | Vector arithmetic, dot/matrix products, comprehensions/filtering/each, indexing and aliases. |
| `4` | Recursive functions, default/named parameters, sequential `let`. |
| `5` | Lexical ordinary variables versus dynamically inherited `$fn`. |
| `6` | Descending ranges and dependent nested loop bindings. |
| `7` | Forward module/function lookup and simple geometry. |
| `8` | CSG, polyhedron, primitive-local resolution, children, appearance/modifiers and dynamic context. |
| `9` | 2D `cross()`, `norm()`, Unicode conversion, `version_num()`, `search()` and seeded `rands()`. |
| `10` | Experimental `roof()` on a simple square; requires explicit opt-in. |
| `11` | Printable Latin text followed by extrusion. |
| `12` | Experimental project-relative JSON `import()`; requires explicit opt-in. |

Named built-in function-call labels are also accepted. On the pinned native profile, labels do not reorder built-in values; their source order is preserved and tested against the oracle. Anonymous expression closures support lexical capture, dynamic special variables, defaults and higher-order invocation; `parent_module()` matches native stack indexing. `cross()`, piecewise-linear `lookup()`, Unicode `chr()`/`ord()`, `search()`, `version_num()`, explicitly seeded `rands()`, `dxf_dim()`, and `dxf_cross()` are oracle-tested. DXF helpers use authorized ASCII file inputs and implement a bounded dimension/straight-line entity subset; see the [native-backed built-in inventory](BUILTIN_FUNCTIONS.md). Experimental object values support map/list merge, set/delete entries, key lookup and nested API defines; `object()`/`has_key()` require explicit opt-in, while object methods remain unsupported. `textmetrics()` and `fontmetrics()` are compared with native for bundled Liberation faces.

Examples from the workspace root:

```sh
./bin/openscad-js.js references/language_features.scad -o language_features.stl
./bin/openscad-js.js references/language_features.scad -D 'case_id=8' -o language_geometry.stl
./bin/openscad-js.js references/language_features.scad -D 'case_id=10' --enable=roof -o language_roof.stl
./bin/openscad-js.js references/language_features.scad -D 'case_id=11' -o language_text.stl
./bin/openscad-js.js references/language_features.scad -D 'case_id=12' --enable=import-function -o language_import.stl
./references/openscad/build/openscad references/language_features.scad
npm run test:language-reference
```

Case 3 is value-only and intentionally has no final geometry; use echo/evaluation checks rather than requesting STL for that case. For native echo inspection:

```sh
./references/openscad/build/openscad references/language_features.scad \
  -D 'case_id=3' --export-format=echo -o -
```

The automated suite compares explicit expected echoes with both native and JavaScript evaluation for cases 0-12 in preview and render contexts. Cases 10 and 12 are run with explicit roof/import opt-ins; case 0 excludes these cases. JSON import is evaluated through the project service with its adjacent fixture asset. Native `.echo` export defaults to `$preview=true`; tests explicitly supply `$preview` for the context being checked. A separate full-reference STL test compares native and JavaScript final volume/bounds/topology. These tests do not establish complete numeric formatting, malformed-input, or language compatibility.

## Extended Reference

[language_features_pending.scad](language_features_pending.scad) remains a compact, focused fixture for restricted text and experimental imports; both behaviors are also covered by cases 11 and 12 in the supported reference.

| Case | Extended Example |
| --- | --- |
| `1` | Text followed by extrusion. |
| `2` | Experimental JSON `import()` from a project-relative file. |

```sh
./bin/openscad-js.js references/language_features_pending.scad \
  -D 'case_id=2' --enable=import-function -o imported.stl
```

The focused model uses warning-free identifiers; numeric-prefix identifiers remain accepted with a deprecation diagnostic and are tested separately. Case 2 requires `experimental: ["import-function"]` or CLI `--enable=import-function`. The JSON import example uses the adjacent `language_features_data.json` fixture. These examples do not establish full text shaping or non-JSON import support.

`roof()` requires explicit native `--enable=roof`. It is not part of the default JavaScript profile. The square case separates the roof algorithm from the font/text pipeline required by the numeral model.

## Implemented Slice and Limits

- Numeric-prefix identifiers are accepted with `deprecated-identifier` warnings, matching the pinned native profile; original samples were not renamed.
- ASCII/binary STL imports use `assets` or `assetResolver` and source-relative normalized paths. The CLI uses the authorized filesystem adapter. Missing files, unsupported formats, oversized assets, and invalid mesh topology fail explicitly. `pico.scad` now renders and exports through the worker; reimport uses the documented STL merge policy and passes native checks.
- Bounded list comprehensions support `for`, dependent bindings, `if`/`else`, `each` vectors/ranges and `let`. Indexed polyhedra use Earcut face triangulation, native clockwise face conventions, validation and triangle budgets.
- Text currently supports printable Latin ASCII and bundled Liberation Sans/Serif/Mono regular, bold, italic, and bold-italic faces, plus left-to-right/default English/Latin settings, size/spacing/alignment, and native-style fragment-derived curve sampling. Font selection is limited to these bundled faces; OpenType outlines do not replace full HarfBuzz shaping. Numerals `5` and `0` have native bounds/volume tests with `0.02` absolute tolerance at size 4.
- Experimental roofs support concave, holed, multiple-hole and disconnected profiles through distinct `voronoi` and `straight` methods, with a 10,000-vertex contour cap and triangle/refinement budgets. Voronoi uses Boost.Polygon WASM; straight uses the MIT `straight-skeleton@1.1.0` implementation, not the newer CGAL wrapper. Native tests compare bounds, closed meshes and directional Boolean differences. [Roof verification](../BACKEND_FEASIBILITY.md#experimental-roof) documents coarse tessellation and text-outline differences; these tests do not establish unrestricted roof compatibility.
- Geometry operations now include 2D/3D `hull` and `resize`, 2D `offset` and `fill`, full/partial `rotate_extrude`, `projection(cut=false/true)`, and 3D `minkowski`. Their tests compare directional Boolean differences with native solids; 2D Minkowski and general compatibility edge cases remain unsupported.

```sh
npm run test:import
npm run test:text-roof
npm run assess:models -- --compile
./bin/openscad-js.js references/language_features.scad -D 'case_id=10' --enable=roof -o roof.stl
```

## Repeatable Corpus Assessment

```sh
npm run assess:models
```

[The assessment script](../scripts/assess-models.js) emits JSON for the 13 current SCAD sample files. It performs bounded source resolution and JavaScript evaluation at `$t=0`, checks native `.echo` evaluation, inventories parsed module calls, and records the first blocker. Native parser diagnostics may be redirected into the `.echo` file even on a failing exit; the script captures those as well as stdout/stderr and deprecations. Temporary files are removed afterward. Sample sources are not rewritten.

### Captured Baselines

On 2026-10-19 the stale `hand.scad` entry was deliberately recaptured alone
while establishing the local release gate. Preview, render, native diagnostics,
STL hashes and geometry comparisons matched the old entry; only source bytes
and hashes changed. Its model-local `capture` records that run. Other entries
and the roof baseline were not regenerated.

[The capability audit](CAPABILITY_AUDIT.md) maps every advertised language/geometry family to test evidence and restrictions. Its object-inequality and nested-fill findings are now repaired with native and worker regressions; captured baseline files retain the original audit configuration. The runtime manifest now names previously omitted unsupported families; its lists are not a complete native-feature inventory.

Generate comparable reports with explicit configurations:

```sh
node scripts/assess-models.js --baseline --output=references/corpus-baseline.json
node scripts/assess-models.js --baseline --enable=roof --model=numbers_stencil.scad --output=references/corpus-roof-baseline.json
```

[Default-profile results](corpus-baseline.json) include all 13 sources at `$t=0` in JavaScript preview and final mode: **7 previews and 8 final exports succeed**. Four sources fail in both native and JavaScript parsers. Roof is disabled by default; the numeral stencil fails explicitly here while native warns and produces empty geometry. Mecanum's final export succeeds, but preview fails on a background STL reference outside the authorized sample root; that asset is also absent. Inactive import references are inventoried separately from assets actually read.

During the 2026-10-19 license review, the Pico example's third-party case mesh
was replaced with an independently designed calibration solid. Only its model
entry was deliberately recaptured in the default baseline; the entry's
`capture` field records that run's provenance. Other model entries and the
roof baseline retain their original captures. This example no longer measures
the original Pico case; see the [sample provenance](scad%20sample%20files/README.md).

For the eight successful default final exports, recorded bounds match native exactly and the largest relative volume difference is approximately `4.49e-10`. [The separately roof-enabled stencil](corpus-roof-baseline.json) succeeds in preview/final with approximately 0.022% relative volume difference and 0.0614 mm maximum bounds difference. These are metrics-only corpus comparisons, **not shape-equivalence checks**; existing stencil differential tests provide separate shape evidence.

Reports record oracle revision, project revision and uncommitted implementation-patch hash, runtime/backend, selected flags/defines/time, job limits, entry/dependency/loaded-asset SHA-256 hashes, diagnostics and final STL metrics/hashes. The initial reports identify an uncommitted audit implementation patch on top of the recorded revision; do not treat that revision alone as their complete implementation identity. Native preview means explicit `$preview=true` echo evaluation, not a native rendered preview image. `--model` can select a source for focused runs. `--compile` remains a final-compilation option, but experiments now require `--enable=...` rather than automatic roof enabling. Report generation exits successfully when individual models fail; inspect each model status. Oracle identity/setup failures still fail the command.

The test gate verifies report schema/configuration and freshness of captured source/dependency hashes. STL hashes identify captured artifacts, not a byte-identical regeneration guarantee. Future implementation changes require a deliberate baseline refresh and comparison; input freshness tests alone do not re-certify all recorded metrics.

Feature inventory includes inactive definitions and does not imply those calls execute in the selected configuration. Files blocked during parsing cannot have a complete JavaScript AST inventory. Successful evaluation is not proof of kernel/render/export success, printability, or native mesh equivalence.

| Sample | Current JavaScript Finding | Native 2026 Finding |
| --- | --- | --- |
| [caster mount.scad](scad%20sample%20files/caster%20mount.scad) | Preview/final/export succeed. | Final STL succeeds; baseline metrics agree. |
| [hand.scad](scad%20sample%20files/hand.scad) | Preview/final/export succeed; dedicated overlay/export tests. | Final STL succeeds; baseline metrics agree. |
| [prism_beakon.scad](scad%20sample%20files/prism_beakon.scad) | Preview/final/export succeed. | Final STL succeeds; baseline metrics agree. |
| [spider_bot.scad](scad%20sample%20files/spider_bot.scad) | Preview/final/export succeed. | Final STL succeeds; baseline metrics agree. |
| [parts.scad](scad%20sample%20files/parts.scad) | Parses/evaluates and final render succeeds; deprecated identifier warning. | Accepted with numeric-prefix deprecation. |
| [mecanum.scad](scad%20sample%20files/mecanum.scad) | Final export succeeds; preview blocked by restricted/missing background asset. | Final STL succeeds with library deprecation; baseline metrics agree. |
| [pico.scad](scad%20sample%20files/pico.scad) | Final render/export and native reimport use the original calibration STL fixture, not the former third-party case. | Accepted with the library deprecation. |
| [tank_rover.scad](scad%20sample%20files/tank_rover.scad) | Parses/evaluates and final render succeeds. | Accepted with the library deprecation. |
| [numbers_stencil.scad](scad%20sample%20files/numbers_stencil.scad) | Final STL export succeeds with roof opt-in; dedicated native shape comparison has a 1% combined roof/text budget (measured about 0.82%). | Roof-disabled warnings by default; evaluation succeeds with `--enable=roof`. |
| [quad chopter.scad](scad%20sample%20files/quad%20chopter.scad) | Missing argument-slot syntax, line 157. | Parser rejects it too. |
| [spotter mount.scad](scad%20sample%20files/spotter%20mount.scad) | Missing argument-slot syntax, line 157. | Parser rejects it too. |
| [zero two.scad](scad%20sample%20files/zero%20two.scad) | Missing argument-slot syntax, line 157, in the unchanged assessment input. | Parser rejects it too. |
| [rover.scad](scad%20sample%20files/rover.scad) | Missing argument-slot syntax, line 158. | Parser rejects it too. |

## Remaining Compatibility Roadmap

These are separately prioritized compatibility improvements, not prerequisites
for repeating the current subset gate. Release-focused work is tracked in
[remaining release checks](../README.md#remaining-release-checks).

1. Expand remaining geometry/language families and real-model coverage; studio animation/Customizer basics use the shared worker service and roof remains explicit opt-in.
2. Broaden text shaping/font selection and geometric conformance beyond the bounded Latin subset.
3. Verify missing historical import assets and broaden project persistence/workflows. The studio now loads source files/folders and STL assets, selects entries and retains dependency edits; native rendering equivalence for all newly unblocked models remains broader work than the initial assessment.
4. Extend remaining built-ins/comprehension edge cases and polyhedron adversarial tests using isolated native fixtures.

The four native-invalid originals remain recorded as invalid inputs unless the user supplies corrected versions; supporting their old malformed argument behavior is not required by the pinned 2026 profile. This implemented slice changes the declared runtime capabilities, but does not rewrite historical models or silently enable experimental features.

### Vector Built-In Follow-Up

Native differential cases now cover 2D cross determinants and their native
nonnumeric-to-zero conversion, finite numeric 3D cross products, mixed dimensions,
invalid arity/elements and nonfinite rejection in the 3D branch. Tested `cross()`
warnings match native text for argument conversion, vector size, component type,
NaN and infinity. Norm covers numeric vectors, empty vectors, invalid argument
warnings, overflow and NaN propagation. `rands()` coverage includes non-finite
recovery, warning text, seeded/unseeded stream continuation and evaluator-level
`randomSeed`; the initial unseeded state remains runtime-specific. Echo/str
formatting uses native inf/-inf/nan spellings. Norm warning wording and general
finite-number formatting remain partial.

The same values/warnings run through browser workers, CLI expression overrides
and hard-warning output suppression; the installed artifact also compiles a
solid driven by cross/norm. The full gate on 2026-10-12 passed 368 Node tests,
216 browser tests (72 per engine) and strict declarations. Historical
corpus/resource snapshots above are not recaptured or re-certified by these
focused repairs.

## Compatibility and Robustness Plan

Use `npm run test:all` as the local regression gate (Node/native, browser, declarations). Keep the pinned 2026.10.02 oracle and explicit experimental flags; no change of compatibility target or silent enabling of experiments. New feature families and approved deviations remain separate decisions, not prerequisites for this effort.

Geometry triage tolerance agreed 2026-10-03: a relative volume difference of **0.1% or less** against a nonempty native solid is acceptable without a volume-only repair. Record the measurement and retain bounds, kernel/topology and directional shape checks so matching volume cannot hide incorrect geometry. Empty/native-zero results need explicit handling rather than division by zero. Existing tighter exact-fixture regressions are not automatically loosened; approximate cases retain documented shape/layout tolerances. Semantic errors and unsupported-parameter handling are not covered by this volume tolerance.

1. **Establish an accurate baseline.** Audit the capability manifest against evaluator/compiler behavior, including partial features, unsupported operations, diagnostics and known deviations. Re-run the real-model corpus in preview and final mode with explicitly supplied assets; record source hashes, configuration, oracle revision and results. Preserve native-invalid samples. Exit: every claimed family has a test reference and restriction, and corpus blockers are reproducible.
2. **Expand differential coverage.** Prioritize parameter binding, scopes/closures, object operators, numeric coercion/undef, Unicode/search, seeded RNG, extrusion, offset/fill nesting, resize and projection boundaries. Compare echoes and diagnostic categories; compare final geometry using bounds, topology/kernel status and both directional Boolean differences, not volume alone. Add preview-layer checks where final STL cannot express behavior. Reduce each mismatch to the smallest fixture before repair. Exit: prioritized discrepancies are fixed or explicitly recorded with justified fixture-specific tolerances.
3. **Exercise malformed and boundary inputs.** Add deterministic, bounded generated cases with saved seeds and minimized failure fixtures. Cover deep syntax/recursion, huge ranges/arrays, cyclic or oversized API values, hostile object keys, degenerate/nonfinite geometry, touching/coplanar Booleans and truncated imports. Test both direct and worker hosts. Exit: no uncaught host errors, hung jobs or partial exports in the selected corpus, and documented resource limits produce located/structured failures.
4. **Measure resource and lifecycle behavior.** Benchmark cold start, evaluation/kernel/export time, repeated compile/dispose memory trends and cancellation latency on representative small and large models. Audit expensive helpers and kernel calls against pre-allocation budgets, rather than relying only on post-result limits. Exercise worker timeout/restart, queued jobs, stale results and cancellation during font/asset preparation. Exit: measured baselines and enforceable budgets are published; handles and pending jobs are cleaned up after each tested failure.
5. **Verify host parity and automate the gate.** Extend the shared fixtures to Firefox/WebKit alongside Chromium, including compact/mobile viewers, worker/WASM loading, local-only assets and context recovery. Add root CI with a supported Node runtime, Chromium, declarations and a reproducibly provisioned pinned oracle; distinguish kernel-unit failures from oracle/build setup failures. Preserve dependency-lockfile policy unless explicitly changed. Exit: routine local and CI runs reproduce the baseline and selected cross-browser fixtures pass, or host-specific deviations are documented.

All five stages now have selected-corpus evidence: capability/corpus audit,
native differential repairs, deterministic boundary regressions, resource and
lifecycle measurements, and three-engine testing with configured CI. This does
not mean every case or host is covered; hosted Actions execution remains
deliberately deferred. Standalone packaging is implemented and tested below.
Full font shaping, new formats and missing geometry families remain separate
priorities. Keep new native mismatches small and immediately testable; preserve
historical snapshots until a deliberate recapture/comparison is requested.

### Malformed And Boundary Coverage

The first bounded robustness corpus is shared across the direct service, Node workers and browser workers in [boundary-cases.js](../tests/fixtures/boundary-cases.js). Seed `0x5cad` generates 12 reproducible truncated programs; case names retain the seed/index for reduction. Additional fixed cases cover cyclic/deep API values, oversized sparse/aggregate vectors, invalid limits/types, source/parser/range/call-depth limits, dependency cycles, escaping paths, nonfinite geometry, invalid polyhedron indices, mixed dimensions and extreme fragment counts. They must return structured errors, located when the failure is source-based, and allow the next valid job to compile. Previously successful export handles must remain usable; failed results cannot export.

Exact accepted boundaries include 64 nested binding levels and 99,999 vector slots plus their container within the 100,000-value snapshot budget. Sparse slots now count as undefined values before normalization; oversized arrays are rejected before copying. Legal object keys and parameter names such as `__proto__`, `constructor` and `prototype` do not leak through JavaScript prototypes. Internal closures now have a distinct type: user data containing `anonymous`, `statement` and `scope` remains an object, not a callable. Built-in/signature dispatch only considers own table entries.

[Import tests](../tests/import.node.test.js) exercise truncated STL headers/triangles, inconsistent counts, nonfinite coordinates, malformed ASCII facets and byte/triangle limits in both direct and worker hosts. Exact limits accept a valid cube; one-below limits reject it, with no failed export and successful recovery. Triangle-budget failures in the decoder currently carry `geometry-error`, while asset-byte limits carry `resource-limit`; consistent diagnostic taxonomy remains follow-up work.

This is deterministic regression coverage, not an exhaustive fuzzer or complete memory/security guarantee. Arbitrary host JavaScript objects/accessors, job-wide allocation budgets, broader degeneracy/coplanar stress and measured leak/cancellation behavior still need work. Historical corpus baselines are unchanged.

### Resource And Lifecycle Measurements

[measure-resources.js](../scripts/measure-resources.js) provides a bounded, repeatable Node-worker measurement run. [The captured snapshot](resource-baseline.json) records runtime/CPU, source workloads, limits, implementation revision/patch hash and measurement-script hash. Regenerate on Node 22:

```sh
npm run measure:resources -- --cycles=30 --output=references/resource-baseline.json
# System-Node-18 workaround for this checkout:
npm exec --yes --package=node@22 -- npm run measure:resources -- --cycles=30
```

The run initializes a worker, warms three fixtures, then performs 30 compile/export/dispose cycles across a cube, sphere CSG and a holed multi-slice extrusion, including repeated malformed jobs. It samples process memory every 10 ms, requests host GC between cycles when available, and measures resolve/evaluate/kernel timing, queue overflow, queued and active-read cancellation, worker restart, bounded busy-geometry cancellation and disposal with active/queued jobs. All spawned workers must emit exit and have threadId -1 after awaited disposal; both jobs pending at disposal must settle. Previously copied mesh data remains usable after a worker reset. The test gate runs a shorter six-cycle version without machine-specific timing/RSS thresholds.

Captured results on this machine: startup about 94.6 ms; median compile/export 5.45/16.14 ms, p95 10.69/36.70 ms. Busy cancellation settled about 0.37 ms after abort and worker exit was observed about 14.14 ms after abort. Resolver cancellation settled in about 0.14 ms, queued cancellation in 0.10 ms, restart in 90.7 ms, and disposal in 2.24 ms. Three workers spawned/exited and two pending jobs settled. Faster hosts may finish busy work before the scheduled abort; that outcome is reported rather than mislabeled as cancellation.

Observed peak RSS was approximately 173.9 MiB; RSS increased 12.4 MiB across measured cycles, while main-thread JS heap increased about 0.10 MiB after requested GC. **These measurements are not proof of leak freedom.** RSS includes worker isolates/WASM/allocator retention, but heap/external/arrayBuffer values describe only the main thread. The kernel does not expose a reliable heap meter here, and interval sampling may miss brief peaks. OS high-water retention and live leaks cannot be distinguished from this snapshot alone. Browser/mobile memory, long-run trends and larger real-model workloads remain follow-up work.

Two allocation guards were strengthened: extrusion now estimates side/cap triangles before kernel subdivision and checks final output triangles; saturated worker queues reject before cloning request payloads. The estimate is conservative for collapsing/scaled or simplified contours, so explicit tight budgets can reject a result that would simplify below the limit. Exact square/holed-profile limits and a million-slice rejection are tested without allocating the oversized extrusion. This is not a job-wide memory cap: input snapshots, other CSG/Minkowski kernels and font/asset preparation still need broader allocation analysis. Host resolvers own their promises and must honor abort signals; the measurement releases intentionally stalled promises after cancellation/disposal.

### Cross-Browser Parity And CI

[Playwright projects](../playwright.config.js) run the same 46 tests on Chromium,
Firefox and WebKit. All three suites passed locally on 2026-10-03 (138 passes),
including worker/WASM compilation, bounded cancellation/recovery, imports and
exports, experimental roofs/objects, metrics, project loading, animation,
Customizer, desktop/mobile layout and canvas pixels, embedded aspect ratios and
WebGL context recovery. Tests retain failure traces; CI also generates HTML
reports. No engine-specific skips or relaxed comparisons were added.

The aggregate npm run test:all gate also passed: 310 Node tests, 138 browser
tests and strict public declaration checks.

Local validation used Node 22 and Playwright's Ubuntu 24.04 fallback binaries
on Linux Mint 22.3. WebKit initially could not launch because libavif16 and its
libgav1/libyuv dependencies were missing. For verification only, packages were
downloaded from the configured Ubuntu repository and unpacked in /tmp; their
libraries were explicitly loaded into the test process because the WebKit
wrapper resets LD_LIBRARY_PATH. No system package or browser wrapper was edited.
That temporary setup is not a deployment prerequisite or a portable workaround:
install Playwright's supported host dependencies normally on your target host.

These are three browser-engine tests on Linux, not certification on shipping
Safari, actual iOS/Android hardware, every browser version, or arbitrary VS Code
webviews. Actual device/mobile Safari validation, longer-run memory tests and
production/offline packaging remain open.

[The root workflow](../.github/workflows/verify.yml) runs on pushes, pull requests
and manual dispatch, with read-only contents permissions and superseded-run
cancellation. Its Ubuntu 24.04 native job explicitly checks out the pinned
OpenSCAD revision (and nested submodules), installs headless build dependencies,
builds a version-pinned experimental Manifold/CGAL oracle, and runs Node/native
tests and declaration checks. Setup/build failures have separate steps from test
failures; native tests are not silently skipped. Browser matrix jobs obtain the
same reference font assets, install their engine and host dependencies, and run
the shared suite with two workers each. Per-engine reports/screenshots/failure
traces are uploaded for seven days, even after failures.
All browser matrix jobs use the main Ubuntu archive over HTTPS instead of the
runner's Azure mirror after hosted dependency downloads exhausted installation
timeouts before tests started. Browser/host installation is bounded to eight minutes and the
build/test step to ten minutes within the twenty-minute browser job budget.

The reference is a pinned submodule declared in the root .gitmodules file.
Native source revision availability was
verified with a clean public fetch. [build-reference.sh](../scripts/build-reference.sh)
checks the source revision, forces version 2026.10.02, uses HEADLESS/NULLGL to
avoid Qt/OpenGL dependencies, and bounds compilation to two jobs by default.
It does not replace your existing build unless run with the default build path;
use REFERENCE_BUILD_DIR for independent verification. A separate local Release
build completed and reported the pinned version; its doughnut STL matched the
existing oracle's volume, bounds, 9,488 triangles, zero degenerate triangles and
closed-edge metrics. This is a build/export check, not the entire differential
suite rerun against that separate executable. Roof WASM rebuilding is not part
of this workflow; existing generated assets are tested.

Root and extension dependency lockfiles are committed, and CI uses `npm ci`
to install their pinned npm dependency graphs. Native build tools and system
libraries still depend on the host environment. Workflow syntax/action inputs
were checked locally with actionlint. The 2026-10-23 hosted run for commit
`7fa38cb` on `fix/github-actions` passed Node/native/types, WebKit and the
extension job. Chromium and Firefox timed out installing host packages from
the Azure mirror, before their tests started. Extending the mirror change to
those engines still requires a new hosted run.

### Standalone Distribution Checkpoint

On 2026-10-04, the full gate passed 311 Node tests, 147 browser tests (49 per
engine) and strict declarations. The additional browser cases test a nested-path
standalone studio/API with requests outside the artifact blocked, loaded fonts,
both WASM kernels, final STL, desktop/mobile screenshots and geometry pixels.
The package test verifies identical repeated-build inventories, exact tarball
contents/hashes and offline installation into a clean consumer using the
installed API/worker/viewer/CLI. These results supplement, not replace, the
initial 46-per-engine run above or the historical corpus metrics.

See [distribution setup](../README.md#build-distribution) and the
[packaging contract](../BACKEND_FEASIBILITY.md#standalone-packaging-checkpoint).
Local assets served over HTTP do not imply service-worker installation, strict
CSP/webview certification, real Safari/mobile-device support or completed
embedded-component license provenance. The native reference tree and its
executable are development inputs, not runtime dependencies of the artifact.