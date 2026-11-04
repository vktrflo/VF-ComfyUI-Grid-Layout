// Records the README demo clips into recordings/demos, one mp4 per clip.
// Run tools/export-gifs.py afterward to encode them into docs/media.
//
// Usage: node tools/record-demos.mjs [clip-prefix ...]   e.g. 03 07
// Env: COMFYUI_URL (default http://127.0.0.1:8197), PLAYWRIGHT_MODULE.
// The page keeps every change local: POST/PUT calls to the server are stubbed.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const BASE=process.env.COMFYUI_URL ?? 'http://127.0.0.1:8197';
const W=1080,H=706;
const OUT='recordings/demos';
const prefix='/extensions/VF-ComfyUI-Grid-Layout/';
const only=process.argv.slice(2);
const browser=await chromium.launch({headless:true});
await mkdir(OUT,{recursive:true});
const clips=[];

// Headless captures omit the system cursor, so draw one with the page.
function demoChrome(){
 const install=()=>{
  const style=document.createElement('style');
  style.textContent=`.demo-pointer{position:fixed;left:0;top:0;width:32px;height:32px;border:2px solid #fff;border-radius:50%;background:#54e3b533;box-shadow:0 0 0 2px #17252b;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px)}.demo-pointer::after{content:'';position:absolute;left:13px;top:13px;width:6px;height:6px;border-radius:50%;background:white;box-shadow:0 0 2px black}.demo-click{position:fixed;width:32px;height:32px;border:3px solid #54e3b5;border-radius:50%;pointer-events:none;z-index:2147483647;animation:demo-click .55s ease-out forwards}@keyframes demo-click{from{transform:scale(1);opacity:1}to{transform:scale(2.6);opacity:0}}
.demo-badge{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);padding:10px 20px;border-radius:10px;background:#101820f0;border:2px solid #54e3b5;color:#fff;font:600 24px system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:2147483646;opacity:0;transition:opacity .2s}.demo-badge.show{opacity:1}
.demo-tip{position:fixed;max-width:520px;padding:10px 14px;border-radius:8px;background:#101820f2;border:1px solid #54e3b5;color:#e8f3f0;font:500 18px/1.45 system-ui,sans-serif;white-space:pre;pointer-events:none;z-index:2147483646;display:none}
.side-toolbar-container,.comfyui-menu,.workflow-tabs-container,.p-toast,.bottom-panel{display:none!important}`;
  document.head.append(style);
  const pointer=document.createElement('div');pointer.className='demo-pointer';document.body.append(pointer);
  const badge=document.createElement('div');badge.className='demo-badge';document.body.append(badge);
  const tip=document.createElement('div');tip.className='demo-tip';document.body.append(tip);
  let timer;
  window.demoBadge=(text,ms=0)=>{clearTimeout(timer);badge.textContent=text;badge.classList.toggle('show',Boolean(text));if(ms)timer=setTimeout(()=>badge.classList.remove('show'),ms);};
  document.addEventListener('pointermove',event=>{
   pointer.style.transform=`translate(${event.clientX-18}px,${event.clientY-18}px)`;
   // Native title tooltips do not render headless, and ports explain themselves through them.
   const port=document.elementsFromPoint(event.clientX,event.clientY).find(el=>el.classList?.contains('clt-port'));
   if(port){tip.textContent=port.title;tip.style.display='block';const box=port.getBoundingClientRect();tip.style.left=`${Math.max(16,Math.min(innerWidth-tip.offsetWidth-16,event.clientX-tip.offsetWidth/2))}px`;tip.style.top=`${box.bottom+22}px`;}
   else tip.style.display='none';
  },true);
  document.addEventListener('pointerdown',event=>{pointer.style.transform=`translate(${event.clientX-18}px,${event.clientY-18}px)`;const ring=document.createElement('div');ring.className='demo-click';ring.style.left=`${event.clientX-19}px`;ring.style.top=`${event.clientY-19}px`;document.body.append(ring);setTimeout(()=>ring.remove(),600);},true);
  document.addEventListener('keydown',event=>{if(!event.ctrlKey||['Control','Shift'].includes(event.key))return;window.demoBadge([event.ctrlKey&&'Ctrl',event.shiftKey&&'Shift',event.key.toUpperCase()].filter(Boolean).join(' + '),1300);},true);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
}

// Runs in the page. messy=true scatters the nodes for the "before" state.
function buildGraph(messy){
 const app=window.comfyAPI.app.app;const LG=window.LiteGraph ?? window.comfyAPI.litegraph.LiteGraph;
 app.graph.clear();
 const spots=[
  ['ckpt','CheckpointLoaderSimple','Load Checkpoint',[0,0],[30,300],[270,100]],
  ['latent','EmptyLatentImage','Empty Latent',[0,200],[-40,40],[270,110]],
  ['pos','CLIPTextEncode','Positive prompt',[300,0],[390,330],[280,150]],
  ['neg','CLIPTextEncode','Negative prompt',[300,210],[300,60],[280,150]],
  ['ks','KSampler','KSampler',[610,0],[690,110],[270,262]],
  ['dec','VAEDecode','VAE Decode',[910,0],[1010,330],[210,50]],
  ['save','SaveImage','Save Image',[910,120],[960,50],[210,100]],
 ];
 const n={};
 for(const [key,type,title,tidy,scattered,size] of spots){const node=LG.createNode(type);app.graph.add(node);node.title=title;node.pos=[...(messy?scattered:tidy)];node.size=[...size];n[key]=node;}
 const wire=(a,out,b,inp)=>a.connect(a.findOutputSlot(out),b,b.findInputSlot(inp));
 wire(n.ckpt,'CLIP',n.pos,'clip');wire(n.ckpt,'CLIP',n.neg,'clip');wire(n.ckpt,'MODEL',n.ks,'model');wire(n.pos,'CONDITIONING',n.ks,'positive');wire(n.neg,'CONDITIONING',n.ks,'negative');
 wire(n.latent,'LATENT',n.ks,'latent_image');wire(n.ks,'LATENT',n.dec,'samples');wire(n.ckpt,'VAE',n.dec,'vae');wire(n.dec,'IMAGE',n.save,'images');
 n.ckpt.widgets[0].value='sd_xl_base_1.0.safetensors';
 n.pos.widgets[0].value='cinematic portrait of a red fox in a misty forest, golden hour, 35mm';
 n.neg.widgets[0].value='blurry, lowres, watermark';
 for(const node of app.graph._nodes)node.has_errors=false;
 window.demoNodes=Object.fromEntries(Object.entries(n).map(([key,node])=>[key,node.id]));
 app.canvas.setDirty(true,true);
}

async function openPage(){
 const context=await browser.newContext({viewport:{width:W,height:H}});
 const page=await context.newPage();
 page.setDefaultTimeout(30000);
 page.on('pageerror',error=>console.log('pageerror:',error.message));
 await page.addInitScript(demoChrome);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='GET')return route.fulfill({status:200,json:{}});
  if(/\/api\/(view|history|jobs|queue)/.test(url.pathname))return route.fulfill({status:404,body:''});
  if(url.pathname==='/api/extensions'){const response=await route.fetch();const list=await response.json();return route.fulfill({response,json:[...list.filter(item=>item.startsWith('/extensions/core/')),prefix+'grid_layout.js']});}
  if(url.pathname==='/api/settings'){const response=await route.fetch();const json=await response.json();
   for(const id of Object.keys(json))if(id.startsWith('VF.'))delete json[id];
   Object.assign(json,{'Comfy.VueNodes.Enabled':false,'Comfy.Minimap.Visible':false,'Comfy.Canvas.SelectionToolbox':true,'Comfy.LinkRenderMode':2,'Comfy.Graph.CanvasInfo':false,'Comfy.TutorialCompleted':true,'Comfy.Workflow.ShowMissingModelsWarning':false,'Comfy.Workflow.ShowMissingNodesWarning':false,'Comfy.ColorPalette':'dark','Comfy.EnableTooltips':false,'LiteGraph.Canvas.LowQualityRenderingZoomThreshold':0.1,'VF.LinkEffects.Enabled':false});
   return route.fulfill({response,json});}
  if(url.pathname==='/api/object_info'){const response=await route.fetch();const json=await response.json();
   // The clips must not show the model names of the machine that records them.
   const spec=json.CheckpointLoaderSimple?.input?.required?.ckpt_name;
   if(spec){if(Array.isArray(spec[0]))spec[0]=['sd_xl_base_1.0.safetensors'];else if(spec[1]?.options)spec[1].options=['sd_xl_base_1.0.safetensors'];}
   return route.fulfill({response,json});}
  return route.fallback();
 });
 await page.route(`**${prefix}**`,async route=>{const rel=new URL(route.request().url()).pathname.slice(prefix.length);await route.fulfill({contentType:'text/javascript',body:await readFile(fileURLToPath(new URL('../web/'+rel,import.meta.url)))});});
 await page.goto(BASE,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.comfyAPI?.app?.app?.canvas,null,{timeout:90000});
 await page.waitForFunction(()=>window.comfyAPI.app.app.extensions.some(e=>e.name==='VF.ComfyUI.GridLayout'),null,{timeout:30000});
 await page.locator('.clt-overlay').waitFor({state:'attached'});
 await page.waitForSelector('[data-testid=app-loading-overlay]',{state:'hidden',timeout:90000}).catch(()=>{});
 await page.waitForTimeout(1500);
 await page.keyboard.press('Escape');
 // Floating panels change between frontend versions, so remove whatever covers the canvas edges.
 await page.evaluate(()=>{document.querySelectorAll('.p-dialog-mask').forEach(el=>el.remove());
  const canvas=document.querySelector('.graph-canvas-container canvas');
  for(const y of [8,30,55,80,105,130,innerHeight-110,innerHeight-80,innerHeight-50,innerHeight-25,innerHeight-6])for(let x=6;x<innerWidth;x+=30){
   let el=document.elementFromPoint(x,y);if(!el||el===canvas||el.closest('.clt-overlay')||el.closest('.demo-badge'))continue;
   while(el.parentElement&&!el.parentElement.contains(canvas))el=el.parentElement;if(!el.contains(canvas))el.style.setProperty('display','none','important');}});
 return {context,page};
}

