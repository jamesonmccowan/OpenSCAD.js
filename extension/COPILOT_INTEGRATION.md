# OpenSCAD.js Copilot & AI Design Integration Specification

## Overview

This specification outlines features designed to enable GitHub Copilot (and AI coding assistants in general) to act as an active, physically-grounded co-pilot for parametric 3D modeling and mechanical design (e.g., robotic hands, mechanisms, articulated linkages, and functional 3D-printed enclosures).

When designing physical mechanisms, code-level syntax diagnostics alone are insufficient. The AI assistant requires **geometric ground truth** (exact dimensions, bounding boxes, volumes, and visual projections) to reason about clearances, tolerances, and mechanical fit.

---

## Working with Copilot today

Copilot (in agent mode) can read workspace files and run terminal commands, but
it cannot click in the preview or invoke VS Code commands on its own. Anything
produced inside the preview reaches it as a **file in the workspace** or as
**text pasted into chat**. Mentioning a file path in chat (or attaching it with
`#file:` / drag-and-drop) is all that is needed; it does not need to be opened.

| What | How it reaches Copilot | Notes |
| --- | --- | --- |
| Viewport image | Camera button, then mention `<name>-preview.png` | Saved in the **workspace root**, not beside the `.scad`. Shows the displayed model (current camera, slice, references), which may predate unsaved edits or the latest compile. Also say which `$t`/parameters were shown if they matter. |
| Bounds, volume, triangle count | `.openscad-model.json` in the workspace root | Rewritten by whichever preview compiled last; check its `file` field. |
| Point-to-point measurement | **Copy Last 3D Measurement**, then paste the JSON | Includes both points, distance and deltas. |
| Preview audit findings | Copy the Audit tab text into chat | Or let Copilot run the CLI audit below, which it can repeat after each edit. |
| Errors and warnings | VS Code Problems panel | Copilot sees these for open files; the CLI also prints them. |

Copilot can verify geometry itself through the CLI, without the preview:

```sh
# compile a pose to STL (e.g. for measurement scripts); -D overrides parameters
./bin/openscad-js.js robot/hand.scad -D 'test_var=1' --time 0.5 -o /tmp/pose.stl --diagnostics=json
# pairwise interference / contact / clearance across poses and $t samples
./bin/openscad-js.js --audit model.scad --audit-samples 5 \
  --audit-pose 'curl=0' --audit-pose 'curl=1' --audit-clearance 0.2
```

The audit needs moving solids wrapped in `audit_part("name") { ... }` (unique
names, not nested, outside any `union`/`difference` that combines them). It
exits `4` on interference and `0` otherwise, reporting touching layers as
`CONTACT` and gaps under `--audit-clearance` as `CLEARANCE`. See the root
README's "CLI interference audit" for all options.

Useful things to tell Copilot up front: printer precision / desired clearance,
which variables drive motion (and their ranges), and which file a screenshot
came from.

---

## Architecture & Integration Points

```
+-------------------------------------------------------------+
|                      VS Code Editor                         |
|  - .scad text document                                      |
|  - Copilot Chat / Agent                                     |
+-------------------------------------------------------------+
          |                                  ^
          | Commands & Shortcuts             | Diagnostics & Geometry Telemetry
          v                                  |
+-------------------------------------------------------------+
|                Extension Host (extension.cjs)               |
|  - Commands: Snapshot, Inspect Geometry, Preview, Render     |
|  - File I/O: Saves .openscad-preview.png, reports bounds    |
+-------------------------------------------------------------+
          |                                  ^
          | Webview RPC (postMessage)        | Metrics & Canvas Pixels
          v                                  |
+-------------------------------------------------------------+
|               Preview Webview (Three.js + WASM)             |
|  - Three.js Scene: Bounding box, mesh volume, layers        |
|  - WebGL Canvas: toDataURL / toBlob PNG capture             |
|  - Interactive tools: Measurement ruler & clipping plane    |
+-------------------------------------------------------------+
```

---

## Feature Roadmap

### Follow-up observations from the robot-hand exercise

- Snapshot capture is a VS Code command, not an automatically registered Copilot
  tool. An assistant without a command-execution bridge cannot invoke it directly;
  users can capture from the Camera button and share the resulting PNG.
- The capture command accepts an explicit SCAD URI and awaits both saved PNGs.
  Use that form in a future AI bridge to avoid focus-dependent targeting.
- The workspace-wide `.openscad-preview.png` and `.openscad-model.json` describe
  the latest writer, not necessarily the same model or animation frame. Consider
  a per-file capture manifest with source revision, parameters, animation time,
  camera and metrics for reliably matching screenshots to geometry.
- Files with the same basename in different directories currently share the
  named snapshot destination. Consider entry-relative names or explicit output
  URIs before extending automated multi-model capture.
