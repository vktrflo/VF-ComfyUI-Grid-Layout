# Header Configuration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Fresh subagent per task; two-stage review (spec compliance first, then code quality) before the next task. The user may instead request inline implementation.

**Goal:** Replace the "Header color…" dialog with a "Header configuration…" panel that sets the header **background color**, an explicit **text color** (with an Auto-contrast checkbox), and a **font size** — frame-level defaults with per-cell overrides, exactly like the existing color model.

**Architecture:** `textColor` (normalized hex) and `fontSize` (8–24) join `color` in the existing `comfyui_layout_templates` v1 metadata at frame and cell level. The pure engine validates/clamps/migrates/round-trips them (`web/core/layout.js`); the overlay resolves them per field (cell → frame → defaults), renders them via a generalized `applyHeaderStyle`, and hosts the panel through three small, reusable dialog-helper extensions (`web/core/overlay.js`). No controller or adapter changes.

**Tech Stack:** Vanilla ES modules (no bundler), Node built-in test runner (`npm test` → `node --test tests/*.test.mjs`), Playwright browser suite (classic + Nodes 2.0), Python zip packaging.

**Spec:** `docs/superpowers/specs/2026-10-06-header-configuration-design.md`

**Repo facts the implementer needs:**

- Repo root `E:\projects\VF-ComfyUI-Layout-Templates` (git-bash: `/e/projects/VF-ComfyUI-Layout-Templates`). Run all commands from there.
- Unit tests: `npm test` — **52 green** before any change; grows as tasks add tests. Browser tests need the dedicated ComfyUI server (port 8197, `--disable-all-custom-nodes`); the suite injects extension assets from the repo, so no copy is needed.
- After editing any JS file run `node --check <file>` — the `patch` tool can silently over-delete; prefer small, uniquely-anchored patches.
- Inter-module imports are relative (`./layout.js`); tests import modules directly (`../web/core/layout.js`). `web/core/overlay.js` has no DOM access at import time, so Node can import it.
- The `patch` tool refuses fuzzy edits when the anchor text is ambiguous — include trailing context lines. For line-targeted rewrites, a small Python `open()/replace()/write()` in `execute_code` is reliable.
- Commit after each task; short imperative subjects. Do NOT push (local commits only; the user pushes when asked).
- Renderer note for browser work: `getComputedStyle` values are rgb() strings; computed `fontSize` is px (e.g. `'18px'`).

---

### Task 1: Engine — `textColor` + `fontSize` validation, carry, and round-trip

**Objective:** The pure engine accepts, clamps, migrates, and round-trips the two new header fields; unit-tested (TDD).

**Files:**
- Modify: `tests/color.test.mjs`
- Modify: `web/core/layout.js`

**Step 1: Write failing tests** — append to `tests/color.test.mjs`:

