import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,slowMo:120});
const prefix='/extensions/VF-ComfyUI-Grid-Layout/';
const clips=[];
async function run(name,title,subtitle,setup,actions){
 const context=await browser.newContext({viewport:{width:1080,height:850},recordVideo:{dir:'recordings/raw',size:{width:1080,height:850}}});
 const page=await context.newPage();
 // Capture a visible pointer: headless browser videos omit the system cursor.
 await page.addInitScript(()=>{
  const install=()=>{
   const style=document.createElement('style');
   style.textContent=`.demo-pointer{position:fixed;left:0;top:0;width:32px;height:32px;border:2px solid #fff;border-radius:50%;background:#54e3b533;box-shadow:0 0 0 2px #17252b;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px)}.demo-pointer::after{content:'';position:absolute;left:13px;top:13px;width:6px;height:6px;border-radius:50%;background:white;box-shadow:0 0 2px black}.demo-click{position:fixed;width:32px;height:32px;border:3px solid #54e3b5;border-radius:50%;pointer-events:none;z-index:2147483647;animation:demo-click .55s ease-out forwards}@keyframes demo-click{from{transform:scale(1);opacity:1}to{transform:scale(2.6);opacity:0}}`;
   document.head.append(style);
   const pointer=document.createElement('div');pointer.className='demo-pointer';document.body.append(pointer);
   document.addEventListener('pointermove',event=>{pointer.style.transform=`translate(${event.clientX-18}px,${event.clientY-18}px)`;},true);
   document.addEventListener('pointerdown',event=>{pointer.style.transform=`translate(${event.clientX-18}px,${event.clientY-18}px)`;const ring=document.createElement('div');ring.className='demo-click';ring.style.left=`${event.clientX-19}px`;ring.style.top=`${event.clientY-19}px`;document.body.append(ring);setTimeout(()=>ring.remove(),600);},true);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
 });
 await page.route('**/extensions',route=>route.fulfill({json:[prefix+'grid_layout.js']}));
 await page.route(`**${prefix}**`,async route=>{const rel=new URL(route.request().url()).pathname.slice(prefix.length);await route.fulfill({contentType:'text/javascript',body:await readFile(fileURLToPath(new URL('../web/'+rel,import.meta.url)))});});
 await page.route('**/object_info',async route=>{const response=await page.request.get('http://127.0.0.1:8188/object_info');await route.fulfill({response});});
 await page.goto('http://127.0.0.1:8197',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.comfyAPI?.app?.app?.canvas);
 await page.locator('.clt-overlay').waitFor({state:'attached'});
 await page.evaluate(async()=>{const app=window.comfyAPI.app.app;await app.ui.settings.setSettingValue('Comfy.VueNodes.Enabled',false);await app.ui.settings.setSettingValue('Comfy.Canvas.SelectionToolbox',true);await app.ui.settings.setSettingValue('Comfy.Minimap.Visible',false);const workflow=structuredClone(window.comfyAPI.defaultGraph.defaultGraph);await app.loadGraphData(workflow);app.extensionManager?.toast?.removeAll?.();});
 await page.locator('.p-blockui-mask-document').waitFor({state:'hidden'});
 await page.addStyleTag({content:'.side-toolbar-container{display:none!important}.comfyui-menu{display:none!important}'});
 const fit=async()=>page.evaluate(async()=>{const app=window.comfyAPI.app.app;const f=app.graph.extra.comfyui_grid_layout?.frames?.[0] ?? app.graph.extra.comfyui_layout_templates?.frames?.[0];let x,y,w,h;if(f){[x,y]=f.pos;[w,h]=f.size;}else{const ns=app.graph._nodes;x=Math.min(...ns.map(n=>n.pos[0]));y=Math.min(...ns.map(n=>n.pos[1]-30));w=Math.max(...ns.map(n=>n.pos[0]+n.size[0]))-x;h=Math.max(...ns.map(n=>n.pos[1]+n.size[1]))-y;}
 const scale=Math.min(970/w,660/h,1);app.canvas.ds.scale=scale;app.canvas.ds.offset=[(1080/scale-w)/2-x,(850/scale-h)/2-y+25];app.canvas.setDirty(true,true);});
 const baseline=async()=>{await page.evaluate(async()=>{const {LayoutController}=await import('/extensions/VF-ComfyUI-Grid-Layout/core/controller.js');const app=window.comfyAPI.app.app;const c=new LayoutController(app);c.createFromNodes(app.graph._nodes.map(n=>n.id),'columns');});await fit();};
 const menu=async(name)=>{await page.getByRole('button',{name:'Grid options',exact:true}).click();await page.waitForTimeout(2200);await page.getByRole('menuitem',{name,exact:true}).hover();await page.waitForTimeout(900);await page.getByRole('menuitem',{name,exact:true}).click();};
 const pause=ms=>page.waitForTimeout(ms*2);
 const drag=async(locator,dx,dy)=>{const b=await locator.boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:35});await page.mouse.up();};
 const helpers={fit,baseline,menu,pause,drag};
 await setup(page,helpers);await pause(500);
 const started=Date.now();await pause(1000);await actions(page,helpers);await pause(1800);
 const seconds=(Date.now()-started)/1000;
 await page.screenshot({path:`recordings/${name}-preview.png`});
 const video=page.video();await context.close();const path=await video.path();clips.push({name,title,subtitle,path,seconds});console.log('Recorded '+name);
}
try{
 await run('01-instant-layout','MESSY NODES? ONE CLICK.','Select nodes. Create a layout. Keep every connection.',async(p,h)=>{await h.fit();},async(p,h)=>{
 const count=await p.evaluate(()=>window.comfyAPI.app.app.graph._nodes.length);
 for(let index=0;index<count;index++){
  const point=await p.evaluate(index=>{const app=window.comfyAPI.app.app;const n=app.graph._nodes[index];const ds=app.canvas.ds;return {x:(n.pos[0]+n.size[0]/2+ds.offset[0])*ds.scale,y:(n.pos[1]+ds.offset[1])*ds.scale};},index);
  await p.mouse.move(point.x,point.y,{steps:10});
  await p.evaluate(index=>{const app=window.comfyAPI.app.app;app.canvas.selectNodes(app.graph._nodes.slice(0,index+1));},index);
  await h.pause(250);
 }
 await h.pause(900);
 await p.locator('.selection-toolbox').getByRole('button',{name:'Create layout from selected nodes',exact:true}).click();await h.pause(800);
 await p.getByRole('menuitem',{name:'Preserve columns',exact:true}).click();await h.fit();await h.pause(2500);
 });
 await run('02-split-cells','MAKE ROOM FOR MORE.','Split cells. Add rows. Build your own workspace.',async(p,h)=>{await h.baseline();},async(p,h)=>{
 await p.getByRole('button',{name:'Cell options',exact:true}).last().click();await h.pause(600);await p.getByRole('menuitem',{name:'Split into top / bottom',exact:true}).click();await h.fit();await h.pause(1300);
 await h.menu('Add bottom row');await h.fit();await h.pause(1500);
 await p.getByRole('button',{name:'Cell options',exact:true}).last().click();await h.pause(500);await p.getByRole('menuitem',{name:'Split into left / right',exact:true}).click();await h.pause(1800);
 });
 await run('03-live-appearance','YOUR WORKFLOW. YOUR STYLE.','Live colors, type and borders. Nothing permanent until OK.',async(p,h)=>{await h.baseline();},async(p,h)=>{
 await h.menu('Change Appearance\u2026');await h.pause(700);
 await p.getByRole('slider',{name:'Font size',exact:true}).focus();await p.keyboard.press('End');await h.pause(1200);
 await p.getByLabel('Background color',{exact:true}).evaluate(el=>{el.value='#204c59';el.dispatchEvent(new Event('input',{bubbles:true}));});await h.pause(1000);
 await p.getByRole('slider',{name:'Border thickness',exact:true}).focus();await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight');await h.pause(600);
 await p.getByLabel('Border color',{exact:true}).evaluate(el=>{el.value='#54e3b5';el.dispatchEvent(new Event('input',{bubbles:true}));});await p.getByLabel('Border style',{exact:true}).selectOption('dashed');await h.pause(1400);
 await p.locator('dialog').getByRole('button',{name:'OK',exact:true}).click();await h.pause(1800);
 });
 await run('04-inline-titles','NAME IT. ORGANIZE IT.','Double-click any title. Edit right on the canvas.',async(p,h)=>{await h.baseline();},async(p,h)=>{
 await p.locator('.clt-frame-header .clt-label').dblclick();await p.getByRole('textbox',{name:'Frame title',exact:true}).pressSequentially('My creative workspace',{delay:75});await p.keyboard.press('Enter');await h.pause(1200);
 await p.locator('.clt-cell-header .clt-label').first().dblclick();await p.getByRole('textbox',{name:'Cell title',exact:true}).pressSequentially('MODEL + PROMPTS',{delay:85});await p.keyboard.press('Enter');await h.pause(1800);
 });
 await run('05-resize-and-shrink','LESS CLUTTER. MORE CONTROL.','Resize an edge. Fit every cell back to its controls.',async(p,h)=>{await h.baseline();},async(p,h)=>{
 await h.drag(p.locator('.clt-resize-x'),65,0);await h.pause(1500);await h.menu('Shrink layout to content');await h.pause(1700);
 await h.drag(p.locator('.clt-resize-left'),-45,0);await h.pause(1500);await h.menu('Shrink layout to content');await h.pause(1600);
 });
 await run('06-fill-and-undo','CLEAN LAYOUT. ZERO COMMITMENT.','Fill cell heights. Undo. Redo. Stay in control.',async(p,h)=>{await h.baseline();},async(p,h)=>{
 await h.menu('Fill cell height');await h.pause(2100);await h.menu('Undo Fill cell height');await h.pause(1700);await p.keyboard.press('Control+z');await h.pause(1400);await p.keyboard.press('Control+Shift+z');await h.pause(1600);
 });
}finally{await writeFile('recordings/clips.json',JSON.stringify(clips,null,2));await browser.close();}
