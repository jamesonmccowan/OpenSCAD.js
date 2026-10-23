# Release candidate smoke-test checklist

Use this for each release candidate, not as a claim that the checks below
have already passed. The automated gate does not operate a real VS Code host.
The author's earlier successful Desktop/Remote SSH usage is useful exploratory
evidence, separate from a recorded run against the exact candidate.

## Scope and recording

Safari and iOS browsers are **unsupported** for this release. Volunteer testing
and compatibility contributions are welcome for a future support decision.
Playwright WebKit and narrow viewport tests remain regression coverage, not
Safari/iOS or physical-device certification. Desktop Chromium/Firefox and
desktop VS Code/Remote SSH are the intended browser/extension targets;
record the actual versions and OS tested rather than assuming all platforms.
Browser VS Code, arbitrary strict-CSP/cross-origin embedding and actual mobile
devices are not certified by this checklist.

Copy this document into release notes or a private test record and fill it out.
Use PASS, FAIL or NOT RUN for every section, with evidence and reasons.
NOT RUN is not PASS. Do not include credentials, private SSH hostnames,
private paths, source models or other personal data in public results.

| Field | Value |
| --- | --- |
| Date / tester | |
| Public source revision / version | |
| Full extension ID (`publisher.name`) | |
| VSIX filename / SHA-256 | |
| Standalone filename / SHA-256 | |
| Automated gate report / hosted CI run URL | |
| Local client OS / VS Code version | |
| SSH client OS / remote OS / VS Code server version | |
| Browser versions / graphics environment | |

## 1. Freeze and install the candidate

- [ ] Choose the final publisher ID; do not describe `openscad-js-local` as a
  registered Marketplace identity.
- [ ] Run `npm run release:check` from the intended release source. All stages
  must pass; preserve `.release-check/report.json`, logs and `SHA256SUMS`.
- [ ] Record the hashes of the exact archives you will test and upload.
  On Linux use `sha256sum <file>`; on macOS `shasum -a 256 <file>`; on
  PowerShell `Get-FileHash <file> -Algorithm SHA256`.
- [ ] Use a disposable VS Code profile/workspace with no competing SCAD
  extensions. Disable/uninstall the old publisher-ID copy if applicable.
- [ ] Use **Extensions: Install from VSIX...**, install the candidate and reload.
  Verify its ID/version in Extensions and its host using
  **Developer: Show Running Extensions**.
- [ ] Create a disposable trusted folder, not this development checkout.
  No native OpenSCAD or development `node_modules` should be needed at runtime.
- [ ] Repeat sections 2-6 once locally and once in a Remote SSH window with the
  extension installed in the remote workspace host. Record separate outcomes.
  Transfer files/VSIX using your normal trusted process; never share SSH keys.

## 2. Preview, edit, render and export

Create `main.scad` with this original test source:

```scad
/* [Dimensions] */
width = 20; // [10:1:30]
moving = false;
/* [Hidden] */
translate([moving ? 10*$t : 0, 0, 0]) cube([width, 10, 5]);
```

- [ ] Open **OpenSCAD: Open Preview to the Side**. A visible solid appears,
  dimensions are 20 x 10 x 5 mm, and volume is 1000 mm3.
- [ ] Orbit, zoom and fit; resize/narrow the panel. Controls remain usable,
  geometry remains visible, and compilation does not unexpectedly reset camera.
- [ ] With auto-preview off, change width to 24 without saving. The panel marks
  the old view out of date. Export STL without manually recompiling first.
  Reopen the exported STL: dimensions are 24 x 10 x 5 mm, volume is 1200 mm3.
- [ ] Test explicit Preview (F5) and Render (F6). Both use the current editor text.
- [ ] Test auto-preview on save and on edit separately. Restore it to off.
- [ ] Introduce a syntax error. The previous model remains visible with a located
  error in the panel/Problems. Fix it and compile successfully.
- [ ] Start an expensive compile using a suitable test model, cancel with the
  preview's **Cancel compilation** toolbar control, and compile the small cube afterward. No stale result
  replaces the newer model; cancellation/errors do not produce partial exports.
- [ ] In an untrusted disposable workspace, confirm the extension is disabled
  until trust is granted; do not grant trust to unfamiliar test content.

## 3. Sources, imported assets and fonts

- [ ] Add `shape.scad` containing `module shape() { cube([6, 8, 10]); }`.
  In `main.scad`, use `use <shape.scad> shape();`. Preview and export work;
  edit the dependency and verify the next compile uses its current contents.
- [ ] Import the exported cube with `import("exported.stl");` (adjust filename).
  Confirm expected dimensions. A missing import reports a useful error.
