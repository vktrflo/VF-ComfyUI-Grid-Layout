# IDE UI Expansion — Tabbed Panels, Collapsing Sidebars/Rows, Docking Hotspots & Compass, Zen Focus, Presets & App Mode

**Date:** 2026-11-14
**Status:** Approved (via `/grill-me` design interview)
**Target:** VF-ComfyUI-Grid-Layout v1.3.0
**Branch:** `feat/ide-ui-panels-tabs`
**VF Todo:** `#245` (`https://todo.vktrflo.com/#/todo/245`)

## 1. Context & Goal

VF Grid Layout currently allows users to organize ComfyUI nodes into recursive split grids (columns and rows), with frame-level lock, autohide, minimize, collapse, fill cell height, and custom appearance.

This expansion transforms a Grid Frame on the ComfyUI canvas into a full **IDE-style workspace** constructed from custom nodes:
1. **Canvas Frame UI + Clean "App View" Mode:** Lives directly on the ComfyUI graph canvas inside a Grid Frame. A new **App View (`appMode`)** toggle zeroes out internal padding/gaps into crisp 1px IDE splitters, keeps Tab Bars & Activity Bars visible for navigation, hides internal ComfyUI connection wires inside the frame, and blends node chrome into the panel background.
2. **Unified Recursive Split Tree + IDE Layout Presets:** Any cell in the recursive split tree can host stacked nodes, multi-tabbed pages, or be collapsed along its parent split axis. Includes 1-click **IDE Layout Presets** (`VS Code IDE`, `Dual Sidebar Studio`, `Tabbed Dashboard`) in the frame menu and canvas menu.
3. **Tabbed Panels (Seamless Promotion, Single-Node & Multi-Node Tabs, Draggable Tabs):**
   - A standard leaf cell remains a simple cell until a node is dropped onto its header/tab bar or the center of its docking compass, or `+` is clicked to add a tab.
   - Supports both **1-node quick tabs** (auto-labeled with the node's title/icon) and **multi-node stacked tabs** (dropping onto the active tab's body stacks nodes inside that tab page; double-click any tab to rename it or set an icon).
   - **Stable Frame Sizing (Max of All Tabs):** A tabbed cell's minimum width and content height are the maximum across all of its tabs, so switching tabs never causes the frame or sibling panels to jump in size. Inactive tabs' nodes are hidden cleanly (`clt-node-hidden` / parked under the cell header) while active tab nodes are placed and stretched (when `fill` is enabled).
   - **Draggable Tabs:** Users can drag a tab pill to reorder tabs within the same bar, move a tab to another cell's tab bar, drop a tab onto any cell's edge/compass hotspot to split that cell with the tab's nodes, or drag a tab outside the frame to detach its nodes back onto the canvas.
4. **Smart Axis-Aware Collapsing Panels + Activity Bar / Pinned Sidebar Icons + Accordion Nodes:**
   - **Column cell collapse (`axis: 'x'` parent):** Collapses horizontally into a slim **36px Activity Bar vertical strip** while sibling columns expand to reclaim the freed width. Displays an icon/emoji badge for each tab (plus rotated vertical title). Clicking a tab icon in the Activity Bar expands the sidebar directly to that tab; clicking the active tab icon again re-collapses it.
   - **Row cell collapse (`axis: 'y'` parent):** Collapses vertically into a slim **26px header bar** while sibling rows reclaim or adjust height.
   - **Node Accordion Folding:** Individual nodes stacked inside an active cell/tab can be folded/unfolded accordion-style from the cell or directly via a quick action, immediately reflowing the stack.
