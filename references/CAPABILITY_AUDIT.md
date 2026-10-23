# Capability Audit

Initial audit: 2026-10-03 against project revision `9ce8469` plus the recorded
audit change set. Coverage notes include subsequent scoped updates; historical
corpus baselines are separate evidence, with deliberate model-local recaptures
documented in [the conformance report](LANGUAGE_CONFORMANCE.md#captured-baselines).
Oracle: OpenSCAD 2026.10.02, revision `7d44e5796cd489bcbfb8cef0720abe4db60ce35e`.
The [runtime manifest](../src/core/evaluator.js) is a selected-family inventory,
not an exhaustive list of native built-ins. A family appearing there does not
mean every parameter, value, diagnostic or geometry case is native-compatible.
All entries below are **partial** unless explicitly experimental. Test references
identify existing evidence, not certification of every restriction.

Current distribution and three-engine verification are summarized in
[project status](../README.md#current-status). Passing packed-consumer and
browser tests validates selected hosts/assets, not additional native semantics.

## Language Claims

| Manifest Claim | Existing Evidence | Restriction Or Audit Finding |
| --- | --- | --- |
| `audit_part:extension-interference` | [component audit service tests](../tests/service.node.test.js), [CLI audit tests](../tests/cli.node.test.js) | Project extension, not an upstream OpenSCAD primitive. Named solid components support bounded sampled overlap/contact/clearance checks; sampling is not continuous-motion collision certification. |
| `assignments` | [scope tests](../tests/evaluator.node.test.js), [native reference](../tests/language-reference.node.test.js) | Lazy last-assignment behavior; exact warning wording differs. |
| `modules`, `functions` | [scope/recursion tests](../tests/evaluator.node.test.js), [project fixtures](../tests/project.node.test.js) | Bounded recursion, selected binding/default cases; malformed parameter binding needs differential coverage. |
| `anonymous-functions:closures`, `callable-expressions` | [closure tests](../tests/evaluator.node.test.js), [browser worker](../tests/backend.spec.js) | Immediate, indexed and member-expression calls work; object methods still have no automatic `this` binding. |
| `objects:experimental-object-function`, `object-methods:experimental-object-function` | [object tests](../tests/evaluator.node.test.js), [native oracle](../tests/language-reference.node.test.js), [CLI](../tests/cli.node.test.js) | Experimental `object-function`; merge/set/delete/access, recursive equality/inequality, and receiver-bound function properties with explicit `this` parameters. Ordering and diagnostic parity remain partial. |
| `import-function:experimental-json` | [JSON import tests](../tests/import.node.test.js), [native oracle](../tests/import.node.test.js), [browser worker](../tests/backend.spec.js) | Experimental expression `import()` reads JSON only from authorized project sources/assets; null maps to undef, malformed/missing inputs warn, and size/import-count limits apply. Other data formats remain unsupported. |
| `vector-swizzle:experimental` | [swizzle tests](../tests/evaluator.node.test.js), [native oracle](../tests/language-reference.node.test.js) | Opt-in `vector-swizzle` supports x/y/z/w component selection and ordered multi-component reads. |
| `parent_module` | [native stack fixtures](../tests/language-reference.node.test.js), [browser worker](../tests/backend.spec.js) | Native tests cover indexed stack lookup, explicit/default module arguments, repeated `children()` re-entry, function/closure exclusion, recursion, include/use definitions, fractions, signed-int boundaries, invalid argument types/counts and range warnings. The tested stack/index semantics match the pinned profile; broader unusual numeric inputs remain partial. |
| `textmetrics:liberation-fonts`, `fontmetrics:liberation-fonts` | [metrics and override fixtures](../tests/language-reference.node.test.js), [font selection fixtures](../tests/text-roof.node.test.js), [worker](../tests/backend.spec.js), [CLI](../tests/cli.node.test.js) | Prepared bundled Liberation Sans/Serif/Mono regular/bold/italic faces; printable ASCII/LTR/English, approximate glyph bounds. A4 repaired below: preparation includes calls in expression overrides. |
| `built-in-functions:cross-lookup-search-chr-ord-rands-version_num` | [built-in tests](../tests/evaluator.node.test.js), [native echoes](../tests/language-reference.node.test.js), [worker](../tests/backend.spec.js), [CLI](../tests/cli.node.test.js) | `len()` counts Unicode string code points, vectors, and experimental objects; ranges and other unsupported types warn/return undef. `abs/sign/round/floor/ceil`, `sqrt/exp/ln`, both `log()` overloads, `pow()`, and degree trigonometry match tested native validation, warnings, domain, exact-angle, tie/NaN, and overload behavior. Cross covers native 2D determinants/zero conversion and finite numeric 3D vectors with located warnings for invalid arity/dimensions/3D values. Search matches tested native overloads, row-validation warnings, early termination, argument counts, and count/column coercion. Other built-ins and exhaustive malformed/extreme-value parity remain partial; unseeded random-stream continuation differs from native. |
| `norm` | [native vector/overflow cases](../tests/language-reference.node.test.js), [worker](../tests/backend.spec.js), [CLI](../tests/cli.node.test.js), [packed consumer](../tests/distribution.node.test.js) | One numeric vector, empty norm zero; rejects nonnumeric elements/incorrect arity with warnings. Native sum-of-squares overflow and NaN propagation retained. Exact warning wording and broader numeric formatting remain partial. |
| `hexadecimal-integer-literals` | [literal tests](../tests/language-reference.node.test.js) | Longest-match legacy names remain accepted/deprecated; malformed numeric boundaries need tests. |
| `if`, `for`, `intersection_for` | [control tests](../tests/evaluator.node.test.js), [native reference](../tests/language-reference.node.test.js) | Bounded range/dependent loops and intersections of iteration results; C-style `for` is rejected by the pinned parser, while legacy `assign`/`child()` are ignored as unknown modules. |
| `let`, `ranges`, `vectors` | [value/control tests](../tests/evaluator.node.test.js), [native reference](../tests/language-reference.node.test.js) | Bounded ranges; vector arithmetic/coercion is partial; mixed-type/vector ordering rejected. |
| `indexing`, `ternary` | [expression tests](../tests/evaluator.node.test.js) | Integer list/string access, string object keys and basic conditional expressions; unsupported call expressions remain separate. |
| `modifiers` | [layer tests](../tests/evaluator.node.test.js), [rendered overlays](../tests/viewer.spec.js) | %, #, !, * have tested selected behavior; final STL omits preview overlays. |
| `include:project`, `use:project` | [resolution tests](../tests/project.node.test.js), [filesystem tests](../tests/filesystem.node.test.js) | Explicit virtual/authorized roots, cycles and limits; no implicit network/global library search. |
| `matrix-multiplication` | [matrix tests](../tests/evaluator.node.test.js), [native reference](../tests/language-reference.node.test.js) | Numeric rectangular matrices; mixed-value and ordering semantics not complete. |
| `defines:api` | [service boundary tests](../tests/service.node.test.js), [shared cases](../tests/fixtures/boundary-cases.js), [CLI defines](../tests/cli.node.test.js) | Typed bounded snapshots and main-scope expressions; sparse slots, cycles/depth and prototype/callable-like data now covered. Broader hostile host objects and allocation budgets remain priorities. |
| `numeric-prefix-identifiers:deprecated` | [native lexer tests](../tests/language-reference.node.test.js) | Accepted with a source-located deprecation; not equivalent to the optional Unicode identifier feature. |
| `list-comprehensions:for-if-each-let` | [native comprehension tests](../tests/language-reference.node.test.js) | Selected for/if/else/each/let forms; C-style comprehensions absent. |
| `named-built-in-function-arguments` | [named-call fixture](../tests/language-reference.node.test.js) | Legacy arithmetic/list built-ins consume values in source order; metrics/object constructors have separate named binding. This is not a blanket rule for every native function. |
| `dxf-functions:dimension-and-line-cross` | [native DXF built-in tests](../tests/dxf-builtins.node.test.js) | `dxf_dim()` handles rotated/aligned/angular/radial/ordinate dimensions; `dxf_cross()` finds the first intersection among standalone LINE/LWPOLYLINE paths. ASCII DXF assets must resolve through the authorized project resolver; blocks, INSERT transforms, curved paths, and all other DXF entities remain unsupported here. |

The native-backed [`lookup()` edge fixture](../tests/language-reference.node.test.js) verifies unsorted and duplicate keys, out-of-range clamping, the first-row failure rule, later malformed-row skipping, and NaN/infinity coordinates.

## Geometry Claims

| Manifest Claim | Existing Evidence | Restriction Or Audit Finding |
| --- | --- | --- |
| `cube`, `sphere:orig`, `cylinder` | [native primitive/Boolean cases](../tests/backend.node.test.js) | Bounded Float32 meshes, scoped fn/fa/fs; coercion and malformed-input handling partial. Sphere style variants and fe absent. |
| `square`, `circle`, `polygon` | [extruded profile cases](../tests/backend.node.test.js) | 2D kernel profiles; standalone 2D preview/export not supported. Adversarial paths need coverage. |
| `polyhedron` | [native tetrahedron and topology validation](../tests/language-reference.node.test.js) | Face winding and bounded triangulation; nonplanar/self-intersecting faces not certified. |
| `import:stl` | [import tests](../tests/import.node.test.js), [Pico workflow](../tests/studio-project.spec.js) | ASCII/binary STL only, explicit assets and merge/topology policy; DXF geometry import and other formats absent. DXF dimension/intersection functions are a separate bounded language API. |
| `text:liberation-latin-fonts` | [native text cases](../tests/text-roof.node.test.js), [runtime font cases](../tests/fonts.node.test.js) | Printable ASCII with bundled Liberation and runtime-loaded fonts and basic layout; Unicode shaping absent. |
| `roof:experimental-voronoi-straight` | [native roof/stencil cases](../tests/text-roof.node.test.js), [worker](../tests/backend.spec.js) | Experimental roof flag; bounded contours/refinement and fixture-specific text/roof tolerances. |
| `linear_extrude` | [native parameter/profile fixtures](../tests/backend.node.test.js), [validation tests](../tests/evaluator.node.test.js) | A3 repaired below: native height default 100, h alias and 2026 positional order. Twist needs explicit slices; v and nonzero segments fail explicitly rather than being ignored. Automatic slicing remains absent. |
| `rotate_extrude` | [full/partial/reflected cases](../tests/backend.node.test.js) | Selected angle/start and fn/fa/fs behavior; a alias, fe and odd-fn diagnostics not covered. Crossing the Y axis is native-invalid, not a feature gap. |
| `projection` | [outline/cut fixtures](../tests/backend.node.test.js) | XY outline or Z=0 cut, then extrusion for export; coplanar cut boundaries need comparisons. |
| `minkowski:3d` | [translated/multiple/hollow sums](../tests/backend.node.test.js) | Center-normalized 3D kernel sums; 2D absent, expensive-job allocation and empty-operand semantics not certified. |
| `offset:2d` | [round/miter/chamfer fixtures](../tests/backend.node.test.js) | 2D only; selected joins/resolution, shrinking/concave/acute joins need comparisons. |
| `resize:2d-3d` | [auto/partial fixtures](../tests/backend.node.test.js) | Origin-based scaling of unioned children; empty/zero extents and invalid autosize types need coverage. |
| `fill:2d` | [single-hole, nested and disconnected fixtures](../tests/backend.node.test.js) | Keeps outermost contours; A2 repaired below with native shape comparisons. Native 3D fill is itself unimplemented, while this compiler rejects it explicitly. |
| `union`, `difference`, `intersection` | [native Boolean cases](../tests/backend.node.test.js), [layer grouping](../tests/evaluator.node.test.js) | Same kernel family as the selected oracle backend; touching/coplanar, empty/grouped operands and materials need continued comparisons. |
| `hull` | [2D/3D hull cases](../tests/backend.node.test.js) | Tested convex-envelope cases; point sets, degenerate inputs and output budgets need broader tests. |
| `translate`, `rotate`, `scale`, `mirror` | [transform cases](../tests/backend.node.test.js), [evaluator](../tests/evaluator.node.test.js) | 3D and planar 2D only; nonplanar 2D rotation rejected. |
| `multmatrix:3d` | [transform fixtures](../tests/backend.node.test.js), [dimension guards](../tests/evaluator.node.test.js) | Finite 4x4 matrices in 3D; 2D unsupported. |

## Repair Status

**A1: Object inequality, repaired.** Previously the object branch returned an
equality result for every operator, including inequality and arithmetic. It now
compares recursively only through equality dispatch, with native key-order
semantics, and inverts that result for inequality. Native regressions cover
equal/different objects, nested objects and vectors, key order, scalar mismatches
and arithmetic returning undef. Native arithmetic warning wording and ordering
remain outside this repair. Reproduction now returns true in both implementations:

```scad
a = object(k=1);
b = object(k=2);
echo(a != b); // true with object-function enabled
```

**A2: Nested-island fill, repaired.** Previously a retained nested island became
a hole when rebuilt with EvenOdd, yielding volume 96 instead of 100. Selecting
only outermost contours removes that redundant boundary. Native Boolean-difference
and analytic-volume regressions cover nested islands, deeper nesting, and
disconnected filled components; the worker also checks the original volume-100 case.

```scad
linear_extrude(1) fill() {
  difference() { square(10); translate([2,2]) square(6); }
  translate([4,4]) square(2);
}
```

**A3: Extrusion defaults and argument order, repaired.** Omitted height is now
100, `h` works as an alias, and `height` takes precedence when both are given.
The 2026 positional order is height, v, scale, center, twist, slices, segments;
use named parameters when possible. Nonpositive height produces empty geometry.
Direction v and nonzero segments remain unsupported and fail explicitly.
Native volume/bounds and Boolean-difference regressions cover omitted height,
alias/precedence, positional scale/center and named parameters.

**A4: Font preparation through defines, repaired.** Metric calls supplied only
through API `defineExpressions` or CLI `-D` now participate in the service's
font-preparation scan. Native metric comparisons, CLI exports and browser-worker
regressions verify the path. Font/shaping limitations are unchanged.

The captured corpus baselines remain historical audit artifacts and are not
rewritten by these repairs. Remaining differential work is exhaustive
malformed/extreme-value coverage across built-ins, plus broader parameter
coercion and font/format support. New feature families remain separately
prioritized.

**V1: Cross/norm vector semantics, repaired.** Cross previously accepted only
3D arrays and allowed JavaScript element coercion. It now supports the native
2D determinant, including nonnumeric-to-zero conversion specific to that branch,
while validating finite numeric 3D components and argument counts/dimensions.
Norm previously coerced elements through Math.hypot and could throw on a
non-vector; it now warns/returns undef for invalid arguments and follows native
numeric sum-of-squares semantics, including empty vectors, overflow and NaN.
Nonfinite scalar/vector echo and str formatting now uses inf/-inf/nan.
Cross differential fixtures compare explicit native values and warning message
text for tested invalid cases. Norm fixtures compare native values and warning
counts; its exact warning wording and broader numeric formatting remain partial.
Worker export/recovery, CLI defines/hardwarnings and offline packed-consumer
geometry are covered. The full gate on 2026-10-12 passed 368 Node tests, 216
browser tests (72 per engine), and strict declarations.

**V2: Cross diagnostics and random stream, updated 2026-10-12.** `cross()` now
matches tested native warning messages for argument conversion, vector size,
component type, NaN and infinity. `rands()` matches tested argument validation,
non-finite recovery, seeded sequences and stream advancement across compile
requests after explicit seeding. The API `randomSeed` option initializes each
evaluation reproducibly; the default initial seed remains runtime-specific.
These results supersede the historical built-in claim in the Language Claims
table; see [the current built-in inventory](BUILTIN_FUNCTIONS.md) for tested scope.

**B1: Sparse binding budgets, repaired.** Array.map skipped holes, letting oversized
sparse vectors bypass the snapshot value counter. Array length is now checked
before copying, and sparse slots count as undefined values. Exact-limit and
one-over/aggregate-limit cases run in direct, Node worker and browser hosts.

**B2: Callable-shaped data, repaired.** JSON-like fields could impersonate the
anonymous closure marker. Closures now use an internal class, so these fields
remain ordinary object data and cannot be invoked as evaluator functions.

**B3: Prototype-like names, repaired.** Parameter binding used a plain object,
losing __proto__ values; inherited function-table entries also resolved as
built-ins. Binding maps are now prototype-free, and dispatch uses own entries.
Native comparison verifies valid prototype-like parameter names; shared
robustness cases verify inherited built-in names fail with structured errors.

**R1: Extrusion subdivision budget, repaired.** A ten-slice square could generate
84 triangles under a budget of 10. Side/cap triangle estimates now reject before
kernel subdivision, with a final triangle-count guard. Exact square and holed
limits are tested; estimates may conservatively reject collapsing/simplified
profiles under very tight budgets.

**R2: Queue payload allocation, repaired.** Queue capacity used to be checked
after cloning requests. Saturated queues now reject before reading/cloning the
payload, with a regression that observes zero payload getter reads.

[Resource measurements](LANGUAGE_CONFORMANCE.md#resource-and-lifecycle-measurements)
record cancellation settlement and observed worker exit separately. Timing and
RSS are measurements, not universal resource guarantees.