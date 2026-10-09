// Verifies the collapse affordance end to end: the frame folds its nodes to
// title bars, stacks them flush under the header with the border wrapping the
// stack, carries them along when the frame is dragged, and puts everything back
// on expand. Runs against both renderers.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch {
  const path = process.env.PLAYWRIGHT_MODULE;
  if (!path) throw new Error('Install playwright or set PLAYWRIGHT_MODULE to its module directory.');
  playwright = require(path);
}
const base = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188';
const exampleWorkflow = JSON.parse(await readFile(new URL('../examples/two-column.workflow.json', import.meta.url), 'utf8'));
const prefix = '/extensions/VF-ComfyUI-Grid-Layout/';
const FRAME_TITLE = 36, PAD = 12;
const browser = await playwright.chromium.launch({ headless: true });
await mkdir('test-results', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.COMFYUI_TEST_INSTALLED !== '1') {
    await page.route('**/extensions', async route => {
      const response = await route.fetch();
      const list = await response.json();
      await route.fulfill({ response, json: [...list, `${prefix}grid_layout.js`] });
    });
    await page.route(`**${prefix}**`, async route => {
      const relative = new URL(route.request().url()).pathname.slice(prefix.length);
      assert.ok(!relative.includes('..'));
      try {
        const body = await readFile(fileURLToPath(new URL(`../web/${relative}`, import.meta.url)));
        await route.fulfill({ contentType: 'text/javascript', body });
      } catch { await route.fulfill({ status: 404, body: 'Extension file not implemented' }); }
    });
  }
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 60000 });
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.GridLayout'), { timeout: 15000 });
  await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 15000 });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  // Normalize the canvas transform so overlay pixel heights are meaningful.
  const normalize = () => page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    app.canvas.ds.scale = 1; app.canvas.ds.offset = [0, 0];
    app.canvas.setDirty(true, true);
  });
  const frameHeight = () => page.locator('.clt-frame').first().evaluate(el => el.getBoundingClientRect().height);
  const isCollapsed = () => page.evaluate(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].collapsed === true);
  const foldedFlags = () => page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    return (app.graph._nodes ?? []).map(n => [n.id, Boolean(n.flags?.collapsed)]);
  });
  // Frame geometry plus every node sorted top-to-bottom, as the renderer sees it.
  const layoutState = () => page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const frame = app.graph.extra.comfyui_grid_layout.frames[0];
    return {
      frame: { pos: [...frame.pos], size: [...frame.size] },
      nodes: app.graph._nodes.map(n => [n.id, [...n.pos], Boolean(n.flags?.collapsed)]).sort((a, b) => a[1][1] - b[1][1]),
    };
  });
  const setFolded = ids => page.evaluate(ids => {
    const app = window.comfyAPI.app.app;
    for (const n of app.graph._nodes) n.flags.collapsed = ids.includes(n.id);
    app.canvas.setDirty(true, true);
  }, ids);

  for (const vue of [false, true]) {
    const mode = vue ? 'Nodes 2.0' : 'Classic';
    await page.evaluate(async ({ vue, workflow }) => {
      const app = window.comfyAPI.app.app;
      await app.ui.settings.setSettingValue('Comfy.VueNodes.Enabled', vue);
      await app.loadGraphData(workflow);
    }, { vue, workflow: exampleWorkflow });
    await page.locator('.p-blockui-mask-document').waitFor({ state: 'hidden' });
    await settle();
    await normalize();
    await settle();

    const before = await layoutState();
    assert.ok(await page.locator('.clt-cell').count() > 0, 'the grid renders its cells before collapsing');
    assert.equal(await page.locator('.clt-collapse').textContent(), '▴', 'the chevron points up while expanded');

    // Collapse: every node folds to a title bar, stacked flush under the header.
    await page.getByRole('button', { name: 'Collapse grid', exact: true }).click();
    await settle();
    await page.waitForTimeout(300);
    const folded = await layoutState();

    assert.equal(await isCollapsed(), true, 'collapse is recorded on the frame');
    assert.equal(await page.locator('.clt-collapse').textContent(), '▾', 'the chevron points down while collapsed');
    assert.equal(await page.locator('.clt-cell').count(), 0, 'cells stop rendering when collapsed');
    assert.ok(await page.locator('.clt-divider').count() > 0, 'column dividers render when collapsed');
    assert.equal(await page.getByRole('button', { name: 'Expand grid', exact: true }).count(), 1, 'the chevron flips to expand');
    assert.ok(folded.nodes.every(([, , isFolded]) => isFolded), 'every contained node folds to its title bar');

    assert.notEqual(folded.nodes[0][1][0], folded.nodes[1][1][0], 'nodes maintain separate column positions');
    const titleHeight = 30;
    assert.equal(folded.nodes[0][1][1], folded.frame.pos[1] + FRAME_TITLE + titleHeight, 'column 1 node is flush under header');
    assert.equal(folded.nodes[1][1][1], folded.frame.pos[1] + FRAME_TITLE + titleHeight, 'column 2 node is flush under header');
    assert.equal(folded.frame.size[1], FRAME_TITLE + titleHeight + PAD, 'the border wraps the tallest column');

    // In Nodes 2.0 the titles are real DOM; confirm they sit side-by-side in their columns.
    if (vue) {
      const rects = await page.evaluate(() => {
        const app = window.comfyAPI.app.app;
        return app.graph._nodes
          .map(n => document.querySelector(`.lg-node[data-node-id="${CSS.escape(String(n.id))}"]`))
          .filter(Boolean)
          .map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })
          .sort((a, b) => a.top - b.top);
      });
      assert.equal(rects.length, folded.nodes.length, 'every folded node renders a DOM element');
      assert.ok(Math.abs(rects[0].top - rects[1].top) <= 2, 'column titles start at the same top under the header');
      const frameRect = await page.locator('.clt-frame').first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      assert.ok(rects[0].bottom <= frameRect.bottom + 2, 'the titles sit inside the frame border');
    }

    // Dragging the collapsed frame must carry its folded children along.
    const header = await page.locator('.clt-frame-header').first().boundingBox();
    await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(header.x + header.width / 2 + 70, header.y + header.height / 2 + 50, { steps: 8 });
    await page.mouse.up();
    await settle();
    await page.waitForTimeout(300);
    const dragged = await layoutState();
    const frameDelta = [dragged.frame.pos[0] - folded.frame.pos[0], dragged.frame.pos[1] - folded.frame.pos[1]];
    assert.ok(frameDelta[0] > 10 && frameDelta[1] > 10, 'the frame actually moved');
    for (const [id, pos] of dragged.nodes) {
      const was = folded.nodes.find(n => String(n[0]) === String(id))[1];
      const nodeDelta = [pos[0] - was[0], pos[1] - was[1]];
      assert.ok(Math.abs(nodeDelta[0] - frameDelta[0]) <= 2 && Math.abs(nodeDelta[1] - frameDelta[1]) <= 2, `child ${id} travels with the frame`);
    }

    // Expanding unfolds everything and restores the frame-relative layout.
    await page.getByRole('button', { name: 'Expand grid', exact: true }).click();
    await settle();
    await page.waitForTimeout(300);
    const restored = await layoutState();
    assert.equal(await isCollapsed(), false);
    assert.ok(restored.nodes.every(([, , isFolded]) => !isFolded), 'expanding unfolds every node');
    assert.ok(await page.locator('.clt-cell').count() > 0, 'cells render again');
    const original = new Map(before.nodes.map(([id, pos]) => [String(id), [pos[0] - before.frame.pos[0], pos[1] - before.frame.pos[1]]]));
    for (const [id, pos] of restored.nodes) {
      const want = original.get(String(id));
      const got = [pos[0] - restored.frame.pos[0], pos[1] - restored.frame.pos[1]];
      assert.ok(want && Math.abs(got[0] - want[0]) <= 1 && Math.abs(got[1] - want[1]) <= 1, `node ${id} returns to its layout position`);
    }

    // A node the user had folded themselves must not be reopened by expand.
    const ids = restored.nodes.map(([id]) => id);
    await setFolded([ids[0]]);
    await settle();
    await page.getByRole('button', { name: 'Collapse grid', exact: true }).click();
    await settle();
    const afterFold = Object.fromEntries(await foldedFlags());
    assert.equal(afterFold[ids[0]], true, 'the user-folded node stays folded while collapsed');
    await page.getByRole('button', { name: 'Expand grid', exact: true }).click();
    await settle();
    const afterExpand = Object.fromEntries(await foldedFlags());
    assert.equal(afterExpand[ids[0]], true, 'the user-folded node stays folded after expand');
    assert.equal(afterExpand[ids[1]], false, 'the frame-folded node is reopened');
    await setFolded([]);
    await settle();

    // Undo and redo both step through the collapse.
    await page.getByRole('button', { name: 'Collapse grid', exact: true }).click();
    await settle();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].collapsed !== true);
    // The model updates before the overlay repaints; wait on the DOM.
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length > 0, { timeout: 5000 });
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].collapsed === true);
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 0, { timeout: 5000 });
    await page.getByRole('button', { name: 'Expand grid', exact: true }).click();
    await settle();
    assert.equal((await foldedFlags()).some(([, isFolded]) => isFolded), false, 'redo then expand leaves no node folded');
    assert.ok((await frameHeight()) > FRAME_TITLE, 'the frame is not stranded at the collapsed height');

    // A collapsed frame stays collapsed across a save/load round trip.
    await page.getByRole('button', { name: 'Collapse grid', exact: true }).click();
    await settle();
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.comfyAPI.app.app.graph.serialize())));
    await page.evaluate(async saved => { await window.comfyAPI.app.app.loadGraphData(saved); }, saved);
    await page.locator('.p-blockui-mask-document').waitFor({ state: 'hidden' });
    await settle();
    assert.equal(await isCollapsed(), true, 'collapse persists through a workflow save/load round trip');
    assert.equal(await page.locator('.clt-cell').count(), 0, 'a reloaded collapsed frame renders no cells');

    // Expand grid via header button.
    await page.getByRole('button', { name: 'Expand grid', exact: true }).click();
    await settle();
    assert.equal(await isCollapsed(), false, 'expanding restores the frame');
    assert.ok((await frameHeight()) > FRAME_TITLE, 'expanding restores the content height');

    await page.screenshot({ path: `test-results/collapse-${vue ? 'nodes-2' : 'classic'}.png` });
    console.log(`Frame collapse checks passed: ${mode}`);
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
} finally { await browser.close(); }