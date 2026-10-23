# OpenSCAD.js Preview

Local VS Code extension with normal `.scad` text editing, syntax highlighting
and a side-by-side, file-pinned 3D preview. No native OpenSCAD installation is
required. The compiler supports a partial OpenSCAD subset, not every model.

Supported extension targets are desktop VS Code and Remote SSH, not browser
VS Code. Safari and iOS browsers are unsupported for this release; volunteer
compatibility contributions are welcome for future consideration.

The blue square-tunnel cube is the extension's package and preview-tab icon.
Its SCAD source and reproducible artwork are created with OpenSCAD.js;
the mark does not imply affiliation with OpenSCAD.

Open a `.scad` file and run **OpenSCAD: Open Preview to the Side** (or press
`F5` / select the editor-title preview icon). The preview automatically builds
upon opening. Subsequent edits mark the panel Out of Date (or trigger background
recompilation if Auto preview is enabled). The last successful geometry and camera
remain visible on compile errors. STL export renders the current source and asks
for a destination. Compilation errors appear in Problems and the preview, with
clickable source locations.

The preview footer displays real-time geometric dimensions ($X \times Y \times Z$ mm),
volume ($\text{mm}^3$), and triangle count, and exports `.openscad-model.json` to
the workspace for AI/Copilot inspection. Use the **Camera** button or command
`OpenSCAD: Capture Viewport Snapshot to Workspace` to save rendered PNG snapshots
to `${file}-preview.png` and `.openscad-preview.png`.
Both files are saved in the SCAD file's workspace root (or beside the file when
it is outside a workspace). The snapshot includes the current camera, visible
references, clipping and annotations. It captures the displayed geometry, which
may be out of date after an edit; it does not compile the source automatically.
Wait for compilation to finish before capturing.

The command uses the focused preview, then the active SCAD editor's preview.
When neither identifies a target, it uses the only open preview or asks you to
choose among multiple previews. Moving, hiding or revealing a preview does not
invalidate its model or cancel compilation. Capture failures appear in the
preview and/or a VS Code error notification rather than silently saving a blank
image.

For extension/API callers, `vscode.commands.executeCommand('openscadJs.captureSnapshot', scadUri)`
pins the request to that file's already-open preview. The returned promise
resolves to the named PNG's `vscode.Uri` only after both PNG files have been
written, and rejects on capture/write errors, panel closure or a 15-second timeout.
Omitting the URI uses the interactive selection rules above; cancelling selection
returns `undefined`. This command must be invoked through the VS Code extension
host; it is not automatically exposed as an AI tool.

The **Axes** toggle draws world X, Y, and Z lines through the origin. **Marks**
also enables axes and adds positive-side tick marks and labels; spacing adapts
between 10, 100, and 1000 mm intervals as the view zooms out. The corner XYZ
indicator follows camera rotation and is independent of these toggles. Axes and
marks are viewport overlays and do not affect model metrics or STL exports.

The **Audit**, **Cross Section**, **Animation**, **Customizer**, **References**, and **Fonts** tabs share a
single tool panel beneath the preview. Select a tab to show its controls, or the
**&#9660;** tab to hide all panels (the default). Switching tabs preserves
settings and does not stop animation, disable slicing, or cancel an audit.
Use Left/Right arrow keys or Home/End while a tab is focused to switch tabs.

The **Cross Section (Slicing Plane)** tab allows cutting through solid geometry
in real time along the X, Y, or Z axis with an interactive slider and invert toggle.
This makes it easy to inspect internal cavities, bolt recesses, and tendon channels
without altering your source model.

Select **Measure**, then click two visible points on the model to see their
point-to-point distance and signed X/Y/Z deltas in millimeters. Hits behind the
active cross-section plane are ignored. The optional gap target compares the
measured distance with a selected 0.20, 0.30, or 0.40 mm reference; this is a
reference comparison, not an automatic fit or interference analysis. Use Copy
to send the point coordinates, distance, deltas, and comparison to the clipboard
as JSON. The line and endpoint markers are preview annotations and are not
included in compilation or STL exports.

