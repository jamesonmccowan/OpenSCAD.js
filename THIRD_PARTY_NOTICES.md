# Bundled Runtime Notices

## Distribution Selection

The standalone build retains this document, root dependency license/notice
files under licenses/, Liberation's SIL Open Font License, and generated
esbuild legal-comment sidecars. Its manifest records the selected package
versions, source URLs and artifact hashes. Only the Manifold kernel wrapper and
WASM are included, not its npm glTF/image/export tooling or their dependency
tree. Viewer addons are bundled against one local Three.js module.
CodeMirror 6 is bundled locally into `src/studio/editor-bundle.js`. The build
inventories the CodeMirror/Lezer packages and transitive libraries actually
included in that bundle, retaining their MIT licenses under licenses/ and
generated legal-comment sidecars. Sources: https://github.com/codemirror,
https://github.com/lezer-parser, https://github.com/marijnh/style-mod,
https://github.com/marijnh/w3c-keyname and https://github.com/marijnh/crelt.

The Manifold and roof runtime review is recorded in
[licenses/wasm/provenance.json](licenses/wasm/provenance.json), with source URLs,
reviewed input hashes and retained notice/evidence hashes. The distribution
builder verifies those inputs and copies the complete licenses/wasm directory;
the extension also retains it. Dependency or generated-asset changes require a
new review, not just a version bump. This is a bounded source/build-graph review,
not legal certification, a signed inventory, or a blanket license conclusion
about unreviewed components.

## JavaScript, icons and fonts

The standalone distribution's dependency inventory records the selected
JavaScript/font packages and hashes of their retained root license/notice
files. The extension additionally records packages from actual esbuild inputs
in licenses/bundled-packages.json, retaining separate name/version license
directories so different Three.js versions are not conflated.
Generated legal-comment sidecars must remain beside their bundles. Build tools,
test frameworks and packages merely installed in node_modules are not claimed
to be shipped dependencies.

### OpenType.js embedded helpers

opentype.js 1.3.4 is MIT-licensed, Copyright (c) 2020 Frederik De Bleser.
Its published dist/opentype.js explicitly includes tiny-inflate by Devon
Govett and the string.prototype.codepointat polyfill by Mathias Bynens.
Our runtime uses that prebundled file, so its helpers are not separate esbuild
input packages. Retain the additional complete MIT texts in
licenses/javascript/tiny-inflate.LICENSE and codepointat.LICENSE.
They were retained from tiny-inflate 1.0.3 and string.prototype.codepointat
0.2.1; those are license-text sources, not a claim that every embedded helper
matches the installed version byte-for-byte (the polyfill banner says 0.2.0).
Sources: https://github.com/devongovett/tiny-inflate and
https://github.com/mathiasbynens/String.prototype.codePointAt.

tiny-inflate's README identifies it as a JavaScript port of Joergen Ibsen's
tiny inflate (tinf), not an original implementation. We additionally retain
the upstream zlib notice in licenses/javascript/tinf.LICENSE, sourced from
https://github.com/jibsen/tinf/blob/5f8f3f9acc4330cffb966c3b94705ee0fdf70e72/LICENSE.
That snapshot preserves the upstream attribution and terms; tiny-inflate does
not identify the original C revision it ported. This distribution contains
the JavaScript adaptation embedded in OpenType.js, not the original C source.

### Icons and original artwork

Lucide 0.468.0 is ISC-licensed, with Feather-derived portions credited in its
LICENSE to Cole Bemis (2013-2022), and other portions to Lucide Contributors
(2022). Retain that complete license and the Feather MIT text in
licenses/javascript/Feather.LICENSE, sourced from
https://github.com/feathericons/feather/blob/v4.29.2/LICENSE
(Copyright (c) 2013-2023 Cole Bemis). This conservatively preserves both
attribution and permission texts; it is not a claim that all current Feather
icons are bundled.

