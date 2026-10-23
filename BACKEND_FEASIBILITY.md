# Backend Feasibility: Manifold WASM

Initial assessment: 2026-10-02. Status refreshed: 2026-10-04. Manifold selected; shared compiler/worker service, studio, viewer, CLI and standalone distribution candidate implemented. Not a complete OpenSCAD compiler or a release-certification record.

## Recommendation

Continue with the selected `manifold-3d@3.5.4` geometry kernel. It runs headlessly in Node and in a browser module worker, without a remote service, GPU, or cross-origin isolation. The tested Boolean, extrusion, transform, and adapter primitive cases match the pinned OpenSCAD reference within documented tolerances. Selection does not waive the remaining release gates.

Do not directly substitute every Manifold primitive for the corresponding SCAD primitive. The independently authored adapter resolves default sphere discretization and builds cylinder/cone meshes. The evaluator preserves lexical/dynamic scopes, child grouping, and modifier metadata. Virtual projects support `include`/`use`; the public service enforces final-mode STL export. Broader language coverage remains incomplete.

The studio now uses the shared worker-backed core; the old in-page parser/interpreter/CSG implementation has been removed. A reusable Three.js viewer consumes transferred meshes and preview layers, preserves camera state, and supports final-mode STL downloads. Standalone JS/WASM/font packaging and three-engine Linux testing are implemented. Embedded-component provenance, real-device and strict-CSP deployment checks remain open. No OpenSCAD implementation code was copied.

## Reproduce

Use Node.js 22 or another version supported by the installed Playwright release. The Node-only tests also passed on the available system Node 18.19.1, but Playwright requires Node 20 or newer and installed optional tooling declares additional requirements.

```sh
npm ci
npx playwright install chromium firefox webkit
npm run test:all
```

