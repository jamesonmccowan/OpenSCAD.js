# Native-Backed Built-In Function Inventory

Compared with the pinned OpenSCAD 2026.10.02 source at revision
`7d44e5796cd489bcbfb8cef0720abe4db60ce35e`. This inventory covers registered
expression functions, not built-in modules, language keywords, or exhaustive
argument-by-argument conformance.

The native registration sites are `references/openscad/src/core/builtin_functions.cc`
and `references/openscad/src/io/dxfdim.cc`. The JavaScript implementation is
the evaluator's function dispatch plus dedicated handlers for predicates,
metrics, objects, and JSON imports. `tests/builtin-inventory.node.test.js`
compares those native registration names with this list and verifies which names
have a JavaScript implementation path.

| Family | Native functions | JavaScript status |
| --- | --- | --- |
| Numeric | `abs`, `sign`, `min`, `max`, `round`, `ceil`, `floor`, `pow`, `sqrt`, `exp`, `ln`, `log` | `abs()`/`sign()`/rounding/`sqrt()`/`exp()`/`ln()`/`pow()` enforce tested native arity/type validation. `pow()` also matches tested libm special cases for unit bases with non-finite exponents; named arguments preserve source order. `sqrt()`/`exp()`/`ln()`/`log()` are tested at subnormal, overflow/underflow, domain, and unusual-base boundaries. `log(value)` is base 10; `log(base,value)` supports an explicit base. `min()`/`max()` match tested vector/variadic validation and ordered NaN behavior. Other scalar functions retain partial parity. |
| Trigonometry | `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2` | Degree functions match tested exact-angle reduction, inverse-angle snapping, tangent poles, non-finite/domain results, and strict arity/type warnings. Other numeric extremes remain partial. |
| Strings and lists | `len`, `str`, `chr`, `ord`, `concat`, `search`, `lookup` | `len()` counts Unicode string code points, vectors, and objects; it rejects ranges and other unsupported types with native-style diagnostics. `str()` uses native six-significant-digit number formatting and SCAD-style nested vector/object/range and anonymous-function text; only tested expression forms are claimed. `lookup()` matches tested unsorted/duplicate key selection, boundaries, malformed first/later rows, and non-finite pair behavior. `search()` matches tested native overloads, row warnings, early stops, argument counts, and count/column coercion. Exhaustive malformed/extreme-value parity is not claimed. |
| Vectors and random | `norm`, `cross`, `rands` | `norm()` preserves native square overflow, subnormal accumulation, and underflow behavior. `cross()` preserves tested 2D/3D overflow, underflow, and cancellation arithmetic, plus native warning messages for argument conversion, vector size, invalid component type, NaN, and infinity. `rands()` matches tested arity/type warnings, non-finite bound/count recovery, non-finite seed hashing, and stream advancement across compile requests after explicit seeds. The API `randomSeed` option deterministically initializes each evaluation; without it, the initial stream is runtime-seeded and differs from native time/process seeding. |
| Version and reflection | `version`, `version_num`, `parent_module` | `version_num()` matches tested no-argument default, 2/3-component date vectors, invalid-vector `undef`, non-finite arithmetic, and extra-argument handling. `parent_module()` matches tested stack and parameter behavior. |
| Predicates | `is_undef`, `is_list`, `is_num`, `is_bool`, `is_string`, `is_function`, `is_object` | Match tested native type classification, one-argument warnings, NaN handling, quiet `is_undef(missing_variable)`, and object/function values under experimental semantics. |
| Text metrics | `textmetrics`, `fontmetrics` | Implemented for bundled Liberation Sans/Serif/Mono regular/bold/italic faces and supported Latin layout; shaping is bounded. |
| Experimental objects | `object`, `has_key` | Implemented behind `object-function`; ordering and diagnostic parity remain partial. |
| Experimental data import | `import` | JSON only, behind `import-function`, resolved from authorized project inputs. |
| DXF helpers | `dxf_dim`, `dxf_cross` | Implemented for DIMENSION values and standalone LINE/LWPOLYLINE intersections from authorized ASCII DXF files. Blocks, INSERT transforms, and curved intersection paths are outside this slice. |

`concat()` accepts zero or more values, expands each vector argument by one level, and preserves nested vectors and source argument order.

The native registration count is **46**; all registrations now have JavaScript
implementation paths, with DXF coverage bounded as described above. A
registered function's presence does not claim complete native compatibility; consult
[the capability audit](CAPABILITY_AUDIT.md) and the focused differential tests.