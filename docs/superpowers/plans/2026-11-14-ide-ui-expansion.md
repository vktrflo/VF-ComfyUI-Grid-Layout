# IDE UI Expansion Implementation Plan

**Goal:** Expand VF-ComfyUI-Grid-Layout into an IDE-style UI builder on the ComfyUI canvas with tabbed panels, draggable tabs, 5-way docking compass & edge hotspots, smart axis-aware collapsing sidebars/rows with VS Code-style Activity Bar icons, Zen focus panel maximize, Clean App View mode, draggable row dividers, and 1-click IDE layout presets.

**Architecture:**
- Pure geometry, state transitions, validation, and presets in `web/core/layout.js`.
- Controller actions and transaction-wrapped drop/tab routing in `web/core/controller.js`.
- Overlay DOM rendering, CSS styling, Compass Rose HUD, Tab Bar / Activity Bar interactions, and App View wire/chrome styling in `web/core/overlay.js` and `web/grid_layout.js`.

**Spec:** `docs/superpowers/specs/2026-11-14-ide-ui-expansion-design.md`

---

### Task 1: Pure Engine (`web/core/layout.js`) & Unit Tests (`tests/ide-layout.test.mjs`)

1. **Constants & Helpers:**
   - Export `COLLAPSED_CELL_WIDTH = 36` and `COLLAPSED_CELL_HEIGHT = 26`.
   - Add tab synchronization helpers (`syncCellTabs`, `activeTabNodes`, `ensureCellTabs`).
2. **Validation & Templates (`validateFrame`, `exportTemplate`, `importTemplate`):**
   - Frame-level: validate `appMode === true` and `maximizedCellId` (string matching a leaf cell ID).
   - Leaf-level: validate `collapsed === true`, `icon` (string up to 8 chars), `minHeightOverride` (finite number >= 40), `tabs` (up to 32 items with `id`, `label`, optional `icon`, `nodes`), and `activeTab` (clamped integer).
   - Ensure `exportTemplate` preserves `tabs` structure (with empty `nodes: []`), `collapsed`, `icon`, `appMode`, and clears `maximizedCellId`.
   - Ensure `importTemplate` assigns fresh IDs to tabs as well as cells.
3. **Tabbed & Collapsible Geometry (`layoutFrame`, `contentMinimumWidth`):**
   - Support `frame.appMode` compact spacing (`framePad = 4`, `gap = 4`, `cellPad = 6`).
   - Support `frame.maximizedCellId`: expand the maximized leaf cell across the frame body while parking other cells' nodes with `hidden: true`.
   - Support `cell.collapsed === true`:
     - In `axis: 'x'` parent: fixed width `COLLAPSED_CELL_WIDTH` (36px); remaining width distributed across uncollapsed siblings by relative weight.
     - In `axis: 'y'` parent: fixed height `COLLAPSED_CELL_HEIGHT` (26px).
     - Park collapsed cell nodes at the collapsed strip with `hidden: true`.
   - Support `cell.tabs`:
     - Size leaf cell to the max width and max height across all tabs (`Max of All Tabs`).
     - Place active tab's nodes normally (with `fill` support on the active tab's bottom node).
     - Park inactive tabs' nodes with `hidden: true` under the cell header.
   - Emit `axis` on each cell entry in `layout.cells` (`parentAxis: 'x' | 'y' | null`) and emit both `axis: 'x'` and `axis: 'y'` dividers in `layout.dividers`.
4. **Hotspots & Structural Operations:**
   - `insertRowCell(frames, frameId, cellId, side, nodeIds, metrics)` for `'top'` and `'bottom'` splits.
   - `addCellTab`, `removeCellTab`, `selectCellTab`, `renameCellTab`, `moveCellTab`, `dropNodesIntoTab`.
   - Update `dropNodes` so dropping into a tabbed cell inserts into the active tab (and syncs `cell.nodes`).
   - `toggleCellCollapse(frame, cellId)` and `toggleMaximizeCell(frame, cellId)`.
   - `applyIdePreset(frame, presetName, metrics)` supporting `'vscode'`, `'dual-sidebar'`, and `'tabbed-dashboard'`.
   - Update `resolveDropTarget(layouts, node, options)` to support:
     - `compass` hit testing when `options.pointer` is within the hovered cell's 5-way compass rose (`compass-center` -> `tab`, `compass-top` -> `split-top`, `compass-bottom` -> `split-bottom`, `compass-left` -> `split-left`, `compass-right` -> `split-right`).
     - Cell header / tab bar drop zone (`kind: 'tab'`, `ghostType: 'tab'`).
     - Top/Bottom cell edge split zones (`kind: 'split-top'`, `kind: 'split-bottom'`).
