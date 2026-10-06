# Header Colors Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Fresh subagent per task; two-stage review (spec compliance first, then code quality) before the next task.

**Goal:** Customizable header-bar colors for layout frames and cells — one color per frame covering the frame bar and all its cell bars, with optional per-cell overrides — persisted in workflow metadata and templates.

**Architecture:** Optional `color` fields on frame and leaf-cell records in the existing `comfyui_layout_templates` v1 metadata. Normalization lives in the pure engine (`web/core/layout.js`); presentation (contrast + styles) lives in `web/core/overlay.js`; all writes go through the existing `controller.edit()` undo transactions.

**Tech Stack:** Vanilla ES modules (no bundler), Node built-in test runner (`npm test` → `node --test tests/*.test.mjs`), Playwright browser suite (classic + Nodes 2.0), Python zip packaging.

**Spec:** `docs/superpowers/specs/2026-10-06-header-colors-design.md`

**Repo facts the implementer needs:**

- Repo root `E:\projects\ComfyUI-Layout-Templates` (git-bash: `/e/projects/ComfyUI-Layout-Templates`). Run all commands from there.
- Unit tests: `npm test` — must be 31 green before any change; grows as tasks add tests.
- After editing any JS file run `node --check <file>` — the `patch` tool can silently over-delete; verify after every patch and prefer small, uniquely-anchored patches.
- Inter-module imports are relative (`./layout.js`); tests import modules directly (`../web/core/layout.js`).
- Commit after each task; short imperative subjects.

---

### Task 1: Engine color support — `normalizeColor` + validation + structural migration

**Objective:** The pure engine stores, normalizes, validates, and round-trips colors; unit-tested.

**Files:**
- Create: `tests/color.test.mjs` (engine section)
- Modify: `web/core/layout.js`

**Step 1: Write failing tests** — create `tests/color.test.mjs` with exactly:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

test('normalizeColor normalizes valid forms and drops junk without throwing', () => {
  assert.equal(engine.normalizeColor('#A1B2C3'), '#a1b2c3');
  assert.equal(engine.normalizeColor('a1b2c3'), '#a1b2c3');
  assert.equal(engine.normalizeColor('#abc'), '#aabbcc');
  assert.equal(engine.normalizeColor('ABC'), '#aabbcc');
  for (const bad of [undefined, null, 42, 'red', '#12', '#1234567', '#gggggg', '', 'rgb(0,0,0)']) {
    assert.equal(engine.normalizeColor(bad), undefined, `expected ${String(bad)} to be rejected`);
  }
});

test('validateFrame keeps valid frame and cell colors and drops invalid ones', () => {
  const frame = engine.createFrame([10, 20]);
  frame.color = '#123AbC';
  engine.splitCell(frame, frame.root.id, 'x');
  frame.root.children[0].color = 'ff0000';
  frame.root.children[1].color = 'not-a-color';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.color, '#123abc');
  assert.equal(validated.root.children[0].color, '#ff0000');
  assert.equal('color' in validated.root.children[1], false);

  const plain = engine.createFrame([0, 0]);
  plain.color = 'red';
  assert.equal('color' in engine.validateFrame(plain), false);
});

test('template round trips preserve frame and cell colors with fresh ids', () => {
  const frame = engine.createFrame([10, 20]);
  frame.color = '#112233';
  engine.gridCell(frame, frame.root.id, 1, 2);
  frame.root.children[0].color = '#AABBCC';
  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.color, '#112233');
  assert.equal(template.frame.root.children[0].color, '#aabbcc');
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [5, 6]);
  assert.notEqual(restored.id, frame.id);
  assert.equal(restored.color, '#112233');
  assert.equal(restored.root.children[0].color, '#aabbcc');
});

