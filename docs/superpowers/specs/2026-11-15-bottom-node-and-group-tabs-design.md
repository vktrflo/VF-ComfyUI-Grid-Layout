# Bottom-Tabbed Nodes & ComfyUI Groups — Design Spec

**Date:** 2026-11-15
**Status:** Approved (via `/grill-me` design interview)
**Target:** VF-ComfyUI-Grid-Layout

## 1. Context & Goal

Users frequently work with tall, dense custom nodes (e.g. `VF Load Image` with a tall port list, multiple parameter widgets, and an interactive crop/preview canvas) as well as collections of related nodes and native ComfyUI Groups (`LGraphGroup`). Currently, VF Grid Layout offers top-tabbed IDE panels inside full Grid Frames, but users also want lightweight **bottom-tabbed interfaces** directly on individual nodes and native ComfyUI Groups anywhere on the canvas.

This feature introduces two complementary bottom-tab capabilities with a unified visual and interaction model:
1. **Intra-Node Bottom Section Tabs:** Splits a single node's vertical anatomy (`Ports`, `Widgets`, `Preview`, or custom widget assignments) into compact views controlled by a docked tab bar flush along the **bottom of the node**.
2. **Multi-Node & ComfyUI Group Bottom-Tab Stacks:** Combines multiple nodes and/or native ComfyUI Groups (`LGraphGroup`) into a **bottom-tabbed stack** directly on the canvas—either turning a single ComfyUI Group's member nodes into tabs, or combining multiple ComfyUI Groups / nodes so each Group becomes its own multi-node tab page.

Both capabilities:
- Work **standalone anywhere on the ComfyUI canvas** without requiring a Grid Frame.
- Remain **100% compatible when docked inside a VF Grid Frame cell** (keeping existing Grid Cell panel tabs at the top while accounting for the bottom tab bar height in cell layout).
- Are **purely visual organization** — switching or hiding tabs never alters node bypass (`node.mode`), connections, widget values, or ComfyUI prompt execution.
- Support **both ComfyUI Nodes 2.0 (Vue DOM)** and **Classic LiteGraph Canvas**.

---

## 2. Data Model (`web/core/layout.js` / `web/core/bottom-tabs.js`)

All state persists inside `graph.extra.comfyui_grid_layout` (`VERSION = 1`) alongside `frames` so workflows degrade gracefully if the extension is uninstalled:

```js
graph.extra.comfyui_grid_layout = {
  version: 1,
  frames: [...],
  nodeTabs: {
    // Keyed by String(node.id)
    [nodeId]: {
      activeTab: 2,              // 0-based active section tab index
      sizing: 'max',             // 'max' (default: Stable Max-of-Tabs) | 'compact' (Compact Fit per tab)
      tabs: [
        {
          id: 'tab-ports',
          label: 'Ports',
          icon: '🔌',
          includePorts: true,    // Renders node input/output slot rows
          widgets: [],           // Explicit widget names assigned to this tab
          includePreview: false, // Renders media/preview/custom canvas widgets & node.imgs
        },
        {
          id: 'tab-widgets',
          label: 'Widgets',
          icon: '🎛️',
          includePorts: false,
          widgets: ['image_path', 'pixel_zoom', 'mask_color', 'resize_to', 'ratio', 'angle', 'Browse Images'],
          includePreview: false,
        },
        {
          id: 'tab-preview',
          label: 'Preview',
          icon: '🖼️',
          includePorts: false,
          widgets: ['crop_preview'],
          includePreview: true,
        }
      ]
    }
  },
  tabStacks: [
    // Standalone bottom-tabbed stacks of multiple nodes and/or ComfyUI Groups
    {
      id: 'stack-uuid',
      pos: [x, y],
      size: [width, height],     // Active/max body box (excluding bottom tab bar height)
      sizing: 'max',             // 'max' (default) | 'compact'
      activeTab: 0,
      tabs: [
        // Single-node tab page:
        {
          id: 'page-1',
          kind: 'node',
          label: 'VF Load Image',
          color: undefined,
          nodeId: 12,
        },
        // Multi-node ComfyUI Group tab page:
        {
          id: 'page-2',
          kind: 'group',
          label: 'Prompting',
          color: '#3f789e',
          layoutMode: 'relative', // 'relative' (default: preserves freeform offsets) | 'stack' (vertical column)
          nodes: [
            { id: 14, offset: [16, 42], size: [320, 180] },
            { id: 15, offset: [352, 42], size: [320, 180] },
          ],
          groupSnapshot: {       // Saved native LGraphGroup state for clean unpack/restoration
            title: 'Prompting',
            color: '#3f789e',
            fontSize: 24,
            bounding: [100, 100, 690, 250],
          }
        }
      ]
    }
  ]
};
```

