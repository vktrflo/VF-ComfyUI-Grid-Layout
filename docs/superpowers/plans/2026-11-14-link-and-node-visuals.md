# Implementation Plan: Link & Node Visuals inside Grid Control

## Tasks

1. ** Inactive Tab & Collapsed Panel Link Routing (`web/core/overlay.js`, `web/core/layout.js`)**
   - Update `refreshHidden()` in `web/core/overlay.js` to compute `this.hidden.targets` for nodes hidden in inactive tabs, collapsed cells, collapsed frames, or non-maximized cells.
   - Update `routeMinimizedEndpoints()` to route hidden endpoints to their tab pill or cell/frame header anchor and suppress internal links within the same hidden container.
   - Remove the early-return guard in `canvas.renderLink` that hid non-frame hidden links.
   - In `layoutFrame()` (`web/core/layout.js`), park inactive-tab nodes with `hidden: true` when `frame.collapsed === true`.

2. ** Native Grid Bypass & Removal of Custom Node/Group Bypass Icons and `"Enabled"` Input Ports (`web/core/overlay.js`, `VF-ComfyUI-Nodes/web/vf_node_bypass.js`)**
   - Add `isFrameBypassed(frame)` and `toggleFrameBypass(frameId)` to `LayoutOverlay` (`web/core/overlay.js`).
   - Render `.clt-bypass.clt-frame-bypass` (`↱`) in `.clt-frame-header` and add `Bypass grid` / `Unbypass grid` to `frameActions`.
   - Update `NodeBypassOverlay` in `/mnt/wsl/linux/comfyui/custom_nodes/VF-ComfyUI-Nodes/web/vf_node_bypass.js` to stop rendering `.vf-nb-node-bar`, `.vf-nb-group-bar`, `.vf-nb-grid-bar`, and `.vf-nb-port` `"Enabled"` input ports.

3. ** Collapsed Node Width Preservation in Grid (`web/core/adapter.js`, `web/core/overlay.js`, `web/core/controller.js`)**
   - Update `NodeAdapter.apply(node, placement)` to set `node.size[0] = placement.width` (preserving `node.size[1]`) when collapsed, lock `node._collapsed_width` to `placement.width` for Classic LiteGraph, and set `--node-width` on `.lg-node` for Nodes 2.0.
   - Add `NodeAdapter.releaseDockedWidth(node)` and call it when nodes are detached from grids or when a grid is removed.
   - Sync `--node-width` for collapsed docked `.lg-node` elements in `LayoutOverlay.prototype.render()`.

4. ** Verification & Deployment**
   - Add unit tests in `tests/overlay.test.mjs`, `tests/ide-layout.test.mjs`, and `tests/adapter.test.mjs`.
   - Run `timeout 30s npm test` in `/mnt/wsl/linux/projects/VF-ComfyUI-Grid-Layout/.worktrees/feat/link-and-node-visuals` and in `/mnt/wsl/linux/comfyui/custom_nodes/VF-ComfyUI-Nodes`.
   - Deploy to `/mnt/wsl/linux/comfyui/custom_nodes/VF-ComfyUI-Grid-Layout/web/` and `/mnt/wsl/linux/comfyui/custom_nodes/VF-ComfyUI-Nodes/web/`.
   - Run Playwright E2E tests (`tests/ide-ui.mjs`, `tests/collapse-ui.mjs`).