```js
test('validateFrame keeps text color and clamps font size, dropping junk', () => {
  const frame = engine.createFrame([10, 20]);
  frame.color = '#123abc';
  frame.fill = true;
  frame.lock = true;
  frame.textColor = '#AB12CD';
  frame.fontSize = 40;
  engine.splitCell(frame, frame.root.id, 'x');
  frame.root.children[0].textColor = 'ff0000';
  frame.root.children[0].fontSize = 9.6;
  frame.root.children[1].textColor = 'nope';
  frame.root.children[1].fontSize = 'big';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.textColor, '#ab12cd');
  assert.equal(validated.fontSize, 24, 'out-of-range sizes clamp');
  assert.equal(validated.color, '#123abc');
  assert.equal(validated.fill, true);
  assert.equal(validated.lock, true);
  assert.equal(validated.root.children[0].textColor, '#ff0000');
  assert.equal(validated.root.children[0].fontSize, 10, 'sizes round');
  assert.equal('textColor' in validated.root.children[1], false);
  assert.equal('fontSize' in validated.root.children[1], false);

  const plain = engine.createFrame([0, 0]);
  assert.equal('textColor' in engine.validateFrame(plain), false);
  assert.equal('fontSize' in engine.validateFrame(plain), false);
});

test('text color and font size survive splits, grids, and template round trips', () => {
  const frame = engine.createFrame([10, 20]);
  frame.textColor = '#112233';
  frame.fontSize = 18;
  engine.splitCell(frame, frame.root.id, 'x');
  assert.equal('textColor' in frame.root, false);
  assert.equal('fontSize' in frame.root, false);
  assert.equal(frame.root.children[0].textColor, '#112233');
  assert.equal(frame.root.children[0].fontSize, 18);
  assert.equal('textColor' in frame.root.children[1], false);

  const grid = engine.createFrame();
  grid.root.textColor = '#abcdef';
  grid.root.fontSize = 10;
  engine.gridCell(grid, grid.root.id, 2, 2);
  assert.equal(engine.leaves(grid.root)[0].textColor, '#abcdef');
  assert.equal(engine.leaves(grid.root)[0].fontSize, 10);
  assert.ok(engine.leaves(grid.root).slice(1).every(leaf => !('textColor' in leaf) && !('fontSize' in leaf)));

  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.textColor, '#112233');
  assert.equal(template.frame.fontSize, 18);
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [5, 6]);
  assert.equal(restored.textColor, '#112233');
  assert.equal(restored.fontSize, 18);
  assert.equal(restored.root.children[0].fontSize, 18);
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — the new assertions error (`validated.textColor` is `undefined`, out-of-range not clamped). Existing 52 still pass.

**Step 3: Implement in `web/core/layout.js`**

3a. Add the export next to `normalizeColor`:

```js
export function normalizeFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return undefined;
  return Math.min(24, Math.max(8, Math.round(size)));
}
```

3b. Add a carry helper above `splitCell`:

```js
function carryHeaderConfig(target, source) {
  for (const key of ['color', 'textColor', 'fontSize']) {
    if (source[key] !== undefined) { target[key] = source[key]; delete source[key]; }
  }
}
```

3c. In `splitCell` and `gridCell`, replace the existing `if (cell.color) { first.color = cell.color; delete cell.color; }` line with:

```js
  carryHeaderConfig(first, cell);
```

3d. In `validateFrame`'s leaf branch (next to the `color` lines) add:

```js
      const textColor = normalizeColor(cell.textColor);
      if (textColor) result.textColor = textColor;
      const fontSize = normalizeFontSize(cell.fontSize);
      if (fontSize !== undefined) result.fontSize = fontSize;
```

3e. In `validateFrame`'s frame-level branch, after the `fill`/`lock` lines add the same three lines with `value` in place of `cell`:

```js
  const textColor = normalizeColor(value.textColor);
  if (textColor) result.textColor = textColor;
  const fontSize = normalizeFontSize(value.fontSize);
  if (fontSize !== undefined) result.fontSize = fontSize;
```

**Step 4: Run to verify pass**

Run: `node --check web/core/layout.js && npm test`
Expected: PASS — 54 tests, 0 fail.

**Step 5: Commit**

```bash
git add web/core/layout.js tests/color.test.mjs
git commit -m "Add text color and font size to header metadata"
```

---

### Task 2: Overlay — generalize header styling and the dialog helper

**Objective:** `applyHeaderStyle` renders the three fields (with per-field inheritance); the dialog helper supports optional fields, custom number bounds, checkboxes, and change hooks. No user-visible change yet (old color dialog still in place).

**Files:**
- Modify: `web/core/overlay.js`

**Step 1: Generalize the styling helper.** Replace `applyHeaderColor` (currently three lines setting background + `contrastColor`) with:

```js
function applyHeaderStyle(el, { color, textColor, fontSize } = {}) {
  if (color) {
    el.classList.add('clt-custom-bg');
    el.style.background = color;
  }
  if (textColor) el.style.color = textColor;
  else if (color) el.style.color = contrastColor(color);
  if (fontSize) el.style.fontSize = `${fontSize}px`;
}
function applyHeaderConfig(target, values) {
  const color = normalizeColor(values.color);
  if (color) target.color = color; else delete target.color;
  const textColor = values.auto === true ? undefined : normalizeColor(values.textColor);
  if (textColor) target.textColor = textColor; else delete target.textColor;
  const fontSize = values.fontSize == null ? undefined : normalizeFontSize(values.fontSize);
  if (fontSize === undefined) delete target.fontSize; else target.fontSize = fontSize;
}
```

Import `normalizeFontSize` in the overlay's import line from `./layout.js`.

**Step 2: Update the two render sites.**

Frame header (currently `const frameColor = ...; if (frameColor) applyHeaderColor(header, frameColor);`):

```js
      applyHeaderStyle(header, {
        color: normalizeColor(frame.color),
        textColor: normalizeColor(frame.textColor),
        fontSize: normalizeFontSize(frame.fontSize),
      });
