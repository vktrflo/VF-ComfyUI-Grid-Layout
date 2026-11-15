# Bottom-Tabbed Nodes & ComfyUI Groups Implementation Plan

**Goal:** Add standalone and Grid-compatible bottom-tabbed interfaces to individual ComfyUI nodes (splitting `Ports`, `Widgets`, and `Preview` sections, plus custom widget/tab configuration) and native ComfyUI Groups (`LGraphGroup`) / multi-node stacks, supporting both ComfyUI Nodes 2.0 (Vue DOM) and Classic LiteGraph Canvas.

**Architecture:**
- Pure data model, validation, section auto-split heuristics, ComfyUI Group snapshot/convert/unpack helpers, and geometry calculations in `web/core/bottom-tabs.js` (re-exported / integrated with `web/core/layout.js`).
- Measurement clearance (`BOTTOM_TAB_BAR_HEIGHT`), node sizing application, and transaction-wrapped controller operations + movement synchronization in `web/core/adapter.js` and `web/core/controller.js`.
- Flush `.clt-bottom-tab-bar` overlay rendering (1-row and 2-row nested), inline rename, drag-to-merge/reorder/detach, `Configure Tabs…` modal, Nodes 2.0 + Classic section visibility, wire endpoint routing to bottom tab pills, live wire-drag `Ports` auto-peek, and context/toolbox menu integration in `web/core/overlay.js` and `web/grid_layout.js`.

**Spec:** `docs/superpowers/specs/2026-11-15-bottom-node-and-group-tabs-design.md`

---

### Task 1: Pure Engine (`web/core/bottom-tabs.js`) & Unit Tests (`tests/bottom-tabs.test.mjs`)

1. **Constants & Schema Validation:**
   - Export `BOTTOM_TAB_BAR_HEIGHT = 28` and `GROUP_TAB_HEADER_HEIGHT = 28`.
   - `validateBottomTabsData(data, graph)`: validates `data.nodeTabs` (map of `nodeId -> { activeTab, sizing, baseHeights, tabs }`) and `data.tabStacks` (array of `{ id, pos, size, sizing, activeTab, tabs }`), pruning deleted nodes and empty stacks.
2. **Intra-Node Section Auto-Split & Customization:**
   - `classifyNodeSections(node)`: inspects `node.inputs`, `node.outputs`, `node.widgets`, and `node.imgs` / DOM preview elements to classify `Ports`, `Widgets`, and `Preview` (omitting empty sections, defaulting `activeTab` to `Preview` if present, else `Widgets`, else `Ports`).
   - `enableNodeBottomTabs(data, node)` / `removeNodeBottomTabs(data, nodeId)` / `selectNodeBottomTab(data, nodeId, tabIndex)` / `renameNodeBottomTab(data, nodeId, tabIndex, label)` / `mergeNodeBottomTabs(data, nodeId, sourceIdx, targetIdx)` / `reorderNodeBottomTab(data, nodeId, fromIdx, toIdx)` / `addCustomNodeTab(data, nodeId, label, icon)` / `assignWidgetToNodeTab(data, nodeId, widgetName, tabIndex)` / `setNodeTabsSizing(data, nodeId, sizing)`.
   - `computeNodeSectionHeight(node, tabConfig, tabIndex, metrics)` & `effectiveNodeTabHeight(node, tabConfig, metrics)` supporting `'max'` (Stable Max-of-Tabs) and `'compact'` (Compact Fit).
3. **ComfyUI Groups (`LGraphGroup`) & Multi-Node Bottom-Tab Stacks:**
   - `createStackFromSingleGroup(data, graph, group, titleHeight)`: converts a single native `LGraphGroup`'s member nodes into single-node bottom tabs (`kind: 'node'`), snapshotting the group for clean restoration and removing the consumed native group from `graph._groups`.
   - `createStackFromSelection(data, graph, { nodes, groups }, titleHeight)`: combines multiple ComfyUI Groups (`kind: 'group'`, preserving relative internal node offsets by default with `layoutMode: 'relative'`) and/or standalone nodes (`kind: 'node'`) into a `tabStack`.
   - `layoutTabStack(stack, graph, metrics, nodeTabs)`: computes outer stack body rect, active/inactive node placements (`hidden: true` for inactive tab nodes), bottom tab bar rect(s) (including 2-row nested footer when active single-node tab also has `nodeTabs`), and group chrome rect when active tab is `kind: 'group'`.
   - `selectStackTab`, `renameStackTab`, `toggleGroupTabLayoutMode` (`'relative' | 'stack'`), `dropItemIntoStack`, `moveOrDetachStackTab`, and `unpackTabStack` (restoring native `LGraphGroup` instances to `graph._groups`).