Install Playwright's supported host libraries as well; on supported Linux,
`npx playwright install --with-deps chromium firefox webkit` may require
administrator privileges. Python 3 supplies the managed test server. See
[focused commands and distribution setup](README.md#test).

The native oracle must exist at `./references/openscad/build/openscad`, report `2026.10.02`, and have source revision `7d44e5796cd489bcbfb8cef0720abe4db60ce35e`. Standard native geometry fixtures explicitly use `--backend=Manifold` and binary STL; experimental fixtures state their enable flags separately. Native subprocesses have bounded timeouts, and temporary SCAD/export files are removed after testing. [The build recipe](scripts/build-reference.sh) verifies the source/version; use `REFERENCE_BUILD_DIR` to avoid replacing an existing build.

For this machine's older system Node, browser validation used a temporary npm-provided runtime rather than replacing Node:

```sh
npm exec --yes --package=node@22 -- node node_modules/@playwright/test/cli.js install chromium firefox webkit
npm exec --yes --package=node@22 -- npm run test:all
```

Playwright manages its local HTTP server. npm's `test:browser` builds the
standalone artifact first; direct `npm test`/Playwright invocations need
`npm run build` before including distribution fixtures. Root and extension
lockfiles are committed; development and CI use `npm ci` for locked installs.
Latest local full gate (2026-10-12): 368 Node tests, 216 browser tests (72 per engine) and strict declarations.
The root CI workflow is configured, but hosted runner verification is deferred.

## Evidence

| Check | Result |
| --- | --- |
| Node suites | 258 checks pass: prior language/geometry/import/CLI regressions plus 4 project-state invariant checks. |
| Browser suite | 33 checks pass in Chromium: prior studio/service checks plus 8 file/folder/asset, edit persistence, dependency, entry export, recovery and mobile project workflows. |
| Runtime separation | Headless Node computation has no `document`; the browser worker loads only local kernel/harness modules and WASM. |
| Browser security/deployment | Works with `default-src 'none'`, self-hosted scripts/workers/connections, and `script-src 'self' 'wasm-unsafe-eval'`; `crossOriginIsolated` is false. |
| Cross-host results | Browser and Node agree for backend summaries, SCAD-to-solid measurements, language echoes, and virtual-project service outputs; binary STL is transferred from the worker. |
| Responsiveness | Page timers continue while a worker executes 4,400 fixture cycles. |
| Isolation/cancellation | Separate workers produce independent results; a busy worker can be terminated and replaced by a working instance. |
| Resource handling | Explicitly owned Manifold/CrossSection objects are deleted in `finally`; 100 Node cycles, 4,400 browser cycles, and repeated compiler failure/recovery remain usable. |
| Payload | Installed kernel wrapper: 82,371 bytes; WASM: 541,470 bytes, both uncompressed. These exclude packaging tools, test code, viewer assets, and notices. |

Cancellation checks termination/replacement and prompt job settlement, not the time until every OS resource is reclaimed. The supervisor has queue limits, latest-job supersession, generation-based stale-message rejection, crash recovery and timeout policy. Later [resource/lifecycle measurements](references/LANGUAGE_CONFORMANCE.md#resource-and-lifecycle-measurements) separately record cancellation settlement and observed worker exit, plus sampled process RSS, restart and disposal. The kernel does not expose a heap meter; observed RSS peaks and repeated usability do not prove leak freedom or a whole-job allocation bound. Longer-run memory accounting and real deployment/device coverage remain open.

The shared suite now passes on Playwright Chromium, Firefox and WebKit on Linux, including desktop/mobile viewport sizes, compact/wide/tall viewer containers, local-only startup and WebGL context recovery. This is not certification of shipping Safari or actual mobile devices. Standalone artifact tests also block requests outside the distribution. Iframe embedding, strict-CSP/VS Code webviews and service-worker offline installation remain unverified or unimplemented. See [cross-browser scope](references/LANGUAGE_CONFORMANCE.md#cross-browser-parity-and-ci) and the standalone packaging checkpoint below.

## Geometry Corpus

The [shared fixtures](tests/fixtures/backend-cases.js) cover:

- Cube and overlapping union.
- Face-touching union and identical-solid subtraction.
- Empty disjoint intersection and an enclosed cavity.
- Grouped nested CSG with disconnected operands.
- Reflection followed by translation, preserving outward winding.
- Extrusion with a hole and extrusion of a concave polygon.
- A 32-facet frustum with distinct bottom/top radii.
- Adapter spheres/cylinders with default, angular, linear, fixed, odd, fractional, minimum, and local resolution settings.
- Module-style child scopes, diameter precedence, clamp diagnostics, centered diameter frustums, both cone orientations, and empty results for invalid finite dimensions.
- Implicit module operand grouping, `children()` wrappers, debug subtraction, root selection, and direct versus nested background intersections.

Each candidate result is checked against independently specified volume/bounds, finite coordinates, nondegenerate triangles, and closed oppositely oriented edge pairs. Binary STL is encoded, decoded, measured, and reconstructed through Manifold. Invalid open-mesh input and truncated STL are rejected.

Nonempty native outputs are reconstructed through Manifold and compared using both directional Boolean differences against hand-built fixtures and actual SCAD evaluator/compiler results. This catches shape differences that volume and bounds alone would miss. This is a same-kernel-family differential check, not an independent formal proof of robustness; analytic expectations and mesh checks provide additional evidence.

Tolerances for these small, origin-near fixtures are absolute: `0.0001` for volume/bounds and `0.001` for total symmetric-difference volume. These thresholds must not be reused blindly for arbitrary model scales or large coordinate magnitudes. Exact-coordinate vertex welding is sufficient for these binary STL fixtures; general STL import needs a deliberate tolerance policy.

The real [hand sample](references/scad%20sample%20files/hand.scad) exposed 106 zero-area output facets with exact repeated Float32 positions, despite a successful Manifold solid. Direct raw-mesh STL serialization omits repeated-position facets but still rejects distinct collinear facets, invalid indices, and non-finite coordinates. Validated kernel-owned service results now also omit exact zero-area serialization facets, after Pico exposed five Float32-collinear facets; no area threshold or approximate simplification is applied. Hand/Pico output passes kernel/native reconstruction and volume comparison. STL reimport uses Manifold's documented merge helper because STL loses vertex relationships. Both the hand export and native reference fail a strict coordinate-weld edge-pair checker for touching components, so that checker alone is not a universal watertightness criterion. Real-model volume comparisons use `0.01` absolute tolerance.

Valid empty native solids cause the reference STL command to fail with an empty-object diagnostic; tests distinguish that outcome from arbitrary export failures. The compiler can represent an empty solid, but public export rejects it by default. API `allowEmpty` and CLI `--allow-empty` explicitly permit a zero-triangle STL.

## Language Reference Corpus

Twelve fixtures run against the native oracle, evaluator, and browser worker. They cover last-assignment behavior and its warning, forward lookup, lexical versus dynamic lookup, local `$fn`, truthiness, vector/matrix multiplication, recursion, indexing, `let`, `$t`, descending ranges, and a legal `eof` identifier. Six additional native project fixtures cover include scopes, library bindings/defaults, nested resolution, and dynamic specials. Unexpected native diagnostic lines fail the fixtures. These do not describe the old editor interpreter's compatibility.

Dedicated [supported](references/language_features.scad) and [extended/restricted](references/language_features_pending.scad) SCAD references complement the isolated fixtures. The baseline has explicit preview/render echoes and native final-geometry comparison. Numeric-prefix naming is now accepted with a deprecation warning; the extended cases compile under declared restrictions, including explicit roof opt-in. [The corpus report](references/LANGUAGE_CONFORMANCE.md) records newly unblocked rendering for parts/mecanum/pico/tank/stencil and native-invalid originals. Historical models remain unchanged except for the Pico example's imported asset, replaced with an original calibration fixture during the license review.

## Added Language and Asset Subsets

- Numeric-prefix names use longest-match tokenization without swallowing numeric exponent literals. Deprecation diagnostics are source-located, including unused library definitions. The shared `180_camera` parse blocker is removed.
- List comprehensions support bounded `for`, dependent bindings, `if`/`else`, `each` vector/range expansion and `let`. Polyhedra use native face winding, finite/index/topology validation and Earcut triangulation; broad nonplanar/adversarial compatibility remains future work.
- `import()` accepts only ASCII/binary STL in this slice. `CompileRequest.assets` supplies normalized-path text/byte assets, or `assetResolver(path,{signal})` reads them explicitly. References resolve from the import statement's source file, including used libraries. Source and asset resolver functions are separately bridged by workers. Byte/triangle limits, format checks and Manifold validation are enforced; missing/invalid assets fail rather than becoming placeholders. The filesystem adapter provides both resolvers under the same physical-root checks. CLI `--max-asset-bytes` defaults to 20,000,000 bytes.
- `dxf_dim()` and `dxf_cross()` read bounded ASCII DXF text through the same authorized project assets/resolvers; paths resolve relative to the calling SCAD file, including used libraries. `dxf_dim()` supports rotated, aligned, angular, radial/diameter, and ordinate values by optional `layer`, `name`, `origin`, and `scale` filters. `dxf_cross()` finds the first intersection of two two-point LINE/LWPOLYLINE paths. DXF geometry `import()` remains unsupported; block/INSERT transforms, curved-path intersections, and other DXF entities are outside these helper implementations.
- `text()` is partial: printable Latin ASCII, bundled Liberation Sans/Serif/Mono regular/bold/italic/bold-italic faces plus runtime fonts, LTR/default English/Latin settings, and basic alignment/spacing. OpenType outlines use native-style fragment-derived sampling and approximately native em scaling. The CLI/extension discover installed fonts and optional directories; the browser offers file loading and permission-based local access. The core accepts explicit font bytes/resolvers. See [runtime font configuration and limits](README.md#runtime-fonts). This is not Unicode shaping or a HarfBuzz replacement.
- `roof()` is disabled by default. API `experimental: ["roof"]`, CLI `--enable=roof`, or the studio's **Experimental roof** checkbox enables distinct Voronoi/straight construction for concave, holed and disconnected profiles. See the algorithm, precision and test limits below.

Earcut `3.0.2` (ISC) and OpenType.js `1.3.4` (MIT) are pinned dependencies. The bundled Liberation font retains its own license. Font/geometry redistribution and production packaging remain subject to the existing dependency audit. These additions do not imply complete feature compatibility or enable experiments implicitly.

### Experimental Roof

The default `voronoi` method uses an independently authored Boost.Polygon segment-Voronoi WASM binding and JavaScript cell meshing. `straight` uses `straight-skeleton@1.1.0`, the older MIT JavaScript implementation, bundled with esbuild; it does not use the newer CGAL wrapper. Concave/holed inputs intentionally use different algorithms rather than treating the method names as aliases. Both methods cap total contour vertices at 10,000 and enforce the compiler triangle budget. Voronoi coordinates are centered and quantized to bounded integers; output coordinates are Float32. Curved-edge refinement honors `$fn/$fa/$fs`, with recursion/sample limits. Pathological geometry and extreme precision remain limited; worker cancellation isolates expensive synchronous jobs.

Native checks cover convex/concave, holed, multiple-hole and disconnected profiles, bounds, closure and both directional Boolean differences. Browser workers exercise both algorithms and export under a restrictive CSP. The studio tests verify default-off gating, preview and STL export. Coarse Voronoi tessellation can differ from native; refined holed cases use tighter budgets. The real numeral stencil has approximately **0.82% symmetric shape difference**, **0.022% volume difference** and less than **0.1 mm bounds difference**, with a 1% combined text/roof shape regression budget. Flat text alone differs by about 0.53%; an identical curved numeral polygon isolates the roof algorithm and passes a 0.1% shape budget. These are fixture-specific measurements, not general error guarantees.

Rebuild from the checked-in C++ source and pinned npm dependency:

```sh
npm ci
# Activate Emscripten 4.0.23; Boost 1.83 headers were used for verification.
BOOST_INCLUDE_DIR=/usr/include npm run build:roof
npm run test:text-roof
npm run test:backend:browser
```

`em++` must be on PATH and `BOOST_INCLUDE_DIR` must contain `boost/`. The bindings use `DYNAMIC_EXECUTION=0` to work without JavaScript eval under restrictive CSP. The build emits `roof-voronoi-wasm.js`, its sibling `.wasm`, and `roof-straight-bundle.js` in `src/geometry/`. Ship all three together and retain [third-party notices](THIRD_PARTY_NOTICES.md). The extension packages the Voronoi WASM and resolves it explicitly through its webview resource bridge for Blob workers. The WASM maximum linear memory is 256 MiB. This is a reproducible build procedure with recorded versions, not a byte-identical-build claim across toolchains. The broader production dependency/license audit remains separate.

## Public Service Contract

[The public entry point](src/index.js) exports `createEngine`, `createWorkerEngine`, `SERVICE_API_VERSION`, `WORKER_PROTOCOL_VERSION`, capabilities, parser/evaluator APIs, and `resolveProject`. [TypeScript declarations](src/index.d.ts) describe both request/result/export contracts. The package exposes this entry through its ESM `exports` field, and the worker entry asset through `./worker`. Both version constants are `1`; structural breaking changes require a relevant version change, while broader supported language capabilities may be additive.

```js
import { createEngine } from "./src/index.js";

const engine = await createEngine();
const result = await engine.compile({
	entry: "main.scad",
	files: {
		"main.scad": "use <parts/shape.scad> shape(width);",
		"parts/shape.scad": "module shape(size=2) { cube(size); }",
	},
	defines: { width: 3 },
	mode: "render",
	context: { time: 0.5 },
});
try {
	if (result.status === "success") {
		const binary = await engine.export(result, { format: "stl", encoding: "binary" });
		console.log(binary.byteLength, result.bounds, result.dependencies);
	} else console.error(result.status, result.diagnostics);
} finally {
	if (result.status === "success") result.dispose();
	engine.dispose();
}
```

In the development source, default WASM initialization uses the pinned npm module in Node or a bundler; plain browser hosts inject an initialized `module` or a `loadModule` factory. The built distribution rewrites that dependency to its local kernel wrapper, so default `createEngine()` is tested in both Node and plain browsers. Browser `createWorkerEngine()` now defaults to a module-relative local Manifold wrapper: the development dependency in a checkout, or the packaged runtime in the artifact. Explicit worker/kernel/WASM overrides remain available. Imports alone do not initialize WASM or touch the DOM. Engine creation rejects initialization/profile errors; strict-CSP integration is not yet certified.

`compile()` resolves to a discriminated result: `success`, `error`, or `cancelled`. All results identify API version, engine-local job ID, profile/backend, mode, diagnostics, echoes, dependency paths, and phase timings. Successful results additionally expose bounds, volume, emptiness, semantic tree/layers, material provenance, source view settings, independent typed-array mesh/overlay copies, and idempotent disposal. `getMesh()` includes optional Manifold run indices/original IDs, while `getOverlays()` returns separate ghost/debug meshes; final-mode results have no overlays. Parameter values and time are snapshotted at job start; source-file maps are copied by resolution. Failures preserve dependency paths already read, including malformed sources. Metadata does not expose a raw kernel solid.

Results belong to their creating engine. Dispose each successful result after use; engine disposal invalidates and frees every live result and aborts outstanding project reads. Mesh copies and exported byte arrays remain caller-owned after disposal. Failed results cannot be exported. Timings are runtime observations, not time-limit guarantees.

`export()` returns `Uint8Array` for binary or UTF-8 ASCII STL. It rejects preview-mode, foreign, failed, or disposed results and unsupported formats/encodings with coded errors. It never silently exports preview meshes or recompiles with a different `$preview` value. Compile again with `mode="render"` for final export. Valid empty solids can compile, but export fails with `empty-geometry` unless `allowEmpty=true`; opted-in binary empty output has zero triangles. Normal final geometry is exported, not background/debug presentation layers. Both encodings have been reimported through native OpenSCAD with preserved bounds, volume, and closed geometry.

`defines` supplies SCAD scalar/vector values overriding main-scope source assignments. The additive `defineExpressions` option supplies at most 128 strings, each exactly `NAME=SCAD_EXPRESSION`; these are parsed into main-scope bindings after source declarations and before execution, can reference script variables/functions, and support range values. Later expression overrides win, and structured `defines` takes final precedence when both options are supplied. This is the CLI `-D` path; it does not execute JavaScript or arbitrary statements. `context.time` initializes `$t`, mode initializes `$preview`, and `specialVariables` supplies initial dynamic bindings. `context.viewport` provides a snapshot of `$vpr/$vpt/$vpd/$vpf` for script reads; `result.view` identifies applicable top-level source assignments rather than mistaking host defaults for authored camera changes. Source/local assignments still follow SCAD scope rules. `hardWarnings=true` promotes accumulated warnings to a failed compilation without leaving a live handle.

The in-thread `createEngine()` bounds pending jobs (`maxPendingJobs`, default 16), but does not implement a worker queue or latest-result selection. IDs let hosts distinguish out-of-order completions. Abort signals settle pending host reads without waiting for the resolver, and evaluation checks cooperative cancellation. Host resolvers receive the signal and remain responsible for stopping their own I/O. A synchronous WASM call cannot be interrupted on the same thread; use the worker-backed API below for hard cancellation. There is no complete whole-job memory budget yet.

## Worker-Backed API

[The supervisor](src/core/worker-engine.js) and [worker entry](src/core/worker-entry.js) move evaluation, geometry construction, mesh extraction, and STL serialization off the caller's thread. Node uses `worker_threads`; browsers use module workers. The existing in-thread API remains available. The worker-backed API uses the same compile/export request and result metadata, without requiring callers to manage protocol messages.

```js
import { createWorkerEngine } from "./src/index.js";

const engine = await createWorkerEngine(); // Node; browser asset options below
try {
	const result = await engine.compileLatest({
		mode: "render",
		files: { "main.scad": "sphere(r=5, $fn=32);" },
	});
	if (result.status === "success") {
		try {
			const mesh = result.getMesh();
			const bytes = await engine.export(result);
			console.log(mesh.triVerts.length / 3, bytes.byteLength);
		} finally { result.dispose(); }
	}
} finally { await engine.dispose(); }
```

Plain browser hosts must provide the locally hosted kernel module URL, with an optional explicit WASM URL. The default worker script is relative to the installed supervisor module. For a workspace-root HTTP server, the tested configuration is:

```js
const engine = await createWorkerEngine({
	manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href),
	wasmUrl: new URL("/node_modules/manifold-3d/manifold.wasm", location.href),
	maxPendingJobs: 16,
	timeoutMs: 30_000,
	startupTimeoutMs: 30_000,
});
```

These are development asset paths, not a recommendation to expose an entire dependency tree in production. Bundled hosts may provide `workerUrl`, kernel URLs, or a trusted `workerFactory(url)` returning a browser/Node-compatible worker. Host-provided entry scripts must implement worker protocol version 1. No CDN or cross-origin isolation is required by the tested path. Node defaults load the pinned npm dependency in the worker, including when the caller uses an inline ESM script.

Each supervisor runs one operation at a time in FIFO order, with at most `maxPendingJobs` active-plus-queued jobs. Compile requests are structured-cloned at submission, excluding `signal` and `resolver`; non-cloneable data produces a coded error. The host resolver is bridged through protocol reads and receives an abort signal. Mesh buffers and export bytes are transferred from worker to host; `getMesh()` returns independent copies of cached host mesh data synchronously. The full semantic metadata is cloned, which still has a host-side cost for very large trees.

`compileLatest(request, key="default")` cancels older unfinished latest-job compilations with the same key. Superseded compile promises settle as `cancelled` with code `superseded`; late worker messages and host read replies cannot become the newer result. Ordinary `compile()` jobs and other keys are not superseded. Hosts still decide whether and when to display successful results.

Queued cancellation removes only that job and preserves the worker/results. Cancelling an active compile or export terminates the worker, settles the job, and uses a fresh worker for subsequent work. Worker crashes also settle active work and allow recovery. Active operations default to a 30-second timeout, including resolver waits after dispatch; startup has a separate 30-second deadline. Queue wait is not included in the operation deadline. Timeout compiles have status `cancelled` and code `timeout`; export cancellations/timeouts reject with coded errors. Optional `onProgress` callbacks report advisory `queued`, `started`, `finished`, and `worker-ready` phases.

**Restart invalidates every live result handle owned by that worker.** Such handles cannot be exported or queried again (`worker-reset`); there is no hidden recompilation that could change model context or `$preview`. Previously obtained mesh copies/STL bytes remain usable. Recompile if another final export is needed after restart. Queued exports referring to invalidated handles fail instead of using stale geometry. Disposing a queued export's result does not reset unrelated healthy handles.

`result.dispose()` remains synchronous and idempotent; it drops cached host mesh data and sends a release message for worker kernel ownership. `await engine.dispose()` settles active/queued jobs, invalidates live handles, and waits for tracked Node worker termination. Call it in cleanup to avoid leaving Node workers alive. Idle engines retain their worker/WASM instance for reuse. Custom resolver I/O/factory resources remain the host's responsibility.

The supervisor is not a worker pool, persistent mesh store, or complete memory-budget implementation. The studio uses it for compilation/export. Browser/Node support outside the tested environments and strict-CSP integration in real embedders still need validation.

## Node Filesystem and CLI

[The executable](bin/openscad-js.js) uses the worker-backed API for final compilation and STL serialization. It does not invoke native OpenSCAD, launch a browser, or require a GPU. The package declares `openscad-js` as its binary; from the checkout use the executable path or `npm run cli -- ...`. Installing/linking the package makes the named command available subject to the user's npm prefix/PATH configuration. Development browser tests still need a Playwright-supported Node version; Node 22 is recommended. CLI tests also pass on the available Node 18.19.1.

```sh
./bin/openscad-js.js model.scad -o model.stl
./bin/openscad-js.js model.scad -D 'width=height+2' -I ./libraries --root . -o model.stl
./bin/openscad-js.js - -o - --export-format=asciistl < model.scad > model.stl
./bin/openscad-js.js model.scad --time=0.5 --diagnostics=json -o frame.stl
```

Exactly one input and one output are required; `-` means stdin/stdout and `--` ends option parsing. Only STL is supported, with `--export-format=binstl` (default) or `asciistl`; file outputs require a `.stl` extension. Repeated `-D` uses main-scope expression overrides with the last value winning. Native fixtures verify script-variable references and source override precedence. `--profile` currently accepts only `openscad-2026.10.02`. `--help` lists actual supported options, not the complete native CLI.

[The Node filesystem adapter](src/node/filesystem.js), also available as `openscad-js-studio/node` with [declarations](src/node/filesystem.d.ts), maps a trusted project root and explicitly authorized library roots onto virtual paths. The default root is the input directory, or cwd for stdin. Use `--root` for a wider project and repeated `-I`/`--library-path` for external library directories. Environment variables and system library locations are not implicitly trusted or searched. Libraries are mounted under reserved `__openscad_libraries__/N` prefixes, which can appear in dependency/diagnostic paths.

Logical traversal and URL/absolute references remain restricted by project resolution. Physical paths are resolved and checked against the corresponding authorized root; directory aliases are canonicalized, symlink escapes are rejected, nonregular sources are rejected, and file reads are bounded before allocating full text. POSIX nonblocking/no-follow open flags avoid blocking on FIFO sources and following a substituted final symlink where supported. This is not an OS sandbox against an attacker concurrently modifying filesystem ancestors; authorized roots should be controlled by the host/user. Input and output paths must differ. Output access is authorized explicitly by `-o`, rather than restricted to source roots.

File output is first written to an exclusively created temporary file beside the target, flushed and closed, then renamed over the target. Compilation/export failure leaves an existing artifact unchanged and creates no final output. Temporary output is cleaned up on write/cancellation failure where the filesystem permits. Parent output directories must already exist. Stdout receives only complete serialized STL bytes, but stream/I/O failures cannot be rolled back atomically. Logs, echoes, warnings, and errors always go to stderr when compiling.

`--diagnostics=json` emits one JSON report to stderr with status, diagnostics, echoes, dependencies, and available engine/timing metadata; text is the default. `-q` suppresses warnings/echoes, not errors. `--hardwarnings` fails on warnings. Empty geometry is rejected unless `--allow-empty` is supplied. Error locations retain normalized project/dependency paths and `<command-line>` for overrides.

Worker startup and each compile/export operation use `--timeout-ms` (default 30000). Other supported budgets are `--max-triangles`, `--max-steps`, `--max-depth`, `--max-files`, `--max-include-depth`, `--max-project-bytes`, and `--max-file-bytes`. SIGINT/SIGTERM abort input reads or terminate worker computation; handles/workers are disposed before exit. These budgets do not form a complete global-memory limit.

| Exit Code | Meaning |
| --- | --- |
| `0` | Successful artifact export, help, or version; or an `--audit` with no overlap above epsilon. |
| `1` | SCAD/geometry/export failure, including empty geometry, hard warnings, or evaluator/primitive resource limits. |
| `2` | Invalid invocation/profile/format/definition, missing or restricted files, worker startup failure, or I/O failure. |
| `3` | Deadline/other cancellation without a termination signal. |
| `4` | `--audit` completed and found at least one interference (contacts and clearance findings alone exit `0`). |
| `130` | SIGINT cancellation. |
| `143` | SIGTERM cancellation. |

`--audit` replaces STL export with a pairwise check of `audit_part("name")` components: each frame (every `--audit-pose` × every `--audit-samples`/`--audit-times` value, at most 1000) is compiled in final mode with `auditOnly`, sequentially on one worker, and `--timeout-ms` applies per frame. The text or JSON report goes to stdout or an atomic `-o` `.json`/`.txt` file; diagnostics stay on stderr, deduplicated across frames, and the first failing frame stops the audit with its frame label appended to the error.

Limitations follow the supported evaluator subset. ASCII/binary STL geometry imports are supported through the authorized filesystem adapter. This CLI does not yet implement Customizer presets, image/camera output, dependency-file emission, multiple outputs or additional import/export formats. Tests exercise real child processes, including stdin/stdout, JSON diagnostics, atomic failure preservation, native `-D` agreement, symlink restrictions and busy-worker cancellation.

## Studio and Viewer

[The studio controller](openscad.js) now invokes `createWorkerEngine()` for preview and final export. A newer preview supersedes old work; only the latest completion updates the scene. Explicit cancellation leaves the last good model visible, and compilation errors do not discard it. Located error messages can focus the matching editor offset. Warnings and echoes are displayed without changing successful compilation into an error.

[The viewer component](src/viewer/viewer.js), exported as `openscad-js-studio/viewer` with [types](src/viewer/viewer.d.ts), accepts a host element and successful compilation results. It has no editor, fixed element IDs, worker, or page-level toolbar of its own; multiple instances can use independent containers. It copies mesh/overlay buffers into GPU geometry, so callers may dispose compilation handles immediately after `setModel()`. It exposes view get/set, native viewport snapshots, perspective/orthographic switching, fit, wireframe, stats, resize and idempotent disposal.

```js
import { Viewer } from "./src/viewer/viewer.js";
import { createWorkerEngine } from "./src/index.js";

const viewer = new Viewer(document.querySelector("#model-display"));
const engine = await createWorkerEngine({
	manifoldModuleUrl: new URL("/node_modules/manifold-3d/manifold.js", location.href),
});
const result = await engine.compile({ files: { "main.scad": "cube(10);" } });
try { if (result.status === "success") viewer.setModel(result); }
finally { if (result.status === "success") result.dispose(); }
```

The example above uses development-checkout paths: browser hosts must resolve `three` and `three/addons/`, as the studio import map does. For distribution embeds, import `openscad.js/core.js` and `openscad.js/viewer.js` and call `createWorkerEngine()` without URL configuration; the packaged viewer resolves its bundled Three module without an import map. Supporting URLs resolve relative to the runtime modules, not an assumed site root. On teardown, call `viewer.dispose()` and `await engine.dispose()`. `setView()` before initial model assignment preserves an explicit host view; set `viewer.locked=true` to ignore source camera changes. The viewer-only API does not require the studio controller or its global icon library.

The higher-level [preview component](src/preview/preview.js), with
[declarations](src/preview/preview.d.ts), is exported as
`openscad-js-studio/preview` and packaged `openscad.js/preview.js`. It mounts a
Shadow DOM window containing independent worker-backed compilation, viewer,
overlay controls, textarea/multi-file source panel, status, and diagnostics.
It uses the public core/viewer APIs rather than the studio controller.
Creation returns a handle before deferred visible initialization; `ready` and
explicit operations return structured outcomes, and `state` identifies errors,
cancellation, and stale displayed geometry. Final-mode download recompiles the
current snapshot without replacing the displayed model. `dispose()` releases
owned resources, including during pending worker startup. The shared viewer's
`setPaused()` suspends its animation loop for hidden previews without changing
default studio drawing behavior. See the
[artifact API guide](scripts/distribution/README.md#embed-a-preview-window).

Ordinary compilation preserves the user's camera after first successful fit. Top-level `$vpt/$vpr/$vpd/$vpf` assignments apply unless source-camera lock is enabled; two-component native view vectors default Z to zero. Native gimbal conversion uses explicit axis/order mapping, not direct Three.js Euler assignment. Fit accounts for aspect ratio and normal-solid bounds; background-only scenes fall back to visible bounds. Hidden/zero-size containers skip invalid resize work, and WebGL context restoration retains the scene. These paths have desktop/mobile, compact/wide/tall, round-trip camera, and context-recovery checks.

Preview foreground faces use Manifold original-ID/run provenance to associate inherited appearance with CSG surfaces. The first valid outer color takes precedence, matching the inspected native CSG evaluator; explicit numeric alpha overrides vector/string alpha. The viewer handles named/hex/RGB/RGBA colors, while background and debug meshes receive independent ghost/highlight styles. Lighting/transparency are Three.js presentation, not pixel-identical OpenCSG. Degenerate/invalid color warnings, complex colored 2D-profile unions/extrusions, and broader appearance conformance remain incomplete.

Background/debug meshes use material arrays with an explicit full-index draw group. A missing fallback group previously left their scene objects present but undrawn; the hand regression now compares rendered pixels with its background toggled off/on and verifies the studio's final-mode download.

The download action snapshots the current project and performs a separate render-mode compile/export using the selected entry, Customizer defines and animation time. It does not export ghost/debug meshes or reuse a `$preview=true` result. Projection, camera lock, fit, wireframe, cancellation and source-error recovery are functional controls; screenshots and canvas-pixel checks confirm nonblank, framed, interactive scenes. The studio loads multi-file sources/assets and navigates dependency diagnostics. Animation and Customizer basics are implemented below; picking beyond diagnostics, standalone 2D preview and additional language features remain outstanding.

### Studio Animation And Customizer

[Animation](src/studio/animation.js) provides an independently tested, single-flight scheduler. FPS is 1-60, steps 1-1000, loop frames use `i/N`, and manual time accepts 1. Slow geometry lowers achieved playback rate rather than accumulating jobs. Source edits, parameter edits, export, cancel, failed compilation, document hiding and an invisible viewport pause playback. Frame/time/slider controls and an animated example use `context.time`; no alternate evaluator is introduced. Source-authored cameras retain their normal policy; absent camera assignments preserve orbit state.

The frame-sequence action snapshots files/assets, typed overrides, experimental flags and viewport bindings. It serially compiles all final-mode frames and downloads one deterministic-name, uncompressed ZIP using pinned MIT `fflate@0.8.3`. Failed/cancelled runs produce no partial archive; the aggregate STL cap is 64 MiB, in addition to per-job limits. Snapshot controls are locked during export, all results are disposed, and viewer/camera/time are not modified. ZIP assembly remains synchronous; streaming and video output are not implemented.

[Customizer](src/studio/customizer.js) uses the existing AST for top-level literal defaults, excluding `$` variables, computed values and nested assignments. It supports numeric/boolean/string and 1-4-component numeric-vector controls, descriptions, `/* [Group] */`/`[Hidden]`, `[max]`, `[min:max]`, `[min:step:max]`, and numeric/string `[value:label,...]` choices. Typed structured defines have the existing API override precedence and never rewrite the source. Valid overrides survive compatible source edits and entry switching; replacement clears settings after confirmation. This is a bounded Customizer subset, not complete native UI metadata compatibility.

Named presets are held per entry and import/export OpenSCAD `fileFormatVersion: "1"`/`parameterSets` JSON. Native string-serialized non-string values are parsed as literals only; unknown fields are ignored, invalid known values reject imports atomically. Budgets are 128 parameters, 128 presets, 128-character preset names and 1 MB JSON. Source and preset files are downloaded, not written to original paths or persisted across refresh. Browser tests cover override/source separation, ranges, preset import/export and invalid values, timed final STL, bounded playback/error pause, camera retention, deterministic frame archives, cancellation/recovery, desktop/mobile screenshots and nonblank canvas pixels.

## Studio Project Loading

[StudioProject](src/studio/project.js) manages sources, binary assets, selected entry, active editor buffer, revisions and the last compile's dependency set without a DOM or filesystem. The [studio controller](openscad.js) commits the current buffer before switching sources, changing entries, taking compile/export snapshots, or loading additions. The entry and edited source are independent: editing a library still compiles the selected main script. Error-panel navigation switches to the reported project source before selecting its offset.

The files picker accepts multiple `.scad`/`.stl` files using basenames; it cannot infer directory structure that the browser does not expose. The folder picker uses `webkitRelativePath` and strips the selected folder's single common leading directory, preserving nested project-relative paths. Other file types are ignored. Entry selection prefers an existing entry during additions, then `main.scad`, then the first loaded source; users can select a different entry explicitly.

The add-files picker merges sources/assets into the current project. Duplicate paths within one selection, attempts to replace an edited source, unsafe normalized paths, asset-only replacement projects, and size limits fail without mutating current project state. Adding an asset to an existing source project is allowed and recompiles immediately, supporting missing-asset recovery. Folder input preserves nested import paths; a loose asset is added by basename. Loading/replacement is atomic, read-only editor controls prevent concurrent edits during reads, and load generations reject stale completions.

Current budgets are 128 accepted source/asset files, 1,000,000 bytes per SCAD source, 5,000,000 combined source bytes and 20,000,000 combined STL bytes. Both selected and merged-project totals are checked. Loading reads user-selected browser `File` objects only and does not fetch arbitrary filesystem paths or URLs. The compile service retains its separate validation/budgets.

Source edits remain in memory. Auto preview is on by default and debounced by 600 ms; successful compile dependencies identify which edited source affects the entry. Pending dependency invalidation survives switching to or editing an unrelated buffer. After a failed or discarded stale compile, edits conservatively schedule a retry. Changing entries or adding files recompiles directly. With auto preview off, changed buffers show `MODIFIED` until explicit Preview; stale results cannot overwrite a newer revision. Ordinary previews retain camera state; project/entry changes refit by default unless source-camera lock is on.

Project/example replacement asks before discarding edited sources. The source-download action saves the active buffer as a browser download and uses that text as its new clean baseline; it does not write to the originally selected file. Final STL uses the selected entry basename. There is no persistent browser storage, external file watcher, directory write-back, project archive export, removal/rename editor, or recursive folder merge picker yet. Refreshing can lose in-memory edits; download them before leaving the page.

Pico's actual sources and binary STL asset are tested through project preview and final download. Other checks cover nested folder imports, entry changes, dependency edits, error navigation, failed-load preservation, cancellation of unsaved replacement, disabled auto preview, and mobile layout screenshots. Folder picking relies on browser directory-input support; browsers without it can use individual files with flat paths. Broader browser/OS picker behavior remains a release gate.

Three.js `0.180.0` (MIT), Lucide `0.468.0` (ISC), and DM Mono/Manrope Fontsource `5.3.0` (OFL-1.1) are pinned local runtime assets alongside Manifold. No runtime CDN/font request is needed in the tested studio. The development checkout serves selected assets from `node_modules`; the standalone distribution bundles/vendors its runtime subset and includes dependency/font licenses and notices. Embedded-component provenance review remains a release requirement.

## Virtual Project Resolver

[The resolver](src/core/project.js) accepts an entry path (default `main.scad`), a string-valued file object or `Map`, ordered `libraryPaths`, and an optional asynchronous `resolver(path, { signal })`. It never implicitly accesses the filesystem or network. Missing sources are indicated by `undefined`. A trusted host adapter must enforce its own real filesystem/URL permissions, including symlinks or decoding behavior, in addition to logical path validation.

Resolution uses the containing file's directory first, then ordered library roots, with normalized POSIX paths. Parent-relative references may stay within the project root; absolute paths, URL schemes, backslashes, control characters, and root escape are rejected. File names may contain spaces. Dependency paths and AST locations remain normalized and source-specific. Unique loaded file count/UTF-8 bytes, include depth, and expanded statement count are bounded; repeatedly included content still counts toward expansion limits.

`include` splices statements into the current scope and executes top-level contents. `use` imports module/function definitions with library-local bindings without exporting ordinary assignments or running top-level geometry/echo. Nested relative dependencies and library defaults have native fixtures. Missing files and include/use cycles are fatal in this initial service; this deliberately stricter policy and recursive-use/re-export edge cases need further native compatibility work. Direct `evaluate()`/`compileScad()` calls containing unresolved directives fail; use the service or `resolveProject()` followed by evaluation.

## Reusable Core API

[The parser](src/core/parser.js) returns a source-located syntax tree. [The evaluator](src/core/evaluator.js) returns an immutable semantic geometry tree without initializing WASM or accessing a DOM. [The compiler](src/core/compiler.js) turns that tree into a Manifold solid through the primitive adapter.

```js
import createModule from "manifold-3d";
import { evaluate, CAPABILITIES } from "./src/core/evaluator.js";
import { compileScad } from "./src/core/compiler.js";

const source = "$fn=24; difference() { cube(10); cylinder(h=12,r=2); }";
const evaluation = evaluate(source, { mode: "render", file: "model.scad" });
console.log(evaluation.tree, evaluation.echoes, CAPABILITIES.status);

const module = await createModule();
module.setup();
const result = compileScad(source, module, { mode: "render" });
try {
	console.log(result.solid.volume(), result.getMesh(), result.diagnostics);
} finally {
	result.dispose();
}
```

`compileGeometry(evaluation, module, options)` compiles an existing evaluation without parsing twice. Results expose `evaluation`, `diagnostics`, `layers`, `solid`, `getMesh()`, and an idempotent `dispose()`. Callers must dispose the result and must not independently delete its solid. `getMesh()` rejects access after disposal; intermediate kernel objects are released on success and failure. Neither loading nor compiling requires Three.js, WebGL, or a native executable at runtime.

The tree preserves group/module boundaries, ordered transform wrappers, Boolean child operands, source locations, appearance wrappers, modifier flags, and per-primitive special-variable snapshots. It is not a flattened list of display meshes. Preview results retain semantic background/debug subtrees with their transform/appearance ancestors and independently compiled overlay meshes, now consumed by the viewer. Background geometry is excluded from final solids; debug geometry contributes normally. Root selection limits the compiled subtree and disabled calls do not contribute geometry.

Reference-tested nuance: `intersection() { cube(4); %translate([1,1,1]) cube(2); }` retains the cube, but placing `%` inside the normal transform (`translate(...) %cube(2)`) leaves an empty transform operand and yields an empty intersection. The tree/compiler deliberately preserves this distinction instead of flattening all background descendants away.

Supported initial language forms include lazy scope-level last-assignment bindings, forward module/function definitions, anonymous expression closures with lexical capture, dynamically inherited special variables, parameters/defaults, `children()`, conditionals, recursion, `for`, finite ranges, indexing, vector aliases, scalar/basic-vector arithmetic, ternary/short-circuit logic, `let`, and named built-in function call syntax. Native built-in dispatch consumes labeled-call values in source order instead of reordering them by label. Echo messages and warnings are structured result data rather than mandatory console output. `$preview` follows mode and `$t` follows the selected time snapshot.

`parent_module()` uses a separate stack of active user-module calls; user-function and anonymous-function calls do not add module frames. Objects are represented as prototype-safe `ScadObject` maps. `object()` and `has_key()` are gated by the native-compatible `object-function` experiment; `is_object()` is always available. The constructor supports named keys, object/map merge and list entries `[key,value]` / `[key]` for set/delete. Dot and string-key indexing read properties. API `defines` snapshots accept bounded nested JSON-like objects. Object methods and automatic `this` binding are unsupported; imported native objects are also outside the current subset.

`textmetrics()` and `fontmetrics()` share bundled/runtime font resolution with geometry. The service resolves faces on demand and retries synchronous evaluation after asynchronous preparation; preparation retries restore the shared random stream. Direct synchronous `evaluate()` calls without prepared metrics report `unresolved-font`. Text metrics currently support printable Latin ASCII, English/default language, left-to-right direction, and basic alignment/spacing. Outline bounds use OpenType glyph boxes and may differ slightly from FreeType grid-fit values; the native fixture tolerance is 0.02 for tested metrics. Unicode text, complex shaping, and broader script/language combinations remain unsupported.

On-demand font preparation also covers `defineExpressions`, including CLI `-D`, so metric overrides need no metric call in the source itself. Extrusion parameter regressions now cover native height default 100, h/height precedence and 2026 positional scale/center binding. Direction v and nonzero segments fail explicitly; zero segments is accepted as no extra contour segmentation. Invalid-type/diagnostic parity and automatic slices remain unfinished.

`CAPABILITIES` declares a partial profile and lists the current syntax/geometry families and major unsupported features. Unsupported modules/functions fail explicitly with `ScadError`; unknown variables produce a warning and `undef`. Locations include file, offset, line, and column. Exact native warning wording and complete source spans are not yet guaranteed.

`hull()` uses Manifold convex hulls for 2D and 3D. `offset()` supports 2D round (`r`), miter (`delta`) and chamfer (`delta,chamfer=true`) joins with `$fn/$fa/$fs` round-join resolution and vertex limits. `fill()` unions 2D children and removes nested hole contours. `resize()` scales 2D cross-sections and 3D solids about the origin, including native `auto` sizing. `rotate_extrude()` supports full/partial sweeps, start angles, reflected profiles and `$fn/$fa/$fs` segment counts; profiles crossing the Y axis fail explicitly. `projection()` supports XY outline and Z=0 cut via Manifold. Three-dimensional `minkowski()` uses Manifold sums after centering operands and restoring their summed centers; 2D Minkowski remains unsupported. Native tests exercise translated, multi-operand and hollow sums. Built-in function labels are accepted while values remain in source order, matching observed native behavior.

The built-in function set includes common scalar/trigonometric operations plus `cross()`, piecewise-linear `lookup()`, Unicode-aware `search()`/`chr()`/`ord()`, `version_num()`, and `rands()`. Cross supports scalar 2D determinants with native nonnumeric-to-zero conversion, plus validated finite numeric 3D vectors; covered warning categories and messages match native. Norm validates one numeric vector and follows native sum-of-squares/overflow/NaN behavior; both warn and return undef for selected invalid arguments rather than coercing or throwing host errors. Nonfinite echo/str spellings match inf/-inf/nan; general numeric formatting and warning wording outside tested cases remain partial. Seeded rands matches the pinned native MT19937 stream for numeric seeds; non-finite bounds/counts use native recovery behavior, and result count is bounded by the evaluator step limit. Unseeded calls advance a shared runtime stream; the API `randomSeed` option deterministically initializes each evaluation, while the default initial seed source differs from native time/process seeding. Anonymous closures support parameter defaults, named arguments, recursion through captured bindings, higher-order calls and dynamic special-variable lookup at the call site. Broader built-in and closure edge-case compatibility remains unfinished. Numeric matrix products, bounded comprehensions, STL/polyhedron inputs, restricted text and experimental concave/holed roofs are implemented; mixed-type/vector ordering remains unsupported. Only basic planar 2D transforms and 3D `multmatrix` are implemented. Twisted extrusion requires explicit slices and broader extrusion conformance remains outstanding. Basic preview materials use original-ID provenance; appearance edge cases, scalar/type coercion and malformed-argument behavior are not fully native-compatible. Top-level 2D-only output is rejected by final-solid compilation.

`dxf_dim()` and `dxf_cross()` are also registered expression functions. They consume named DXF file options and add resolved DXF inputs to compile dependencies; their bounded entity support and omissions are listed above and in the [native-backed built-in inventory](references/BUILTIN_FUNCTIONS.md).

Low-level geometry compilation is synchronous; the worker-backed service keeps it off the caller's thread and adds operation/startup deadlines. Source/token/parser-nesting limits, evaluation step/range/call-depth limits, project limits, primitive triangle budgets, and circle/slice guards bound selected risks, but do not constitute a complete job-wide memory budget. Initial standalone packaging is implemented below; expanded editor/project workflows remain outstanding.

## Primitive Adapter API

[GeometryAdapter](src/geometry/manifold.js) accepts an already initialized Manifold module. It imports neither a DOM nor a WASM loader and can be used unchanged in Node or a browser worker. [The tessellator](src/geometry/tessellation.js) can also generate indexed typed-array meshes without Manifold.

```js
import createModule from "manifold-3d";
import { GeometryAdapter } from "./src/geometry/manifold.js";

const module = await createModule();
module.setup();
const geometry = new GeometryAdapter(module, {
	specialVariables: { $fn: 0, $fa: 12, $fs: 2 },
	maxTriangles: 1_000_000,
	onDiagnostic: (warning) => console.warn(warning.code, warning.message),
});
const childScope = geometry.withSpecialVariables({ $fn: 24 });
const sphere = childScope.sphere({ d: 10, $fn: 32 });
const cone = geometry.cylinder({ h: 10, r1: 4, r2: 0, center: true });
try {
	const mesh = sphere.getMesh();
	console.log(mesh.triVerts.length / 3, cone.volume());
} finally {
	sphere.delete();
	cone.delete();
}
```

Returned solids are caller-owned Manifold objects and must be deleted. They support native kernel transforms/Booleans and mesh extraction, but do not yet carry SCAD appearance, source identity, or modifier flags. The adapter itself owns no solid resources. Browser callers provide their own locally loaded module, as the existing test worker does.

Resolution precedence is adapter defaults, a per-call scope object (the second method argument), then primitive-local `$fn/$fa/$fs` arguments. `withSpecialVariables()` makes an independent frozen settings snapshot and does not mutate its parent. The standalone tessellation functions take an explicit resolution object; local-argument merging belongs to the adapter.

Positive `$fn` overrides adaptive resolution, rounds upward, and has a minimum of three. Otherwise adaptive resolution uses the smaller angular/linear estimate and a minimum of five. Negative `$fn` becomes zero; `$fa/$fs` below `0.01` are clamped with diagnostic codes. Native tiny-radius fallback below `2^-20` uses three fragments. Cylinders choose resolution from the larger end radius; `d/d1/d2` override their corresponding radius parameters with diagnostics.

This typed API requires finite numeric dimensions and resolution settings, and Boolean `center`. It returns empty geometry with diagnostics for nonpositive sphere radius, nonpositive cylinder height, negative cylinder radii, or two zero radii. Unlike the native evaluator's sometimes permissive value handling, non-finite or incorrectly typed API inputs are rejected; conversion/warning behavior remains a future evaluator responsibility. Only sphere `style="orig"` is implemented; `style="octa"` fails explicitly. Experimental `$fe` is not part of the default resolution contract.

The configurable triangle limit is enforced before mesh allocation, independently per primitive. It is not a whole-job memory budget. Coordinates are stored as Float32 for the Manifold mesh API; general extreme-scale geometry remains unverified.

## Resolved Incompatibility and Performance

For `sphere(r=5, $fn=32)`, OpenSCAD and `Manifold.sphere(5, 32)` produce different surfaces:

| Measurement | Observed Value |
| --- | --- |
| Native volume | 515.2487099 |
| Raw Manifold constructor volume | 511.9025126 |
| Raw constructor symmetric-difference volume | 4.9147506 |
| Adapter volume | 515.2487101 |
| Adapter symmetric-difference volume | 0.0000021 |

The regression now confirms both the raw constructor mismatch and the adapter's compatible geometry. The adapter generates offset latitude rings and flat end caps rather than using the geodesic constructor; equivalent surfaces do not require identical triangle ordering.

On an AMD Ryzen 5 7640U, Linux, Node 18.19.1, 100 warmed fixture build/measure/STL-round-trip/dispose cycles in the expanded corpus measured approximately 0.73 ms median and 18.14 ms p95. The initial smaller corpus measured 0.57 ms median and 2.72 ms p95; the changed model mix makes these figures non-comparable as an optimization benchmark. These are small models, not a large-CAD benchmark or a cold-start budget. The Node test emits updated runtime/CPU/timing data; Playwright attaches browser initialization and execution metrics to its test results.

## Standalone Packaging Checkpoint

`npm run build` runs [the distribution builder](scripts/build-distribution.js)
and stages a standalone `dist/` candidate. Phase 1 provides public
`openscad.js/core.js`, `openscad.js/viewer.js`, and `openscad.js/cli.js` entries,
with supporting files beneath `openscad.js/runtime/`, a full `editor.html`, and
a minimal worker/STL `demo.html`. Documented legacy entry paths remain available.
The extension builder consumes the relocated runtime assets. External
JS dependencies are bundled/vendored, viewer addons share a local Three module,
fonts and both WASM kernels are included, and source-module relationships preserve
worker and asset URLs. The generated private package has no npm runtime
dependencies; reference sources, tests and unused npm export tooling are absent.
Its readme, licenses, legal-comment sidecars, third-party notices and hashed
inventory travel with the package. Build-time font input still comes from the
development reference checkout; runtime font loading does not.

[The package test](tests/distribution.node.test.js) checks repeated-build
inventory identity, exact tarball contents/hashes, offline installation into a
clean temporary consumer, and installed API/worker/viewer/CLI behavior with
text and both roof methods. [Distribution browser tests](tests/distribution.spec.js)
verify default direct-engine and worker loading under a nested URL, text/roof
WASM, bundled fonts, final STL, and desktop/mobile screenshots with real
geometry-pixel changes. Requests outside `dist/` are blocked. The full gate
passed on 2026-10-04: 311 Node tests, 147 browser tests (49 per engine), and
strict public declarations. This is a distribution candidate, not public
publication, a complete transitive license audit or full offline installation.

## Licensing and Packaging Follow-Up

The candidate declares Apache-2.0 for original work. The subsequent bounded
runtime/asset reviews are recorded in [third-party notices](THIRD_PARTY_NOTICES.md)
and the [source-asset review](references/README.md). The standalone build now
inventories actual bundle inputs, retains required notices, and verifies pinned
Manifold/roof inputs. The extension also delivers the pinned OCCT source payload
and replacement instructions. These reviews are not legal certification.

Installed dependency manifests include MIT, Apache-2.0, ISC, and
LGPL-3.0-or-later declarations. The npm package's glTF/export tooling brings in
Sharp and native `libvips` packages; those are not shipped by the selected
kernel-only distribution. Do not replace that selection with the full npm
dependency tree without a new review or make a blanket Apache-only claim.

Normal builds consume prebuilt kernels and do not require a C++/Emscripten
toolchain. The separate roof/OCCT rebuild reviews used pinned toolchains as
documented in their provenance records. Committed root and extension lockfiles
pin the npm dependency graphs installed by `npm ci`; they do not pin system
libraries, native compiler toolchains or independently downloaded sources.
Reviewed binary hash guards and selected artifact inventories provide separate,
bounded checks of runtime inputs.

## Remaining Feasibility Gates

Before claiming broader compatibility, extend checks to newer sphere styles, twist/scale/revolve edges, curved coplanar/tangent cases, large coordinates, thin walls, invalid polyhedra, and representative real models. Initial resource/cancellation/restart measurements, three-engine Linux testing and standalone packaging now have recorded evidence; longer-run/job-wide memory accounting, arbitrary strict-CSP deployment and physical mobile-device validation remain open. Safari/iOS is explicitly unsupported for this release; Playwright WebKit is regression coverage, not Safari certification.

The next release-focused boundaries are exact-candidate deployment/host smoke
tests using the [release checklist](RELEASE_CHECKLIST.md) and hosted Actions
verification after a push. The [local release gate](README.md#complete-local-release-gate)
checks both projects and their actual archives. Broader real-model language
coverage, expanded Customizer compatibility and project persistence/workflows
can remain separately prioritized. Experimental roof verification/documentation
and studio animation/Customizer basics are implemented with the limits above.