test('splitting or gridding a colored cell moves the color to the first leaf', () => {
  const split = engine.createFrame();
  split.root.color = '#abcdef';
  engine.splitCell(split, split.root.id, 'x');
  assert.equal('color' in split.root, false);
  assert.equal(split.root.children[0].color, '#abcdef');
  assert.equal('color' in split.root.children[1], false);

  const grid = engine.createFrame();
  grid.root.color = '#abcdef';
  engine.gridCell(grid, grid.root.id, 2, 2);
  assert.equal('color' in grid.root, false);
  assert.equal(engine.leaves(grid.root)[0].color, '#abcdef');
});
```

**Step 2: Run to verify failure** — `npm test`. Expected: 4 new tests FAIL — the first on `engine.normalizeColor is not a function`, the rest on the missing color propagation (validation, round-trip, and migration assertions); all 31 existing tests still pass.

**Step 3: Implement** in `web/core/layout.js`:

1. After the `clone` helper add:

```js
export function normalizeColor(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return undefined;
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return `#${hex.toLowerCase()}`;
}
```

2. In `validateFrame` — frame level: build the result, then attach a valid color:

```js
const result = { id: freshIds ? id() : value.id, label: String(value.label ?? 'Layout').slice(0, 120), pos: [...value.pos], size: [...value.size], root };
const color = normalizeColor(value.color);
if (color) result.color = color;
return result;
```

3. In `validateFrame`'s inner `read(cell, depth)` — in the **leaf branch** (the `else` that validates `cell.nodes`), after `result.nodes = ...` add:

```js
const color = normalizeColor(cell.color);
if (color) result.color = color;
```

(Only leaf cells carry colors — a stray color on a split node is dropped by validation, keeping the invariant that only renderable header bars hold colors.)

4. In `splitCell`, after `first.nodes = cell.nodes;` add:

```js
if (cell.color) { first.color = cell.color; delete cell.color; }
```

5. In `gridCell`, replace the final `leaves(cell)[0].nodes = nodes;` with:

```js
const first = leaves(cell)[0];
first.nodes = nodes;
if (cell.color) { first.color = cell.color; delete cell.color; }
```

**Step 4: Run to verify pass** — `npm test`. Expected: all tests pass (31 + 4 new).

**Step 5: Commit**

```bash
git add tests/color.test.mjs web/core/layout.js
git commit -m "Add color data support to the layout engine"
```

---

### Task 2: Overlay presentation — contrast, render styling, menus

**Objective:** Header bars render the stored colors with readable text; both menus can set and reset colors; undoable.

**Files:**
- Modify: `web/core/overlay.js`
- Modify: `tests/color.test.mjs` (append contrast tests)

**Step 1: Write failing test** — append to `tests/color.test.mjs` (move the `contrastColor` import up beside the existing imports at the top of the file):

```js
import { contrastColor } from '../web/core/overlay.js';

