# Header configuration panel — background, text color, and font size

**Date:** 2026-10-06
**Status:** Approved (design reviewed and approved 2026-10-06; scope: frame defaults + per-cell overrides).
**Target:** VF-ComfyUI-Layout-Templates v0.3.0

## Context

v0.2.0 gave frames and cells a customizable header background: a per-frame color, optional per-cell overrides, labels whose text color auto-switches between dark and light by measured WCAG contrast, and conditional reset entries. The user asked to generalize the color dialog into a **Header Configuration panel** that additionally lets the user set the header **text color** explicitly and the header **font size**.

## Approved scope

- The frame "•••" menu and the cell "+" menu replace **"Header color…"** with **"Header configuration…"**, opening a panel with three fields:
  - **Background color** — the existing swatch; OK always sets it at that level (unchanged behavior).
  - **Text color** — swatch plus an **"Auto (contrast)"** checkbox. Auto (the default whenever the level has no explicit text color) keeps the automatic WCAG dark/light selection; unchecking pins an explicit color.
  - **Font size** — optional number in px; blank leaves it unset; the input is clamped to 8–24 on OK.
- Inheritance resolves per field: cell → frame → defaults (background `#20282c`, text auto-contrast, size 13px). A cell panel can override any subset; OK never pins a field the user left unset (Auto checked = unset; blank size = unset).
- The conditional **"Reset header configuration"** (replacing "Reset header color") appears when any of the three fields is set at that level and clears all three.
- No value set → current behavior, pixel-identical to today.

Rejected alternatives:

- Frame-level only — the user chose to keep the existing frame + per-cell override model.
- Always-explicit text color (seeded with the computed auto color) — OK would silently freeze the auto contrast that the colors feature is built on; the Auto checkbox keeps both behaviors reachable.
- Per-field reset entries — one reset per level covers the cleanup case; per-field unsetting happens inside the panel (Auto / blank size).
- Headers growing with the font size — header bar heights are shared with the layout engine (`CELL_TITLE` constants in geometry); font size is visual-only.

## Data model

- Frame and cell objects gain `textColor` (normalized `#rrggbb`) and `fontSize` (number, 8–24) beside the existing `color`, inside `graph.extra.comfyui_layout_templates` v1. Absent = unset.
- `validateFrame`: `textColor` goes through `normalizeColor` (dropped when invalid); `fontSize` is kept only when finite, then rounded and clamped to 8–24 (non-numbers dropped). Both coexist with `color`, `fill`, and `lock`; strays on the wrong level are dropped by the whitelist, and corrupted values never block a load.
- `splitCell` / `gridCell` carry `color`, `textColor`, and `fontSize` to the first leaf (exactly as `color` migrates today). New cells start unset; removals are unaffected.
- Templates and workflow saves round-trip all three; metadata `VERSION` stays `1` (additive).

## UI (`web/core/overlay.js`)

- `luminance()` / `contrastColor()` stay as-is. `applyHeaderColor(el, color)` generalizes to `applyHeaderStyle(el, { color, textColor, fontSize })`:
  - background + the `clt-custom-bg` class are applied only when a background color resolves;
  - text color = explicit `textColor` when set, else `contrastColor(background)` when a background exists, else untouched (theme default);
  - font size is applied to the **header bar element**, so the title and its small controls scale together as one bar.
- Rendering resolves per field: the frame header uses `frame.<field>`; a cell header uses `cell.<field> ?? frame.<field>` (background already resolves this way).
- The dialog helper gains three small extensions (used by the panel, reusable later): `field.optional` (input is not required; blank allowed), `field.min` / `field.max` for number inputs (the grid dialog's existing 1–16 bounds move onto the same mechanism), and input type `'checkbox'` with an optional `field.onChange(input, inputs)` hook (wired on `change` and invoked once at open — the panel uses it to disable the text swatch while Auto is checked).
- Panel prefill: background `cell.color ?? frame.color ?? '#20282c'` (existing behavior); text swatch `cell.textColor ?? frame.textColor ?? contrastColor(effective background)` with Auto checked iff the level has no own `textColor`; size `cell.fontSize ?? frame.fontSize ?? 13`.
- Submit runs one `controller.edit()`: background set/deleted from its normalized value; text color deleted when Auto is checked, else set from its normalized value; size deleted when blank, else `Math.round` clamped to 8–24.
- Menus: "Header configuration…" in both menus; the conditional "Reset header configuration" clears `color`, `textColor`, and `fontSize` at that level.

## Testing

Unit — extend `tests/color.test.mjs`:

- `validateFrame` keeps/drops `textColor`, clamps/drops `fontSize` (keeps 8–24 after rounding, drops non-numbers); coexistence with `color` / `fill` / `lock`; absent stays absent.
- `splitCell` / `gridCell` carry all three fields to the first leaf.
- Template round-trip with all three fields and fresh IDs.

Browser — extend `tests/browser.mjs` (classic and Nodes 2.0):

- Frame panel: set background `#70d8be`, uncheck Auto → text `#112233`, size 18 → frame header computed styles show the background, text color, and 18px; every cell header inherits all three.
- Cell panel: override font size only → that cell's bar renders 11px while siblings stay at 18px, background and text stay inherited.
- Auto toggle: pin a cell text color, reopen the panel, re-check Auto → the cell override clears and the inherited color returns.
- Reset entries clear their level; computed styles return to defaults (default background, auto contrast, 13px).
- Undo/redo of a panel application; workflow save/load keeps all three; screenshots `test-results/header-config-classic.png` and `test-results/header-config-nodes-2.png`.
- The existing color scenario keeps passing with the renamed entries ("Header configuration…", "Reset header configuration") and the same prefill/OK flow — with Auto defaulting to checked and the size blank, OK is a no-op for those two fields.

## Release

- Part of the unreleased 0.3.0; version stays 0.3.0.
- README usage bullet updated; `docs/verification.md` records the actual results; `dist/VF-ComfyUI-Layout-Templates.zip` regenerated via `python tools/package.py`.
- Commits in the local repo; push to GitHub when the user asks.
