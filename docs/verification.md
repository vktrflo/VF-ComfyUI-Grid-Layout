# Verification record

Test environment: Windows, Node.js 22.22.0, Python 3.13, ComfyUI 0.39.0, frontend 1.53.10. ComfyUI runs on CPU in an isolated base/user/input/output directory on port 8197. Extension assets are injected only into the test browser's requests.

Version 0.1.1 regression verification also runs the full browser suite at `http://10.0.0.164:8197`, asserting `isSecureContext === false` and that `crypto.randomUUID` is unavailable. Both renderers open `examples/two-column.workflow.json` through ComfyUI's normal file handler and restore its nodes, connection, and frame. Unit coverage includes ID generation without `randomUUID`, without any crypto API, and example workflow structure.

## Automated checks

Version 0.1.2 adds checks for dragging right/bottom frame edges in both renderers, bottom-row insertion with unchanged existing node positions, row undo/redo, repeated rows, nested splitting of a new row, and empty-template round-trip.

- Pure layout/controller tests cover multi-node geometry, title clearance, minimum-size growth, nested splits, grids, ordering, transfers, detach, missing nodes, template round-trip and validation, workflow metadata, balanced transactions, graph switching, rollback, coordinate conversion, dynamic minimum widths, and geometry limits.
- Browser checks run with classic rendering and Nodes 2.0: startup, canvas creation, real node drags, stacking, transfers, release, split undo/redo, frame movement, divider adjustment, grids and nested cells, JSON download/import, workflow round-trip, frame resize/undo, removal/undo, zoom/pan, and automatic attachment of newly created nodes.
- Browser checks compare API prompt data before and after layout operations, then run an actual model-free EmptyImage → SaveImage generation and check its success/output in ComfyUI history.
- Screenshots are saved under `test-results/` for visual inspection.

## Manual checks for other ComfyUI versions or custom-node packs

1. Install the ZIP, restart ComfyUI, and confirm the two layout actions appear in the canvas context menu.
2. Drop two nodes with text controls or image previews into a cell. Confirm their titles, controls, and connection sockets remain accessible.
3. Split the populated cell; confirm the first child retains both nodes. Resize its divider in both directions.
4. Drag a node between cells and out of the frame. Undo and redo each operation.
5. Move and resize the frame; confirm all attached nodes follow, without changing widget values or links.
6. Save/reload the workflow. Export/import an empty template and confirm it contains no nodes.
7. Remove the frame; confirm the nodes remain and the workflow still executes.
8. Repeat at different zoom levels in both renderers and with the custom-node packs you use.

Third-party node packs and older/newer frontend releases are not exhaustively tested.

## Development cell editing update

Thirty unit tests pass, including a geometry fixture extracted from the user's five-column nested layout. Right-edge expansion and shrink preserve all left columns, and shrink clamps to minimum content width. Multi-row grids resize only each row's boundary cell. Deletion tests cover nested parent collapse, surviving IDs/memberships, and clearing the final cell. Browser scenarios cover populated-cell deletion, detached-node geometry, connections, undo/redo, and unchanged left-column node geometry while resizing.

Automatic-height update: 31 unit tests and both classic/Nodes 2.0 browser suites pass. Frame height shrinks and grows with content; stacked rows use their content heights rather than saved vertical ratios. Bottom/corner handles and row-height divider handles are absent. Diagonal width-handle drag preserves automatic height.

Inline title editing: Browser scenarios pass in both renderers for frame/cell double-click, Enter save, blur save, Escape cancellation, and title undo/redo. All 31 unit tests also pass.

## Header colors update (v0.2.0)

Version 0.2.0 adds customizable header-bar colors: a per-frame color covering the frame header bar and all its cell header bars, with optional per-cell overrides, chosen from either menu with a native color picker. Label text switches between dark and light by measured WCAG contrast, and reset entries restore inheritance or the default theme look. Colors persist in workflow metadata and exported templates.

Automated checks (2026-10-06; Windows, Node.js 26.7.0; dedicated ComfyUI 0.39.0 / frontend 1.53.10 test server on port 8197 with custom nodes disabled):

- Unit: 39 tests pass (`npm test`), covering engine color normalization, validation keep/drop, template round-trips, split/grid migration, stray-color and deletion invariants, and contrast selection (direct WCAG comparison with saturated-color regression pins).
- Browser: both classic and Nodes 2.0 suites pass, including the header-color scenario — frame color inherited by every cell header (dark label text), per-cell override with sibling/frame isolation (light label text), undo/redo, workflow save/load round-trip, conditional reset entries before/after setting, dialog prefills, and screenshots (`test-results/colors-classic.png`, `test-results/colors-nodes-2.png`).
- Reviews: spec-compliance and code-quality reviews passed for all three implementation tasks; one review-driven improvement (replacing the single luma threshold with direct WCAG contrast comparison) was amended into the design spec and re-reviewed before release.

Browser-suite note: run the dedicated instance with `--disable-all-custom-nodes`. On the test install, loading the full custom-node set (~600 frontend extensions) prevented the suite's canvas-menu step from surfacing the extension's menu entries; the minimal environment passes both renderers.

## VF rename + cyclone emoji update (2026-10-06)

- Renamed the project to `VF-ComfyUI-Layout-Templates`: repository folder, npm/pyproject package names, installable ZIP name and inner folder, extension registration name (`VF.ComfyUI.LayoutTemplates`), browser-test asset prefix, and documentation references. The workflow metadata key `comfyui_layout_templates` is intentionally unchanged so existing saved workflows and templates keep loading.
- Added 🌀 to the frame header title bar (decorative `aria-hidden` element, separate from the editable label) and prefixed both canvas context-menu entries: `🌀 Add Layout Frame`, `🌀 Import Layout Template…`.
- Checks (same dedicated 0.39.0 test server): `npm test` 39/0; browser suite green in both renderers with new assertions for the header emoji element and the raw-label rename prefill.