- Snapshots are written to the workspace root, not beside the `.scad` file.
  An assistant looking next to the model (e.g. `robot/hand-preview.png`) finds
  nothing and may fall back to a stale `.openscad-preview.png`. Report the saved
  path in a discoverable place (manifest, or the active file's directory) and
  consider a setting for the snapshot directory.
- Geometry inspection and measurement-copy commands should use the same
  unambiguous preview selection rules as snapshot capture.
- Fixed: the parser accepted `color([0, 1, 1]) knee = ...;` (an assignment as
  the unbraced child of a module call), leaving the variables silently undefined.
  It now matches upstream (checked against `references/openscad/build/openscad`):
  unbraced children of calls, `if`/`else` and `for` must be instantiations or
  `;`, and `# % ! *` only apply to instantiations.
- Done: interference checking was first improvised for the hand (tagging parts
  and intersecting STL exports by hand) because `audit_part()` was only
  reachable from the preview. The CLI now has `--audit` with `$t` samples,
  `-D`-style poses, JSON output, and separate contact/clearance reporting.
- Done: the preview Audit tab separates overlap, contact and clearance findings,
  with a minimum-clearance input (default 0.2 mm) and worst sample times.
- The CLI audit samples discrete frames. A "sweep" option (refine samples
  around frames where the gap shrinks) would catch collisions between samples.

### 1. Geometric Telemetry & Model Inspection (Phase 1)
- **Goal:** Provide exact numerical dimensions and topological health metrics to Copilot and the user.
- **Data Exposed:**
  - Bounding box dimensions: $\Delta X, \Delta Y, \Delta Z$ in millimeters.
  - Bounds coordinates: $[X_{min}, Y_{min}, Z_{min}]$ to $[X_{max}, Y_{max}, Z_{max}]$.
  - Bounding center: $[X_c, Y_c, Z_c]$.
  - Total volume (in $\text{mm}^3$) and manifold triangle count.
  - Sub-mesh count: solids, background objects (`%`), and debug objects (`#`).
- **Interfaces:**
  - `openscadJs.inspectGeometry` command returns a structured JSON summary.
  - Summary line in preview footer displays $X \times Y \times Z$ mm alongside triangle count and volume.
  - Copilot can run this command or inspect `.openscad-model.json` to verify clearances and tolerances.

### 2. Viewport Snapshot to Workspace (Phase 1)
- **Goal:** Allow Copilot to visually inspect renders, mechanical proportions, and angles through image input.
- **Capabilities:**
  - `openscadJs.captureSnapshot` command renders the active viewport and writes it directly to the workspace as `.openscad-preview.png` (or user-chosen path).
  - Quick camera toolbar button in preview webview: "Save Snapshot to Workspace".
  - Clean background option (preserves shadows and colors without the grid for AI visual analysis).

### 3. Interactive Cross-Section & Slice Plane (Phase 2)
- **Goal:** Reveal internal channels, fastener pockets, and joint clearances inside solid bodies.
- **Capabilities:**
  - Configurable cutting planes ($X, Y, Z$ and inverted) using Three.js local clipping.
  - Visual clipping caps so cut sections appear solid.
  - Copilot can request cross-sectional snapshots to verify tendon passage clearance or screw counterbore depths.

### 4. Interactive 3D Measurement Tool (Phase 3)
- **Goal:** Precise distance and clearance verification between mating parts.
- **Capabilities:**
  - Raycast visible-surface picking in the 3D viewport, respecting the active slice plane.
  - Euclidean distance, signed $\Delta X, \Delta Y, \Delta Z$ readouts, endpoint markers, and a connecting line.
  - Copy measurement points, distance and deltas as structured JSON for Copilot.
  - Optional comparison against a selected 0.20, 0.30 or 0.40 mm gap reference. This comparison does not itself establish a CAD fit or detect interference.

**Status:** Initial interactive point-to-point measurement is implemented. Automated
surface-normal clearance analysis, tolerance presets beyond the three references,
and measurement history remain future work.

### 5. Multi-Part Interference & Clearance Audit (Phase 4)
- **Goal:** Automated collision detection across range-of-motion animations ($t = 0 \dots 1$).
- **Capabilities:**
  - Named parts are wrapped with `audit_part("name") { ... }` so compilation preserves each component before the final union.
  - Sample the animation interval (2–20 poses) and compute pairwise Manifold intersections, reporting overlap volumes, intersection bounds, and sample times.
  - Optionally ignore overlaps below a user-selected volume threshold in mm³.
  - Report touching contacts within 0.001 mm separately from penetration, and gaps below a chosen clearance (default 0.2 mm in the preview).
  - This is discrete sampling, not continuous collision detection; collisions between samples may be missed.

**Status:** Sampled interference, contact and clearance audit is implemented in
the extension and CLI (`--audit`, with `-D` pose lists). Minimum gaps use
Manifold `minGap` on the tessellated geometry.

### 6. Standard Hardware & Mechanism Library (Phase 5)
- **Goal:** Shared verified mechanical primitives for rapid prototyping.
- **Included Modules:**
  - Fasteners: ISO metric screws (M2, M2.5, M3, M4) with clearance holes and counterbores.
  - Fasteners: Heat-set insert pockets and hex nut traps.
  - Bearings: Standard miniature bearings (608, 623, MR63ZZ).
  - Actuators: Micro-servo mounting flanges and horn splines (SG90/MG90S).
