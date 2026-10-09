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

  // Click Grid options
  const gridOptionsBtn = page.getByRole('button', { name: 'Grid options', exact: true });
  await gridOptionsBtn.click();
  await page.waitForTimeout(200);

  // Click Change Appearance...
  const changeAppearanceItem = page.getByRole('menuitem', { name: /Change Appearance/ });
  await changeAppearanceItem.click();
  await page.waitForTimeout(300);

  const dialog = page.locator('dialog.clt-dialog');
  await assert.ok(await dialog.isVisible(), 'Appearance dialog should be visible');

  // Verify top-level tabs
  const topTabs = dialog.locator('.clt-tabs .clt-tab');
  const tabTexts = await topTabs.allTextContents();
  console.log('Top tabs found:', tabTexts);
  assert.deepEqual(tabTexts, ['Title Bar', 'Border', 'Grid Container']);

  // Take screenshot of Title Bar tab
  await page.screenshot({ path: 'test-results/tabs-title-tab.png' });
  console.log('Saved test-results/tabs-title-tab.png');

  // Switch to Border tab
  await topTabs.nth(1).click();
  await page.waitForTimeout(200);
  assert.ok(await dialog.locator('label:has-text("Border color")').isVisible(), 'Border color visible');
  assert.ok(await dialog.locator('label:has-text("Border thickness")').isVisible(), 'Border thickness visible');
  await page.screenshot({ path: 'test-results/tabs-border-tab.png' });
  console.log('Saved test-results/tabs-border-tab.png');

  // Switch to Grid Container tab
  await topTabs.nth(2).click();
  await page.waitForTimeout(200);

  // Verify child tabs
  const childTabs = dialog.locator('.clt-child-tabs .clt-child-tab');
  const childTabTexts = await childTabs.allTextContents();
  console.log('Child tabs found:', childTabTexts);
  assert.deepEqual(childTabTexts, ['Color', 'Custom Image']);

  // Verify Color child panel elements
  assert.ok(await dialog.locator('label:has-text("Container background color")').isVisible(), 'Container color visible');
  assert.ok(await dialog.locator('label:has-text("Container opacity")').isVisible(), 'Container opacity visible');
  assert.ok(await dialog.locator('label:has-text("Repeating pattern")').isVisible(), 'Repeating pattern dropdown visible');
  await page.screenshot({ path: 'test-results/tabs-container-color.png' });
  console.log('Saved test-results/tabs-container-color.png');

  // Switch to Custom Image child tab
  await childTabs.nth(1).click();
  await page.waitForTimeout(200);

  // Verify Custom Image child panel elements
  assert.ok(await dialog.locator('label:has-text("Custom image")').isVisible(), 'Custom image visible');
  assert.ok(await dialog.locator('label:has-text("Image display mode")').isVisible(), 'Image display mode visible');
  assert.ok(await dialog.locator('label:has-text("Image opacity")').isVisible(), 'Image opacity visible');
  await page.screenshot({ path: 'test-results/tabs-container-image.png' });
  console.log('Saved test-results/tabs-container-image.png');

  // Test Reset button
  const resetBtn = dialog.getByRole('button', { name: 'Reset appearance configuration' });
  await resetBtn.click();
  await page.waitForTimeout(200);

  // Cancel dialog
  const cancelBtn = dialog.getByRole('button', { name: 'Cancel' });
  await cancelBtn.click();
  await page.waitForTimeout(300);

  console.log('ALL TAB UI CHECKS PASSED SUCCESSFULLY!');
} finally {
  await browser.close();
}