5. **Unit Tests:**
   - Write comprehensive tests in `tests/ide-layout.test.mjs` and verify `npm test` passes 100%.

---

### Task 2: Controller Integration (`web/core/controller.js`)

1. Route new drop target kinds in `LayoutController.drop()`:
   - `resolved?.kind === 'split-top' || resolved?.kind === 'split-bottom'` -> call `insertRowCell(...)`.
   - `resolved?.kind === 'tab'` -> call `dropNodesIntoTab(...)` using each node's title from the graph (`node.title || node.type || 'Tab'`) as the default tab label.
2. Add convenience methods on `LayoutController`:
   - `createPreset(pos, presetName)` — creates a frame with `autohide: false` (so the IDE structure is immediately visible) and applies the preset.
   - Support `finishNativeDrag` keys for `split-top`, `split-bottom`, and `tab`.

---

### Task 3: Overlay UI, Tab Bar, Activity Bar, Compass Rose & App Mode (`web/core/overlay.js` & `web/grid_layout.js`)

1. **Hidden Nodes Tracking (`refreshHidden`):**
   - Include any node whose placement in `layoutFrame` has `hidden: true` (inactive tab nodes, collapsed cell nodes, non-maximized cell nodes when another cell is in Zen Focus) in `this.hidden.ids` and `this.hidden.frames` so both Classic `drawNode` and Nodes 2.0 `.clt-node-hidden` hide them seamlessly!
2. **5-Way Docking Compass Rose HUD:**
   - During node drag or tab drag over a cell, render `.clt-compass` at the cell center with 5 directional zones (`North/Top`, `South/Bottom`, `West/Left`, `East/Right`, `Center/Tab`), highlighting the active zone when hovered.
   - Render `.clt-ghost-tab` preview when `dropPreview.ghostType === 'tab'`.
3. **Cell Header Tab Bar & Draggable Tabs:**
   - Render `.clt-tab-bar` inside `.clt-cell-header` when `cell.tabs?.length > 0`, with clickable/double-click-renamable/draggable `.clt-cell-tab` pills, close `×` buttons, and a `+` button to add a new tab.
   - Implement `startTabDrag` in `LayoutOverlay` so dragging a tab pill previews and executes reordering within the tab bar, moving to another cell's tab bar, splitting any cell via Compass/Edge hotspots, or detaching onto the canvas.
4. **Collapsing Panels & VS Code Activity Bar:**
   - Add collapse button (`◀`/`▶` or `▲`/`▼`) and Zen Focus Maximize button (`⤢`/`⤡`) to `.clt-cell-header`.
   - When a cell is collapsed along `axis: 'x'`, render `.clt-cell-collapsed-x` (36px wide Activity Bar) with expand toggle, vertical badge icons for each tab (clicking a tab icon expands the sidebar directly to that tab), and vertical rotated title.
   - When a cell is collapsed along `axis: 'y'`, render `.clt-cell-collapsed-y` (26px tall header strip) with expand button and tab badges.
5. **Horizontal Row Divider Dragging (`axis: 'y'`):**
   - Render `.clt-divider-y` for `axis: 'y'` dividers and allow dragging to resize row heights cleanly.
6. **Clean "App View" (`frame.appMode`) & Accordion Node Folding:**
   - Add `🖥` App View toggle button to `.clt-frame-header` and frame menu.
   - When `frame.appMode === true`:
     - Add `.clt-app-mode` class to `.clt-frame`, styling crisp 1px IDE borders/splitters and sleek dark IDE header chrome.
     - Suppress internal link wires between nodes inside that `appMode` frame in `renderLink`.
   - Add "Fold/Unfold nodes in panel (Accordion)" action in the cell menu.
7. **IDE Presets Menu Integration:**
   - Add `IDE Layout Presets` to the frame `•••` menu and `🌀 Add IDE Layout (VS Code)` to the canvas context menu.

---

### Task 4: Browser Verification (`tests/ide-ui.mjs`) & Documentation (`README.md`, `docs/verification.md`)

1. Create `tests/ide-ui.mjs` to test all new IDE features in headless Chromium against live ComfyUI (`http://127.0.0.1:8188`) in both Classic and Nodes 2.0 modes, saving screenshots to `test-results/`.
2. Run `npm test` and `npm run test:ui` + `node tests/ide-ui.mjs` to verify zero regressions and full live functionality.
3. Update `README.md`, `CHANGELOG.md`, `docs/verification.md`, and update VF Todo `#245` with Design, Docs, and Implementation details and markdown artifacts.
