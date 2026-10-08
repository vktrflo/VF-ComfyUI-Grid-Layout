// Renders icon.png (800x400) for the Comfy Registry / ComfyUI-Manager listing.
// The motif is the extension's own frame: a teal 🌀 header bar above split cells.
//   node tools/make-icon.mjs
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);

const W=800,H=400,TEAL='#54e3b5',BG='#101820',PANEL='#17252b',BLOCK='#33485a',LINE='#4a6a7d';
// One cell column: x offset, top offset, and the stacked node blocks inside it.
const columns=[
 {x:12,w:158,blocks:[[0,58],[0,116]]},
 {x:176,w:158,blocks:[[0,58],[0,116],[0,174]]},
 {x:340,w:156,blocks:[[0,58]]},
];
const html=`<!doctype html><meta charset="utf-8"><style>
 *{margin:0;padding:0;box-sizing:border-box}
 html,body{width:${W}px;height:${H}px;background:${BG};overflow:hidden}
 body{font-family:"Segoe UI Emoji","Apple Color Emoji",sans-serif;display:grid;place-items:center}
 .glow{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(62% 92% at 22% 10%,${TEAL}26,transparent 72%)}
 .frame{position:relative;width:508px;height:236px;border:2px solid ${TEAL};border-radius:12px;background:${PANEL};box-shadow:0 0 44px ${TEAL}22}
 .head{height:40px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:2px solid ${TEAL};background:#1b2b34}
 .swirl{font-size:19px;line-height:1}
 .title{width:104px;height:8px;border-radius:4px;background:${TEAL};opacity:.85}
 .sub{width:58px;height:7px;border-radius:4px;background:${LINE}}
 .grid{position:absolute;left:12px;right:12px;top:52px;bottom:12px;display:flex;gap:6px}
 .cell{position:relative;border:1px dashed ${LINE};border-radius:8px;background:#131f26}
 .blk{position:absolute;left:8px;right:8px;border-radius:6px;background:${BLOCK};border:1px solid ${LINE}}
</style>
<div class="glow">
 <div class="frame">
  <div class="head"><span class="swirl">🌀</span><span class="title"></span><span class="sub"></span></div>
  <div class="grid">
   ${columns.map(c=>`<div class="cell" style="width:${c.w}px">${c.blocks.map(b=>`<div class="blk" style="top:${b[0]}px;height:${b[1]}px"></div>`).join('')}</div>`).join('')}
  </div>
 </div>
</div>`;

const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
await page.setContent(html,{waitUntil:'load'});
await page.evaluate(()=>document.fonts.ready);
await page.screenshot({path:fileURLToPath(new URL('../icon.png',import.meta.url))});
await browser.close();
console.log('Wrote icon.png ('+W+'x'+H+')');