function helpers(page){
 let cursor=[W/2,H+60];
 const ease=t=>t<.5?2*t*t:1-(-2*t+2)**2/2;
 const wait=ms=>page.waitForTimeout(ms);
 const moveTo=async(x,y,ms=700)=>{const [x0,y0]=cursor;const t0=Date.now();for(;;){const k=Math.min(1,(Date.now()-t0)/ms),t=ease(k);await page.mouse.move(x0+(x-x0)*t,y0+(y-y0)*t);if(k>=1)break;}cursor=[x,y];};
 const center=async locator=>{const box=await locator.boundingBox();if(!box)throw new Error('not visible: '+locator);return [box.x+box.width/2,box.y+box.height/2];};
 const clickHere=async()=>{await wait(200);await page.mouse.down();await wait(70);await page.mouse.up();await wait(250);};
 const clickAt=async(x,y,ms)=>{await moveTo(x,y,ms);await clickHere();};
 const click=async(locator,ms)=>{const [x,y]=await center(locator);await clickAt(x,y,ms);};
 const hover=async(locator,ms)=>{const [x,y]=await center(locator);await moveTo(x,y,ms);};
 const dragTo=async(x,y,ms=1200)=>{await page.mouse.down();await wait(120);await moveTo(x,y,ms);await wait(120);await page.mouse.up();};
 const dragBy=async(locator,dx,dy,ms=1200)=>{const [x,y]=await center(locator);await moveTo(x,y);await dragTo(x+dx,y+dy,ms);};
 const ext=`window.comfyAPI.app.app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout')`;
 const fit=async(ms=0,top=70,side=90)=>{
  await page.evaluate(({ms,W,H,top,side,ext})=>new Promise(done=>{const app=window.comfyAPI.app.app,ds=app.canvas.ds;const frames=(0,eval)(ext).controller.frames;
   const ns=app.graph._nodes;let x=Math.min(...ns.map(n=>n.pos[0])),y=Math.min(...ns.map(n=>n.pos[1]-30));let w=Math.max(...ns.map(n=>n.pos[0]+n.size[0]))-x,h=Math.max(...ns.map(n=>n.pos[1]+n.size[1]))-y;
   for(const f of frames){const x1=Math.max(x+w,f.pos[0]+f.size[0]),y1=Math.max(y+h,f.pos[1]+f.size[1]);x=Math.min(x,f.pos[0]);y=Math.min(y,f.pos[1]);w=x1-x;h=y1-y;}
   const s1=Math.min((W-side)/w,(H-top-50)/h,1),o1=[(W/s1-w)/2-x,((H+top-30)/s1-h)/2-y];
   const s0=ds.scale,o0=[...ds.offset],t0=performance.now();
   const apply=(s,o)=>{ds.scale=s;ds.offset=o;app.canvas.setDirty(true,true);};
   if(!ms){apply(s1,o1);done();return;}
   const step=now=>{let t=Math.min(1,(now-t0)/ms);t=t<.5?2*t*t:1-(-2*t+2)**2/2;apply(s0+(s1-s0)*t,[o0[0]+(o1[0]-o0[0])*t,o0[1]+(o1[1]-o0[1])*t]);if(t<1)requestAnimationFrame(step);else done();};requestAnimationFrame(step);
  }),{ms,W,H,top,side,ext});
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 };
 // keys limits the grid to those nodes. Pass autohide=true to keep the default of a new grid.
 const grid=async({keys,autohide=false}={})=>{
  await page.evaluate(({keys,autohide,ext})=>{const app=window.comfyAPI.app.app;const c=(0,eval)(ext).controller;
   const ids=keys?keys.map(key=>window.demoNodes[key]):app.graph._nodes.map(n=>n.id);const f=c.createFromNodes(ids,'columns');
   c.edit(()=>{const frame=c.frames.find(x=>x.id===f.id);frame.label='Grid';if(!autohide)delete frame.autohide;});
   app.canvas.deselectAll?.();app.canvas.setDirty(true,true);},{keys,autohide,ext});
  await fit();
 };
 const setting=(id,value)=>page.evaluate(async({id,value})=>{const s=window.comfyAPI.app.app.ui.settings;await (s.setSettingValueAsync?.(id,value) ?? s.setSettingValue(id,value));window.comfyAPI.app.app.canvas.setDirty(true,true);},{id,value});
 const badge=(text,ms=0)=>page.evaluate(({text,ms})=>window.demoBadge(text,ms),{text,ms});
 const nodePoint=(key,dx=70,dy=-15)=>page.evaluate(({key,dx,dy})=>{const app=window.comfyAPI.app.app,ds=app.canvas.ds;const n=app.graph.getNodeById(window.demoNodes[key]);return [(n.pos[0]+dx+ds.offset[0])*ds.scale,(n.pos[1]+dy+ds.offset[1])*ds.scale];},{key,dx,dy});
 const clickNode=async(key,ms)=>{const [x,y]=await nodePoint(key);await clickAt(x,y,ms);};
 const emptyPoint=async()=>[W-40,H-30];
 const item=name=>page.getByRole('menuitem',{name,exact:true});
 const pick=async name=>{await item(name).waitFor();await wait(500);await click(item(name),450);};
 const gridMenu=async name=>{await click(page.getByRole('button',{name:'Grid options',exact:true}));await pick(name);};
 const cellMenu=async(index,name)=>{await click(page.getByRole('button',{name:'Cell options',exact:true}).nth(index));await pick(name);};
 const paint=(label,value)=>page.getByLabel(label,{exact:true}).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const slide=async(label,from,to,ms=900)=>{const steps=20,t=ms/steps;for(let i=1;i<=steps;i++){await paint(label,String(Math.round(from+(to-from)*i/steps)));await wait(t);}};
 return {wait,moveTo,clickAt,click,hover,dragTo,dragBy,fit,grid,setting,badge,nodePoint,clickNode,emptyPoint,item,pick,gridMenu,cellMenu,paint,slide};
}