## Dialog polish update (2026-10-06)

- The header-color dialog's swatch is now a large rectangle (160x42, accent border, pointer cursor); the confirm button reads **OK** (Cancel unchanged) across the extension's dialogs; frame, cell, menu, and dialog text now uses the ComfyUI frontend font stack (`var(--font-inter, ...)`) instead of Consolas.
- Checks (same dedicated 0.39.0 test server): `npm test` 46/0; browser suite green in both renderers — new assertions pin the swatch size (at least 140x36) and the Inter font family on frame titles, with release screenshots `test-results/dialog-classic.png` and `test-results/dialog-nodes-2.png`.

## Fill cell height update (v0.3.0, frame level)

Version 0.3.0 adds frame-level height filling: **Fill cell height** in the frame "•••" menu stretches every cell's bottom node flush with its cell's content floor — recomputed every layout from each node's intrinsic (pre-stretch) height, so short cells track taller neighbors elastically and enlarged nodes keep anchoring their rows; **Fit to content height** returns the nodes to their pre-fill heights. Stored as `frame.fill` in the existing v1 metadata; travels through workflow saves and exported templates. (A first revision placed the control per-cell; the user directed the container-level control before release, and the intrinsic-height model replaced the initial minimum-height model with it.)

Automated checks (2026-10-06; same dedicated 0.39.0 / frontend 1.53.10 test server on port 8197 with custom nodes disabled):

- Unit: 52 tests pass (`npm test`) — the fill suite covers frame-flag validation (keeps `true`, drops strays on any cell), survival across splits/grids, template round-trips, flush-to-floor geometry (each filled cell's bottom node, bottom-node-only among stacked nodes, lone cells keeping their intrinsic height), collapsed/empty no-ops, idempotence, adapter intrinsic-height reporting, release behavior (revert to the pre-fill height, foreign changes left alone, minimum fallback without tracking), and tracking survival across node-instance swaps.
- Browser: both classic and Nodes 2.0 suites pass — enabling fill from the frame menu stretches the short column flush to the cell floor while the taller anchor column is untouched; labels switch between "Fill cell height" and "Fit to content height"; undo/redo round-trips; release returns the node to its pre-fill height; the flag and stretch survive a workflow save/load round trip. Screenshots: `test-results/fill-classic.png`, `test-results/fill-nodes-2.png` (both show the flush alignment).
- Hardening found by an instrumented browser probe (scratch, not committed): ComfyUI's undo/redo replaces node instances with the stretched size baked into the restored state — fill tracking now keys by node id so the pre-stretch base survives; `apply()` records the applied stretch *before* `setSize` because resize callbacks can synchronously re-enter `measure` and it would otherwise adopt the stretch as content. Both are pinned by unit tests. The suite also forces a canvas repaint before scenario screenshots, because headless captures could otherwise show a stale bitmap (data assertions were unaffected).
- Implementation notes: one existing adapter-shape assertion in `tests/controller.test.mjs` was updated for the new `minHeight`/`collapsed` metric fields. The fill browser scenario deselects nodes before opening menus — ComfyUI's Selection Toolbox appears alongside dragged nodes and intercepted the first menu click (observed once, fixed in the suite).

## Frame lock update (2026-10-06)

- The frame "•••" menu gains **Lock frame** / **Unlock frame**; while locked a 🔒 shows in the frame header (between the title and the menu button) and the header cursor stays `default`. Locked frames ignore header, right-edge, and divider drags (single guard in `startDrag`); menu commands and node editing are unaffected. Stored as `frame.lock` in the v1 metadata; splits/grids/removals leave it alone and templates round-trip it.
- Checks (same test server): `npm test` 52/0 (2 new lock tests: validation keep/drop and split/grid/round-trip survival); browser suite green in both renderers — the lock scenario toggles the lock from the frame menu, asserts the 🔒 appears, proves a header drag leaves the frame position unchanged while locked, then unlocks and proves the same drag moves the frame. Screenshots: `test-results/lock-classic.png`, `test-results/lock-nodes-2.png`.

## Header configuration update (2026-10-06)

- The "Header color…" dialog is now a **Header configuration** panel: background color, text color (with an **Auto (contrast)** checkbox), and an optional font size (8–24px, blank keeps the inherited/default size so OK never pins a default). It lives in the frame "•••" menu and each cell's "+" menu with the existing inheritance model (cell → frame → defaults); **Reset header configuration** clears the three fields at that level.
- Stored as `textColor` + `fontSize` beside `color` in the v1 metadata: validation normalizes colors, rounds and clamps sizes to 8–24 (non-numbers dropped), splits and grids carry the whole header config to the first leaf, and templates plus workflow saves round-trip all of it.
- Checks (same dedicated 0.39.0 / frontend 1.53.10 test server on port 8197 with custom nodes disabled): `npm test` 54/0 — two new tests cover validation keep/clamp/drop and split/grid/round-trip survival. Browser suite green in classic and Nodes 2.0 — panel prefill states (default background, Auto checked with the computed contrast swatch, blank size), applying all three fields to the frame bar and inherited cells (`rgb(112, 216, 190)` background, `18px`, dark label), a cell overriding only the size (11px vs 18px siblings), the Auto toggle pinning and then clearing a cell text color, undo/redo, a save/load round trip (`#112233` / 18 / 11 persisted), and both reset entries returning the default background, auto contrast, and 13px. Screenshots: `test-results/header-config-classic.png`, `test-results/header-config-nodes-2.png`.
- No spec deviations during implementation; the first carry test set its fields on the frame instead of the root cell and was corrected while red.
