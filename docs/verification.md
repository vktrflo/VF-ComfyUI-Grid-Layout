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

## Fill cell height update (v0.3.0)

Version 0.3.0 adds per-cell height filling: **Fill cell height** in the cell "+" menu stretches the cell's bottom node flush with the cell's content floor — recomputed every layout from the node's natural minimum, so it tracks siblings elastically; **Fit to content height** releases it and snaps the node back to its measured minimum. Stored as `cell.fill` in the existing v1 metadata; travels through workflow saves and exported templates.

Automated checks (2026-10-06; same dedicated 0.39.0 / frontend 1.53.10 test server on port 8197 with custom nodes disabled):

- Unit: 46 tests pass (`npm test`) — 7 new fill tests cover validation keep/drop, split/grid migration, template round-trip, flush-to-floor geometry (single node, and bottom-node-only among several), no-slack and collapsed/empty no-ops, and idempotence including after re-measurement of the stretched height.
- Browser: both classic and Nodes 2.0 suites pass, including the fill scenario — a taller left column leaves the right cell with spare height; enabling fill stretches the right node flush to the cell floor (placement geometry and applied node size verified), menu labels switch between "Fill cell height" and "Fit to content height", undo/redo round-trips, release snaps the node back to its measured minimum, and the flag plus stretch survive a workflow save/load round trip. Screenshots: `test-results/fill-classic.png`, `test-results/fill-nodes-2.png`.
- Implementation notes: one existing adapter-shape assertion in `tests/controller.test.mjs` was updated for the new `minHeight`/`collapsed` metric fields (amended during execution; the plan expected no unit-test changes). The fill browser scenario deselects nodes before opening cell menus — ComfyUI's Selection Toolbox appears alongside dragged nodes and intercepted the first menu click (observed once, fixed in the suite).
