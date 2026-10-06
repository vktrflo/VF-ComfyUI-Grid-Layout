# Header colors — customizable frame and cell header bars

**Date:** 2026-10-06
**Status:** Approved (design reviewed and approved by the user)
**Target:** ComfyUI-Layout-Templates v0.2.0

## Context

Frame and cell header bars are currently fixed to `var(--comfy-menu-bg, #20282c)`. Users cannot visually distinguish frames or sections of a layout on the canvas. This spec adds a customizable "main color" for the header bars through the existing menu/dialog system.

## Approved scope

Per-frame color with per-cell override:

- A frame can store one header color. It colors the frame header bar **and** every cell header bar in that frame.
- A cell can store its own color, overriding the frame color for that cell only.
- No value set → fall back: cell → frame → default theme look (pixel-identical to today).

Rejected alternatives:

- Per-frame only — no color-coding of individual cells/sections.
- Global single color — cannot distinguish frames; the value would not persist per layout.

## Data model

- `frame.color` and `cell.color`: optional `#rrggbb` (lowercase) strings on the frame object and on leaf cells inside the existing `graph.extra.comfyui_layout_templates` v1 metadata. Only leaf cells carry colors (only leaves render header bars).
- Metadata `VERSION` stays `1` — the field is additive. Old workflows load unchanged; an older extension version reading new data drops the field silently through the existing `validateFrame` whitelist (no throw).
- `normalizeColor(value)` (new export in `web/core/layout.js`):
  - accepts `#abc`, `abc`, `#aabbcc`, `aabbcc` (any case) → returns lowercase `#aabbcc`;
  - anything else (non-string, wrong length/characters) → `undefined`;
  - never throws. Color is cosmetic data and must never block a workflow load, render, or template import.
- `validateFrame` carries colors for the frame object and every leaf cell, so colors survive workflow save/load, workflow copies, undo/redo snapshots, and template export/import (including empty exported templates).
- Structural editing semantics (consistent with existing node/label retention):
  - `splitCell` and `gridCell` move the original cell's color to the first resulting leaf cell, exactly like nodes and label today; the split node carries no color afterward.
  - `deleteCell` drops the deleted cell's color; collapsed parents carry no color.
  - New cells (bottom row, second split child, grid children) start without a color and inherit the frame color at render time.

## Rendering

- `contrastColor(hex)` (new export in `web/core/overlay.js`): perceived luminance `(0.299r + 0.587g + 0.114b) / 255`; luminance > 0.6 → text `#101418`, else `#f4f6f7`.
- In `LayoutOverlay.render()`:
  - frame header: `normalizeColor(frame.color)`;
  - cell header: `normalizeColor(cell.color) ?? normalizeColor(frame.color)`;
  - when a color applies, the header element gets class `clt-custom-bg` plus inline `background` and `color` (contrast) styles.
- CSS additions:
  - `.clt-custom-bg .clt-button:hover, .clt-custom-bg .clt-button:focus-visible { background: rgba(128,128,128,.3); border-color: transparent; }` — hover feedback stays legible on any chosen color.
  - `.clt-title-input` text color changes from `inherit` to `var(--fg-color, #e4e4e7)` so the inline rename field stays readable on colored bars.
- Elements are rebuilt on every render (`replaceChildren`), so there are no stale styles; the existing geometry re-render signature already includes frames and cells, so color edits re-render automatically.
- Explicitly bounded: borders, dividers, resize handles, and menus keep the default teal accent — only header bars take the custom color.

## UI

- Frame ••• menu, after "Rename layout…":
  - **Header color…** — dialog with a native color input (`type: 'color'`), prefilled with the frame's color or `#20282c`; applies `frame.color`.
  - **Reset header color** (shown only when `frame.color` is set) — removes the frame value. Explicit cell overrides remain (clear them from the cell menu).
- Cell + menu, after "Rename cell…":
  - **Header color…** — prefilled with `cell.color ?? frame.color` or `#20282c`; sets a per-cell override.
  - **Reset header color** (shown only when the cell has its own value) — restores inheritance.
- All writes go through `controller.edit()`: single balanced undo step, rollback on failure, same as rename.
- The existing `dialog()` helper already passes `field.type` through to the input element, so the color picker needs no structural change.

## Testing

Unit — new `tests/color.test.mjs` (run: `npm test`):

- `normalizeColor`: valid forms (with/without `#`, 3/6 digits, uppercase) normalize to lowercase `#rrggbb`; junk (numbers, `null`, `'red'`, `'#12'`, `'#gggggg'`, `'#1234567'`, `''`) → `undefined`; never throws.
- `validateFrame`: frame + nested-cell colors round-trip; invalid values dropped without throwing; absent stays absent.
- `exportTemplate` / `importTemplate`: colors preserved (frame + cells) across a JSON round trip; fresh IDs unaffected.
- `splitCell` / `gridCell`: color migrates to the first leaf.
- `contrastColor`: `#ffffff` → `#101418`; `#000000` → `#f4f6f7`; `#70d8be` → `#101418`; `#20282c` → `#f4f6f7`.

Browser — extend `tests/browser.mjs` (runs in both classic and Nodes 2.0):

- Set a frame color via ••• → frame header + all cell headers show the color; label text flips contrast.
- Override one cell → only that cell changes; siblings keep the frame color.
- Undo/redo of a color change.
- Colors survive a workflow save/load round trip.
- Reset cell → back to frame color; reset frame → original default look.
- Screenshot of the colored state for visual inspection.

All 31 existing unit tests stay green.

## Release

- Version `0.1.2` → `0.2.0` in `package.json` and `pyproject.toml`.
- README: usage bullet + version note.
- `dist/ComfyUI-Layout-Templates.zip` regenerated via `python tools/package.py`.
- `docs/verification.md`: record the actual unit + browser results after the run — no claims beyond what ran.