```

Cell header (currently `const cellColor = ...` + conditional call):

```js
      applyHeaderStyle(cellHeader, {
        color: normalizeColor(cell.color) ?? normalizeColor(frame.color),
        textColor: normalizeColor(cell.textColor) ?? normalizeColor(frame.textColor),
        fontSize: normalizeFontSize(cell.fontSize) ?? normalizeFontSize(frame.fontSize),
      });
```

**Step 3: Extend the dialog helper (`dialog(title, fields, submit, message)`).** Replace the field loop with:

```js
    const inputs = {};
    for (const field of fields) {
      const label = element('label', '', field.label), input = document.createElement('input');
      input.name = field.name; input.type = field.type ?? 'text';
      input.setAttribute('aria-label', field.label);
      input.required = field.optional !== true && input.type !== 'checkbox';
      if (input.type === 'number') {
        input.min = String(field.min ?? 1); input.max = String(field.max ?? 16); input.step = String(field.step ?? 1);
        if (field.value != null) input.value = String(field.value);
      } else if (input.type === 'checkbox') {
        input.checked = field.value === true;
      } else {
        input.value = field.value;
        input.maxLength = 120;
      }
      if (field.onChange) input.addEventListener('change', () => field.onChange(input, inputs));
      label.append(input); form.append(label); inputs[field.name] = input;
    }
    for (const field of fields) field.onChange?.(inputs[field.name], inputs);
```

and the submit value mapping with:

```js
      const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => {
        if (input.type === 'number') return [key, input.value === '' ? null : Number(input.value)];
        if (input.type === 'checkbox') return [key, input.checked];
        return [key, input.value];
      }));
```

Check: the grid dialog (rows/columns) keeps its 1–16 bounds via the defaults; rename dialogs are unchanged text fields.

**Step 4: Verify no regressions**

Run: `node --check web/core/overlay.js && npm test`
Expected: 54 pass, 0 fail (no unit test covers the overlay; the old color dialog still uses only `color`).

**Step 5: Commit**

```bash
git add web/core/overlay.js
git commit -m "Generalize header styling and dialog fields"
```

---

### Task 3: Overlay — the Header configuration panel in both menus

**Objective:** Both menus open the new panel; submit applies the three fields in one edit; reset entries become "Reset header configuration".

**Files:**
- Modify: `web/core/overlay.js`

**Step 1: Add the panel method** (next to `dialog`):

```js
  headerConfigDialog(defaults, submit) {
    this.dialog('Header configuration', [
      { name: 'color', label: 'Background color', type: 'color', value: defaults.color },
      { name: 'auto', label: 'Auto (contrast)', type: 'checkbox', value: defaults.auto, onChange: (input, inputs) => { inputs.textColor.disabled = input.checked; } },
      { name: 'textColor', label: 'Text color', type: 'color', value: defaults.textColor },
      { name: 'fontSize', label: 'Font size (px, empty = inherit)', type: 'number', value: defaults.fontSize, optional: true, min: 8, max: 24 },
    ], submit);
  }
