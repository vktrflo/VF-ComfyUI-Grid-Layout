# Fill Cell Height Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Fresh subagent per task; two-stage review (spec compliance first, then code quality) before the next task.

**Goal:** A per-cell "fill" toggle that stretches the bottom node of a cell so it ends flush with the cell's content floor — elastic (recomputed every layout from the node's natural minimum), opt-in per cell, snap-back on disable.

**Architecture:** `cell.fill === true` on leaf cells in the existing `comfyui_layout_templates` v1 metadata. The stretch math lives in the pure engine (`web/core/layout.js`), driven by a new `minHeight`/`collapsed` pair on adapter metrics. The toggle + snap live in the cell "+" menu (`web/core/overlay.js`) and run inside the existing `controller.edit()` undo transactions. No controller changes.

**Tech Stack:** Vanilla ES modules (no bundler), Node built-in test runner (`npm test` → `node --test tests/*.test.mjs`), Playwright browser suite (classic + Nodes 2.0), Python zip packaging.

**Spec:** `docs/superpowers/specs/2026-10-06-fill-cell-height-design.md`

**Repo facts the implementer needs:**

- Repo root `E:\projects\VF-ComfyUI-Layout-Templates` (git-bash: `/e/projects/VF-ComfyUI-Layout-Templates`). Run all commands from there.
- Unit tests: `npm test` — must be 39 green before any change; grows as tasks add tests.
- After editing any JS file run `node --check <file>` — the `patch` tool can silently over-delete; verify after every patch and prefer small, uniquely-anchored patches.
- Inter-module imports are relative (`./layout.js`); tests import modules directly (`../web/core/layout.js`).
- `web/core/overlay.js` has no DOM access at import time, so Node can import it.
- Commit after each task; short imperative subjects.
- The repo now has a GitHub remote (`origin`, vktrflo); do NOT push — local commits only.

---

### Task 1: Engine fill support — flag, metrics, elastic stretch geometry

**Objective:** The pure engine stores, validates, migrates, and round-trips `cell.fill`; `layoutFrame` stretches the bottom node of a filled cell flush to the content floor; unit-tested.

**Files:**
- Create: `tests/fill.test.mjs`
- Modify: `web/core/layout.js`

**Step 1: Write failing tests** — create `tests/fill.test.mjs` with exactly:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

const { PAD, CELL_TITLE } = engine;
const metric = (minWidth, height, minHeight = height, extra = {}) => ({ minWidth, height, minHeight, collapsed: false, titleHeight: 30, ...extra });

const twoColumn = (fill) => {
  const frame = engine.createFrame([0, 0]);
  engine.splitCell(frame, frame.root.id, 'x');
  const [left, right] = engine.leaves(frame.root);
  left.nodes = ['tall'];
  right.nodes = ['short'];
  if (fill) right.fill = true;
  return { frame, right };
};

test('validateFrame keeps fill true on leaves and drops everything else', () => {
  const frame = engine.createFrame([1, 2]);
  frame.root.fill = true;
  frame.root.color = '#abcdef';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.root.fill, true);
  assert.equal(validated.root.color, '#abcdef');

  for (const bad of [false, 'yes', 1, null, undefined]) {
    const f = engine.createFrame([0, 0]);
    f.root.fill = bad;
    assert.equal('fill' in engine.validateFrame(f), false, `expected ${String(bad)} to be dropped`);
  }

  const split = engine.createFrame([0, 0]);
  engine.splitCell(split, split.root.id, 'x');
  split.root.fill = true; // stray flag on a split node
  assert.equal('fill' in engine.validateFrame(split).root, false);
});

test('splitting or gridding a filled cell carries fill to the first leaf', () => {
  const split = engine.createFrame();
  split.root.fill = true;
  engine.splitCell(split, split.root.id, 'x');
  assert.equal('fill' in split.root, false);
  assert.equal(split.root.children[0].fill, true);
  assert.equal('fill' in split.root.children[1], false);

  const grid = engine.createFrame();
  grid.root.fill = true;
  engine.gridCell(grid, grid.root.id, 2, 2);
  assert.equal('fill' in grid.root, false);
  assert.equal(engine.leaves(grid.root)[0].fill, true);
});