### Validation & Cleanup
- Missing/deleted node IDs are pruned automatically on `validate` / `reflow`.
- If a `tabStack` drops to 0 live tabs, it is removed; if unpacked by the user, single-node tabs return to normal canvas nodes and `kind: 'group'` tabs restore their native `LGraphGroup` instances in `graph._groups`.
- Newly added dynamic widgets on a node with `nodeTabs` automatically fall into the first tab with `widgets` (or `Preview` if detected as a media/preview widget) so custom nodes that add widgets at runtime never lose controls.

---

## 3. Intra-Node Bottom Section Tabs

### 3.1 Auto-Split Heuristic & Default Tab
When enabling bottom tabs on a single node:
1. **`Ports` section:** Present if `(node.inputs?.length ?? 0) + (node.outputs?.length ?? 0) > 0` (excluding widget-converted inputs that only render as widgets unless they carry a slot dot).
2. **`Preview` section:** Captures `node.imgs` / media outputs and custom preview/canvas DOM widgets (e.g. widgets containing `<canvas>`, `<img>`, `<video>`, crop/mask editors, or custom DOM widgets with intrinsic height > 80px that are not textareas/code inputs).
3. **`Widgets` section:** Captures standard parameter & action widgets (`number`, `combo`, `text`/`string`, `toggle`, `button`, multiline prompt textareas) not classified as `Preview`.
4. **Empty sections are omitted** automatically (e.g. a `KSampler` without preview creates `Ports` | `Widgets`).
5. **Default active tab:** Opens **`Preview`** first if present; otherwise opens **`Widgets`** (or `Ports` if only ports exist).

### 3.2 Customization UX
- **Inline on Bottom Tab Bar:**
  - **Click** a tab pill to switch sections immediately.
  - **Double-click** a tab pill to rename it inline.
  - **Drag** a tab pill left/right to reorder tabs.
  - **Drag one section tab pill onto another section tab pill** to merge their sections into a single combined tab (e.g. merging `Ports` + `Widgets`).
- **`•••` Button on Bottom Tab Bar:**
  - **`Configure Tabs…` modal** (styled consistently with `.clt-appearance-dialog`): Add/delete/rename tabs, toggle `Ports` or `Preview` per tab, reassign individual widgets by name to any tab, or **Reset to Auto-Split**.
  - **`Compact Fit` / `Lock Max Height` toggle** (`sizing: 'compact' | 'max'`).
  - **`Remove Bottom Tabs`** (restores normal full node height and removes `nodeTabs[nodeId]`).

### 3.3 Renderer Implementation (Nodes 2.0 & Classic LiteGraph)
- **Nodes 2.0 (`LiteGraph.vueNodesMode` / `.lg-node`):**
  - Inspects `.lg-node[data-node-id]` child slot rows, widget wrappers, and preview/media containers; toggles a `.clt-section-hidden` (`display: none !important`) class on elements belonging to inactive tabs while keeping DOM nodes mounted so Vue state and interactive canvases (e.g. crop editors) preserve their state.
  - Updates node height (`sizing: 'max'` = tallest single tab height; `sizing: 'compact'` = active tab height) so active widgets/previews sit cleanly right below the node header.
- **Classic LiteGraph Canvas:**
  - Toggles `.clt-node-hidden` on inactive `.dom-widget` elements and non-destructively suppresses drawing/hit-testing of inactive canvas widgets and slot rows during `drawNode` / `drawNodeWidgets` / `getSlotOnPos`, shifting active widgets upward right beneath the title bar while keeping `node.inputs`, `node.outputs`, and `node.widgets` intact for graph serialization and `graphToPrompt`.

---

## 4. Multi-Node & ComfyUI Group Bottom-Tab Stacks

### 4.1 Mapping Rules for Nodes & Native ComfyUI Groups (`LGraphGroup`)
- **Single ComfyUI Group → `"Convert group nodes into bottom tabs"`:**
  - Each member node inside the ComfyUI Group (`group.recomputeInsideNodes()`) becomes its own single-node tab (`kind: 'node'`), inheriting the Group's color accent, and the native `LGraphGroup` is snapshotted so `"Unpack"` can restore it.
- **Multiple ComfyUI Groups, Multiple Nodes, or Mixed Selection → `"Combine into bottom-tabbed stack"`:**
  - Each selected ComfyUI Group becomes a multi-node tab page (`kind: 'group'`) labeled with `group.title` and accented with `group.color`. Nodes inside that Group are claimed by the Group tab (not duplicated as separate tabs).
  - Each standalone selected node (not inside any selected Group) becomes a single-node tab page (`kind: 'node'`) labeled with `node.title`.
- **Group Tab Internal Layout:**
  - Defaults to **`layoutMode: 'relative'`**, preserving each ComfyUI Group's relative internal node offsets inside the Group tab container.
  - Optional **`Stack nodes vertically`** toggle (`layoutMode: 'stack'`) in the tab bar `•••` menu snaps the Group tab's nodes into a uniform-width vertical stack.
  - Native `LGraphGroup` boxes consumed by a `tabStack` are removed/suppressed while stacked and restored cleanly to `graph._groups` when detached or unpacked.