- [ ] Compile `linear_extrude(2) text("ABC", font="Liberation Sans", size=10);`.
  Visible text geometry and STL export work using packaged fonts.
- [ ] Open Fonts, choose a parser-readable installed font from the workspace
  host, and compile with its exact family/style. If none is available, record
  NOT RUN for system fonts rather than assuming success.
- [ ] Over SSH, verify Fonts identifies the remote host. Client-only fonts are
  not silently substituted; an unavailable named font fails explicitly.
- [ ] A model requiring experimental roof/object features fails without opt-in
  and succeeds for a known supported example with the appropriate setting.

## 4. Interactive tools and generated outputs

- [ ] Restore the first source. Customizer exposes width; changing it updates
  dimensions. Export/import a preset and verify its value is restored.
- [ ] Enable `moving`, seek `$t` between 0 and 1, and play/stop Animation.
  Position changes without a blank/stuck view; source errors stop playback.
- [ ] Enable Cross Section, change its axis/position and disable it again.
  It clips the view, not exported geometry.
- [ ] Measure two cube points, copy the result and inspect the JSON.
- [ ] Capture a viewport snapshot. The generated PNG is nonblank and reflects
  the camera; `.openscad-model.json` contains plausible current metrics.
  Over SSH, verify outputs are written to the remote workspace.
- [ ] Run Audit on the source below: at `$t=0` the parts are separated, while
  `$t=1` produces overlap. Findings identify the named pair; no continuous-motion
  safety guarantee is implied.

```scad
audit_part("fixed") cube(5);
translate([10-10*$t, 0, 0]) audit_part("slider") cube(5);
```

## 5. Model and G-code viewers

Copy these original repository fixtures into the disposable workspace:
`references/scad sample files/cube.stl`, `plate with hole.step`,
`hex prisms.3mf`, and `viewer-calibration.gcode`. The G-code is visualization
data only: **do not send it to a printer**.

- [ ] STL opens with visible geometry, 10 mm dimensions, 1000 mm3 volume and
  watertight status.
- [ ] STEP opens as a 30 x 20 x 5 mm plate with a hole; Convert to STL saves
  a valid model. This exercises the actual host OCCT worker.
- [ ] 3MF opens as two prisms with combined bounds about 45 x 17.32 x 15 mm;
  conversion preserves the expected geometry.
- [ ] Add one model as a SCAD reference, transform/toggle it, and reopen that
  preview. Placement is restored. Reference geometry does not enter STL export.
- [ ] Overwrite a model file with a different valid model: reload keeps camera.
  Then make the input invalid: an explicit error retains the previous model.
- [ ] G-code shows 55 layers, 111 mm filament, 0.28 g and synthetic printer/
  generator metadata. Layer-range, travel, camera and Open as Text controls work.
- [ ] Close/reopen viewers and previews; no unhandled errors appear in
  **Developer: Toggle Developer Tools** or the extension host log. Record
  unexpected errors rather than treating an empty UI as a successful load.

## 6. Standalone and final delivery

- [ ] Extract the standalone `.tgz` outside the checkout. Serve its `package/`
  directory over HTTP (for example `python3 -m http.server 8080` from that
  directory). Do not open it with `file://`.
- [ ] In desktop Chromium and Firefox, open `editor.html` and `demo.html`.
  Compile, edit and export; demo previews are nonblank and independent.
  Inspect Console/Network for missing worker, WASM, font or script assets.
- [ ] From the extracted `package/`, run
  `node openscad.js/cli.js --version`, then compile a small SCAD file to STL.
- [ ] After pushing the intended public source, require hosted verification to
  pass, including the extension job. Check README/issue/source links and
  clean-clone submodule/setup instructions.
- [ ] Upload the tested archives and checksums, not a later untested rebuild.
  State version, partial language profile, experimental features, supported
  environments and known limitations in release notes.

## Decision

| Check group | Desktop result / evidence | Remote SSH result / evidence |
| --- | --- | --- |
| Candidate identity and install | | |
| Preview / export / errors / cancellation | | |
| Sources / imports / fonts | | |
| Customizer / animation / tools | | |
| Model / G-code viewers | | |
| Standalone / links / hosted CI | | Not applicable for SSH transport |

- Release decision: GO / NO-GO
- Outstanding failures and NOT RUN items:
- Explicitly accepted limitations (Safari/iOS remains unsupported):
- Exact archive hashes approved for upload:

Any source, dependency, publisher, packaging or generated-asset change after
testing creates a new candidate: rerun affected automated checks and repeat
affected smoke checks. A green CI candidate is not a recorded manual smoke pass.