// Screencast frames carry their own timestamps, so slow frames keep real time.
async function capture(page,name,actions){
 const dir=path.join(OUT,'frames',name);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const cdp=await page.context().newCDPSession(page);const frames=[];
 cdp.on('Page.screencastFrame',async frame=>{frames.push({data:frame.data,t:frame.metadata.timestamp});cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});});
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:92,maxWidth:W,maxHeight:H,everyNthFrame:1});
 const t0=Date.now()/1000;await actions();const t1=Date.now()/1000;
 await cdp.send('Page.stopScreencast');await cdp.detach();
 let list='ffconcat version 1.0\n';
 for(let i=0;i<frames.length;i++){const file=`f${String(i).padStart(5,'0')}.jpg`;await writeFile(path.join(dir,file),Buffer.from(frames[i].data,'base64'));
  const next=i+1<frames.length?frames[i+1].t:Math.max(t1,frames[i].t+0.04);list+=`file ${file}\nduration ${Math.max(0.001,next-Math.max(frames[i].t,i?0:t0)).toFixed(4)}\n`;}
 list+=`file f${String(frames.length-1).padStart(5,'0')}.jpg\n`;
 await writeFile(path.join(dir,'list.txt'),list);
 const mp4=path.join(OUT,`${name}.mp4`);
 execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(dir,'list.txt'),'-vf',`fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,'-c:v','libx264','-preset','fast','-crf','16','-movflags','+faststart',mp4]);
 await rm(dir,{recursive:true,force:true});
 return {path:mp4,seconds:t1-t0,frames:frames.length};
}

async function run(name,title,subtitle,setup,actions){
 if(only.length&&!only.some(item=>name.startsWith(item)))return;
 const {context,page}=await openPage();
 try{
  const h=helpers(page);
  await setup(page,h);await h.wait(500);
  const {path:mp4,seconds,frames}=await capture(page,name,async()=>{await h.wait(900);await actions(page,h);await h.wait(1500);});
  await page.screenshot({path:`recordings/${name}-preview.png`});
  clips.push({name,title,subtitle,path:mp4,seconds});
  console.log(`Recorded ${name}  ${seconds.toFixed(1)}s  ${frames} frames`);
 }finally{await context.close();}
}

try{
 await run('01-instant-layout','MESSY NODES? ONE CLICK.','Select nodes. Click Grid. Keep every connection.',async(p,h)=>{await p.evaluate(buildGraph,true);await h.fit();},async(p,h)=>{
  const count=await p.evaluate(()=>window.comfyAPI.app.app.graph._nodes.length);
  for(let index=0;index<count;index++){
   const point=await p.evaluate(index=>{const app=window.comfyAPI.app.app;const n=app.graph._nodes[index];const ds=app.canvas.ds;return [(n.pos[0]+n.size[0]/2+ds.offset[0])*ds.scale,(n.pos[1]+ds.offset[1])*ds.scale];},index);
   await h.moveTo(point[0],point[1],450);
   await p.evaluate(index=>{const app=window.comfyAPI.app.app;app.canvas.selectNodes(app.graph._nodes.slice(0,index+1));},index);
   await h.wait(250);
  }
  await h.wait(800);
  await h.click(p.locator('.selection-toolbox').getByRole('button',{name:'Create grid layout from selected nodes',exact:true}));await h.moveTo(540,620,500);await h.wait(500);
  await h.fit(900);await h.wait(1500);
  await h.click(p.locator('.selection-toolbox .clt-toolbox-autohide'));await h.wait(2500);
 });
 await run('02-split-cells','MAKE ROOM FOR MORE.','Split cells. Add rows. Build your own workspace.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid();},async(p,h)=>{
  await h.cellMenu(-1,'Split into top / bottom');await h.fit(500);await h.wait(1200);
  await h.gridMenu('Add bottom row');await h.fit(500);await h.wait(1300);
  await h.cellMenu(-1,'Split into left / right');await h.wait(1600);
 });
 await run('03-live-appearance','YOUR WORKFLOW. YOUR STYLE.','Live colors, borders and backgrounds. Nothing sticks until OK.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid();},async(p,h)=>{
  await h.gridMenu('Change Appearance…');await h.wait(700);
  const dialog=p.locator('dialog.clt-appearance-dialog');const tab=name=>dialog.getByRole('button',{name,exact:true});
  await h.hover(p.getByLabel('Title bar background color',{exact:true}),500);await h.paint('Title bar background color','#1f6f8b');await h.wait(700);
  await h.hover(p.getByLabel('Title font size',{exact:true}),500);await h.slide('Title font size',13,20,700);await h.wait(400);
  await h.click(tab('Border'));await h.wait(300);
  await h.hover(p.getByLabel('Border color',{exact:true}),450);await h.paint('Border color','#54e3b5');await h.wait(400);
  await h.hover(p.getByLabel('Border thickness',{exact:true}),500);await h.slide('Border thickness',2,5,400);await h.wait(200);
  await h.hover(p.getByLabel('Border style',{exact:true}),400);await p.getByLabel('Border style',{exact:true}).selectOption('dashed');await h.wait(500);
  await h.click(tab('Grid Background'));await h.wait(300);
  await h.click(p.getByLabel('Enable container background color',{exact:true}));await h.wait(300);
  await h.paint('Container background color','#204c59');await h.wait(400);
  await h.hover(p.getByLabel('Repeating pattern',{exact:true}),400);await p.getByLabel('Repeating pattern',{exact:true}).selectOption('hexagons');await h.wait(800);
  await h.click(dialog.getByRole('button',{name:'OK',exact:true}));await h.moveTo(980,640,500);await h.wait(1500);
 });
 await run('04-inline-titles','NAME IT. ORGANIZE IT.','Double-click any title. Edit right on the canvas.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid();},async(p,h)=>{
  const label=p.locator('.clt-frame-header .clt-label');await h.hover(label);await label.dblclick();await p.getByRole('textbox',{name:'Frame title',exact:true}).pressSequentially('My creative workspace',{delay:75});await p.keyboard.press('Enter');await h.wait(1000);
  const cell=p.locator('.clt-cell-header .clt-label').first();await h.hover(cell);await cell.dblclick();await p.getByRole('textbox',{name:'Cell title',exact:true}).pressSequentially('MODEL + LATENT',{delay:85});await p.keyboard.press('Enter');await h.wait(1500);
 });
 await run('05-resize-and-shrink','LESS CLUTTER. MORE CONTROL.','Resize an edge. Fit every cell back to its controls.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid();await h.fit(0,70,260);},async(p,h)=>{
  await h.dragBy(p.locator('.clt-resize-x'),70,0);await h.wait(1200);await h.gridMenu('Shrink grid to content');await h.wait(1500);
  await h.dragBy(p.locator('.clt-resize-left'),-55,0);await h.wait(1200);await h.gridMenu('Shrink grid to content');await h.wait(1400);
 });
 await run('06-fill-and-undo','CLEAN LAYOUT. ZERO COMMITMENT.','Fill cell heights. Undo. Redo. Stay in control.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid();},async(p,h)=>{
  await h.gridMenu('Fill cell height (all columns)');await h.wait(1900);
  await h.gridMenu('Undo Fill cell height (all columns)');await h.wait(1500);
  await p.keyboard.press('Control+z');await h.wait(1500);await p.keyboard.press('Control+Shift+z');await h.wait(1700);
 });
 await run('07-link-effects','SEE WHAT CONNECTS.','Electricity, Neon Glow and hidden-link reveal.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.setting('VF.LinkEffects.Enabled',true);await h.setting('VF.LinkEffects.Effect','electricity');await h.grid({autohide:true});},async(p,h)=>{
  await h.badge('Link effect: Electricity');await h.wait(500);
  await h.clickNode('ks');await h.wait(2800);
  await h.clickNode('pos');await h.wait(2200);
  await h.badge('Link effect: Neon Glow');await h.setting('VF.LinkEffects.Effect','neon');await h.clickNode('ks');await h.wait(2400);
  const [x,y]=await h.emptyPoint();await h.clickAt(x,y);await h.wait(300);
  await h.badge('Link render mode: Hidden');await h.setting('Comfy.LinkRenderMode',-1);await h.wait(1500);
  await h.clickNode('ks');await h.wait(2400);await h.clickNode('ckpt');await h.wait(2000);await h.clickAt(x,y);await h.wait(1200);await h.badge('');
 });
 await run('08-minimize','FOLD IT AWAY.','Minimize a grid. Its wires keep working through consolidated ports.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid({keys:['pos','neg','ks','dec']});await p.evaluate(()=>{const app=window.comfyAPI.app.app;const f=app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout').controller.frames[0];const n=id=>app.graph.getNodeById(window.demoNodes[id]);n('ckpt').pos=[f.pos[0]-340,f.pos[1]+30];n('latent').pos=[f.pos[0]-340,f.pos[1]+220];n('save').pos=[f.pos[0]+f.size[0]+70,f.pos[1]+30];});await h.fit();},async(p,h)=>{
  await h.wait(500);await h.click(p.getByRole('button',{name:'Minimize grid',exact:true}));await h.wait(1700);
  await h.hover(p.locator('.clt-port-in'));await h.wait(2300);
  await h.hover(p.locator('.clt-port-out'));await h.wait(2300);
  await h.moveTo(540,620);await h.wait(900);
  const header=p.locator('.clt-frame-header .clt-label');await h.dragBy(header,0,170,900);await h.wait(900);await h.dragBy(header,0,-170,900);await h.wait(600);
  await h.click(p.getByRole('button',{name:'Restore grid',exact:true}));await h.wait(2000);
 });
 await run('09-autohide-and-opacity','SHOW ONLY WHAT MATTERS.','Fade the title bar. Hide the grid until you need it.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid();await p.evaluate(()=>{const c=window.comfyAPI.app.app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout').controller;c.edit(()=>{c.frames[0].color='#1f9dc4';});});},async(p,h)=>{
  await h.gridMenu('Change Appearance…');await h.wait(600);
  const dialog=p.locator('dialog.clt-appearance-dialog');
  await h.hover(p.getByLabel('Title bar opacity',{exact:true}),500);await h.slide('Title bar opacity',100,20,1400);await h.wait(600);
  await h.click(dialog.getByRole('button',{name:'OK',exact:true}));await h.moveTo(540,650,500);await h.wait(1800);
  await h.click(p.getByRole('button',{name:'Autohide grid',exact:true}));await h.moveTo(980,640,500);await h.wait(1800);
  await h.clickNode('ks');await h.wait(800);
  await h.click(p.locator('.selection-toolbox .clt-toolbox-autohide'));await h.wait(1500);
  await h.click(p.locator('.selection-toolbox .clt-toolbox-autohide'));await h.wait(1200);
  const [x,y]=await h.emptyPoint();await h.clickAt(x,y);await h.wait(1000);
 });
 await run('10-bypass-and-column-fill','ONE CELL AT A TIME.','Bypass a whole cell. Fill one column at a time.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid();},async(p,h)=>{
  const bypass=p.locator('.clt-cell-bypass');
  await h.click(bypass.nth(1));await h.moveTo(540,640,500);await h.wait(1900);
  await h.click(p.getByRole('button',{name:'Unbypass cell',exact:true}).first());await h.moveTo(540,640,500);await h.wait(1200);
  await h.cellMenu(0,'Fill cell height (this column)');await h.moveTo(540,650,400);await h.wait(1500);
  await h.cellMenu(3,'Fill cell height (this column)');await h.moveTo(540,650,400);await h.wait(1500);
  await h.cellMenu(0,'Undo Fill cell height (this column)');await h.moveTo(540,650,400);await h.wait(1700);
 });
 await run('11-drop-previews','SEE IT BEFORE YOU DROP.','A ghost shows the new cell, column or row while you drag.',async(p,h)=>{await p.evaluate(buildGraph,false);await h.grid({keys:['ckpt','pos','neg','ks','latent'],autohide:true});await p.evaluate(()=>{const app=window.comfyAPI.app.app;const n=id=>app.graph.getNodeById(window.demoNodes[id]);n('dec').pos=[1330,60];n('save').pos=[1330,230];});await h.fit();},async(p,h)=>{
  const [x,y]=await h.nodePoint('dec');await h.moveTo(x,y);await h.wait(400);
  await p.mouse.down();await h.wait(150);
  const {a,b}=await p.evaluate(()=>{const app=window.comfyAPI.app.app,ds=app.canvas.ds;const f=app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout').controller.frames[0];const px=([gx,gy])=>[(gx+ds.offset[0])*ds.scale,(gy+ds.offset[1])*ds.scale];return {a:px(f.pos),b:px([f.pos[0]+f.size[0],f.pos[1]+f.size[1]])};});
  const mx=(a[0]+b[0])/2;
  await h.moveTo(b[0]-90,a[1]+200,1200);await h.wait(1300);
  await h.moveTo(b[0]-14,a[1]+120,800);await h.wait(1400);
  await h.moveTo(mx,b[1]+22,1000);await h.wait(1300);
  await h.moveTo(b[0]-14,a[1]+120,900);await h.wait(900);
  await p.mouse.up();await h.fit(700);await h.moveTo(980,650,400);await h.wait(1200);
  await h.click(p.locator('.selection-toolbox .clt-toolbox-autohide'));await h.wait(2000);
 });
}finally{
 if(clips.length){
  let previous=[];try{previous=JSON.parse(await readFile('recordings/clips.json','utf8'));}catch{}
  const names=new Set(clips.map(clip=>clip.name));
  await writeFile('recordings/clips.json',JSON.stringify([...previous.filter(clip=>!names.has(clip.name)),...clips],null,2));
 }
 await browser.close();
}
