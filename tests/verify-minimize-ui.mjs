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
  await page.screenshot({ path: 'test-results/grid-expanded.png' });
  console.log('Saved test-results/grid-expanded.png');

  // Click minimize
  console.log('Clicking minimize button...');
  await minimizeBtn.click();
  await page.waitForTimeout(500);

  // Verify minimized state
  const minimizedBox = await frameEl.boundingBox();
  console.log('Minimized frame height:', minimizedBox.height);
  // Header is 34px, border is 2px top + 2px bottom = 38px, or FRAME_TITLE 36px
  assert.ok(minimizedBox.height <= 40, `Minimized height should be <= 40px, got ${minimizedBox.height}`);

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
  assert.ok(hiddenInfo.hiddenSize > 0 || hiddenInfo.minimizedNodes > 0, 'Contained nodes should be marked hidden');

  // Take screenshot of minimized state
  await page.screenshot({ path: 'test-results/minimize-verification.png' });
  console.log('Saved test-results/minimize-verification.png');

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
  await page.screenshot({ path: 'test-results/restore-verification.png' });
  console.log('Saved test-results/restore-verification.png');

  console.log('ALL MINIMIZE/RESTORE CHECKS PASSED SUCCESSFULLY!');
} finally {
  await browser.close();
}
