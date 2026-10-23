# Reference and fixture provenance

This directory mixes original project material with a separately licensed
upstream Git submodule. The root Apache-2.0 license does not override upstream
licenses or turn missing external assets into licensed project content.

## Current-tree review

Reviewed on 2026-10-19, after the runtime, JavaScript/icon and font passes:

| Material | Provenance and license boundary |
| --- | --- |
| `scad sample files/*.scad` | The project author confirmed these retained model designs are original. Apache-2.0 applies. See the [sample notes](scad%20sample%20files/README.md) for intentionally broken inputs and absent external imports. |
| `scad sample files/cube.stl` | Original project-generated binary cube fixture, with an OpenSCAD.js export header. Its editable [cube source](scad%20sample%20files/cube.scad) is retained. |
| `scad sample files/import-base.stl` | Independently designed calibration fixture, generated from [its original source](../tests/fixtures/import-base.scad). Not a derivative of the removed third-party Pico case. |
| `scad sample files/plate with hole.step` | Original hand-written plate-with-hole fixture. Its STEP header identifies the project and hand-written generation; no upstream CAD source is claimed. |
| `scad sample files/hex prisms.3mf` | Original test archive containing a hexagonal-prism mesh and two transformed instances. Reviewed archive members are `[Content_Types].xml`, `_rels/.rels` and `3D/3dmodel.model`; no imported model, thumbnail or printer profile is embedded. |
| `scad sample files/viewer-calibration.gcode` | Original deterministic [fixture generator](../scripts/build-gcode-fixture.js), with synthetic metadata and no copied printer-profile macros. Visualization/test data only, not prepared for printing. |
| [Doughnut fixture](../tests/fixtures/doughnut.scad) | The project author explicitly confirmed this is their own design, not an official upstream OpenSCAD example. Apache-2.0 applies. |
| [Language reference](language_features.scad), [pending cases](language_features_pending.scad), JSON inputs and JS test fixtures | Project conformance inputs expressing behavior and test expectations; no third-party source attribution was found in this bounded scan. The project license applies to original contributions, not any independently established upstream content. |
| Markdown reports and JSON baselines | Project specifications, measurements and development records. They are evidence of tested behavior, not permission to redistribute their cited sources or an upstream license certification. |
| [OpenSCAD submodule](openscad/) | Separately licensed upstream source pinned to `7d44e5796cd489bcbfb8cef0720abe4db60ce35e` from https://github.com/openscad/openscad. Preserve its own [COPYING](openscad/COPYING), source headers and bundled-component notices when redistributing a checkout/archive that contains it. Its font files have their own OFL license. |

The review inspected current tracked asset names, SCAD external imports,
retained model metadata, source attribution markers and artifact selection.
Authorship confirmations are the author's representations, not an independent
proof of ownership. Absence of a copyright header does not prove originality,
and this pass is not an exhaustive textual-similarity or legal audit of every
implementation, dependency or upstream file.

The early `openscad specs.md` research-service export was removed with the
author's approval; the maintained [specification](../SPECIFICATION.md) and its
upstream links replace it. No rights in the export's cited manuals, articles,
code examples or service branding are inferred from its former presence.

## Repository versus runtime artifacts

The public source repository retains the original samples for development.
The standalone distribution does not ship this sample corpus, test fixtures,
research documents, or the upstream native source/executable. It ships only
the selected unmodified Liberation fonts from the reference checkout, with
their OFL text. The VSIX ships its own original
[cube example](../extension/examples/cube.scad), not this development corpus;
its separately supplied OCCT sources remain covered by the OCCT review.

The submodule is a link in the parent Git tree, but a recursive checkout or
source archive that includes it contains upstream content with its own
obligations. Do not describe that combined source tree as Apache-only. The
reference executable is used as a separate development oracle; runtime builds
do not embed it or assume its GPL exception licenses derivative ports.

## Deferred release inspection

The removed noncommercial Pico meshes, research export and slicer export may
remain in old history. The author plans a fresh-history publication, but no
history rewriting or release copy was performed in this pass. Inspect that
actual publication tree separately; do not publish the old history by accident.
Personalization/privacy cleanup and the excluded `robot/` material also remain
outside this licensing pass.
