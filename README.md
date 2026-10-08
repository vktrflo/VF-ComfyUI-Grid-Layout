# VF-ComfyUI-Layout-Templates

Reusable layout frames for the ComfyUI workflow canvas. Drop normal nodes into a cell to attach them, match their widths, and arrange them in a vertical stack. Split cells into adjustable columns, rows, or grids.

This is a **frontend extension** installed as a custom-node package. It adds canvas tools, not an executable generation node.

## Install

1. Extract `VF-ComfyUI-Layout-Templates.zip` into your ComfyUI `custom_nodes` folder, or copy this project there.
2. Check that `custom_nodes/VF-ComfyUI-Layout-Templates/__init__.py` and `web/layout_templates.js` exist directly inside the package folder.
3. Restart ComfyUI and refresh your browser with **Ctrl+F5**.

No extra Python packages, frontend build, or model downloads are required.

When updating, replace the existing package files, restart ComfyUI, and use **Ctrl+F5** to clear the old extension from the browser cache. Version 0.1.1 fixes creating layouts over HTTP network addresses (for example, `http://10.0.0.164:8188`). Version 0.2.0 adds customizable header colors for frame and cell header bars. Version 0.3.0 adds frame-level fill-cell-height (a frame's bottom nodes can stretch to fill their cells), a frame lock, and a header configuration panel (background, text color, font size).

## Examples: workflow versus template

- **`examples/two-column.workflow.json`** is a normal ComfyUI workflow. Open it with ComfyUI's **Open** action or drop it onto the canvas. It contains a populated two-column layout with connected **Empty Image → Save Image** nodes, and runs without model downloads.
- **`examples/two-column.layout.json`** is an empty layout template. Use **right-click canvas → 🌀 Import Layout Template…**. It is not a ComfyUI workflow; opening it through the normal workflow action will show an empty canvas.

## Use

- Right-click empty canvas space → **🌀 Add Layout Frame**.
- Drag a node by its title over a cell and release while any part of it overlaps a cell — it attaches even if the node is much taller than a small empty cell. Drop several nodes into the same cell to create a vertical stack; the drop position determines stack order. Newly created nodes placed inside a cell attach automatically too.
- Drag an attached node to another cell to transfer it, or fully clear of every cell to release it. Released nodes keep their current size.
- Click **+** on a cell header to split left/right, split top/bottom, create a grid, or rename the cell. Splitting keeps existing nodes in the first (top or left) cell.
- Drag a vertical divider to change column widths. Each grid cell can be split again. Drag the frame's right edge to resize its width; only cells touching that boundary change width.
- Drag the layout header to move its nodes together. Frame and row heights automatically fit their content and shrink when content is removed. Empty cells retain a small drop area.
- Click **•••** on the frame → **Add bottom row** to append an empty full-width cell. Existing cells keep their heights and attached nodes; the frame extends downward. Split the new row into columns if needed.
- The same **•••** menu can rename, export an empty template, or remove the frame while retaining nodes and connections.
- Click **•••** → **Header configuration…** to set the frame header's background color, text color (leave **Auto (contrast)** checked to keep the automatic dark/light pick), and font size for the frame title bar and all its cell header bars; use a cell's **+** menu to override any of the three for that one cell, and the reset entry to clear them. The configuration is saved with the workflow and included in exported templates.
- Click **•••** on a frame → **Fill cell height** to stretch every cell's bottom node flush with its cell (short cells fill up to taller neighbors); **Fit to content height** returns the nodes to their pre-fill heights. A filled frame owns its node heights — manual height drags are overridden while filling is on.
- Click **•••** on a frame → **Lock frame** to freeze its position and size — a 🔒 appears in its header; **Unlock frame** re-enables dragging. Locked frames ignore header, edge, and divider drags; menu commands still work.
- Right-click the canvas → **🌀 Import Layout Template…** to place a saved empty layout. Try `examples/two-column.layout.json`.
- Use ComfyUI's normal **Ctrl+Z / Ctrl+Shift+Z** shortcuts for undo/redo.

Node controls are resized through ComfyUI's normal node sizing API. Nodes fill cell widths; their heights retain space for their controls and previews. When a node needs more room, the frame grows instead of clipping it. This can make the frame larger than the requested drag size.

## Saving and reuse

Normal workflow saves include frame positions, sizes, labels, cell splits, and attached node IDs. The extension stores versioned layout metadata in `workflow.extra.comfyui_layout_templates`; node execution, widget values, and connections use ComfyUI's normal workflow data.

Exported templates contain only empty layout structure. Import creates fresh frame and cell IDs and does not create or connect nodes. Workflow copies retain populated layout metadata; copying selected nodes alone does not copy frames.

Frames belong to the currently displayed graph, including subgraphs. Removing this extension leaves the workflow nodes usable; layout metadata remains in saved workflows.

## Compatibility and limits

Tested on **ComfyUI 0.39.0 / frontend 1.53.10**, with classic nodes and **Nodes 2.0**, including real mouse interactions, native history, zoom/pan, workflow reload, template import/export, and model-free image generation.

- Up to 256 leaf cells per frame and 16 nested split levels; grid shortcuts accept 1–16 rows and columns.
- Geometry that exceeds 10 million graph units is rejected and the edit is rolled back. Template imports are limited to 1 MB.
- Custom nodes must honor ComfyUI's sizing API and report their minimum sizes correctly. Extensions that override dragging or force their own sizes may need additional compatibility work.
- Cell merging, populated template exports, and row/grid arrangements of nodes within a cell are not included in this version.

## Development

Run the engine and controller tests with Node.js 22 or newer:

```powershell
npm test
```

Browser verification uses Playwright and a running local ComfyUI instance:

```powershell
npm install --no-save playwright
npx playwright install chromium
$env:COMFYUI_URL = 'http://127.0.0.1:8188'
npm run test:browser
```

If Playwright is already available elsewhere, set `PLAYWRIGHT_MODULE` to its module directory. Browser tests intercept the extension assets in an isolated browser context; they do not install the package or change an open browser session. They create test workflows and queue two model-free `EmptyImage → SaveImage` runs, writing `layout-test` images into that server's output folder. Use a dedicated test instance. Launch that dedicated instance with custom nodes disabled (for example, `--disable-all-custom-nodes`): with the full custom-node set loaded, the suite's canvas-menu step does not surface the extension's menu entries.

Run `python tools/package.py` to create the installable ZIP in `dist/`. See `docs/verification.md` for the verification record and manual checks.

Development update: Cell options > Delete cell (keep nodes) releases the nodes and collapses single-child parents. Deleting the final cell leaves one empty cell. Right-edge width resizing preserve other columns and stop shrinking at the rightmost cells' content minimum.

Double-click a frame or cell title to rename it inline. Enter or leaving the field saves; Escape cancels. Cell titles may be empty; empty frame titles retain the previous name. Renaming supports undo/redo.

Cell divider dragging stops at the neighboring cells' content minimum widths, keeping the frame width and unrelated columns stable.

Frame menu > Shrink layout to content fits cell widths to their widest node's content minimum, with normal padding and gaps. Nested columns are fitted independently; stacked rows share the width required by their widest row. Empty cells keep a small drop area. Undo restores the previous width and column proportions.

New layout frames start with one row of two equal-width empty cells (50/50).

New bottom rows have an empty title. Cell titles can be cleared through inline editing or the rename menu.

Header configuration uses a 12-24 px font slider with a live value label and canvas preview. Background/text colors use the original browser color picker. The header panel retains OK/Cancel. Cancel restores previews; OK saves one undoable header edit.

Drag the frame's left edge to resize only the leftmost boundary cells while keeping its right edge fixed. Minimum content widths clamp shrinking; changes are undoable.

Header configuration is first in the frame and cell menus. Border configuration lets you choose border color, thickness (1-8 px), and solid/dashed/dotted style with live preview. OK saves an undoable change; Cancel restores the previous border. Border settings persist with workflows and templates.

Change Appearance includes Reset appearance configuration. It previews removal of header and border overrides; OK saves the reset, Cancel restores the original appearance. Cells resume inheriting the frame's header appearance.

Select nodes, right-click the canvas or a selected node, then choose Create layout from selected nodes > Preserve columns or Single stack. Column detection groups nodes with nearby left edges, orders columns left to right and stacks top to bottom. The new frame fits content minimum widths, preserves connections and supports one-step undo/redo. Selected nodes already in layouts transfer to the new frame.
The floating selection toolbar includes a Layout button. Its More Options menu also includes Create layout from selected nodes. Both offer Preserve columns and Single stack.
