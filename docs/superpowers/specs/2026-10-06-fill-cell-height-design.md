# Fill cell height — stretch the bottom node to fill a cell

**Date:** 2026-10-06
**Status:** Approved (design reviewed and approved by the user)
**Target:** VF-ComfyUI-Layout-Templates v0.3.0

## Context

Cell heights are content-driven: a cell is as tall as its stacked nodes need. In a row (horizontal split), every cell is stretched to the tallest sibling's height — but nodes inside a shorter cell stay top-aligned at their natural heights, leaving a gap below them. This spec gives a cell the ability to hand that spare height to its nodes.

## Approved scope

Per-cell opt-in toggle, bottom-node growth, snap-back on disable:

- A cell can be marked **fill**: its spare vertical height is given to the **bottom node** in the stack. The bottom node's body ends flush with the cell's content floor (`cell bottom − PAD`); all other nodes keep their measured heights.
- The toggle lives in the cell "+" menu: **"Fill cell height"** when off, **"Fit to content height"** when on.
- Stretch is **elastic**: recomputed on every layout from the bottom node's natural minimum height. If siblings grow, the node stretches deeper; if the row shrinks, the node eases back and the frame can shrink again. Nothing becomes sticky.
- Turning the toggle off clears the flag **and snaps the bottom node back to its natural minimum height**, in the same undo step.
- No value set → current behavior, pixel-identical to today.

Rejected alternatives:

- Always-on filling — would silently reshape every existing saved workflow on load; no opt-in.
- Per-frame toggle with per-cell override (colors pattern) — the user chose per-cell only; smallest surface, no inheritance rules.
- Sharing the spare height evenly or proportionally across sibling nodes — the user chose bottom-node growth.
- Sticky stretching from current size — the stretched height would become "content", the frame could never shrink back, and snap-back on disable would lose its reference point.
- Keeping the stretched height on disable — contradicts the chosen snap-back behavior.

## Data model

- `cell.fill = true` on **leaf cells** only, inside the existing `graph.extra.comfyui_layout_templates` v1 metadata. Absent = off.
- Metadata `VERSION` stays `1` — additive. Old workflows load unchanged; older extension versions drop the field silently through the `validateFrame` whitelist.
- `validateFrame`: the leaf branch keeps the field only when it is exactly `true` (`if (cell.fill === true) result.fill = true;`). Strings, numbers, and `false` are dropped without throwing. A stray `fill` on a split cell is dropped (only leaves carry it, same invariant as colors).
- Structural editing semantics (consistent with color/nodes/label retention):
  - `splitCell` and `gridCell` move `fill` to the first resulting leaf cell, exactly like `color` today.
  - `deleteCell`, `addBottomRow`, and `resizeRightEdge` are unaffected.
  - New cells start without the flag.
- Template export/import round-trips the flag (including empty exported templates; harmless with no nodes).

## Geometry (pure engine — `web/core/layout.js`)

- Metrics entries gain two fields from the adapter:
  - `minHeight`: the node's natural minimum height (`computeSize` height), falling back to its current height when the computed value is unavailable; `0` for collapsed nodes.
  - `collapsed`: boolean, so the engine can skip stretching a collapsed bottom node.
- **Natural sizing** (`minimum()`, leaf branch): for a **filled** cell, the bottom node contributes `minHeight` instead of its measured `height` to the content height. The cell (and therefore the row and frame) can shrink back to what the filled cell really needs. Unfilled cells keep using measured heights.
- **Placement** (`place()`, leaf branch): for a **filled** cell, the bottom node's height is `max(minHeight, floor − bodyTop)` where `floor = rect[1] + rect[3] − PAD` (the cell's content floor) and `bodyTop` is where the bottom node's body would start at natural stacking. Its bottom edge lands exactly on the floor. All other nodes are placed with their measured heights, unchanged.
  - Collapsed bottom node → no stretch (it stays title-only).
  - Empty cell → no-op.
  - If the available space is below the node's minimum, the node keeps `minHeight` (a gap can remain only if the row cannot shrink further).
- The stretch is **idempotent**: re-running `layoutFrame` with the same metrics yields identical placements (pinned by test).

## Adapter and controller

- `NodeAdapter.measure` returns `minHeight` and `collapsed` alongside the existing fields (`height` semantics unchanged).
- Snap-off is applied through the adapter inside the same `controller.edit()` that clears the flag: measure the bottom node, then set its height to `minHeight` via the normal sizing API (skipped for collapsed nodes; `apply` already guards collapsed nodes). Result: one balanced undo step containing both the flag change and the snap.

## UI (cell "+" menu — `web/core/overlay.js`)

- Entries appear after the header-color entries:
  - flag off → **"Fill cell height"** — sets `cell.fill = true`.
  - flag on → **"Fit to content height"** — clears the flag and snaps the bottom node.
- Plain menu items like the rest (no checkmarks); state is read when the menu opens (`cell.fill === true`).
- Works on empty cells too (the flag simply takes effect once a node is dropped and becomes the bottom node).

## Rendering concerns

- The stretch writes real node heights through the normal sizing API (`setSize`), so classic and Nodes 2.0 both show it; positions still come from the usual placement pass.
- Heights of a filled cell are **layout-owned**: a manual node height drag is overridden by the next layout while filling is enabled. Documented in the README.
- The existing re-render signature already covers geometry; the elastic formula is stable across ticks (idempotence test), so no render loop.

## Testing

Unit — new `tests/fill.test.mjs` (run: `npm test`):

- `validateFrame`: keeps `true`; drops `false`, non-booleans, and stray flags on split cells; absent stays absent; coexists with `color` on the same cell.
- `splitCell` / `gridCell`: `fill` migrates to the first leaf.
- `exportTemplate` / `importTemplate`: round trip with fresh IDs.
- Geometry with hand-built metrics: single filled node stretches flush to the cell floor; multiple nodes → only the bottom one grows; flag off → placements identical to today; fill with no spare height → bottom node sits at its minimum; collapsed bottom → no stretch; empty filled cell → no-op; idempotence (repeated layout deeply equal, including after re-measurement of the stretched height).

Browser — extend `tests/browser.mjs` (runs in classic and Nodes 2.0):

- Build a two-column frame where one column is taller (enlarge a node via the sizing API), fill the shorter cell's node flush, and assert the node's bottom edge equals the cell content floor.
- Toggle off → node height returns to the measured `minHeight`; menu labels switch between the two states.
- Undo/redo both directions; workflow save/load keeps the stretch.
- Screenshot of the filled state for visual inspection (`test-results/fill-*.png`).

All 39 existing unit tests stay green.

## Release

- Version `0.2.0` → `0.3.0` in `package.json` and `pyproject.toml`.
- README: usage bullet + version note.
- `dist/VF-ComfyUI-Layout-Templates.zip` regenerated via `python tools/package.py`.
- `docs/verification.md`: record the actual unit + browser results after the run — no claims beyond what ran.
- Commit(s) in the local repo; push to GitHub when the user asks.