test('template round trips preserve fill with fresh ids', () => {
  const frame = engine.createFrame([10, 20]);
  engine.gridCell(frame, frame.root.id, 1, 2);
  frame.root.children[1].fill = true;
  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.root.children[1].fill, true);
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [5, 6]);
  assert.notEqual(restored.id, frame.id);
  assert.equal(restored.root.children[1].fill, true);
});

test('a filled cell stretches its bottom node flush to the content floor', () => {
  const { frame, right } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 100, 60)]]);
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  const rect = cells.find(({ cell }) => cell.nodes[0] === 'short').rect;
  const short = placements.find(p => p.nodeId === 'short');
  const tall = placements.find(p => p.nodeId === 'tall');
  assert.equal(tall.height, 300, 'non-filled sibling column unchanged');
  assert.equal(short.y, rect[1] + CELL_TITLE + PAD + 30);
  assert.equal(short.y + short.height, rect[1] + rect[3] - PAD, 'bottom edge lands on the content floor');
  assert.equal(short.height, rect[3] - CELL_TITLE - PAD * 2 - 30, 'height absorbs all spare space');

  const plain = twoColumn(false);
  const off = engine.layoutFrame(plain.frame, metrics).placements.find(p => p.nodeId === 'short');
  assert.equal(off.height, 100, 'flag off leaves the measured height (gap below)');
});

test('only the bottom node grows in a filled cell', () => {
  const frame = engine.createFrame([0, 0]);
  engine.splitCell(frame, frame.root.id, 'x');
  const [left, right] = engine.leaves(frame.root);
  left.nodes = ['tall'];
  right.nodes = ['a', 'b'];
  right.fill = true;
  const metrics = new Map([['tall', metric(200, 300)], ['a', metric(200, 120)], ['b', metric(200, 100, 60)]]);
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  assert.equal(placements.find(p => p.nodeId === 'a').height, 120, 'upper node keeps its measured height');
  const b = placements.find(p => p.nodeId === 'b');
  const rect = cells.find(({ cell }) => cell.nodes.length === 2).rect;
  assert.equal(b.y + b.height, rect[1] + rect[3] - PAD);
  assert.ok(b.height > 60, 'bottom node absorbs the spare space');
});

test('collapsed bottom nodes do not stretch and empty filled cells are no-ops', () => {
  const { frame } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 0, 0, { collapsed: true })]]);
  const { placements } = engine.layoutFrame(frame, metrics);
  assert.equal(placements.find(p => p.nodeId === 'short').height, 0);

  const empty = engine.createFrame([0, 0]);
  empty.root.fill = true;
  const layout = engine.layoutFrame(empty, new Map());
  assert.equal(layout.cells.length, 1);
  assert.equal(layout.placements.length, 0);
});