```

**Step 2: Replace the cell menu entry.** The current `['Header color…', ...]` block becomes:

```js
      ['Header configuration…', () => {
        const frame = this.controller.frames.find(f => f.id === frameId);
        const cell = frame && findCell(frame.root, cellId);
        if (!cell) return;
        const color = normalizeColor(cell.color) ?? normalizeColor(frame.color) ?? '#20282c';
        this.headerConfigDialog({
          color,
          textColor: normalizeColor(cell.textColor) ?? normalizeColor(frame.textColor) ?? contrastColor(color),
          auto: !normalizeColor(cell.textColor),
          fontSize: normalizeFontSize(cell.fontSize) ?? normalizeFontSize(frame.fontSize),
        }, values => edit((targetFrame, targetCell) => applyHeaderConfig(targetCell, values)));
      }],
```

**Step 3: Replace the frame menu entry.** The current `['Header color…', ...]` entry becomes:

```js
      ['Header configuration…', () => {
        const color = normalizeColor(frame.color) ?? '#20282c';
        this.headerConfigDialog({
          color,
          textColor: normalizeColor(frame.textColor) ?? contrastColor(color),
          auto: !normalizeColor(frame.textColor),
          fontSize: normalizeFontSize(frame.fontSize),
        }, values => this.controller.edit(() => applyHeaderConfig(frame, values)));
      }],
```

**Step 4: Replace both reset entries.**

Cell menu:

```js
    if (cell && (normalizeColor(cell.color) || normalizeColor(cell.textColor) || normalizeFontSize(cell.fontSize) !== undefined)) {
      actions.push(['Reset header configuration', () => edit((targetFrame, targetCell) => {
        delete targetCell.color; delete targetCell.textColor; delete targetCell.fontSize;
      })]);
    }
```

Frame menu:

```js
    if (normalizeColor(frame.color) || normalizeColor(frame.textColor) || normalizeFontSize(frame.fontSize) !== undefined) {
      actions.push(['Reset header configuration', () => this.controller.edit(() => {
        delete frame.color; delete frame.textColor; delete frame.fontSize;
      })]);
    }
```

**Step 5: Verify**

Run: `node --check web/core/overlay.js && npm test && grep -n "Header color" web/core/overlay.js`
Expected: 54 pass; the grep prints nothing (all old entry names gone).

**Step 6: Commit**

```bash
git add web/core/overlay.js
git commit -m "Replace the color dialog with the header configuration panel"
```

---

### Task 4: Browser suite — rename the color pins and add the configuration scenario

**Objective:** The suite drives the new panel in both renderers: prefill states, applying all three fields, per-cell overrides, the Auto toggle, undo/redo, save/load persistence, resets, and a screenshot.

**Files:**
- Modify: `tests/browser.mjs`

**Step 1: Rename existing pins.** In the color scenario only:
- `'Header color…'` → `'Header configuration…'` (4 occurrences).
- `'Reset header color'` → `'Reset header configuration'` (6 occurrences).
- `.clt-dialog input[type="color"]` → `.clt-dialog input[name="color"]` (5 occurrences — the panel now has two color inputs, so the selector must be name-scoped).

Also, next to the existing `defaultHeader` capture (~line 302) add:

```js
    const defaultLabel = await page.evaluate(() => getComputedStyle(document.querySelector('.clt-frame-header .clt-label')).color);
```

Behavior check: with Auto defaulting to checked and the size blank, the color scenario's OK clicks are no-ops for the two new fields — its assertions stay valid.

**Step 2: Add the configuration scenario** — insert after the color scenario's final reset checks (before the `// Fill cell height:` comment):