The blue cube project mark is original project artwork, generated from
branding/icon.scad under Apache-2.0; no upstream OpenSCAD logo is used.
The extension's $(...) command icon names refer to icons supplied by the
VS Code host; no Codicons font or SVG files are copied into this package.
Unicode control labels are text rendered by the host's fonts, not imported
icon artwork. The Lucide SVG artwork used in the web UI/webviews is distinct
from those host icons and text characters.

### Fonts

The bundled model fonts are the 12 Liberation 2.00.1 TTF faces copied
unchanged from the pinned OpenSCAD reference checkout. Their SIL OFL 1.1 text
and copyright/reserved-name notices are retained in licenses/Liberation.LICENSE:
Google Corporation (2010), reserved names Arimo, Tinos and Cousine; Red Hat,
Inc. (2012), reserved name Liberation.

UI fonts are DM Mono (@fontsource/dm-mono 5.3.0, Copyright 2020 The DM Mono
Project Authors) and Manrope (@fontsource/manrope 5.3.0, Copyright 2019 The
Manrope Project Authors). Their SIL OFL 1.1 texts and upstream copyright
statements are retained under licenses/@fontsource-dm-mono/ and
licenses/@fontsource-manrope/. Sources: https://github.com/googlefonts/dm-mono
and https://github.com/sharanda/manrope.
The selected Latin WOFF/WOFF2 files are copied unchanged; esbuild changes asset
filenames and CSS URLs, not the font bytes. The OFL permits bundling these
fonts with software, including commercial software; it does not relicense
the fonts under Apache-2.0. Font modifications must respect applicable reserved
names, and fonts must not be sold by themselves.

User-supplied and system-discovered fonts are not redistributed by the project.
Users must have appropriate rights for their own font use and redistribution.

## Manifold 3.5.4 and embedded components

Source: https://github.com/elalish/manifold/tree/ce50d78021d64507f89e8c9fc2c2e51018117857

Only the npm manifold.js/manifold.wasm pair is copied, unchanged. The npm
archive's SHA-512 integrity and the installed binary hashes were checked.
The npm provenance statement identifies the same revision and the published
workflow, which builds with Emscripten 5.0.2, MinSizeRel, MANIFOLD_PAR=OFF,
and the default Clipper2 cross-section backend. The downloaded attestation
bundle is retained as evidence; its signatures have not been independently
verified. It is not proof of a bit-identical independent rebuild.

Retain licenses/wasm/manifold/ and licenses/wasm/emscripten-5.0.2/:

- Manifold: Apache-2.0, Copyright The Manifold Authors.
- Clipper2: Boost Software License 1.0, Copyright Angus Johnson.
  The source pins revision 46f639177fe418f9689e8ddb74f08a870c71f5b4 and applies
  an upstream carry-patch for CLIPPER2_NO_IOSTREAM guards. That patch is
  retained with the notices; we apply no additional local patches.
- src/svd.h: MIT, Copyright (c) 2019 wi-re and Copyright 2023 The Manifold
  Authors; adapted from https://github.com/wi-re/tbtSVD.
- src/disjoint_sets.h: zlib-style terms, Copyright (c) 2015 Wenzel Jakob;
  adapted from https://github.com/wjakob/dset with connected-component changes.
- include/manifold/math.h: Sun/FreeBSD/musl-derived math helpers, including
  Copyright (C) 1993 Sun Microsystems and its permission notice.
- src/tri_dist.h: modified NVIDIA-Omniverse PhysX distance routines,
  BSD-3-Clause. The referenced PhysX license text is retained, Copyright
  (c) 2008-2025 NVIDIA Corporation. Manifold does not identify the original
  PhysX source revision; the notice's upstream license revision is recorded.

The published non-parallel kernel configuration does not link oneTBB.
GoogleTest is built as separate tests, not linked into manifoldjs. Assimp,
nanobind and Tracy are disabled in this configuration. The npm package's
glTF/image/export tooling and its dependencies are not copied into our runtime.
These exclusions describe the reviewed build graph, not all possible Manifold
builds or everything contained in its npm package.

