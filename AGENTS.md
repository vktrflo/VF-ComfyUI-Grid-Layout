# AGENTS.md — VF-ComfyUI-Grid-Layout

Start here when working on **VF Grid Layout** (`https://github.com/vktrflo/VF-ComfyUI-Grid-Layout`), a frontend-only ComfyUI extension providing splittable canvas grid frames, drop-to-fit node stacks, tabbed IDE-style panels, smart collapsible sidebars, and VF Link Effects.

---

## 1. Architecture & Repository Map

VF Grid Layout adds **canvas tools only**: `__init__.py` exports `WEB_DIRECTORY = "./web"` and empty `NODE_CLASS_MAPPINGS = {}`. It adds no Python execution nodes and requires no extra Python packages or frontend build step.

| File / Directory | Role |
| --- | --- |
| `__init__.py` | Minimal ComfyUI entrypoint exposing `./web`. |
| `web/grid_layout.js` | ComfyUI extension registration (`VF.ComfyUI.GridLayout`), settings, commands, canvas/node/selection-toolbox menu hooks, and `setup()` wiring. |
| `web/core/layout.js` | Pure layout engine & tree model: frame/cell creation, splits (`splitCell`, `gridCell`, `addBottomRow`), `deleteCell`, `deleteEmptyCells`, `shrinkFrame`, `layoutFrame`, `resizeDivider`, `resizeLeftEdge`/`resizeRightEdge`, tabs, IDE presets, `validateFrame`, and template export/import. **No DOM access.** |
| `web/core/controller.js` | `LayoutController`: transactional `begin()` / `edit()` / `end()` with snapshot rollback and ComfyUI undo integration, `reflow()`, `drop()`, `createFromNodes()`, `shrink()`, `optimize()`, `remove()`, and node metrics collection. |
| `web/core/adapter.js` | `NodeAdapter`: abstracts Classic LiteGraph vs. ComfyUI Nodes 2.0 (Vue Nodes) node measurement, sizing, collapse/fold, fill height, and docked width tracking. |
| `web/core/overlay.js` | `LayoutOverlay`: DOM rendering of frames, headers, cells, dividers, resize handles, tabs, Activity Bar, 5-way Docking Compass Rose, drop ghosts, context/grid/cell menus (`frameActions`, `cellMenu`, `MENU_ICONS`), appearance dialog, and selection toolbox sync. |
| `web/core/link-effects.js` | VF Link Effects (Electricity / Neon Glow) and connected-node highlighting. |
| `web/core/link-visibility.js` | Hidden link mode overrides and link-label visibility helpers. |
| `tests/` | Node.js unit tests (`tests/*.test.mjs`) and Playwright browser E2E/UI tests (`tests/browser.mjs`, `tests/*-ui.mjs`). |
| `tools/` | Icon generation (`make-icon.mjs`), registry packaging (`package.py`), demo/capture recording scripts. |
| `docs/` | Verification notes (`docs/verification.md`), media GIFs (`docs/media/`), and design specs/plans (`docs/superpowers/`). |

---

## 2. Key Technical Boundaries & Invariants

1. **Keep `web/core/layout.js` pure:** All tree mutations, geometry math, and serialization validation live in `layout.js` without DOM or LiteGraph globals, so unit tests run directly in Node.
2. **All mutations go through `controller.edit()`:** Wrap every user-facing frame/cell edit in `controller.edit(() => ...)` so rollback on error, `reflow()`, and ComfyUI `Ctrl+Z` undo/redo stay atomic.
3. **Strict workflow validation:** Frames are persisted under `graph.extra.comfyui_grid_layout` (`version: 1`, with legacy fallback `comfyui_layout_templates`). Any new persisted frame/cell property **must** be explicitly whitelisted and normalized in `validateFrame()` in `web/core/layout.js`.
4. **Dual-mode frontend compatibility:** Changes to node sizing, positioning, folding, or menus must work in both **Classic LiteGraph** and **ComfyUI Nodes 2.0 (Vue Nodes)**.
5. **No build step:** `web/` modules are served directly as native browser ES modules.
6. **Worktree `node_modules`:** Linked git worktrees contain tracked files only. Link `node_modules` (symlink on POSIX, directory junction on Windows) from the primary checkout when running Playwright browser tests, and ensure `node_modules` is excluded in `.git/info/exclude` (never committed).

---

## 3. Running Tests & Verification

```bash
# Fast Node.js unit tests (runs all tests/*.test.mjs)
npm test

# Browser E2E & UI verification suites (requires Playwright + running ComfyUI)
npm run test:browser
npm run test:ui
npm run test:links
```

- Always run `npm test` after any edit and confirm 0 failures.
- Wrap all CLI commands with explicit timeouts (`timeout --kill-after=10s` on POSIX or an internal `threading.Timer` watchdog in Python on Windows).

---

## 4. Development Workflow (VF Standards)

- **Branch & worktree first:** Never commit directly to `main`. Cut an isolated worktree from `refs/remotes/origin/main` under `.worktrees/<slug>` on a feature branch (`feat/`, `fix/`, `refactor/`, `docs/`) and unset upstream (`git branch --unset-upstream`).
- **Track work on public VF Todo:** Use `https://todo.vktrflo.com` with Bearer auth from Project Longbranch (`api/cloud/key/vktrflo/todo`). Never call local Todo endpoints.
- **Zero secret leakage:** Never print, log, or commit secret values or tokens.
- **Zero zombies:** Terminate all spawned browser instances, background tasks, and test fixtures before finishing a task.
