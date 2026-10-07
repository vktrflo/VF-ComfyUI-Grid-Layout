import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require('playwright');
const browser = await playwright.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8188', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 90000 });
  const info = await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    return {
      getNodeOnPos: typeof app.graph.getNodeOnPos,
      graphProto: Object.getOwnPropertyNames(Object.getPrototypeOf(app.graph)).filter(n => /node/i.test(n)).slice(0, 20),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await context.close();
} finally { await browser.close(); }
