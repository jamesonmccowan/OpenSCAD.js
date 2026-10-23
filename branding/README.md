# Icon study

A project-mark candidate based on the user's revised SCAD model: a blue cube
with three centered, intersecting square tunnels along X, Y, and Z. Each opening
is half the cube's width, leaving 6 mm outer walls on the 24 mm cube. The top
opening and connected interior make the subtraction visible on all three faces.
The blue palette and square cuts reference constructive solid geometry; this
is not an OpenSCAD affiliation badge. No upstream logo image or geometry is used.
The user's `%` background helper is omitted from the artwork.

- [icon.scad](icon.scad) is the editable source, compiled by OpenSCAD.js itself.
- [icon2.scad](icon2.scad) is a retained alternate study, not an input to the
  icon generator or release artwork.
- [index.html](index.html) compares light/dark backgrounds and actual small sizes.
- `icon-{16,32,48,64,128,256,512}.png` are transparent, locally rendered exports.

Run `npm run build:icon` from the repository root. This uses the existing
OpenSCAD.js engine, Three.js, and Playwright Chromium; dependencies and the
Chromium browser must already be installed. There are no external requests,
native OpenSCAD calls, or image-generation services. The renderer checks the
compiled model's volume/bounds and the exports' blue coverage, transparency,
and small-size tunnel contrast before writing PNGs. Lighting, camera and
supersampling are defined in [the generator](../scripts/build-icon.js).

The initial master is the SCAD model plus its render settings, not a hand-drawn
SVG. Rebuilds on different GPU/browser versions may not be byte-identical.
Artwork and source follow the repository's Apache-2.0 license.

The studio uses the mark in its header and favicon; the packaged editor/demo
include local copies. The extension build copies the 256px export to
`extension/media/icon.png` for its package listing and preview/model-viewer tabs.
After regenerating artwork, run `npm run build` and `npm run build --prefix extension`
to refresh those packaged copies.