test('repeated layouts are idempotent, including after re-measurement', () => {
  const { frame } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 100, 60)]]);
  const first = engine.layoutFrame(frame, metrics);
  const second = engine.layoutFrame(frame, metrics);
  assert.deepEqual(second.placements, first.placements);
  const stretched = first.placements.find(p => p.nodeId === 'short').height;
  const remeasured = new Map([['tall', metric(200, 300)], ['short', metric(200, stretched, 60)]]);
  const third = engine.layoutFrame(frame, remeasured);
  assert.equal(third.placements.find(p => p.nodeId === 'short').height, stretched, 'no feedback growth');
});
```

**Step 2: Run to verify failure** — `npm test`. Expected: the 7 new tests FAIL (missing propagation, missing migration, missing stretch — most fail on `minHeight` being unused / values not matching); all 39 existing tests still pass.

**Step 3: Implement** in `web/core/layout.js`:

1. In `validateFrame`'s inner `read(cell, depth)` — in the **leaf branch**, after the two color lines:
```js
const color = normalizeColor(cell.color);
if (color) result.color = color;
if (cell.fill === true) result.fill = true;
```

2. In `splitCell`, after `if (cell.color) { first.color = cell.color; delete cell.color; }`:
```js
if (cell.fill === true) { first.fill = true; delete cell.fill; }
```

3. In `gridCell`, in the final block (after the color carry):
```js
const first = leaves(cell)[0];
first.nodes = nodes;
if (cell.color) { first.color = cell.color; delete cell.color; }
if (cell.fill === true) { first.fill = true; delete cell.fill; }
```

4. In `layoutFrame`'s `minimum()` — replace the leaf branch with (bottom node contributes `minHeight` when filled):
```js
if (!cell.children) {
  cell.nodes = cell.nodes.filter(n => metrics.has(n));
  const nodes = cell.nodes.map(n => metrics.get(n));
  const content = nodes.reduce((sum, n, index) => sum + n.titleHeight + (cell.fill === true && index === nodes.length - 1 ? n.minHeight : n.height), 0);
  size = [Math.max(160, ...nodes.map(n => n.minWidth)) + PAD * 2,
    CELL_TITLE + PAD * 2 + Math.max(64, content + Math.max(0, nodes.length - 1) * GAP)];
}
```

5. In `layoutFrame`'s `place()` — replace the leaf branch's node loop (stretch the bottom node to the content floor):
```js
let y = rect[1] + CELL_TITLE + PAD;
const floor = rect[1] + rect[3] - PAD;
const last = cell.nodes.length - 1;
cell.nodes.forEach((nodeId, index) => {
  const metric = metrics.get(nodeId);
  let height = metric.height;
  if (cell.fill === true && index === last && !metric.collapsed) {
    height = Math.max(metric.minHeight, floor - y - metric.titleHeight);
  }
  placements.push({ nodeId, x: rect[0] + PAD, y: y + metric.titleHeight, width: rect[2] - PAD * 2, height });
  y += metric.titleHeight + height + GAP;
});
```

**Step 4: Run to verify pass** — `npm test`. Expected: all tests pass (39 + 7 new = 46).

**Step 5: Commit**

```bash
git add tests/fill.test.mjs web/core/layout.js
git commit -m "Add fill data support and stretch geometry to the layout engine"
```

---

### Task 2: Adapter metrics + cell menu toggle

**Objective:** Metrics expose `minHeight`/`collapsed`; the cell "+" menu toggles filling and snaps the bottom node back on disable — one undo step.

**Files:**
- Modify: `web/core/adapter.js`
- Modify: `web/core/overlay.js`

**Step 1: Implement** in `web/core/adapter.js` — extend the `measure()` return (keep `height` semantics unchanged):
```js
const collapsed = node.flags?.collapsed;
return {
  minWidth: this.widths.get(node),
  height: collapsed ? 0 : Math.max(node.size[1] || 0, minimum[1] || 0),
  minHeight: collapsed ? 0 : minimum[1] || node.size[1] || 0,
  collapsed: Boolean(collapsed),
  titleHeight: this.classicTitle,
};
```

**Step 2: Implement** in `web/core/overlay.js` — in `cellMenu()`, between the conditional `Reset header color` push and `this.showMenu(event, actions);` insert:
```js
if (cell?.fill === true) {
  actions.push(['Fit to content height', () => edit((targetFrame, targetCell) => {
    delete targetCell.fill;
    const nodeId = targetCell.nodes[targetCell.nodes.length - 1];
    const node = nodeId != null ? this.controller.graph.getNodeById(nodeId) : null;
    if (node) {
      const metric = this.controller.adapter.measure(node);
      this.controller.adapter.apply(node, { x: node.pos[0], y: node.pos[1], width: node.size[0], height: metric.minHeight });
    }
  })]);
} else {
  actions.push(['Fill cell height', () => edit((targetFrame, targetCell) => { targetCell.fill = true; })]);
}
```
Notes:
- `cell` is the leaf resolved at menu-build time (already defined above in `cellMenu`); the `edit` helper re-resolves the cell and errors if it disappeared.
- `apply()` already skips collapsed nodes; the snap is a no-op for them.
- Entries land after the header-color entries; flag on → only "Fit to content height", flag off → only "Fill cell height".

**Step 3: Verify** — `node --check web/core/adapter.js` and `node --check web/core/overlay.js`; `npm test` → all 46 tests still pass (no new unit tests; the menu/snap paths are covered by Task 3).

**Step 4: Commit**

```bash
git add web/core/adapter.js web/core/overlay.js
git commit -m "Toggle fill cell height from the cell menu"
```

---

### Task 3: Browser verification scenario

**Objective:** The behavior is verified in the real ComfyUI UI in both renderers, with a screenshot.

**Files:** Modify: `tests/browser.mjs`

**Step 1:** Extend the per-renderer loop in `tests/browser.mjs` — add the scenario at the END of the loop body (after the header-color resets, before the final `console.log`), so no later step depends on its state:

1. Reset the graph to a clean state and recreate the two model-free nodes, mirroring the existing block at the start of the prompt section (`loadGraphData({ version: 0.4, nodes: [], links: [], groups: [], extra: {} })`, create `EmptyImage` + `SaveImage`, set `window.testNodes`, scale 0.8).
2. Create a frame via the canvas context menu (existing pattern: right-click → `🌀 Add Layout Frame`), drag test node 0 into it (`nodeDragTo(0, …)`), then enlarge it so its column is tall:
   ```js
   await page.evaluate(() => { const n = window.comfyAPI.app.app.graph.getNodeById(window.testNodes[0]); n.setSize([n.size[0], 420]); });
   await page.waitForTimeout(300);
   ```
3. Split the cell left/right (cell menu → "Split into left / right"), then drag test node 1 into the right cell (compute its center via the existing controller-probe pattern: `import('/extensions/VF-ComfyUI-Layout-Templates/core/controller.js')` → `geometry()[0].cells[1].rect`). The right cell is now shorter than the row.
4. Capture the right node's natural minimum before enabling:
   ```js
   const minBefore = await page.evaluate(async () => {
     const { LayoutController } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/controller.js');
     const c = new LayoutController(window.comfyAPI.app.app, {});
     return c.adapter.measure(window.comfyAPI.app.app.graph.getNodeById(window.testNodes[1])).minHeight;
   });
   ```
5. Open the right cell's "+" menu; assert `menuitem 'Fill cell height'` is present and `'Fit to content height'` is absent; click "Fill cell height".
6. Assert the stretch, via a controller probe (`PAD` imported from `/extensions/…/core/layout.js` in-page): the bottom node's `placement.y + placement.height` equals `rect[1] + rect[3] − PAD` (tolerance < 1.5), i.e. flush with the content floor; also `waitForFunction` that the node's live `size[1]` matches within ~1.5.
7. Reopen the menu: assert `'Fit to content height'` present, `'Fill cell height'` absent. Press Escape.
8. Undo (`Control+z`) → node settles back near its pre-fill natural height (`minBefore`); redo (`Control+Shift+z`) → flush again.
9. Toggle off via "Fit to content height" → `waitForFunction` the node's `size[1]` is within ~1.5 of `minBefore`; menu shows `'Fill cell height'` again.
10. Enable filling again, then save → reload: `graph.serialize()` → `loadGraphData(saved)` → waitFor flush again; assert `frames[0]` metadata still carries the flag on that leaf (`.fill === true`).
11. Screenshot `test-results/fill-${vue ? 'nodes-2' : 'classic'}.png`.

**Step 2: Run the suite:**
- Ensure Playwright: `npm install --no-save playwright` in the repo (chromium binaries are already in the Playwright browser store under `%LOCALAPPDATA%\ms-playwright`; only run `npx playwright install chromium` if the module reports a missing browser).
- Start the dedicated browser-test server — the SMALL_DESKTOP install (ComfyUI 0.39.0 / frontend 1.53.10, the exact verified pair), CPU mode, core extensions only, isolating input/output/temp/user in `.test-comfy/`:

```bash
cd /e/comfyui_instances/SMALL_DESKTOP/ComfyUI && env -u PYTHONPATH -u PYTHONHOME ./.venv/Scripts/python.exe main.py --listen 127.0.0.1 --port 8197 --cpu --disable-all-custom-nodes \
  --input-directory E:/projects/VF-ComfyUI-Layout-Templates/.test-comfy/input \
  --output-directory E:/projects/VF-ComfyUI-Layout-Templates/.test-comfy/output \
  --temp-directory E:/projects/VF-ComfyUI-Layout-Templates/.test-comfy/temp \
  --user-directory E:/projects/VF-ComfyUI-Layout-Templates/.test-comfy/user