### 4.2 Interactive Drag-and-Drop
- **Drop onto Bottom Tab Bar:** Dragging any canvas node or ComfyUI Group onto an existing bottom tab bar adds it as a new tab (only existing bottom tab bars act as drop targets so normal canvas dragging of untabbed nodes is never hijacked).
- **Tab Pill Dragging:**
  - Reorder tabs horizontally within the same bottom tab bar.
  - Move a node/group tab to another `tabStack`'s bottom tab bar (or into a Grid Frame cell).
  - Drag a node/group tab out onto empty canvas to detach it back into a standalone node or native `LGraphGroup`.

---

## 5. Chrome, Sizing, Wire Routing & Grid Compatibility

### 5.1 Flush Bottom Footer Chrome & Movement
- `BOTTOM_TAB_BAR_HEIGHT = 26` (in graph units, rendered in the `.clt-plane` overlay so it scales and pans natively with the canvas).
- Positioned **flush beneath the bottom edge** of the node or group body — never overlapping custom bottom widgets, crop toolbars, or node footer badges (`VF-ComfyUI-Nodes`).
- **Single-node tabs / intra-node tabs:** No redundant outer top wrapper header is added. Moving the visible node by its native title bar (or dragging empty space on the bottom tab bar) moves the entire `tabStack` and parked inactive nodes together.
- **Multi-node Group tabs (`kind: 'group'`):** Renders a subtle ComfyUI-Group-styled border and compact group title header in the Group's color, with the shared tab bar flush along the bottom edge.
- **Nested case (a node with intra-node section tabs inside a multi-node `tabStack`):** Renders the node's section tab strip directly above the outer stack's bottom tab bar (2 stacked footer rows, `52px` total) so neither bar overlaps.

### 5.2 Sizing Modes
- **Stable `Max-of-Tabs` (Default, `sizing: 'max'`):**
  - Width and height equal the maximum width and maximum single-tab height across all tabs in the node/stack.
  - Cuts a tall multi-section node's height down to its single tallest section **and** keeps the bottom tab bar stationary directly under the cursor when clicking between tabs.
- **Compact Fit (`sizing: 'compact'`):**
  - Keeps width stable (`maxWidth`) while shrinking/growing height dynamically to wrap the active tab's exact height.

### 5.3 Wire Routing & Auto-Reveal on Wire Drag
- **Inactive Nodes / Hidden `Ports` Section:**
  - Extends `LayoutOverlay.refreshHidden()` and `routeMinimizedEndpoints()` so wires connected to an inactive tab's node(s)—or to hidden `Ports` on an intra-node tabbed node—route cleanly to the **owning bottom tab pill** (`inPos` on left of pill, `outPos` on right of pill; self-loops inside the same hidden tab suppressed).
- **Live Wire Dragging (`connecting_links`):**
  - When the user drags a live connection wire over a node whose `Ports` section is currently hidden on another tab, the node **temporarily reveals/peeks its `Ports` tab** while hovered so the user can connect to any input/output slot effortlessly (and restores the previous tab if dropped elsewhere, or stays/routes cleanly once connected).

### 5.4 Compatibility Inside VF Grid Frames
- When a node with `nodeTabs` (or a single-node stack) is docked inside a VF Grid Frame cell:
  - `NodeAdapter.measure(node)` includes `BOTTOM_TAB_BAR_HEIGHT` in the node's effective bottom clearance so stacked nodes below it and the cell floor reserve exact space for the bottom tab bar without overlap.
  - Existing Grid Cell panel tabs remain at the top of the cell header as designed.

---

## 6. Testing & Verification Plan

1. **Unit Tests (`npm test`):**
   - `tests/bottom-tabs.test.mjs`:
     - Intra-node auto-split heuristics (`Ports`, `Widgets`, `Preview`, empty-section omission, default `Preview` -> `Widgets` -> `Ports` active tab).
     - Tab customization (renaming, reordering, merging two section tabs, custom widget assignment, reset).
     - `Max-of-Tabs` vs `Compact Fit` geometry calculations and Grid Frame cell measurement clearance.
     - Single ComfyUI Group -> node tabs conversion & unpack restoration; multi-Group + node combination -> `kind: 'group'` relative layout vs vertical stack & native `LGraphGroup` restoration.
     - Wire endpoint routing to owning bottom tab pills for both hidden `Ports` tabs and inactive stack tabs.
2. **Live Browser Verification (Playwright against ComfyUI in both Nodes 2.0 & Classic mode):**
   - Splitting a tall node with ports, widgets, and preview into bottom tabs; verifying bottom tab bar sits flush below node badges/toolbars without overlap, stationary tab bar under cursor in `Max-of-Tabs` mode, and height shrink in `Compact Fit` mode.
   - Routing connected wires to the `Ports` bottom tab pill when viewing `Preview` / `Widgets`, and auto-revealing `Ports` on wire drag.
   - Converting single and multiple native ComfyUI Groups into bottom-tabbed stacks, dragging tabs to reorder/detach, and verifying workflow save/reload + undo/redo round-trips.
