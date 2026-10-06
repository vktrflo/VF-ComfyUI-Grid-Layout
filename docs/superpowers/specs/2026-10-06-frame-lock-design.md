# Frame lock — freeze a frame's geometry

**Date:** 2026-10-06
**Status:** Implemented (user-directed inline, with tests).
**Target:** VF-ComfyUI-Layout-Templates v0.3.0

## Context

Frames are rearranged by dragging: the header moves the whole frame, the right edge resizes its width, and dividers rebalance columns. On a busy canvas those drags are easy to trigger by accident once a layout is finished. The user asked for a lock on the frame, plus a lock icon while it is engaged.

## Approved scope

- A frame can be marked **locked**: it ignores header (move), right-edge (width resize), and divider drags. Menu commands (add row, rename, colors, fill, remove, export) still work — the lock guards against accidental drags, not deliberate edits.
- The frame **••• menu** gains **"Lock frame"** / **"Unlock frame"** (plain items; state read when the menu opens).
- While locked, a **🔒 icon** shows in the frame header between the title and the "•••" button, and the header cursor switches from `move` to `default`.
- Nodes inside a locked frame stay fully editable (they are separate objects); dropping nodes into or out of a locked frame is not blocked (v1 scope).
- No value set → current behavior.

Rejected alternatives:

- Blocking menu commands too — the menus are deliberate two-step actions already; the accident-prone path is dragging.
- A lock on individual cells — the user asked for the parent frame (consistent with the frame-level fill control).
- Freezing node membership changes — node drags land across frames of varying lock states; blocking needs its own design (v2 candidate).

## Data model

- `frame.lock = true` on the frame object, inside the existing `graph.extra.comfyui_layout_templates` v1 metadata. Absent = off.
- `validateFrame` keeps the field only when it is exactly `true`; everything else is dropped without throwing. A stray lock on a cell is dropped by the whitelist.
- Additive: `VERSION` stays `1`; old workflows load unchanged; older extension versions drop the field silently.
- Template export/import round-trips the flag; splits, grids, and removals leave it untouched (it lives on the frame).

## Behavior (`web/core/overlay.js`)

- `startDrag` resolves the live frame as usual, then returns immediately when `frame.lock === true` — one guard covering move, resize, and divider drags (every drag kind flows through `startDrag`). The pointer event is still swallowed, so a locked frame does not pan the canvas either.
- The header renders a `<span class="clt-lock">🔒</span>` (title tooltip "Locked") between the title and the "•••" button when locked; `.clt-lock{flex:none}` shares the 🌀 badge rule.
- Menu entries ("Lock frame" / "Unlock frame") are plain `controller.edit()` mutations, so they land in history and undo like every other frame change.
- The lock icon is DOM in both renderers (the overlay is renderer-agnostic).

## Testing

Unit — `tests/lock.test.mjs`: `validateFrame` keeps frame-level `true` (coexists with `fill`), drops `false`/non-booleans, drops cell-level strays; survives splits, grids, and template round trips.

Browser — `tests/browser.mjs` (classic + Nodes 2.0): lock via the frame menu → `.clt-lock` shows 🔒 → a header drag leaves the frame position unchanged → unlock → the icon disappears and the same drag moves the frame; screenshot `test-results/lock-*.png`.

## Release

Part of the unreleased 0.3.0; README usage bullet; recorded in `docs/verification.md`.
