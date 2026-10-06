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