test('contrastColor picks readable label text for header colors', () => {
  assert.equal(contrastColor('#ffffff'), '#101418');
  assert.equal(contrastColor('#000000'), '#f4f6f7');
  assert.equal(contrastColor('#70d8be'), '#101418');
  assert.equal(contrastColor('#20282c'), '#f4f6f7');
});
```

Run `npm test` — expected: FAIL (`contrastColor` not exported). Note: overlay.js has no DOM access at import time, so Node can import it.

**Step 2: Implement** in `web/core/overlay.js`:

1. Extend the import: add `normalizeColor` to the `./layout.js` import list.
2. Add module-level helpers (near `element()`):

```js
const HEADER_TEXT_DARK = '#101418';
const HEADER_TEXT_LIGHT = '#f4f6f7';
export function contrastColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? HEADER_TEXT_DARK : HEADER_TEXT_LIGHT;
}
function applyHeaderColor(el, color) {
  el.classList.add('clt-custom-bg');
  el.style.background = color;
  el.style.color = contrastColor(color);
}
```

3. CSS changes inside the `STYLE` string:
   - change `.clt-title-input`'s `color:inherit` to `color:var(--fg-color,#e4e4e7)`;
   - add after the `.clt-button:hover` rule:

```
.clt-custom-bg .clt-button:hover,.clt-custom-bg .clt-button:focus-visible{background:rgba(128,128,128,.3);border-color:transparent}
```

4. In `render()` — frame header, after `const header = element('div', 'clt-frame-header');`:

```js
const frameColor = normalizeColor(frame.color);
if (frameColor) applyHeaderColor(header, frameColor);
```

   and cell header, after `const cellHeader = element('div', 'clt-cell-header');`:

```js
const cellColor = normalizeColor(cell.color) ?? normalizeColor(frame.color);
if (cellColor) applyHeaderColor(cellHeader, cellColor);
```

5. In `frameMenu()` — insert after the "Rename layout…" entry and before "Export empty template":

```js
['Header color…', () => this.dialog('Header color', [{ name: 'color', label: 'Header color', type: 'color', value: normalizeColor(frame.color) ?? '#20282c' }], ({ color }) => this.controller.edit(() => {
  const next = normalizeColor(color);
  if (next) frame.color = next; else delete frame.color;
}))],
```

   convert the array passed to `showMenu` into `const actions = [...]`, and when `normalizeColor(frame.color)` is truthy push before the export/remove entries:

```js
actions.push(['Reset header color', () => this.controller.edit(() => { delete frame.color; })]);
```

   (final order: Add bottom row, Rename layout…, Header color…, [Reset header color], Export empty template, Remove layout).

6. In `cellMenu()` — append after "Rename cell…":

```js
['Header color…', () => {
  const frame = this.controller.frames.find(f => f.id === frameId);
  const cell = frame && findCell(frame.root, cellId);
  const current = (cell && (normalizeColor(cell.color) ?? normalizeColor(frame.color))) ?? '#20282c';
  this.dialog('Header color', [{ name: 'color', label: 'Header color', type: 'color', value: current }], ({ color }) => edit((targetFrame, targetCell) => {
    const next = normalizeColor(color);
    if (next) targetCell.color = next; else delete targetCell.color;
  }));
}],
```

   convert the menu array into `const actions = [...]`, and when the cell resolved at build time carries its own color, also append:

```js
const frame = this.controller.frames.find(f => f.id === frameId);
const cell = frame && findCell(frame.root, cellId);
if (cell && normalizeColor(cell.color)) actions.push(['Reset header color', () => edit((targetFrame, targetCell) => { delete targetCell.color; })]);
```

   (the dialog action already errors through the existing `edit` helper when the cell disappeared).

**Step 3: Verify** — `node --check web/core/overlay.js` and `npm test`; all tests pass (existing + 5 new).

**Step 4: Commit**

```bash
git add web/core/overlay.js tests/color.test.mjs
git commit -m "Render and edit customizable header colors"
```

---

### Task 3: Browser verification scenario

**Objective:** The behavior is verified in the real ComfyUI UI in both renderers, with screenshots.

**Files:** Modify: `tests/browser.mjs`

**Step 1:** Extend the per-renderer loop in `tests/browser.mjs` — add the scenario at the END of the loop body (after the auto-attach check, before the final `console.log`), so no later step depends on its history:

1. capture the default header background (`getComputedStyle`), open ••• → "Header color…", set the color input value (`page.locator('.clt-dialog input[type="color"]')` — set via `evaluate(el => el.value = ...)` for reliability) to `#70d8be`, click Apply;
2. assert frame header + every `.clt-cell-header` background is `rgb(112, 216, 190)` and the frame label color is `rgb(16, 20, 24)`;
3. open the first cell's + menu → "Header color…" → set `#112233`, Apply; assert that cell is `rgb(17, 34, 51)` with label `rgb(244, 246, 247)`, siblings/frame unchanged; screenshot `test-results/colors-${vue ? 'nodes-2' : 'classic'}.png`;
4. Ctrl+Z → first cell back to `rgb(112, 216, 190)`; Ctrl+Shift+Z → `rgb(17, 34, 51)` again;
5. `graph.serialize()` → `loadGraphData` → assert colors persist;
6. reset the cell (cell menu) → siblings' color; reset the frame (••• menu) → background equals the captured default.

**Step 2: Run the suite:**
- Ensure Playwright: `npm install --no-save playwright` in the repo (chromium binaries are already in the Playwright browser store under `%LOCALAPPDATA%\ms-playwright`; only run `npx playwright install chromium` if the module reports a missing browser).
- Start the dedicated browser-test server — the SMALL_DESKTOP install (ComfyUI 0.39.0 / frontend 1.53.10, the exact verified pair), CPU mode, isolating only input/output/temp/user in `.test-comfy/`:

```bash
cd /e/comfyui_instances/SMALL_DESKTOP/ComfyUI && env -u PYTHONPATH -u PYTHONHOME ./.venv/Scripts/python.exe main.py --listen 127.0.0.1 --port 8197 --cpu \
  --input-directory E:/projects/ComfyUI-Layout-Templates/.test-comfy/input \
  --output-directory E:/projects/ComfyUI-Layout-Templates/.test-comfy/output \
  --temp-directory E:/projects/ComfyUI-Layout-Templates/.test-comfy/temp \
  --user-directory E:/projects/ComfyUI-Layout-Templates/.test-comfy/user
```

  Two dead ends discovered while pinning this: the `start_comfyui.py` launcher forwards its `--` separator to main.py (argparse failure), and `--base-directory` requires `<base>/custom_nodes` to exist (FileNotFoundError otherwise) — hence the four explicit directory overrides. Run it as a background process; health-check `http://127.0.0.1:8197/system_stats` before the suite (CPU startup with the full custom-node set takes ~1–2 min).
- Run `COMFYUI_URL='http://127.0.0.1:8197' npm run test:browser`; expected: both "Classic" and "Nodes 2.0" success logs, no browser errors, screenshots in `test-results/`.

**Step 3: Commit**

```bash
git add tests/browser.mjs
git commit -m "Verify header colors in the browser suite"
```

---

### Task 4: Docs & release

**Objective:** Feature documented; version bumped; installable zip regenerated; verification record updated with actual results.

**Files:** `README.md`, `package.json`, `pyproject.toml`, `dist/ComfyUI-Layout-Templates.zip`, `docs/verification.md`

1. README — add a "Use" bullet: click ••• → "Header color…" to color a frame header and its cells; override or reset per cell from the + menu; colors save with the workflow and are included in exported templates. Add the version note line for 0.2.0 next to the existing 0.1.1 note.
2. Bump `0.1.2` → `0.2.0` in `package.json` and `pyproject.toml`.
3. `python tools/package.py` — regenerates `dist/ComfyUI-Layout-Templates.zip`.
4. `docs/verification.md` — append a header-colors section with the ACTUAL unit count and browser results from Task 3 (no claims beyond what ran).
5. Commit: `git add -A && git commit -m "Document header colors and release 0.2.0"`.

---

## Verification

- `npm test` — all unit tests green (31 existing + new color tests).
- `COMFYUI_URL=… npm run test:browser` — both renderer passes green, screenshots under `test-results/`.
- `git log --oneline` — one commit per task.