```

  `--disable-all-custom-nodes` is required: with the install's full custom-node set (~600 frontend extensions) the suite's canvas-menu interaction does not surface "Add Layout Frame"; the minimal environment passes both renderers. Run it as a background process; health-check `http://127.0.0.1:8197/system_stats` before the suite.
- Run `COMFYUI_URL='http://127.0.0.1:8197' npm run test:browser`; expected: both "Classic" and "Nodes 2.0" success logs, no browser errors, `test-results/fill-*.png` screenshots written.

**Step 3: Commit**

```bash
git add tests/browser.mjs
git commit -m "Verify fill cell height in the browser suite"
```

---

### Task 4: Docs & release

**Objective:** Feature documented; version bumped; installable zip regenerated; verification record updated with actual results.

**Files:** `README.md`, `package.json`, `pyproject.toml`, `dist/VF-ComfyUI-Layout-Templates.zip`, `docs/verification.md`

1. README — add a "Use" bullet after the header-color bullet:
   "Click a cell's **+** menu → **Fill cell height** to stretch the cell's bottom node flush with the cell's content floor (useful when a neighboring column runs taller); **Fit to content height** releases it and snaps the node back to its natural height. A filled cell owns its node heights — manual height drags are overridden while filling is on."
   Extend the version note (line with the 0.2.0 sentence): " Version 0.3.0 adds fill-cell-height: the bottom node of a marked cell stretches to fill the cell."
