// Probe: why doesn't the overlay mount on the live instance?
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require('playwright');

const base = process.env.PROBE_URL ?? 'http://127.0.0.1:8188';
const browser = await playwright.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`[pageerror] ${(e.stack || e.message || '').slice(0, 600)}`));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 90000 });
  console.log('canvas ready');
  for (let i = 1; i <= 12; i++) {
    const state = await page.evaluate(() => ({
      overlay: document.querySelectorAll('.clt-overlay').length,
      frames: document.querySelectorAll('.clt-frame').length,
      registered: window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.LayoutTemplates'),
    }));
    console.log(`t=${i * 5}s`, JSON.stringify(state));
    if (state.overlay > 0) break;
    await page.waitForTimeout(5000);
  }
  if (errors.length) console.log('=== errors ===\n' + errors.slice(0, 12).join('\n\n'));
  else console.log('no errors captured');
  await context.close();
} finally { await browser.close(); }