4. **Unit Tests (`tests/bottom-tabs.test.mjs`):**
   - Test all heuristics, merges, widget assignments, `Max-of-Tabs` vs `Compact Fit` heights, single-group and multi-group conversions, relative vs vertical stack group layouts, unpack restoration, and nested 2-row footer geometry.

---

### Task 2: Adapter & Controller Integration (`web/core/adapter.js` & `web/core/controller.js`)

1. **`NodeAdapter` (`web/core/adapter.js`):**
   - Account for `bottomClearance` (`BOTTOM_TAB_BAR_HEIGHT` when a docked node has `nodeTabs`) in `measure(node)` / `layoutFrame` so Grid Frame cells reserve exact bottom space beneath bottom-tabbed nodes without overlapping stacked neighbors or cell floors.
   - Support section-tab height overrides cleanly without mistaking tab height reductions for fill stretches.
2. **`LayoutController` (`web/core/controller.js`):**
   - Expose `nodeTabs` and `tabStacks` accessors on `ensureData()`.
   - Include `graph._groups` snapshots in `begin()` / `edit()` rollback so Undo/Redo and error rollbacks restore ComfyUI Groups cleanly.
   - Reflow both `frames`, `tabStacks`, and standalone `nodeTabs` in `reflow()`, and synchronize `tabStack.pos` when the user natively drags the active node of a `tabStack` on the canvas!
   - Support dropping a dragged canvas node or ComfyUI Group onto an existing `.clt-bottom-tab-bar` in `finishNativeDrag()`.

---

### Task 3: Overlay Chrome, Nodes 2.0 + Classic Renderers, Wire Routing & Menus (`web/core/overlay.js` & `web/grid_layout.js`)

1. **Bottom Tab Bar Overlay & Group Chrome (`overlay.js`):**
   - Render `.clt-bottom-tab-bar` (and `.clt-bottom-tab-bar-inner` for 2-row nested footers) flush below bottom-tabbed nodes and `tabStacks`, plus subtle colored `.clt-group-tab-box` chrome when a multi-node `kind: 'group'` tab is active.
   - Support clicking tabs, double-clicking to rename inline, dragging tabs to reorder/merge/detach, dragging the bottom tab bar background to move the node/stack, and clicking `•••` for quick actions + the **`Configure Tabs…`** modal.
2. **Nodes 2.0 & Classic Section Visibility:**
   - **Nodes 2.0 (`.lg-node`):** Toggle `.clt-section-hidden` on inactive slot rows, widget DOM rows, and preview/media containers inside `.lg-node[data-node-id]` while keeping elements mounted so interactive canvases preserve state.
   - **Classic LiteGraph Canvas:** Hide inactive `.dom-widget` wrappers and wrap `drawNode` / slot & widget rendering non-destructively so active sections render cleanly beneath the header while `node.inputs`, `node.outputs`, and `node.widgets` remain untouched for prompt execution.
3. **Wire Routing & Live Wire-Drag Auto-Peek (`refreshHidden` & `routeMinimizedEndpoints`):**
   - Route links attached to inactive stack tabs **and** links attached to hidden `Ports` on intra-node tabbed nodes (`hidden.portTargets`) directly to their owning `.clt-bottom-tab` pill!
   - Detect live wire dragging (`canvas.connecting_links?.length` / `connecting_node`) over a node with hidden `Ports` and auto-peek its `Ports` tab until the wire drag ends or leaves.
4. **Canvas, Node & Group Context Menu Actions (`grid_layout.js` & `overlay.js`):**
   - Right-click single node -> `Split node into bottom tabs` / `Configure bottom tabs…` / `Remove bottom tabs`.
   - Right-click 2+ selected nodes / groups -> `Combine into bottom-tabbed stack`.
   - Right-click ComfyUI Group -> `Convert group nodes into bottom tabs` (or combine selected groups).
5. **Verification:**
   - Run full `npm test` suite (existing 145 tests + new `tests/bottom-tabs.test.mjs` covering unit, controller, overlay DOM, Classic/Vue section hiding, and wire routing).
