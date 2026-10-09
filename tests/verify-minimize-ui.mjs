import playwright from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';

const exampleWorkflow = JSON.parse(await readFile(new URL('../examples/two-column.workflow.json', import.meta.url), 'utf8'));

await mkdir('test-results', { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', err => console.error('Page error:', err.message));

try {
  await page.goto('http://127.0.0.1:8188', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 30000 });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.extensions?.some(e => e.name === 'VF.ComfyUI.GridLayout'), { timeout: 30000 });
  await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 30000 });

  await page.evaluate(async (workflow) => {
    const app = window.comfyAPI.app.app;
    await app.handleFile(new File([JSON.stringify(workflow)], 'two-column.workflow.json', { type: 'application/json' }));
  }, exampleWorkflow);

  await page.waitForTimeout(1000);

  // Add an external node connected to Node 1 inside the grid container to test external output wiring,
  // and set a custom 6px border like in the user's screenshot.
  await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const LiteGraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    const node1 = app.graph.getNodeById(1);
    
    // Create an external node outside the grid
    const extNode = LiteGraph.createNode('SaveImage');
    extNode.pos = [1050, 216];
    app.graph.add(extNode);
    
    // Connect Node 1 (slot 0) to extNode (slot 0)
    node1.connect(0, extNode, 0);

    // Apply custom 6px dotted border to the frame
    const ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    const frame = ext.controller.frames[0];
    if (frame) {
      frame.border = { color: '#595f95', width: 6, style: 'dotted' };
      ext.controller.reflow();
    }
  });

  await page.waitForTimeout(500);

  // Locate the grid frame and minimize button
  const frameEl = page.locator('.clt-frame').first();
  await assert.ok(await frameEl.isVisible(), 'Grid frame should be visible');

  const initialBox = await frameEl.boundingBox();
  console.log('Initial frame height:', initialBox.height);
  assert.ok(initialBox.height > 100, 'Frame height should be larger than 100px initially');

  const minimizeBtn = frameEl.locator('.clt-minimize');
  await assert.ok(await minimizeBtn.isVisible(), 'Minimize button should be visible in header');
  assert.equal(await minimizeBtn.textContent(), '−');
  assert.equal(await minimizeBtn.getAttribute('title'), 'Minimize grid');

  // Verify cells and dividers exist initially
  const initialCells = await page.locator('.clt-cell').count();
  console.log('Initial cell count:', initialCells);
  assert.ok(initialCells > 0, 'Cells should exist initially');

  // Take screenshot of expanded state
  await page.screenshot({ path: 'test-results/grid-expanded-with-ext-node.png' });
  console.log('Saved test-results/grid-expanded-with-ext-node.png');

  // Click minimize
  console.log('Clicking minimize button...');
  await minimizeBtn.click();
  await page.waitForTimeout(500);

  // Verify minimized state
  const minimizedBox = await frameEl.boundingBox();
  console.log('Minimized frame height:', minimizedBox.height);
  // With 6px border: 34 + 6*2 = 46px (scaled by canvas zoom 0.8 => ~36.8px)
  assert.ok(minimizedBox.height >= 30 && minimizedBox.height <= 55, `Minimized height should fit 46px border box, got ${minimizedBox.height}`);

  assert.equal(await minimizeBtn.textContent(), '◻');
  assert.equal(await minimizeBtn.getAttribute('title'), 'Restore grid');

  // Verify cells and dividers are removed while minimized
  const minimizedCells = await page.locator('.clt-cell').count();
  console.log('Minimized cell count:', minimizedCells);
  assert.equal(minimizedCells, 0, 'No cells should be rendered when minimized');

  // Verify collapse button is disabled while minimized
  const collapseBtn = frameEl.locator('.clt-collapse');
  const collapseStyle = await collapseBtn.getAttribute('style');
  assert.ok(collapseStyle.includes('pointer-events: none'), 'Collapse button should be disabled when minimized');

  // Verify consolidated port is rendered!
  const outPort = frameEl.locator('.clt-port-out');
  await assert.ok(await outPort.isVisible(), 'Consolidated output port should be visible');
  const outPortTitle = await outPort.getAttribute('title');
  console.log('Output port title:', outPortTitle);
  assert.ok(outPortTitle.includes('Output'), 'Output port title should mention Output');
  assert.ok(outPortTitle.includes('Empty Image') || outPortTitle.includes('EmptyImage'), 'Output port should list Empty Image');

  // Verify hiddenNodeIds and frame minimized state
  const hiddenInfo = await page.evaluate(() => {
    const ext = window.comfyAPI.app.app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    const hiddenSize = ext?.overlay?.hiddenNodeIds?.size ?? 0;
    const frame = window.comfyAPI.app.app.graph.extra?.comfyui_grid_layout?.frames?.[0];
    return {
      hiddenSize,
      minimized: frame?.minimized === true,
      minimizedNodes: frame?.minimizedNodes?.length ?? 0
    };
  });
  console.log('Hidden info:', hiddenInfo);
  assert.ok(hiddenInfo.minimized, 'Frame should have minimized = true');
  assert.equal(hiddenInfo.minimizedNodes, 2, 'Two contained nodes should be recorded');

  // Take screenshot of minimized state with ports and custom border
  await page.screenshot({ path: 'test-results/minimized-with-ports-and-custom-border.png' });
  console.log('Saved test-results/minimized-with-ports-and-custom-border.png');

  // Click restore (the minimize button again)
  console.log('Clicking restore button...');
  await minimizeBtn.click();
  await page.waitForTimeout(500);

  // Verify restored state
  const restoredBox = await frameEl.boundingBox();
  console.log('Restored frame height:', restoredBox.height);
  assert.ok(Math.abs(restoredBox.height - initialBox.height) < 5, 'Restored height should match initial height');

  assert.equal(await minimizeBtn.textContent(), '−');
  assert.equal(await minimizeBtn.getAttribute('title'), 'Minimize grid');

  const restoredCells = await page.locator('.clt-cell').count();
  console.log('Restored cell count:', restoredCells);
  assert.equal(restoredCells, initialCells, 'Cells should be restored');

  // Output port should no longer be present
  assert.equal(await frameEl.locator('.clt-port-out').count(), 0, 'Port dots should disappear when restored');

  const restoredInfo = await page.evaluate(() => {
    const ext = window.comfyAPI.app.app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    const hiddenSize = ext?.overlay?.hiddenNodeIds?.size ?? 0;
    const frame = window.comfyAPI.app.app.graph.extra?.comfyui_grid_layout?.frames?.[0];
    return {
      hiddenSize,
      minimized: frame?.minimized === true,
    };
  });
  console.log('Restored info:', restoredInfo);
  assert.equal(restoredInfo.minimized, false, 'Frame should not be minimized after restore');
  assert.equal(restoredInfo.hiddenSize, 0, 'No nodes should be hidden after restore');

  // Take screenshot of restored state
  await page.screenshot({ path: 'test-results/restored-with-ext-node.png' });
  console.log('Saved test-results/restored-with-ext-node.png');

  console.log('ALL MINIMIZE, BORDER AND PORT CHECKS PASSED SUCCESSFULLY!');
} finally {
  await browser.close();
}