2. Bump `0.2.0` → `0.3.0` in `package.json` and `pyproject.toml`.
3. `python tools/package.py` — regenerates `dist/VF-ComfyUI-Layout-Templates.zip`.
4. `docs/verification.md` — append a fill-cell-height section with the ACTUAL unit count and browser results from Task 3 (no claims beyond what ran).
5. Commit: `git add -A && git commit -m "Document fill cell height and release 0.3.0"`.

---

## Verification

- `npm test` — all unit tests green (39 existing + 7 new).
- `COMFYUI_URL=… npm run test:browser` — both renderer passes green, `test-results/fill-*.png` written.
- `git log --oneline` — one commit per task.

## Execution deviations (inline run, 2026-10-06)

1. **`tests/controller.test.mjs` adapter-shape assertion updated** — the plan expected "no unit-test changes" for Task 2; extending `measure()` with `minHeight`/`collapsed` broke the existing `deepEqual` fixture. The expected object now pins the full new metric shape (`minHeight: 80, collapsed: false`). Justified: the metric extension is spec'd and the assertion remains a strict shape contract.
2. **Fill browser scenario deselects nodes before opening cell menus** — ComfyUI's Selection Toolbox appears beside the node left selected by the suite's drag and intercepted the first `+` click (30 s actionability timeout; observed once). An `openRightMenu()` helper now calls `canvas.deselectAllNodes()` before each menu-open click; pinned by the scenario passing in both renderers afterwards.

## Revision 2: container-level fill (executed inline, 2026-10-06)

User-directed revision: the fill toggle moves from the cell "+" menu to the frame "•••" menu and applies to every cell; per-cell entries are removed. Spec: `2026-10-06-fill-cell-height-design.md` (revised). The natural-height model changes from "bottom node contributes its minimum" to "bottom node contributes its intrinsic (pre-stretch) height", tracked by the adapter — with every cell filled, minimum-based naturals would collapse frames to minimums and stop enlarged nodes from anchoring their rows.

Implementation steps (as executed):

1. `web/core/layout.js` — reverted the `minimum()` fill-substitution (metrics `height` now carries the intrinsic value); `place()` stretches only when `frame.fill === true` and marks the bottom placement `fill: true`; frame-level `validateFrame` whitelist (`value.fill === true`); leaf-level whitelist and the `splitCell`/`gridCell` carry lines removed.
2. `web/core/adapter.js` — new `bases` / `appliedHeights` WeakMaps; `measure()` reports intrinsic `height` (`max(base, minimum)`); `apply()` records `appliedHeights` for `fill` placements; new `releaseFill(node)` (revert to base when the stretch is still ours; leave foreign changes; fall back to the minimum without a record).
3. `web/core/overlay.js` — cell-menu fill entries removed; frame menu gains the Fill/Fit pair; release runs `releaseFill` over every leaf's bottom node in one edit.
4. `tests/fill.test.mjs` — rewritten for frame-level flags (same flush numbers) with a lone-cell anchor test and adapter base/release tests.
5. `tests/browser.mjs` — fill scenario drives the frame ••• menu (`openFrameMenu` helper), asserts the tall anchor column is untouched, release returns to the pre-fill height, and `frames[0].fill` persists through save/load.