```js
    // Header configuration: background + text color + font size, inherited by cells, per-cell overrides, reset.
    await page.getByRole('button', { name: 'Layout options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Header configuration…', exact: true }).click();
    assert.equal(await page.locator('.clt-dialog input[name="color"]').inputValue(), '#20282c', 'panel prefills the default background');
    assert.equal(await page.locator('.clt-dialog input[name="auto"]').isChecked(), true, 'text color defaults to auto');
    assert.equal(await page.locator('.clt-dialog input[name="textColor"]').inputValue(), '#f4f6f7', 'auto swatch shows the computed contrast color');
    assert.equal(await page.locator('.clt-dialog input[name="fontSize"]').inputValue(), '', 'size stays blank when unset');
    await page.locator('.clt-dialog input[name="color"]').evaluate(el => { el.value = '#70d8be'; });
    await page.locator('.clt-dialog input[name="auto"]').uncheck();
    assert.equal(await page.locator('.clt-dialog input[name="textColor"]').isEnabled(), true, 'unchecking auto enables the text swatch');
    await page.locator('.clt-dialog input[name="textColor"]').evaluate(el => { el.value = '#112233'; });
    await page.locator('.clt-dialog input[name="fontSize"]').fill('18');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-frame-header')).backgroundColor === 'rgb(112, 216, 190)');
    const headerConfig = await page.evaluate(() => {
      const frame = document.querySelector('.clt-frame-header');
      return {
        frame: {
          background: getComputedStyle(frame).backgroundColor,
          size: getComputedStyle(frame).fontSize,
          text: getComputedStyle(frame.querySelector('.clt-label')).color,
        },
        cells: [...document.querySelectorAll('.clt-cell-header')].map(el => ({
          background: getComputedStyle(el).backgroundColor,
          size: getComputedStyle(el).fontSize,
          text: getComputedStyle(el.querySelector('.clt-label')).color,
        })),
      };
    });
    assert.deepEqual(headerConfig.frame, { background: 'rgb(112, 216, 190)', size: '18px', text: 'rgb(17, 34, 51)' }, 'frame header applies all three fields');
    assert.ok(headerConfig.cells.length >= 2 && headerConfig.cells.every(c => c.background === 'rgb(112, 216, 190)' && c.size === '18px' && c.text === 'rgb(17, 34, 51)'), 'cell headers inherit background, text color, and font size');
    await page.evaluate(() => window.comfyAPI.app.app.canvas.setDirty(true, true));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/header-config-${vue ? 'nodes-2' : 'classic'}.png` });

    await page.getByRole('button', { name: 'Cell options', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Header configuration…', exact: true }).click();
    assert.equal(await page.locator('.clt-dialog input[name="color"]').inputValue(), '#70d8be', 'cell panel prefills the inherited background');
    assert.equal(await page.locator('.clt-dialog input[name="auto"]').isChecked(), true, 'cell text color has no own pin yet');
    assert.equal(await page.locator('.clt-dialog input[name="textColor"]').inputValue(), '#112233', 'cell panel shows the inherited text color');
    await page.locator('.clt-dialog input[name="fontSize"]').fill('11');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '11px');
    const overridden = await page.evaluate(() => [...document.querySelectorAll('.clt-cell-header')].map(el => getComputedStyle(el).fontSize));
    assert.ok(overridden[0] === '11px' && overridden.slice(1).every(s => s === '18px'), 'cell overrides only the size');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.clt-cell-header .clt-label')).color), 'rgb(17, 34, 51)', 'text color stays inherited');

    await page.getByRole('button', { name: 'Cell options', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Header configuration…', exact: true }).click();
    await page.locator('.clt-dialog input[name="auto"]').uncheck();
    await page.locator('.clt-dialog input[name="textColor"]').evaluate(el => { el.value = '#ffffff'; });
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header .clt-label')).color === 'rgb(255, 255, 255)');
    await page.getByRole('button', { name: 'Cell options', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Header configuration…', exact: true }).click();
    assert.equal(await page.locator('.clt-dialog input[name="auto"]').isChecked(), false, 'cell text color is pinned');
    await page.locator('.clt-dialog input[name="auto"]').check();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header .clt-label')).color === 'rgb(17, 34, 51)');

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header .clt-label')).color === 'rgb(255, 255, 255)');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header .clt-label')).color === 'rgb(17, 34, 51)');

    const configSave = await page.evaluate(() => JSON.parse(JSON.stringify(window.comfyAPI.app.app.graph.serialize())));
    await page.evaluate(async saved => { await window.comfyAPI.app.app.loadGraphData(saved); }, configSave);
    await settle();
    const configPersisted = await page.evaluate(() => {
      const frames = window.comfyAPI.app.app.graph.extra.comfyui_layout_templates.frames;
      const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
      const cell = leaves(frames[0].root)[0];
      return { frame: { textColor: frames[0].textColor, fontSize: frames[0].fontSize }, cellFontSize: cell.fontSize, hasCellText: 'textColor' in cell };
    });
    assert.equal(configPersisted.frame.textColor, '#112233', 'frame text color persists');
    assert.equal(configPersisted.frame.fontSize, 18, 'frame font size persists');
    assert.equal(configPersisted.cellFontSize, 11, 'cell font size persists');
    assert.equal(configPersisted.hasCellText, false, 'cleared cell text pin stays absent');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '11px');

    await page.getByRole('button', { name: 'Cell options', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Reset header configuration', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '18px');
    await page.getByRole('button', { name: 'Layout options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reset header configuration', exact: true }).click();
    await page.waitForFunction(({ background, label }) => {
      const frame = document.querySelector('.clt-frame-header');
      const style = getComputedStyle(frame);
      return style.backgroundColor === background && style.fontSize === '13px' && getComputedStyle(frame.querySelector('.clt-label')).color === label;
    }, { background: defaultHeader, label: defaultLabel });
    await page.getByRole('button', { name: 'Layout options', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Reset header configuration', exact: true }).count(), 0, 'reset entry gone after clearing the configuration');
    await page.keyboard.press('Escape');
```

**Step 3: Run the suite** (dedicated server on 8197 must be running; `COMFYUI_URL='http://127.0.0.1:8197' npm run test:browser`).

Expected: all pre-existing scenario lines plus a green configuration scenario in both classic and Nodes 2.0; screenshots `test-results/header-config-classic.png`, `test-results/header-config-nodes-2.png`.

**Step 4: Commit**

```bash
git add tests/browser.mjs
git commit -m "Verify the header configuration panel in the browser suite"
```

---

### Task 5: Docs and package

**Objective:** README bullet, verification record, regenerated zip.

**Files:**
- Modify: `README.md`, `docs/verification.md`, `dist/VF-ComfyUI-Layout-Templates.zip`

**Step 1:** In `README.md`, replace the header-colors bullet with a configuration bullet covering the three fields, Auto contrast, and the reset entry (keep it one or two lines, matching the file's style). Read the current bullet first and keep the surrounding list intact.

**Step 2:** Append a "Header configuration update" section to `docs/verification.md` recording: the actual `npm test` count, the browser result line for both renderers, the new screenshots, and any deviation found during execution (nothing claimed that did not run).

**Step 3:** Regenerate the zip: `python tools/package.py` → confirm `dist/VF-ComfyUI-Layout-Templates.zip` updates.

**Step 4: Commit**

```bash
git add README.md docs/verification.md dist/VF-ComfyUI-Layout-Templates.zip
git commit -m "Document the header configuration panel"
```

---

## Verification checklist (run before declaring done)

- `npm test` → 54 pass / 0 fail.
- `node --check` clean on `web/core/layout.js`, `web/core/overlay.js`, `tests/browser.mjs`.
- `grep -rn "Header color" web/ tests/` prints nothing.
- Browser suite green in classic + Nodes 2.0 with the new scenario lines (`Header configuration` assertions pass).
- Both screenshots exist and show the 18px headers after a forced repaint (the suite already forces one before scenario screenshots — keep that pattern for the new screenshot too: add `await page.evaluate(() => window.comfyAPI.app.app.canvas.setDirty(true, true)); await page.waitForTimeout(400);` before the `header-config` screenshot).
- Zip regenerated; `git status` clean after the final commit.
