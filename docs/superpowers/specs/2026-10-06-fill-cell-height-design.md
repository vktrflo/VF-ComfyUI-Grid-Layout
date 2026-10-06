# Fill cell height — stretch the bottom node to fill a cell

**Date:** 2026-10-06
**Status:** Approved — **revised 2026-10-06 (user-directed): control moved from the cell level to the parent container (the frame).**
**Target:** VF-ComfyUI-Layout-Templates v0.3.0

## Context

Cell heights are content-driven: a cell is as tall as its stacked nodes need. In a row (horizontal split), every cell is stretched to the tallest sibling's height — but nodes inside a shorter cell stay top-aligned at their natural heights, leaving a gap below them. This spec gives a frame the ability to hand that spare height to its cells' nodes.

## Approved scope (revision 2 — frame level)

Frame-level opt-in toggle, bottom-node growth, release-on-disable:

- A frame can be marked **fill**: **every cell** in it hands its spare vertical height to its **bottom node**. Each bottom node's body ends flush with its cell's content floor (`cell bottom − PAD`); all other nodes keep their heights.
- The toggle lives in the frame **••• menu**: **"Fill cell height"** when off, **"Fit to content height"** when on. The per-cell "+" menu entries from revision 1 are **removed** (revision 1 was never released).
- Stretch is **elastic**, computed from each bottom node's **intrinsic height** (the height it had before filling stretched it — see Adapter). Tall, deliberately-enlarged nodes keep anchoring their row: enabling fill never shrinks them, and when a neighbor's content shrinks, filled nodes ease back rather than ratcheting the frame taller. Nothing becomes sticky during a session.
- Turning the toggle off clears the flag **and returns every filled node to its pre-fill height** (falling back to its natural minimum when no pre-fill height is known, e.g. after a reload), in the same undo step.
- No value set → current behavior, pixel-identical to today.

Revision rationale: the original per-cell control made users toggle each cell individually; the user directed a single switch at the container level. The natural-height model had to change with it — with *every* cell filled, "natural height = node minimum" (revision 1) would collapse the whole frame to minimums and stop enlarged nodes from anchoring their rows. Tracking each node's pre-stretch height (the intrinsic height) preserves both properties, and as a bonus removes revision 1's "enabling fill shrinks an enlarged node" quirk.

Rejected alternatives:

- Per-cell toggle (revision 1 model) — superseded by user direction: one switch per container beats toggling each cell.
- Per-cell opt-out of the frame flag — the user chose frame-level only; smallest surface, no exceptions.
- Always-on filling — would silently reshape every existing saved workflow on load; no opt-in.
- Sharing the spare height evenly or proportionally across sibling nodes — the user chose bottom-node growth.
- Sticky stretching (natural = measured current size) — the frame could never shrink back; release would have no reference point.
- Natural = node minimum (revision 1) — collapses frames whose cells ALL fill; loses enlarged-node anchors.

## Data model

- `frame.fill = true` on the frame object, inside the existing `graph.extra.comfyui_layout_templates` v1 metadata. Absent = off.
- Metadata `VERSION` stays `1` — additive. Old workflows load unchanged; older extension versions drop the field silently through the `validateFrame` whitelist.
- `validateFrame`: the frame-level result keeps the field only when it is exactly `true` (`if (value.fill === true) result.fill = true;`). Strings, numbers, and `false` are dropped without throwing. A `fill` field on any cell (leaf or split) is not read and is dropped by the whitelist.
- Structural editing semantics: `splitCell`, `gridCell`, `deleteCell`, `addBottomRow`, and `resizeRightEdge` are all unaffected — the flag lives on the frame; new cells fill like any other cell in the frame.
- Template export/import round-trips the flag (including empty exported templates; harmless with no nodes).

## Geometry (pure engine — `web/core/layout.js`)

- Metrics entries gain two adapter-driven fields:
  - `minHeight`: the node's natural minimum height (`computeSize` height), falling back to its current height when the computed value is unavailable; `0` for collapsed nodes.
  - `collapsed`: boolean, so the engine can skip stretching a collapsed bottom node.
  - `height` now reports the node's **intrinsic height** (pre-stretch; identical to today's value whenever the node is not currently stretched). The engine consumes it as before, so a filled frame's cells size from intrinsic content — this is what keeps the frame shrinkable while fill is on. `minimum()` needs no fill-specific logic.