5. **IDE Edge & Header Hotspots + 5-Way Docking Compass Rose:**
   - While dragging a node or a tab over a cell, a **5-way Docking Compass Rose HUD** (`Top`, `Bottom`, `Left`, `Right`, `Center/Tab`) appears inside the hovered cell, alongside spatial edge zones:
     - **Left / Right Edge or Compass West/East:** Splits the cell horizontally (`insertColumnCell`).
     - **Top / Bottom Edge or Compass North/South:** Splits the cell vertically (`insertRowCell` — new capability!).
     - **Cell Header / Tab Bar or Compass Center:** Adds the dragged node(s) as a new **Tab** in that cell (promoting the cell to tabbed if needed).
     - **Cell Body (away from compass/edges):** Stacks the node vertically before/after existing nodes in the active tab.
     - **Outer Frame Bottom:** Adds a full-width bottom row (`bottom-row`).
6. **Maximize / Zen Focus Cell:**
   - Clicking the Maximize button (`⤢` / `⤡`) on a cell/tab header (or via cell menu) temporarily expands that single panel to fill the entire Grid Frame body while hiding sibling cells, and restores the full split layout on second click.
7. **Draggable Horizontal Row Dividers (`axis: 'y'`):**
   - Both vertical (`axis: 'x'`) and horizontal (`axis: 'y'`) dividers are rendered and draggable so users can resize bottom panels and top/bottom splits smoothly.

---

## 2. Data Model (`web/core/layout.js`)

All new fields live inside the existing `graph.extra.comfyui_grid_layout` v1 schema and are strictly validated and whitelisted in `validateFrame`:

### Frame-Level Fields
- `frame.appMode?: true` — Enables Clean "App View" / Chromeless IDE mode.
- `frame.maximizedCellId?: string` — ID of the leaf cell currently in Zen Focus / Maximized mode (must match an existing leaf ID in `frame.root`, otherwise stripped during validation/layout).

### Leaf Cell-Level Fields
- `cell.nodes: Array<string|number>` — Always maintained as the union of all node IDs in the cell (across all tabs if `cell.tabs` is present, or the active stack if untabbed) so existing callers that inspect `cell.nodes` remain 100% compatible!
- `cell.tabs?: Array<{ id: string, label: string, icon?: string, nodes: Array<string|number> }>` — Optional list of tab pages on a leaf cell (up to 32 tabs per cell).
  - When `cell.tabs` is present and non-empty:
    - Each node in the cell belongs to exactly one tab's `nodes` array.
    - `cell.nodes` is synchronized automatically as `cell.tabs.flatMap(t => t.nodes)`.
- `cell.activeTab?: number` — 0-based index into `cell.tabs` (clamped to `[0, cell.tabs.length - 1]`).
- `cell.collapsed?: true` — Leaf-level panel collapse flag.
- `cell.icon?: string` — Optional emoji/icon string (up to 8 chars) for Activity Bar display when untabbed.
- `cell.minHeightOverride?: number` — Optional user-resized row height floor when dragging horizontal `axis: 'y'` dividers.

### Template Export (`exportTemplate`)
- Preserves `cell.tabs` structure (labels and icons) with empty `nodes: []` and fresh tab IDs on `importTemplate`!
- Preserves `cell.collapsed` and `frame.appMode` so exported IDE templates keep their exact sidebar/tab/app-view configuration.
- Strips `frame.maximizedCellId` on template export.

---

## 3. Geometry & Layout Engine (`web/core/layout.js`)

### 3.1 App Mode Spacing
- Standard mode: `PAD = 12`, `GAP = 12`, `CELL_TITLE = 26`, `FRAME_TITLE = 36`.
- When `frame.appMode === true`:
  - Outer frame pad `framePad = 4`, inner divider gap `gap = 4`, cell inner pad `cellPad = 6`.
  - Cells with multiple tabs or a title still show their compact header/tab bar (`CELL_TITLE = 28`), while dividers render as crisp 1px IDE splitters.