The **Interference Audit** samples `$t` from 0 to 1 and intersects named part
solids at each sample. Mark independently moving solids in source, outside their
own union/difference operations:

```scad
audit_part("palm") cube([20, 30, 8]);
translate([20 - 20 * $t, 0, 0]) audit_part("finger") cube([12, 8, 8]);
```

Choose 2-20 samples, an overlap-volume threshold in mm³, and a minimum
**Clearance (mm)** (default 0.2; set to 0 to disable gap warnings).
Findings identify each part pair and sample times, separated into:
- **INTERFERENCE** (red): overlap above the volume threshold, with maximum
  volume and the worst sample time.
- **CLEARANCE** (amber): separated parts closer than the requested clearance,
  with minimum gap and the worst sample time.
- **CONTACT** (muted): touching within 0.001 mm, with overlap at or below the
  volume threshold. Contacts are not automatically treated as collisions.

Up to 64 explicitly wrapped solids are compared; nested markers and duplicate
names are rejected. This is discrete sampling, so collisions between sample times may
be missed. Clearance is measured on the tessellated solids, not a mechanical
strength or manufacturing-fit guarantee. The original
preview remains displayed during the audit. The repository CLI's `--audit` runs
the same check from a terminal (so Copilot can run it) and accepts `-D` pose lists; see
[COPILOT_INTEGRATION.md](COPILOT_INTEGRATION.md#working-with-copilot-today).

After compiling a source, the **Customizer** tab exposes documented SCAD
parameters, including ranges, choices, booleans, strings and vectors. Parameter
changes trigger a debounced preview. Presets can be saved per preview panel and
imported/exported using OpenSCAD's parameter-set JSON format. The **Animation**
tab seeks or plays `$t` from 0 to 1; FPS is bounded to 1-60 and steps to
1-1000. Playback waits for each frame compile and stops on edits, errors or
manual rendering.

For example, these top-level assignments produce a width slider, a color
choice and a centered checkbox:

```scad
/* [Dimensions] */
width = 20; // [4:2:40]
color = "red"; // [red:Red, blue:Blue]
centered = true;

color(color) cube([width, width, 8], center = centered);
```

The extension overrides those variables for preview compilation without
rewriting the source file. It discovers literal number, boolean, string and
numeric-vector assignments at the file's top level; `$` variables, computed
defaults and assignments inside modules are not exposed. A `/* [Hidden] */`
group hides following parameters until the next group heading. Presets save and
restore the overrides, not copies of the SCAD source.

## Fonts

`text()`, `textmetrics()` and `fontmetrics()` can use installed `.ttf`/`.otf`
faces such as `Arial:style=Bold Italic`, without bundling the fonts into the
extension. Bundled Liberation faces remain available without system discovery.

Open the preview's **Fonts** tab to discover parser-readable faces. The list is
loaded only when opened and labels **Bundled**, **Font directory**, and
**Host installed** faces. Search by family or style; **Copy** puts the exact SCAD
assignment (for example `font="DejaVu Sans:style=Bold Oblique"`) on the clipboard
without modifying the source or compiling. **Refresh** rescans directories and
installed fonts, including fonts added since the panel was opened. Discovery
errors appear in the Fonts panel and can be retried. Font files are checked for
readability/format, not certified for every glyph or shaping feature.

- `openscadJs.fontDirectories`: additional directories, searched recursively
  before installed fonts, matched by embedded family/style names rather than
  filenames. Paths are absolute or relative to the workspace folder. Symlinks
  are not scanned. Configure this machine-scoped setting in user settings.
- `openscadJs.systemFonts`: defaults to `true`. Linux uses fontconfig
  (`fc-match` for resolution, `fc-list` for browsing); if unavailable, a warning is shown and standard font directories
  are scanned. Windows/macOS scan standard system and user font directories.

Fonts are accessed on the **extension/workspace host**. With SSH, WSL or
containers, fonts installed on the PC displaying VS Code may not be available
there. Install fonts on the host or configure host font directories; client-PC
font forwarding is not implemented. Font files are not uploaded or copied into
your SCAD project. Font bytes are limited to 20 MB per compile, with at most
128 faces; directory scans are bounded. Use **Refresh** in Fonts after adding
fonts to a scanned directory. The panel explicitly identifies remote extension
hosts so Windows client fonts are not confused with Linux SSH host fonts.

Missing faces and unsupported/malformed fonts are explicit compilation errors;
Arial is not silently replaced with Liberation Sans. `.ttc` collections,
variable axes, Unicode text and complex shaping remain unsupported. Use fonts
you are licensed to use. The browser studio separately provides a file picker
and permission-based local-font access.

## Model viewer (STL, STEP, 3MF)

Opening a `.stl`, `.step`/`.stp` or `.3mf` file shows it in the read-only
OpenSCAD.js Model Viewer instead of VS Code's binary-file message. The viewer
uses the same camera toolbar, axes, marks and wireframe toggle as the SCAD
preview. Its summary reports the triangle count, bounding-box size in mm, and
file size. For watertight meshes it also reports the volume in mm³. For other
meshes it reports the number of open and non-manifold edges, which helps you
catch broken print exports.

- **STL**: binary and ASCII.
- **STEP**: CAD solids are tessellated with OpenCascade in a background worker
  in the extension host, converted to millimeters, and welded so that closed
  solids report as watertight. Large assemblies can take a few seconds.
  Tessellation times out after two minutes.
- **3MF**: mesh objects, components (including production-extension parts
  stored in other model files), build-item and component transforms, and model
  units. Support and "other" objects are skipped. Colors and materials are
  not shown.

For STEP and 3MF files, **Convert to STL** saves the displayed mesh as a binary
STL, by default next to the source file. To use that STL as a reference while
recreating a part in OpenSCAD, add it as a transparent background modifier:
`%import("part.stl");`. This shows it in the preview but leaves it out of
renders and exports.

The viewer reloads automatically when the file changes on disk, for example
after you re-export it, and keeps the current camera. If a reload fails, the
previous model stays visible alongside the error. Files are limited to 100 MB
and 2,000,000 triangles. To open a file as text or with another editor, use
**Reopen Editor With...** or the `workbench.editorAssociations` setting.

STEP support uses [occt-import-js](https://github.com/kovacsv/occt-import-js)
and Open CASCADE Technology under the LGPL-2.1. They ship unmodified in
`media/vendor/occt/` (adding about 8 MB to the extension), and their licenses
are in `licenses/occt-import-js/`.

### Reference overlays

To compare a downloaded model with your SCAD design, select **Use as Reference**
in the model viewer and choose the target SCAD file. You can also use the
model's Explorer context menu, the command **OpenSCAD: Use Model as Reference
in SCAD Preview**, or **References > Add Reference** in an existing preview.
STL, STEP/STP and 3MF references use the same readers and millimeter units as
the model viewer; no intermediate STL conversion is needed.

Each reference appears as a translucent gray overlay with:

- **Visible** and **Opacity** controls.
- **Position** in millimeters, **Rotation** in degrees (X, then Y, then Z about
  the model's original origin), and independent positive **Scale** factors.
  Scaling and rotation are applied before translation.
- **Fit Reference**, which frames that reference without changing its placement.
  The normal camera Fit button continues to frame only the compiled model.
- **Reset Placement**, **Reload**, and **Remove** controls.

Reference files and settings are saved per SCAD file in VS Code's workspace
storage and restored when its preview reopens. The files are linked, not copied;
moving a reference file or renaming the SCAD file requires adding it again.
The settings are local to this VS Code workspace, not checked into the project.
Up to eight references are allowed, each subject to the model viewer's 100 MB
and 2,000,000-triangle limits.

References stay visible across recompilation and automatically reload when
their files change. A failed reload or deleted file retains the previous
geometry with an explicit error. Removing a reference does not delete its file.
References are **preview only**: they do not modify SCAD source, affect model
metrics, measurements, cross-section clipping or interference audits, or appear
in STL exports. Viewport snapshots include visible references.

## G-code viewer

Opening a `.gcode` or `.gco` file shows its sliced toolpath in the OpenSCAD.js
G-code Viewer, drawn on the printer's build plate when the slicer recorded it.
**Open as Text** (or **Reopen Editor With...**) switches back to the text
editor.

- **Layer sliders** pick the first and last visible layer. The label shows the
  range and the Z height of the top layer, so you can step through a print
  layer by layer.
- **Travel** shows non-extruding moves, which are hidden by default.
- **Tubes** draws extrusions as shaded 3D tubes instead of lines. This is
  slower on large files.
- The camera toolbar provides fit, zoom, reset, and right/left/back/front/top
  views. Drag to orbit, right-drag to pan, and scroll to zoom.
- The summary reports the layer count, the printed part's size in mm, filament
  length and weight, estimated print time, printer, slicer, and file size.
  PrusaSlicer, OrcaSlicer, Bambu Studio and Cura metadata are recognized.
  The slicer's purge and prime lines (`;TYPE:Custom`) are drawn but are
  excluded from the reported size and camera fit.

Line colours follow each tool's filament colour, shaded from dark at the
bottom layer to light at the top. Very dark and very light filaments are
lightened or darkened so the toolpath stays visible. Like the model viewer, the
G-code viewer reloads when the file changes and keeps the camera. Files are
limited to 100 MB.

Limitations: binary G-code (`.bgcode`) is not supported, relative positioning
(`G91`) is not interpreted, and moves are not coloured by feature type
(perimeter, infill, support). Rendering uses
[gcode-preview](https://github.com/remcoder/gcode-preview) (MIT).

## Development

The build currently depends on the parent repository and its installed runtime
dependencies and reference font assets. From the parent directory:

```sh
npm install
npm --prefix extension install
npm --prefix extension run build
npm --prefix extension test
npm --prefix extension run test:occt
npm --prefix extension run test:browser
npm --prefix extension run package
```

For the complete parent-plus-extension local candidate gate, run
`npm run release:check` from the parent directory. It cleans generated outputs,
runs both projects' checks and inspects actual packaged archives; see the
[gate instructions and limits](../README.md#complete-local-release-gate).
The VSIX uses normal README-link rewriting against the planned GitHub repository
and its `extension/` directory; no missing-repository or relative-link override
is needed. It is not Marketplace-ready merely because tests pass.

Open `extension/` as the VS Code workspace and press F5 to launch an Extension
Development Host. Alternatively install the generated
`openscad-js-preview-0.1.0.vsix` using Extensions: Install from VSIX.
For Remote SSH, install it in the remote workspace extension host. Packaged
assets are served to the local webview by VS Code; no HTTP server is required.

Set `openscadJs.libraryPaths` to library directories on the workspace host.
Relative paths use the entry's workspace folder, or its parent for standalone
files. Reads cannot escape these roots, including through symlinks. Unsaved
open-document text takes precedence over disk contents. Workspace Trust is
required. Preview panels are not restored after restarting VS Code.

Set `openscadJs.experimentalFeatures` to an array of supported flags to enable
experimental behavior. Available values are `roof`, `object-function`,
`import-function`, and `vector-swizzle`; the default is empty. These options
enable partially implemented features and do not imply full native OpenSCAD
compatibility.

The author reports successful installed-extension use on Desktop and Remote SSH.
A structured smoke check against the exact release VSIX is still needed before release.
Use the [release checklist](../RELEASE_CHECKLIST.md) for separate local and SSH
results, exact package hashes, expected geometry, error recovery and sign-off.
The CI extension job builds, tests, packages and inspects a candidate, but does
not replace those real extension-host checks.
Browser tests cover the actual packaged rendering code with a simulated VS
Code message bridge, not VS Code's complete webview resource transport.

The publisher ID is provisional for local packaging only. Automatic compilation,
Customizer and animation are implemented; native backend selection,
language-server features and session restoration remain deferred.
See SPECIFICATION.md in the source tree.

### Publication identity

- Public author: Jameson McCowan.
- Planned repository: https://github.com/jamesonmccowan/openscad.js, branch `main`.
- Initial version: `0.1.0`; package name: `openscad-js-preview`.
- `openscad-js-local` is an existing local-test publisher ID, **not a registered
  Marketplace identity**. No Marketplace ownership or availability is claimed.

Before Marketplace publication, create a publisher using the
[official publishing instructions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#create-a-publisher),
then replace `publisher` in package.json with its exact registered ID.
The public publisher display name and the unique publisher ID are different.
Do not put publishing credentials in this repository or send them in chat.
No login, account creation, upload or publication is performed by the build/gate.

Changing the publisher changes the extension ID (`publisher.name`).
The existing local extension will not automatically become an installation of
the new ID; uninstall the local-ID copy when testing the final-ID VSIX to avoid
duplicate commands/viewers. Rebuild and rerun the release gate after choosing
the final publisher, then smoke-test that exact VSIX.

README content links explicitly target `blob/main/extension/`, with image links
targeting `raw/main/extension/`, because this extension lives in a monorepo.
Parent-document links therefore resolve at the repository root. These URLs
are planned publication targets, not evidence that the repository has already
been uploaded. Verify them after pushing the fresh public tree.

## Notices

Original code is Apache-2.0. Build output includes LICENSE,
THIRD_PARTY_NOTICES.md, dependency/font licenses and generated legal notices.
Retain these when redistributing. The extension also includes the parent
project's reviewed Manifold/roof provenance and embedded notices under
`licenses/wasm/`; see [the parent notices](../THIRD_PARTY_NOTICES.md).
Those inputs are checked by the parent distribution build before extension
packaging. This bounded review is not legal certification of all project assets.

The build discovers npm inputs for all five host/webview/worker bundles from
esbuild metadata. `licenses/bundled-packages.json` records their package
versions, bundle/sidecar hashes and license-file hashes. Notices are retained
under `licenses/npm/<name>@<version>/`, including both Three.js versions
(0.180.0 for the main viewer and 0.159.0 for G-code). Embedded OpenType.js
helpers and Lucide's Feather-derived artwork have supplemental notices in
`licenses/javascript/`. Rebuilds clear generated licenses before repopulating
them, so removed dependencies do not leave stale attribution trees.

All 12 Liberation TTF faces and six UI WOFF/WOFF2 assets are copied unchanged
from the parent artifact, with their SIL OFL texts. System/user fonts are not
redistributed. VS Code command icon names request host-supplied icons; no
Codicons font is shipped. See the
[JavaScript, icon and font review](../THIRD_PARTY_NOTICES.md#javascript-icons-and-fonts)
for scope and upstream attribution.

### STEP importer provenance review

Evidence checked on 2026-10-19 for `occt-import-js` 0.0.23:

- The [npm release metadata](https://registry.npmjs.org/occt-import-js/0.0.23)
  records `gitHead` as `c2148e54b456b571238d35cac037d304053d64b2`.
  The downloaded npm archive was checked against its registry SHA-512 integrity:
  `sha512-RFfYQXYFX5C1mB1Aywm0ShcUKzXOr/VzTnlzhBSDJOR6YCAPt1HYCzeXWg1vwwjn/cUxwqRNhhtf1dlewoZYCQ==`.
- The [importer source tree](https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2)
  pins its `occt` submodule to
  `d2abb6d844231cb8f29be6894440874a4700e4a5`.
  Its version header identifies OCCT 7.6.1. The original submodule URL is
  `https://git.dev.opencascade.org/repos/occt.git`; the same revision is
  available in the [official GitHub mirror](https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5).
- Installed and packaged `occt-import-js.wasm` have SHA-256
  `33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952`,
  identical to the binary checked into that importer revision.
  Installed and packaged `occt-import-js.js` have SHA-256
  `3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379`.
  The upstream wrapper differs in CRLF/LF line endings only.
- The installed CMake file and Windows setup/build/distribution scripts match
  that revision after CRLF/LF normalization. Our extension copies the npm
  wrapper and WASM without modification. This is not a claim that every
  upstream source file was compared or that the publisher's build was attested.

The upstream build recipe is in
[tools/](https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2/tools)
and [CMakeLists.txt](https://github.com/kovacsv/occt-import-js/blob/c2148e54b456b571238d35cac037d304053d64b2/CMakeLists.txt).
Check out the exact importer revision and initialize its pinned OCCT submodule.
On Windows, `tools/setup_emscripten_win.bat` selects Emscripten 3.1.69 and
MinGW 7.1.0; `tools/build_wasm_win_dist.bat` runs the Release build, tests it,
and copies the outputs and license files into `dist/`.
The Release CMake configuration selects `-Oz`, WebAssembly exceptions, embind,
a modularized `occtimportjs` factory, a 10 MB stack and memory growth.
These are the published recipe's settings, not independently verified facts
about the toolchain used to produce the distributed binary.

The build now includes the full pinned importer, OCCT and Emscripten source
archives in every VSIX under `licenses/occt-import-js/sources/`, alongside a
checksum/revision manifest, LGPL texts, OCCT exception, and runtime notices.
It verifies source archive and npm binary hashes and fails on changes rather
than silently reusing a different version. First builds require network access
to download approximately 79 MiB of sources; later builds use a hash-verified
ignored `.occt-cache/`. `tar` must be installed. The cache is not packaged.
Source delivery increases the VSIX size deliberately so recipients receive
the sources without relying on continued upstream availability.

See [OCCT-SOURCES.txt](OCCT-SOURCES.txt) for extraction, clean-build commands,
license rights and replacement of the JS/WASM pair in `media/vendor/occt/`.
No runtime integrity check prevents users replacing that pair. The extension
host's calling code is also delivered as source. The separate `test:occt`
command checks the built source archives, binaries, instructions and notices;
run it after `build`.

The OCCT worker test and model-viewer browser tests use the packaged library
by default, not the npm copy. To check a rebuilt replacement without changing
the installed pair, set `OPENSCAD_OCCT_SCRIPT` to the absolute path of the
rebuilt `occt-import-js.js` (with its matching WASM beside it), then run
`npm --prefix extension run test:occt` and
`npm --prefix extension run test:browser -- tests/stl.spec.mjs --grep 'STEP'`.
The source/archive integrity tests still check the reviewed release pair;
the worker/browser tests exercise the selected replacement.

Clean Linux rebuilding was verified on 2026-10-19 with Emscripten 3.1.69,
Ninja and the unpatched pinned sources. The rebuilt pair passed the Node
worker geometry/error checks and all four focused Chromium STEP-viewer tests,
including STL conversion. The rebuilt JS matches upstream LF text; the WASM
differs from npm's binary. `provenance.json` records both rebuilt hashes and
the bounded checks; this demonstrates buildability/replacement, not
bit-identical reproducibility or correctness for every model. Release builds
continue to use the reviewed, unchanged npm pair.
OCCT's source declares LGPL-2.1 with its
[special exception](https://github.com/Open-Cascade-SAS/OCCT/blob/d2abb6d844231cb8f29be6894440874a4700e4a5/OCCT_LGPL_EXCEPTION.txt);
the package preserves that exception and prominent OCCT attribution.
Runtime notices include Emscripten (MIT selected), musl, libc++, libc++abi,
compiler-rt, libunwind and dlmalloc; complete source-file notices are retained
in the supplied archives. This source-delivery and provenance work is not a
legal certification or an attestation of the upstream publisher's build.