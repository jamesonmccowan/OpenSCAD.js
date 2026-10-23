# OpenSCAD.js VS Code Extension

## Status And Location

The initial extension lives in `extension/` in the OpenSCAD.js repository.
It may become a separate repository later. The first delivery is a local VSIX,
not a Marketplace release. Repository metadata targets
`https://github.com/jamesonmccowan/openscad.js` on `main`; public author is
Jameson McCowan and initial version is `0.1.0`. The local publisher
`openscad-js-local` remains provisional until a Marketplace publisher is
registered. Changing it changes the extension ID and requires testing a new
VSIX without the old-ID installation active. Normal packaging must rewrite
README links relative to the repository's `extension/` directory.

## Editor And Preview

- `.scad` files open in the normal VS Code text editor with TextMate syntax
  highlighting, comments, brackets and folding. No replacement custom editor.
- Open Preview opens a side-by-side webview pinned to that entry file.
  There is at most one preview per entry URI; reopening focuses it.
- Opening a preview automatically compiles an initial preview build. Subsequent
  compilations can be manual (via Preview/Render buttons or keybindings F5/F6)
  or automatic (via Auto toggle or configuration).
- Switching editors never changes a preview's entry file.
- Preserve camera position, target, projection and zoom between compilations,
  including files containing authored viewport variables. Fit View is explicit;
  the first successful compilation may fit automatically.
- Include orbit, pan, zoom, fit, projection, wireframe, camera snapshot, cross-section clipping and cancellation controls.
- Include an interactive two-point measurement tool that reports millimeter distance and signed axis deltas, ignores slice-clipped surfaces, and copies structured measurement JSON. Optional gap-reference comparisons must be clearly labeled as references, not automated fit analysis.
- Automatically compute and display geometric telemetry ($X \times Y \times Z$ mm dimensions, volume, bounding box, triangle and manifold solid count) in the preview footer and write `.openscad-model.json` to the workspace for Copilot and user inspection.
- Viewport snapshot command and button capture high-resolution PNG renders directly to `${file}-preview.png` and `.openscad-preview.png` for Copilot visual inspection.
- Cancel superseded work. Keep the last successful geometry on compilation errors.
- Show compiler errors/warnings and echoes; link diagnostics to source locations
  and publish them to VS Code's Problems panel.
- STL export compiles the current source snapshot in render mode. Never silently
  export stale geometry. Changes during export invalidate that export.
- Closing a preview releases its worker, meshes, listeners and watchers.
  Session restoration across VS Code restarts is deferred.

## Backend

Use the existing partial OpenSCAD.js compiler and Manifold WASM backend.
Native OpenSCAD is not required. Native executable selection is a possible
optional future feature, not a first-version requirement. The extension does
not claim complete OpenSCAD compatibility.

## Projects

- Resolve include/use relative to the originating file and through configured
  library paths. Resolve supported imported assets relative to their sources.
- Use unsaved text from open documents, including dependency documents.
- Each compilation captures open-document text; subsequent changes mark the
  preview stale. Files read from disk are captured on first access for that job.
- Dependency edits, creation, deletion and imported-asset changes mark affected
  previews stale, including attempted reads of missing dependencies.
- Restrict reads to the entry's workspace folder (or parent for standalone files)
  and explicitly configured library directories. Paths escaping these roots and
  symlinks escaping them are not allowed. Absolute SCAD include paths remain
  subject to the underlying compiler's restrictions.
- Library-path configuration changes cancel work and invalidate previews.
- Retain compiler resource limits and impose bounds on host file reads/messages.

## Environments And Security

Support desktop VS Code and Remote SSH first. Run the extension in the workspace
extension host; perform file reads there via VS Code filesystem APIs. Run the
viewer and compilation worker inside the local webview using packaged assets.
Browser VS Code and other environments are deferred.
Safari/iOS browsers are unsupported for this release, not a required release
test target. Narrow webview layout tests do not certify mobile devices.

Require Workspace Trust for activation. Webviews load only packaged scripts,
WASM and fonts, use a restrictive CSP, and send validated messages to the host.
No arbitrary commands, shell execution or remote asset downloads at runtime.
Allow Blob workers and WASM execution specifically for the compilation engine.
All output paths require a user-selected save destination. Source strings and
compiler messages must never be inserted as HTML.

## Packaging And Development

Bundle local JS, workers, WASM, fonts and notices; a single JS file is not a gate.
Reuse the parent distribution build initially, preserving its dependency notices
and licenses. Provide a launch configuration, focused automated tests and a
local VSIX build command. Test desktop/mobile webview layout and nonblank canvas
rendering; actual desktop and Remote SSH extension-host testing remains a
separate integration gate where no VS Code test host is available.
Use the root [release checklist](../RELEASE_CHECKLIST.md) for exact-candidate
Desktop/Remote SSH sign-off. CI MUST also build the extension, run its unit,
payload and Chromium webview tests, package a VSIX and verify its contents.

## Deferred

Native backend, language server/IntelliSense,
Marketplace publication, browser VS Code and persistent preview restoration.

Customizer controls and `$t` animation playback are implemented in the preview.