### 3.2 Tabbed Cell Sizing (Max of All Tabs) & Placements
- For a leaf cell with `cell.tabs` (length >= 1):
  - Prune missing nodes from each tab's `nodes` array and sync `cell.nodes`.
  - For each tab $t$, compute:
    - $\text{tabMinWidth}(t) = \max(160, \dots \text{node.minWidth}) + \text{cellPad} \times 2$
    - $\text{tabContentHeight}(t) = \sum (\text{node.height} + \text{node.titleHeight}) + \max(0, |t.\text{nodes}| - 1) \times \text{nodeGap}$
  - The cell's minimum width is $\max_t \text{tabMinWidth}(t)$ and minimum height is $\text{cellTitle} + \text{cellPad} \times 2 + \max(64, \max_t \text{tabContentHeight}(t))$.
  - During `place(cell, rect)`:
    - Nodes in the **active tab** (`cell.tabs[activeTab]`) receive normal visible placements (including `fill` stretch on the bottom node of the active tab if `frame.fill` or `cell.fill` is true).
    - Nodes in **inactive tabs** receive `hidden: true` placements parked under the cell header (`x: rect[0] + PAD, y: rect[1] + title, width: rect[2] - PAD * 2, height: 0, hidden: true`) so they move with the frame/cell and are hidden by `LayoutOverlay.refreshHidden()`.

### 3.3 Smart Axis-Aware Cell Collapse
- **`COLLAPSED_CELL_WIDTH = 36`** (for a collapsed leaf or subtree inside an `axis: 'x'` parent).
- **`COLLAPSED_CELL_HEIGHT = 26`** (for a collapsed leaf or subtree inside an `axis: 'y'` parent).
- When a child of an `axis: 'x'` split has `child.collapsed === true`:
  - Its width during `place()` is fixed to `COLLAPSED_CELL_WIDTH` (36px).
  - The remaining `available - sum(collapsedWidths)` is distributed proportionally among all non-collapsed siblings according to their relative `ratios`!
  - Its `contentMinimumWidth` while collapsed is `COLLAPSED_CELL_WIDTH` so the column shrinks cleanly and siblings expand into the space without altering the stored `cell.ratios` (restoring the exact previous width when uncollapsed).
- When a child of an `axis: 'y'` split has `child.collapsed === true`:
  - Its height during `minimum()` and `place()` is `COLLAPSED_CELL_HEIGHT` (26px).
- All nodes inside a collapsed cell receive `hidden: true` placements parked at the collapsed strip so `LayoutOverlay` hides their DOM/canvas rendering while keeping wire coordinates coherent.

### 3.4 Zen Focus / Maximize Cell (`frame.maximizedCellId`)
- When `frame.maximizedCellId` points to a valid leaf cell `targetCell`:
  - `layoutFrame` still computes the full frame size (or uses at least the normal frame size) so the outer frame does not collapse.
  - `targetCell` is placed across the entire inner frame body (`[fx + PAD, fy + FRAME_TITLE + PAD, fw - PAD * 2, fh - FRAME_TITLE - PAD * 2]`).
  - All nodes in other cells receive `hidden: true` placements parked at the frame header.
  - Only `targetCell` is emitted in `layout.cells` (marked `maximized: true`), and `layout.dividers` is empty while maximized.

### 3.5 New Structural Operations
- `insertRowCell(frames, frameId, cellId, side, nodeIds, metrics)`:
  - Analogous to `insertColumnCell`, splits `cellId` along `axis: 'y'` (`side: 'top' | 'bottom'`) and places `nodeIds` into the newly created top or bottom cell.