- **Placement** (`place()`, leaf branch): when `frame.fill === true`, each leaf's **bottom node** gets height `max(minHeight, floor − bodyTop)` where `floor = rect[1] + rect[3] − PAD` and `bodyTop` is where the bottom node's body starts at natural stacking; its bottom edge lands exactly on the floor. Its placement carries a `fill: true` marker so the adapter knows the height is layout-owned. All other nodes are placed with their (intrinsic) heights, unchanged.
  - Collapsed bottom node → no stretch (it stays title-only).
  - Empty cell → no-op.
  - If the available space is below the node's minimum, the node keeps `minHeight`.
  - A cell with no spare height keeps its bottom node at its intrinsic height — enabling fill never shrinks a cell.
- The stretch is **idempotent**: re-running `layoutFrame` with the same metrics yields identical placements (pinned by test).

## Adapter (`web/core/adapter.js`)

`NodeAdapter` tracks two per-node `WeakMap`s:

- `bases`: the node's **base (intrinsic) height** — the last height observed that was not set by a fill stretch. Updated on every `measure()` whenever the node's current height differs from the last height we applied (i.e. the size is foreign: the user's, a node's own, or an initial value).
- `appliedHeights`: the height we last set through a `fill` placement.

Behavior:

- `measure()` reports `height: max(base, computeSize minimum)` — so while a fill stretch is in place, the metric still describes the node's intrinsic height (no feedback: the layout never reads its own stretch back as content).
- `apply()` records `appliedHeights` when the placement is marked `fill`.
- `releaseFill(node)`: reverts the node's height to its tracked base **only if its current height is still our applied stretch**; if the node changed since (user resize, node logic), it is left alone. When no applied stretch is known (e.g. after a workflow reload), the node is set to its natural minimum (computeSize height). Collapsed nodes are skipped.
- Known limitation (documented): after a workflow reload, a persisted stretched height is indistinguishable from user content, so it becomes the new base — release then falls back to the natural minimum instead of the exact pre-fill height.

## UI (frame "•••" menu — `web/core/overlay.js`)

- Entries appear after the header-color entries:
  - flag off → **"Fill cell height"** — sets `frame.fill = true`.
  - flag on → **"Fit to content height"** — clears the flag and releases every cell's bottom node (one undo step).
- The cell "+" menu keeps only its pre-fill entries (delete/split/grid/rename/color).
- Plain menu items like the rest (no checkmarks); state is read when the menu opens (`frame.fill === true`).

## Rendering concerns

- The stretch writes real node heights through the normal sizing API (`setSize`), so classic and Nodes 2.0 both show it; positions still come from the usual placement pass.
- Heights of a filled cell are **layout-owned**: a manual node height drag is overridden by the next layout while filling is enabled. Documented in the README.
- The existing re-render signature already covers geometry; the elastic formula is stable across ticks (idempotence test), so no render loop.

## Testing

Unit — `tests/fill.test.mjs` (run: `npm test`):

- `validateFrame`: keeps frame-level `true`; drops `false`, non-booleans; a `fill` on any cell is dropped; absent stays absent; coexists with frame `color`.
- Frame fill survives `splitCell` / `gridCell` unchanged (the flag never moves).
- `exportTemplate` / `importTemplate`: round trip with fresh IDs.
- Geometry with hand-built metrics: frame fill stretches each cell's bottom node flush to the floor; multiple nodes → only the bottom one grows; flag off → placements identical to today; a lone filled cell keeps its node at its intrinsic height (no collapse to minimum); collapsed bottom → no stretch; empty cell → no-op; idempotence (repeated layout deeply equal, including after re-measurement of the stretched height).
- Adapter (fake node fixture): `measure` reports intrinsic height while a stretch is applied; a foreign size change becomes the new base; `releaseFill` reverts to base when the stretch is still ours, leaves foreign changes alone, and falls back to the minimum with no tracked stretch.

Browser — extend `tests/browser.mjs` (runs in classic and Nodes 2.0):

- Build a two-column frame where one column is taller (enlarge a node via the sizing API); enable fill from the frame ••• menu; assert the short column's node bottom edge equals its cell content floor and the tall column's node is unchanged (anchor preserved).
- Toggle off → the filled node returns to its pre-fill height; menu labels switch between the two states.
- Undo/redo both directions; workflow save/load keeps the stretch.
- Screenshot of the filled state for visual inspection (`test-results/fill-*.png`).

The unit tests outside the fill file stay green.

## Release

- Version stays `0.3.0` (revision 2 is part of the unreleased 0.3.0 feature).
- README: usage bullet updated to the frame menu.
- `dist/VF-ComfyUI-Layout-Templates.zip` regenerated via `python tools/package.py`.
- `docs/verification.md`: record the actual unit + browser results after the run — no claims beyond what ran.
- Commit(s) in the local repo; push to GitHub when the user asks.
