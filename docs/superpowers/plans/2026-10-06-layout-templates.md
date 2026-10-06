# Layout Templates Implementation Plan

**Goal:** Implement the approved canvas frame design without changing node execution.

**Architecture:** A pure cell-tree engine owns geometry and membership. A frontend controller stores versioned metadata in each graph's extra field and operates normal graph nodes. A pointer-transparent HTML overlay supplies frame controls in both renderers.

**Tech stack:** ES modules, Python custom-node loader, Node built-in tests, Playwright against a local ComfyUI frontend.

## Constraints

Vertical stacks, minimum node dimensions, nested splits and regular grids, empty JSON templates, persistent attachment, native undo transactions, classic and Nodes 2.0 support. Frame removal retains nodes and links. No generation node is necessary.

## Tasks

- [x] Write and run failing layout tests for stack sizing, minimum-driven growth, nested splits, membership transfer, ordering, serialization, and invalid template input.
- [x] Implement `web/core/layout.js` with `createFrame`, `splitCell`, `gridCell`, `layoutFrame`, `dropNodes`, `exportTemplate`, and `importTemplate`. Use frame-local unique cell IDs and normalized split ratios; preserve nodes in the first child on splits.
- [x] Write and run failing controller tests for persistent graph extra, balanced native transactions, graph switching, minimum measurement, and node position/size updates without changing widgets or links.
- [x] Implement `web/core/controller.js` and `web/core/adapter.js`. Use the currently displayed graph, resolve node IDs through the graph, and bracket edits in canvas history events.
- [x] Implement `web/layout_templates.js` and `web/core/overlay.js`: register the extension and canvas menu; show frame headers, cell labels/menus, dividers, and resize handles. Track native node moves through document pointer events and reflow after release.
- [x] Add loader, package metadata, installation instructions, a sample empty template, and a manual verification checklist.
- [x] Verify all automated tests, Python loader, browser interaction in both renderers, workflow round-trip, undo/redo, zoom/pan, and API prompt equivalence. Report any environment limitation explicitly.