- `dropNodesIntoTab(frames, frameId, cellId, nodeIds, options = { tabIndex, createNewTab, tabLabel, tabIcon, metrics })`:
  - Handles dropping nodes to create a new tab (seamlessly promoting an untabbed cell's existing nodes into Tab 1 if needed, or creating Tab 1 if the cell was empty and explicitly tabbed) or appending/inserting into an existing tab.
- `addCellTab(frame, cellId, label, icon)` / `removeCellTab(frame, cellId, tabIndex, { keepNodes })` / `selectCellTab(frame, cellId, tabIndex)` / `moveCellTab(frames, sourceFrameId, sourceCellId, tabIndex, target)`:
  - Complete tab lifecycle management, including dragging a tab to reorder within the same cell, move to another cell's tab bar, split a cell (`split-left`, `split-right`, `split-top`, `split-bottom`), or detach outside.
- `toggleCellCollapse(frame, cellId)`:
  - Toggles `cell.collapsed` on a leaf cell.
- `toggleMaximizeCell(frame, cellId)`:
  - Toggles `frame.maximizedCellId === cellId`.
- `applyIdePreset(frame, presetName, metrics)`:
  - Configures a frame into one of the built-in IDE presets while preserving any already-attached nodes into the primary editor cell:
    1. `'vscode'` (**VS Code IDE**): Left Sidebar (collapsible, 2 tabs: `📁 Explorer`, `🎛️ Controls`) + Center Editor Group (2 tabs: `✨ Main View`, `🔧 Pipeline`, `fill: true`) + Bottom Panel (`🖥️ Output / Console`).
    2. `'dual-sidebar'` (**Dual Sidebar Studio**): Left Sidebar (`📥 Inputs`) + Center Canvas (`🎨 Studio`, `fill: true`) + Right Inspector (`⚙️ Inspector` with 2 tabs: `Sliders`, `Advanced`).
    3. `'tabbed-dashboard'` (**Tabbed Dashboard**): Top Control Bar + 2x2 Tabbed Workspace cells with `fill: true`.

---

## 4. Drag-and-Drop Hotspots & 5-Way Compass Rose (`layout.js` & `overlay.js`)

### `resolveDropTarget(layouts, node, options)` Enhancements
When dragging a node (or a tab) over an unlocked, un-minimized, un-collapsed frame:
1. **Outer Bottom Zone (`bottom-row`):** Below the frame bottom edge -> full-width bottom row ghost cell.
2. **Cell Header / Tab Bar Zone (`tab`):** Pointer or node top/center over the cell's header / tab bar (`cy <= y <= cy + cellTitle + 6`) -> returns `kind: 'tab'`, `ghostType: 'tab'`, previewing a tab highlight on the cell header + body.
3. **5-Way Compass Rose HUD (`compass`):**
   - Rendered in the center of the hovered cell during drag (`[cx + cw/2, cy + cellTitle + (ch - cellTitle)/2]`, radius ~54px):
     - **Center (`compass-center`):** `kind: 'tab'` (Add as new Tab in this panel)
     - **North (`compass-top`):** `kind: 'split-top'` (Split cell Top)
     - **South (`compass-bottom`):** `kind: 'split-bottom'` (Split cell Bottom)
     - **West (`compass-left`):** `kind: 'split-left'` (Split cell Left)
     - **East (`compass-right`):** `kind: 'split-right'` (Split cell Right)
4. **Spatial Edge Hotspots (on populated cells):**
   - Left edge (`<= cx + edgeThresholdX`): `kind: 'split-left'`, `ghostType: 'cell'`
   - Right edge (`>= cx + cw - edgeThresholdX`): `kind: 'split-right'`, `ghostType: 'cell'`
   - Top edge (just below header, `<= cy + cellTitle + edgeThresholdY` when pointer is near top edge): `kind: 'split-top'`, `ghostType: 'cell'`
   - Bottom edge (`>= cy + ch - edgeThresholdY` when pointer is near bottom edge): `kind: 'split-bottom'`, `ghostType: 'cell'`
5. **Cell Body Stack (`cell` / `stack`):**
   - Drops into the active tab's node list at the resolved vertical insertion index (`before` or `after`).

---

## 5. Overlay UI & Visual Polish (`web/core/overlay.js`)

- **Tab Bar in Cell Header:**
  - When `cell.tabs?.length > 0`, `.clt-cell-header` renders a scrollable `.clt-tab-bar` with `.clt-cell-tab` pills (showing optional icon + label + node count badge or close `×` button when >1 tab), plus a `+` button (`Add tab`) on the right.
  - Clicking a tab switches `cell.activeTab` immediately.
  - Double-clicking a tab label renames that tab inline.
  - Dragging a tab pill starts a `tab-drag` interaction that lights up the exact same Compass Rose, Edge Split, Tab Bar, and Detach previews as dragging a node!
- **Cell Header Controls:**
  - Collapse panel button (`◀`/`▶` for column cells, `▲`/`▼` for row cells).
  - Maximize / Zen Focus button (`⤢` / `⤡`).
  - Bypass button (`↱`) — bypasses nodes in the active tab (or whole cell).
  - Cell options menu (`•••`) — includes Tab actions (`Add tab`, `Close active tab`), Collapse/Expand panel, Maximize/Restore panel, Accordion Fold/Unfold nodes in cell, Split Left/Right/Top/Bottom, etc.
- **Activity Bar (Collapsed Column Cells):**
  - Renders `.clt-cell.clt-cell-collapsed-x` (36px wide) with `.clt-activity-bar`:
    - Expand button at top (`▶` or `◀` depending on whether it's on the left or right side).
    - Pinned icon buttons for each tab (using `tab.icon` or a smart default icon `📄`/`🎛️` or first letter badge) with tooltip showing the tab name. Clicking an icon expands the sidebar and activates that tab!
    - Vertical rotated cell label along the strip.
- **Collapsed Row Bar (Collapsed Row Cells):**
  - Renders `.clt-cell.clt-cell-collapsed-y` (26px tall) with header title, tab pills preview, and expand button (`▼`).
- **Frame Header & Menu Controls:**
  - New **App View (`🖥`)** button in the frame header (and `Enable App View` / `Disable App View` in the frame `•••` menu) to toggle `frame.appMode`.
  - New **Apply IDE Preset…** actions in the frame `•••` menu and canvas context menu (`🌀 Add IDE Layout…`).
- **Horizontal Divider Resizing (`axis: 'y'`):**
  - Renders `.clt-divider-y` between vertical split children and allows dragging to adjust row heights (`cell.minHeightOverride` / `ratios`).

---

## 6. Testing & Verification Plan

1. **Unit Tests (`npm test`):**
   - New `tests/ide-layout.test.mjs` testing:
     - Tabbed cells (seamless promotion, single-node & multi-node tabs, max-of-all-tabs sizing, hidden inactive tab placements, tab removal/reorder/move, template export/import round-trip).
     - Axis-aware cell collapse (`axis: 'x'` Activity Bar width 36px & sibling expansion, `axis: 'y'` 26px header collapse, hidden node placements).
     - `insertRowCell` (top/bottom splits) and `resolveDropTarget` for compass directions (`compass-center`, `compass-top`, `compass-bottom`, `compass-left`, `compass-right`), `tab` header drop, and `split-top`/`split-bottom`.
     - `toggleMaximizeCell` (Zen focus mode geometry & restoration).
     - `appMode` validation, template round-trip, and compact geometry.
     - `applyIdePreset` (`vscode`, `dual-sidebar`, `tabbed-dashboard`).
   - All existing 129 unit tests must continue to pass without regression.
2. **Live Browser Verification (`tests/ide-ui.mjs` + `npm run test:ui`):**
   - Run Playwright against live ComfyUI (`http://127.0.0.1:8188`) testing both Classic and Nodes 2.0:
     - Creating an IDE preset layout (`VS Code IDE`), verifying Activity Bar / Sidebar collapse & icon click to expand to specific tab, switching tabs and verifying inactive tab nodes hide and active tab nodes display, dragging a node onto the docking compass rose to create a tab or split, toggling Zen Focus Maximize (`⤢`), toggling Clean App View (`🖥`), and undo/redo + save/reload round-trip.
     - Capture screenshots in `test-results/` for visual verification.
