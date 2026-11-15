# Spec: Link & Node Visuals inside Grid Control

## Goal
Improve connection troubleshooting, visual clarity, and node layout consistency inside `VF-ComfyUI-Grid-Layout`:
1. **Keep links visible for inactive tabs and collapsed panels**: Route wires connected to nodes inside inactive tabs, collapsed panels, or non-maximized sibling panels to their owning tab pill or collapsed panel header instead of hiding them.
2. **Remove custom bypass node/group icons and `"Enabled"` input ports**: Remove the custom floating node/group bypass buttons (`↱`) and all `"Enabled"` BOOLEAN input ports (`.vf-nb-port`) from the UI, while keeping manual bypass toggles (`↱`) natively on Grid headers and Cell headers.
3. **Maintain collapsed node width when docked in a Grid**: Ensure collapsed nodes docked inside a grid cell maintain the full cell content width (matching expanded nodes in that cell) in both Classic LiteGraph Canvas and Nodes 2.0 (Vue DOM) modes.

## Design

### 1. Links for Inactive Tabs & Collapsed Panels (`web/core/overlay.js`)
- Previously, `canvas.renderLink` returned early whenever either endpoint was in `this.hidden.ids` and not in `this.hidden.frames` (minimized frames), hiding all wires connected to nodes in inactive tabs, collapsed cells, or non-maximized cells.
- Update `refreshHidden()` to populate `this.hidden.targets = new Map()` mapping every hidden node ID to its visible container anchor `{ key, inPos, outPos }`:
  - **Inactive tab** (`tabIdx` in `cell`):
    - `key = "tab:${cell.id}:${tabIdx}"`
    - Anchor to the `.clt-cell-tab[data-tab-index="${tabIdx}"]` pill inside `.clt-cell[data-cell-id="${cell.id}"]` when present in DOM (`inPos = [tabX, tabY + tabH / 2]`, `outPos = [tabX + tabW, tabY + tabH / 2]`), or fall back to the cell's header tab slot geometry when unmeasured.
  - **Collapsed cell** (`cell.collapsed === true`):
    - `key = "cell:${cell.id}"`
    - Anchor to the collapsed cell's rect (`inPos = [rect[0], rect[1] + rect[3] / 2]`, `outPos = [rect[0] + rect[2], rect[1] + rect[3] / 2]`).
  - **Non-maximized sibling cell** (`frame.maximizedCellId` active):
    - `key = "max:${frame.id}"`
    - Anchor to the frame header (`inPos = [frame.pos[0], frame.pos[1] + 18]`, `outPos = [frame.pos[0] + frame.size[0], frame.pos[1] + 18]`).
  - **Collapsed frame inactive tab**:
    - `key = "frame:${frame.id}"`
- Update `routeMinimizedEndpoints(hidden, graph, link, startPos, endPos, extras)` to consult both `hidden.frames` and `hidden.targets`:
  - Suppress links where both endpoints are hidden inside the same container (`originKey === targetKey`), preventing self-loop stubs on a single tab pill or header.
  - Route `startPos` / `endPos` to the hidden endpoint's `outPos` / `inPos`.
- Remove the early return in `canvas.renderLink` so links to inactive tabs and collapsed cells are always rendered.

### 2. Native Grid Header Bypass & Removal of Node/Group Bypass Bars and `"Enabled"` Ports (`web/core/overlay.js`, `VF-ComfyUI-Nodes/web/vf_node_bypass.js`)
- Add native Grid-level manual bypass directly to `LayoutOverlay` (`web/core/overlay.js`):
  - `isFrameBypassed(frame)` and `toggleFrameBypass(frameId)` toggle `node.mode` between `4` (bypassed) and `0` (active) for all live nodes in the grid frame.
  - Render `.clt-bypass.clt-frame-bypass` (`↱`) in `.clt-frame-header` and add `Bypass grid` / `Unbypass grid` to `frameActions`.
- Update `VF-ComfyUI-Nodes/web/vf_node_bypass.js`:
  - Stop rendering `.vf-nb-node-bar` (custom bypass icon on individual nodes), `.vf-nb-group-bar` (custom bypass icon on groups), and `.vf-nb-port` / `.vf-nb-tooltip` / `.vf-nb-status` (`"Enabled"` input ports across nodes, groups, and grids).
  - Skip injecting `.vf-nb-in-header` into `.clt-frame-header` when `.clt-frame-bypass` is already rendered natively by `VF-ComfyUI-Grid-Layout`.

### 3. Maintain Collapsed Node Width When Docked in Grid Control (`web/core/adapter.js`, `web/core/overlay.js`, `web/core/layout.js`)
- In `NodeAdapter.apply(node, placement)`:
  - Always record `this.imposedWidths.set(node, placement.width)` when `!placement.hidden`.
  - When `node.flags?.collapsed` is true:
    - Update `node.size[0] = placement.width` while preserving `node.size[1]` (the pre-collapse body height) so expanding restores the node's height.
    - Enforce `node._collapsed_width = placement.width` via a configurable property descriptor on `node` while docked (and clean it up when detached from all grids) so Classic LiteGraph's `LGraphCanvas.prototype.drawNode` renders the collapsed title bar at the full cell width (`placement.width`).
    - In Nodes 2.0 (`LiteGraph.vueNodesMode`), set `--node-width: ${placement.width}px` on `.lg-node[data-node-id="${node.id}"]` so Vue's collapsed node wrapper stretches to the full cell width instead of shrinking to `--min-node-width` (`225px`).
- In `layoutFrame` (`web/core/layout.js`):
  - When a frame is collapsed (`frame.collapsed === true`), only stack active-tab nodes visibly and park inactive-tab nodes with `hidden: true`.
