# Historical Model Samples

These models are development/conformance inputs, not bundled runtime examples
or a guarantee of full OpenSCAD compatibility. The assessed corpus contains 13
SCAD entries; [captured results](../LANGUAGE_CONFORMANCE.md#captured-baselines)
record source/asset hashes, preview/final outcomes and native metrics.

Four original models are rejected by both the JavaScript and pinned native
2026.10.02 parsers. They are intentionally preserved. The Pico import example
now uses an original calibration solid instead of the former third-party case.
Mecanum's final export
succeeds, but its preview is blocked by a missing/restricted background STL.
The numeral stencil requires explicit experimental roof opt-in. Successful
volume/bounds comparisons alone do not establish shape equivalence.

For the Pico import test, load `pico.scad`, `parts.scad` and `import-base.stl`, then select
`pico.scad` as the entry. Source/asset paths and limits are documented in the
[studio project workflow](../../BACKEND_FEASIBILITY.md#studio-project-loading).

## Model Viewer Samples

`cube.stl`, `plate with hole.step` and `hex prisms.3mf` are small, original
files for testing the extension's model viewer:

- `plate with hole.step`: a hand-written AP214 B-rep of a 30 × 20 × 5 mm plate
  with a 6 mm through hole. Its volume is about 2858.6 mm³.
- `hex prisms.3mf`: one hexagonal-prism mesh, 20 mm across the corners, placed
  twice. The second copy is scaled by 1.5 in Z. Together they measure
  45 × 17.32 × 15 mm.

## Attribution And Redistribution

The sample author confirms that the retained sample files are original work;
they follow the repository's Apache-2.0 license.

`viewer-calibration.gcode` is original synthetic visualization/test data, not a
slice of a downloaded model or a printer-ready job. It contains 55 rectangular
layers, one outlying `Custom` purge line, and synthetic slicer-style metadata.
Its generator contains no third-party printer/filament macros. Regenerate it:

```sh
node scripts/build-gcode-fixture.js
```

It replaces the former slicer export `multi gas trap cover v3_0.2mm_PC_21m21s.gcode`,
whose embedded printer/filament profiles were not independently licensed in
this review. The replacement tests metadata and viewer controls, not the full
complexity of that real slicer export. Do not send this test fixture to a printer.

`parts.scad` and `rover.scad` still refer to external battery-adapter meshes
(`../stl/dewalt_battery_top.stl` and `stl/Dewalt_Adapter_-_Battery_Clip.stl`).
Those files are absent and are not redistributed or licensed by this project.
The references are not permission to download or redistribute those designs.
No external files are fetched or synthesized to satisfy those imports.

`import-base.stl` is an independently designed calibration solid, not a copy or
adaptation of the previously imported case. Its source is
[import-base.scad](../../tests/fixtures/import-base.scad): a 24 x 16 x 4 mm
block with a rectangular through-hole and a corner boss, volume 1472 mm3.
Regenerate it from the repository root:

```sh
node bin/openscad-js.js tests/fixtures/import-base.scad -o "references/scad sample files/import-base.stl"
```

The former `pico lower.stl` and `pico upper.STL` were downloaded from
[Slim modular Raspberry Pi Pico Case by maximilliampere](https://www.thingiverse.com/thing:4808999)
under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), as
confirmed by the sample author. They have been removed from the current tree;
the project license does not relicense any copies retained in Git history.
Publishing that history still redistributes the former assets and needs a
separate decision about compliance or history cleanup.

See [the source-asset review](../README.md) for the upstream submodule boundary,
other fixture provenance, and the limits of the review. Removed files can still
exist in old Git history; current-tree remediation is not history cleanup.