## Generated roof asset verification

The Voronoi wrapper and WASM were rebuilt on Linux on 2026-10-19 from
src/geometry/roof-voronoi.cpp with scripts/build-roof.sh's flags, Emscripten
4.0.23 and system Boost 1.83.0 headers. Both outputs matched the checked-in
files byte-for-byte. The straight-skeleton 1.1.0 bundle was independently
regenerated with esbuild 0.25.12 and also matched byte-for-byte. Its MIT license
is retained in licenses/wasm/roof/ in addition to the text below.
The review manifest records these hashes; it does not promise identical
outputs on arbitrary platforms or after input changes.

## Versioned Emscripten and runtime notices

Manifold's reviewed build uses Emscripten 5.0.2; the roof backend uses 4.0.23.
Version-specific licenses, author lists and runtime notices are retained under
licenses/wasm/emscripten-5.0.2/ and licenses/wasm/emscripten-4.0.23/.
MIT is selected for Emscripten's dual-licensed code. Its LICENSE also preserves
the Node-derived JS path code notice. Runtime material includes musl,
libc++, libc++abi, compiler-rt, libunwind, llvm-libc and dlmalloc.
The full dlmalloc source is retained to preserve its license declaration.
This is a conservative notice set for these toolchains, not a claim that every
function from every listed runtime survives linking. The extension's separate
OCCT notices cover its own Emscripten 3.1.69 build recipe.

These notices apply to the generated roof assets and frame-archive library, in addition to the licenses of
the project's other dependencies and reference resources. Original binding and
meshing code remains Apache-2.0. No CGAL or upstream OpenSCAD source is compiled
into these roof assets.

## Straight Skeleton 1.1.0

Source: https://www.npmjs.com/package/straight-skeleton/v/1.1.0
Bundled into `src/geometry/roof-straight-bundle.js` without runtime dependencies.

MIT License

Copyright (c) 2021 vHawk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Boost.Polygon (Boost 1.83)

Source: https://www.boost.org/users/history/version_1_83_0.html
Voronoi headers: Copyright Andrii Sydorchuk 2010-2012.
Compiled into `src/geometry/roof-voronoi-wasm.wasm`.

Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

## Emscripten Runtime

Toolchain: Emscripten 4.0.23, revision
`7a5d93b50f6a3a35e85a0d2fc9e667b8498e6aed`.
Source: https://github.com/emscripten-core/emscripten/tree/4.0.23
Emscripten offers MIT or University of Illinois/NCSA licensing; MIT is selected
for its generated runtime here.

Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

Toolchain library components retain their own notices. This record is not a
completed audit of every asset in the studio distribution.

## Musl Runtime

Copyright (c) 2005-2020 Rich Felker, et al.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## LLVM Runtime Components

libc++, libc++abi and compiler-rt are under Apache-2.0 with LLVM exceptions.
The Apache-2.0 terms are reproduced in the accompanying [LICENSE](LICENSE).
The LLVM exceptions follow:

As an exception, if, as a result of your compiling your source code, portions
of this Software are embedded into an Object form of such source code, you
may redistribute such embedded portions in such Object form without complying
with the conditions of Sections 4(a), 4(b) and 4(d) of the License.

In addition, if you combine or link compiled forms of this Software with
software that is licensed under the GPLv2 ("Combined Software") and if a
court of competent jurisdiction determines that the patent provision (Section
3), the indemnity provision (Section 9) or other Section of the License
conflicts with the conditions of the GPLv2, you may retroactively and
prospectively choose to deem waived or otherwise exclude such Section(s) of
the License, but only in their entirety and only with respect to the Combined
Software.

## Fflate 0.8.3

Source: https://www.npmjs.com/package/fflate/v/0.8.3
Used for the studio's ZIP frame export. MIT License:

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.