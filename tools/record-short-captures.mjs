// Records short vertical demo clips (one per beat) against a live ComfyUI.
// Usage: node tools/record-short-captures.mjs [beat-number ...]
// Env: COMFYUI_URL (default http://10.0.0.164:8188), SHOTS=1 for still previews only.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const BASE=process.env.COMFYUI_URL ?? 'http://10.0.0.164:8188';
const W=1080,H=1350,DPR=2;
const OUT='recordings/short-captures';
const prefix='/extensions/VF-ComfyUI-Grid-Layout/';
const only=process.argv.slice(2).map(Number);
const SHOTS=process.env.SHOTS==='1';
await mkdir(OUT,{recursive:true});
const browser=await chromium.launch({headless:true});

// Visible pointer, click rings, key HUD and a tooltip for consolidated ports
// (headless video shows neither the system cursor nor native title tooltips).
function demoChrome(){
 const install=()=>{
  const style=document.createElement('style');
  style.textContent=`.demo-pointer{position:fixed;left:0;top:0;width:34px;height:34px;border:2px solid #fff;border-radius:50%;background:#54e3b533;box-shadow:0 0 0 2px #17252b;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px)}.demo-pointer::after{content:'';position:absolute;left:14px;top:14px;width:6px;height:6px;border-radius:50%;background:white;box-shadow:0 0 2px black}.demo-click{position:fixed;width:34px;height:34px;border:3px solid #54e3b5;border-radius:50%;pointer-events:none;z-index:2147483647;animation:demo-click .6s ease-out forwards}@keyframes demo-click{from{transform:scale(1);opacity:1}to{transform:scale(2.6);opacity:0}}
.demo-keys{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);padding:14px 26px;border-radius:12px;background:#101820e6;border:2px solid #54e3b5;color:#fff;font:600 34px system-ui,sans-serif;letter-spacing:1px;pointer-events:none;z-index:2147483646;opacity:0;transition:opacity .2s}.demo-keys.show{opacity:1}
.demo-tip{position:fixed;max-width:520px;padding:12px 16px;border-radius:8px;background:#101820f2;border:1px solid #54e3b5;color:#e8f3f0;font:500 17px/1.5 system-ui,sans-serif;white-space:pre;pointer-events:none;z-index:2147483646;display:none;box-shadow:0 8px 24px #0008}
.side-toolbar-container,.comfyui-menu,.workflow-tabs-container,.p-toast,.bottom-panel{display:none!important}`;
  document.head.append(style);
  const pointer=document.createElement('div');pointer.className='demo-pointer';document.body.append(pointer);
  const keys=document.createElement('div');keys.className='demo-keys';document.body.append(keys);
  const tip=document.createElement('div');tip.className='demo-tip';document.body.append(tip);
  let keyTimer;
  document.addEventListener('pointermove',e=>{
   pointer.style.transform=`translate(${e.clientX-18}px,${e.clientY-18}px)`;
   const port=document.elementsFromPoint(e.clientX,e.clientY).find(el=>el.classList?.contains('clt-port'));
   if(port){tip.textContent=port.title;tip.style.display='block';const b=port.getBoundingClientRect();tip.style.left=`${Math.max(16,Math.min(innerWidth-tip.offsetWidth-16,e.clientX-tip.offsetWidth/2))}px`;tip.style.top=`${b.bottom+24}px`;}
   else tip.style.display='none';
  },true);
  document.addEventListener('pointerdown',e=>{pointer.style.transform=`translate(${e.clientX-18}px,${e.clientY-18}px)`;const ring=document.createElement('div');ring.className='demo-click';ring.style.left=`${e.clientX-20}px`;ring.style.top=`${e.clientY-20}px`;document.body.append(ring);setTimeout(()=>ring.remove(),700);},true);
  document.addEventListener('keydown',e=>{if(!e.ctrlKey||['Control','Shift'].includes(e.key))return;keys.textContent=[e.ctrlKey&&'Ctrl',e.shiftKey&&'Shift',e.key.toUpperCase()].filter(Boolean).join(' + ');keys.classList.add('show');clearTimeout(keyTimer);keyTimer=setTimeout(()=>keys.classList.remove('show'),1300);},true);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
}

// Builds a ~27 node SD pipeline in loose columns; `messy` scatters it.
function buildWorkflow(messy){
 const app=window.comfyAPI.app.app;const LG=window.LiteGraph ?? window.comfyAPI.litegraph.LiteGraph;
 app.graph.clear();
 let seed=7;const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
 const cols=[
  ['ckpt:CheckpointLoaderSimple','lora1:LoraLoader','lora2:LoraLoader','lora3:LoraLoader','skip:CLIPSetLastLayer','msd:ModelSamplingDiscrete','freeu:FreeU_V2'],
  ['pos:CLIPTextEncode','neg:CLIPTextEncode','latent:EmptyLatentImage'],
  ['cimg:EmptyImage','canny:Canny','cprev:PreviewImage','cnl:ControlNetLoader','cna:ControlNetApplyAdvanced'],
  ['ks:KSampler','dec:VAEDecode','prev:PreviewImage'],
  ['lup:LatentUpscaleBy','ks2:KSampler','dec2:VAEDecode','prev2:PreviewImage'],
  ['uml:UpscaleModelLoader','up:ImageUpscaleWithModel','scale:ImageScaleBy','sharp:ImageSharpen','save:SaveImage'],
 ];
 const n={};
 cols.forEach((col,ci)=>{let y=0;const order=messy?[...col].sort(()=>rnd()-0.5):col;
  for(const spec of order){const [key,type]=spec.split(':');const node=LG.createNode(type);app.graph.add(node);n[key]=node;
   node.pos=messy?[ci*560+(rnd()-0.5)*90,(rnd()*1500)-150+ci*(rnd()*120)]:[ci*480,y];y+=node.size[1]+70;}});
 const wire=(a,out,b,inp)=>a.connect(a.findOutputSlot(out),b,b.findInputSlot(inp));
 wire(n.ckpt,'MODEL',n.lora1,'model');wire(n.ckpt,'CLIP',n.lora1,'clip');
 wire(n.lora1,'MODEL',n.lora2,'model');wire(n.lora1,'CLIP',n.lora2,'clip');
 wire(n.lora2,'MODEL',n.lora3,'model');wire(n.lora2,'CLIP',n.lora3,'clip');
 wire(n.lora3,'CLIP',n.skip,'clip');wire(n.lora3,'MODEL',n.msd,'model');wire(n.msd,'MODEL',n.freeu,'model');
 wire(n.skip,'CLIP',n.pos,'clip');wire(n.skip,'CLIP',n.neg,'clip');
 wire(n.cimg,'IMAGE',n.canny,'image');wire(n.canny,'IMAGE',n.cprev,'images');
 wire(n.pos,'CONDITIONING',n.cna,'positive');wire(n.neg,'CONDITIONING',n.cna,'negative');
 wire(n.cnl,'CONTROL_NET',n.cna,'control_net');wire(n.canny,'IMAGE',n.cna,'image');
 wire(n.freeu,'MODEL',n.ks,'model');wire(n.cna,'positive',n.ks,'positive');wire(n.cna,'negative',n.ks,'negative');wire(n.latent,'LATENT',n.ks,'latent_image');
 wire(n.ks,'LATENT',n.dec,'samples');wire(n.ckpt,'VAE',n.dec,'vae');wire(n.dec,'IMAGE',n.prev,'images');
 wire(n.ks,'LATENT',n.lup,'samples');wire(n.lup,'LATENT',n.ks2,'latent_image');wire(n.freeu,'MODEL',n.ks2,'model');
 wire(n.cna,'positive',n.ks2,'positive');wire(n.cna,'negative',n.ks2,'negative');
 wire(n.ks2,'LATENT',n.dec2,'samples');wire(n.ckpt,'VAE',n.dec2,'vae');wire(n.dec2,'IMAGE',n.prev2,'images');
 wire(n.uml,'UPSCALE_MODEL',n.up,'upscale_model');wire(n.dec2,'IMAGE',n.up,'image');wire(n.up,'IMAGE',n.scale,'image');
 wire(n.scale,'IMAGE',n.sharp,'image');wire(n.sharp,'IMAGE',n.save,'images');
 const names={ckpt:'sd_xl_base_1.0.safetensors',lora1:'film_grain_style.safetensors',lora2:'detail_tweaker_xl.safetensors',lora3:'golden_hour_light.safetensors',cnl:'controlnet-canny-sdxl.safetensors',uml:'4x_UltraSharp.pth'};
 for(const [k,v] of Object.entries(names))n[k].widgets[0].value=v;
 n.pos.widgets[0].value='cinematic portrait of a fennec-eared girl, golden hour, 35mm';n.neg.widgets[0].value='blurry, lowres, watermark';
 const titles={ckpt:'Base model',lora1:'LoRA · Style',lora2:'LoRA · Detail',lora3:'LoRA · Lighting',pos:'Positive prompt',neg:'Negative prompt',cimg:'Control image',cprev:'Edge preview',ks:'Base sampler',ks2:'Hires sampler',prev:'Base preview',prev2:'Hires preview',save:'Final output'};
 for(const [k,t] of Object.entries(titles))n[k].title=t;
 for(const node of app.graph._nodes)node.has_errors=false;
 window.demoNodes=Object.fromEntries(Object.entries(n).map(([k,v])=>[k,v.id]));
 app.canvas.setDirty(true,true);
}

async function openPage(){
 const context=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:DPR});
 const page=await context.newPage();
 page.on('pageerror',e=>console.log('pageerror:',e.message));
 await page.addInitScript(demoChrome);
 // Keep the instance untouched: no settings/userdata/prompt writes leave the browser.
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()!=='GET')return route.fulfill({status:200,json:{}});
  if(/\/api\/(view|history|jobs|queue)/.test(url.pathname))return route.fulfill({status:404,body:''});
  if(url.pathname==='/api/settings'){const response=await route.fetch();const json=await response.json();
   Object.assign(json,{'Comfy.VueNodes.Enabled':false,'Comfy.Minimap.Visible':false,'Comfy.Canvas.SelectionToolbox':true,'Comfy.LinkRenderMode':2,'Comfy.Graph.CanvasInfo':false,'Comfy.Workflow.ShowMissingModelsWarning':false,'Comfy.Workflow.ShowMissingNodesWarning':false});
   return route.fulfill({response,json});}
  if(url.pathname==='/api/object_info'){const response=await route.fetch();const json=await response.json();
   // Neutral model lists: keeps the user's file names off camera and avoids missing-model outlines.
   const lists={CheckpointLoaderSimple:['ckpt_name',['sd_xl_base_1.0.safetensors']],LoraLoader:['lora_name',['film_grain_style.safetensors','detail_tweaker_xl.safetensors','golden_hour_light.safetensors']],ControlNetLoader:['control_net_name',['controlnet-canny-sdxl.safetensors']],UpscaleModelLoader:['model_name',['4x_UltraSharp.pth']]};
   for(const [type,[input,values]] of Object.entries(lists)){const spec=json[type]?.input?.required?.[input];if(!spec)continue;if(Array.isArray(spec[0]))spec[0]=values;else if(spec[1]?.options)spec[1].options=values;}
   return route.fulfill({response,json});}
  return route.fallback();
 });
 await page.route(`**${prefix}**`,async route=>{const rel=new URL(route.request().url()).pathname.slice(prefix.length);await route.fulfill({contentType:'text/javascript',body:await readFile(fileURLToPath(new URL('../web/'+rel,import.meta.url)))});});
 await page.route('**/view?**',route=>route.fulfill({status:404,body:''}));
 await page.goto(BASE,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.comfyAPI?.app?.app?.canvas,null,{timeout:90000});
 await page.waitForFunction(()=>window.comfyAPI.app.app.extensions.some(e=>e.name==='VF.ComfyUI.GridLayout'),null,{timeout:30000});
 await page.locator('.clt-overlay').waitFor({state:'attached'});
 await page.waitForSelector('[data-testid=app-loading-overlay]',{state:'hidden',timeout:90000}).catch(()=>{});
 await page.waitForTimeout(2500);
 await page.keyboard.press('Escape');
 // Hide every UI layer along the top and bottom edges (menus, queue, canvas controls).
 await page.evaluate(()=>{document.querySelectorAll('.p-dialog-mask').forEach(el=>el.remove());
  const canvas=document.querySelector('.graph-canvas-container canvas');
  for(const y of [8,30,55,80,105,130,innerHeight-110,innerHeight-80,innerHeight-50,innerHeight-25,innerHeight-6])for(let x=6;x<innerWidth;x+=30){
   let el=document.elementFromPoint(x,y);if(!el||el===canvas||el.closest('.clt-overlay'))continue;
   while(el.parentElement&&!el.parentElement.contains(canvas))el=el.parentElement;if(!el.contains(canvas))el.style.setProperty('display','none','important');}});
 return {context,page};
}

function helpers(page){
 let cursor=[W/2,H+60];
 const ease=t=>t<.5?2*t*t:1-(-2*t+2)**2/2;
 const wait=ms=>page.waitForTimeout(ms*0.6);
 const moveTo=async(x,y,ms=700)=>{const [x0,y0]=cursor;ms*=0.75;const t0=Date.now();for(;;){const k=Math.min(1,(Date.now()-t0)/ms),t=ease(k);await page.mouse.move(x0+(x-x0)*t,y0+(y-y0)*t);if(k>=1)break;}cursor=[x,y];};
 const center=async loc=>{const b=await loc.boundingBox();if(!b)throw new Error('not visible: '+loc);return [b.x+b.width/2,b.y+b.height/2];};
 const click=async(loc,ms=700)=>{const [x,y]=await center(loc);await moveTo(x,y,ms);await wait(250);await page.mouse.down();await wait(90);await page.mouse.up();await wait(300);};
 const dragTo=async(x,y,ms=1200)=>{await page.mouse.down();await wait(150);await moveTo(x,y,ms);await wait(150);await page.mouse.up();};
 // Camera in graph space: rect [x,y,w,h] fitted to the viewport.
 const camFor=([x,y,w,h],margin=60)=>{const s=Math.min((W-margin*2)/w,(H-margin*2)/h,1.4);return {s,ox:(W/s-w)/2-x,oy:(H/s-h)/2-y};};
 const setCam=cam=>page.evaluate(c=>{const ds=window.comfyAPI.app.app.canvas.ds;ds.scale=c.s;ds.offset=[c.ox,c.oy];window.comfyAPI.app.app.canvas.setDirty(true,true);},cam);
 const fly=(cam,ms)=>page.evaluate(({c,ms})=>new Promise(done=>{const app=window.comfyAPI.app.app,ds=app.canvas.ds;const s0=ds.scale,cx0=(ds.offset[0]),cy0=ds.offset[1];
  // Interpolate the graph point at the viewport centre and the zoom (log space).
  const W=innerWidth,H=innerHeight;const p0=[W/2/s0-cx0,H/2/s0-cy0],p1=[W/2/c.s-c.ox,H/2/c.s-c.oy];const t0=performance.now();
  const step=now=>{let t=Math.min(1,(now-t0)/ms);t=t<.5?4*t*t*t:1-(-2*t+2)**3/2;const s=Math.exp(Math.log(s0)+(Math.log(c.s)-Math.log(s0))*t);const p=[p0[0]+(p1[0]-p0[0])*t,p0[1]+(p1[1]-p0[1])*t];ds.scale=s;ds.offset=[W/2/s-p[0],H/2/s-p[1]];app.canvas.setDirty(true,true);if(t<1)requestAnimationFrame(step);else done();};requestAnimationFrame(step);}),{c:cam,ms});
 const bounds=sel=>page.evaluate(sel=>{const app=window.comfyAPI.app.app;const ext=app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout');
  if(sel==='frame'){const f=ext.controller.frames[0];return [f.pos[0],f.pos[1],f.size[0],f.size[1]];}
  const ids=sel?sel.map(k=>window.demoNodes[k]):null;const ns=app.graph._nodes.filter(n=>!ids||ids.includes(n.id));
  const x=Math.min(...ns.map(n=>n.pos[0])),y=Math.min(...ns.map(n=>n.pos[1]-30));return [x,y,Math.max(...ns.map(n=>n.pos[0]+n.size[0]))-x,Math.max(...ns.map(n=>n.pos[1]+n.size[1]))-y];},sel);
 const grid=(keys,label,cellLabels)=>page.evaluate(({keys,label,cellLabels})=>{const app=window.comfyAPI.app.app;const c=app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout').controller;
  const ids=keys?keys.map(k=>window.demoNodes[k]):app.graph._nodes.map(n=>n.id);const f=c.createFromNodes(ids,'columns');
  c.edit(()=>{const frame=c.frames.find(x=>x.id===f.id);frame.label=label;const cells=frame.root.children?frame.root.children:[frame.root];(cellLabels??[]).forEach((l,i)=>{if(cells[i])cells[i].label=l;});});
  app.canvas.deselectAll?.();app.canvas.setDirty(true,true);},{keys,label,cellLabels});
 const editFrame=fn=>page.evaluate(src=>{const app=window.comfyAPI.app.app;const c=app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout').controller;c.edit(()=>(0,eval)(src)(c.frames[0]));app.canvas.setDirty(true,true);},fn.toString());
 const drop=keys=>page.evaluate(keys=>{const app=window.comfyAPI.app.app;for(const k of keys)app.graph.remove(app.graph.getNodeById(window.demoNodes[k]));app.canvas.setDirty(true,true);},keys);
 // Fly so every element matching `selector` is in view, padded in graph units.
 const focus=async(selector,pad=[200,120],ms=900,maxH=1100)=>{const boxes=await page.locator(selector).evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];}));
  const ds=await page.evaluate(()=>{const d=window.comfyAPI.app.app.canvas.ds;return [d.scale,...d.offset];});const g=(x,y)=>[x/ds[0]-ds[1],y/ds[0]-ds[2]];
  const [x0,y0]=g(Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])));const [x1,y1]=g(Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3])));
  const cam=camFor([x0-pad[0],y0-pad[1],x1-x0+pad[0]*2,Math.min(maxH,y1-y0)+pad[1]*2],10);if(ms)await fly(cam,ms);else await setCam(cam);};
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const toGraph=([gx,gy])=>page.evaluate(([gx,gy])=>{const ds=window.comfyAPI.app.app.canvas.ds;return [(gx+ds.offset[0])*ds.scale,(gy+ds.offset[1])*ds.scale];},[gx,gy]);
 const nodeTitle=key=>page.evaluate(key=>{const app=window.comfyAPI.app.app,ds=app.canvas.ds;const n=app.graph.getNodeById(window.demoNodes[key]);return [(n.pos[0]+Math.min(90,n.size[0]/2)+ds.offset[0])*ds.scale,(n.pos[1]-15+ds.offset[1])*ds.scale];},key);
 return {focus,drop,wait,moveTo,click,dragTo,camFor,setCam,fly,bounds,grid,editFrame,settle,toGraph,nodeTitle,get cursor(){return cursor;},set cursor(v){cursor=v;}};
}

// CDP screencast keeps the 2x device pixels (Playwright's recordVideo is low bitrate VP8).
async function capture(page,name,actions){
 const dir=path.join(OUT,'frames',name);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 if(SHOTS){await actions();await page.screenshot({path:path.join(OUT,`${name}.png`)});return;}
 const cdp=await page.context().newCDPSession(page);const frames=[];
 cdp.on('Page.screencastFrame',async f=>{frames.push({data:f.data,t:f.metadata.timestamp});cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});});
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:92,maxWidth:W*DPR,maxHeight:H*DPR,everyNthFrame:1});
 const t0=Date.now()/1000;await actions();const t1=Date.now()/1000;
 await cdp.send('Page.stopScreencast');await cdp.detach();
 let list='ffconcat version 1.0\n';
 for(let i=0;i<frames.length;i++){const file=`f${String(i).padStart(5,'0')}.jpg`;await writeFile(path.join(dir,file),Buffer.from(frames[i].data,'base64'));
  const next=i+1<frames.length?frames[i+1].t:Math.max(t1,frames[i].t+0.04);list+=`file ${file}\nduration ${Math.max(0.001,next-Math.max(frames[i].t,i?0:t0)).toFixed(4)}\n`;}
 list+=`file f${String(frames.length-1).padStart(5,'0')}.jpg\n`;
 await writeFile(path.join(dir,'list.txt'),list);
 const mp4=path.join(OUT,`${name}.mp4`);
 execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(dir,'list.txt'),'-vf',`fps=30,scale=${W*DPR}:${H*DPR}:flags=lanczos,format=yuv420p`,'-c:v','libx264','-preset','slow','-crf','18','-profile:v','high','-movflags','+faststart',mp4]);
 await rm(dir,{recursive:true,force:true});
 console.log(`${mp4}  ${frames.length} frames  ${(t1-t0).toFixed(1)}s`);
}

const CELLS=['MODELS','PROMPTS','CONTROLNET','BASE PASS','HIRES FIX','UPSCALE + SAVE'];
const beats={
 async 1(page,h){ // hook: messy wide canvas, slow push-in
  await page.evaluate(buildWorkflow,true);const b=await h.bounds();
  await h.setCam(h.camFor([b[0]-500,b[1]-700,b[2]+1000,b[3]+1400],0));await h.wait(400);
  await capture(page,'01-hook',async()=>{await h.wait(500);await h.fly(h.camFor([b[0]+b[2]*0.3,b[1]+b[3]*0.25,b[2]*0.4,b[3]*0.45],0),4200);await h.wait(600);});
 },
 async 2(page,h){ // one-click grid
  await page.evaluate(buildWorkflow,true);const b=await h.bounds();
  await h.setCam(h.camFor([b[0]-60,b[1]-260,b[2]+120,b[3]+520],20));await h.wait(400);
  await capture(page,'02-one-click',async()=>{
   await h.moveTo(28,60,900);await h.wait(300);await page.keyboard.down('Control');await h.dragTo(W-28,H-60,1900);await page.keyboard.up('Control');await h.wait(700);
   await h.click(page.locator('.selection-toolbox').getByRole('button',{name:'Create grid layout from selected nodes',exact:true}));await h.wait(600);
   await h.click(page.getByRole('menuitem',{name:'Preserve columns',exact:true}),600);await h.wait(400);
   await page.evaluate(()=>window.comfyAPI.app.app.canvas.deselectAll?.());
   await h.moveTo(W-80,H-40,600);await h.fly(h.camFor(await h.bounds('frame'),30),1300);await h.wait(1200);
  });
 },
 async 3(page,h){ // drop-to-snap
  await page.evaluate(buildWorkflow,false);
  await h.grid(['lup','ks2','dec2','prev2','uml','up','scale'],'Hires + upscale',['HIRES FIX','UPSCALE']);
  await h.editFrame(f=>{f.root.children.push({id:'drop-'+Date.now(),label:'OUTPUT',nodes:[]});f.root.ratios=[0.36,0.32,0.32];f.size[0]+=380;});
  const fr=await h.bounds('frame');
  await page.evaluate(([x,y])=>{const app=window.comfyAPI.app.app;const g=app.graph;const s=g.getNodeById(window.demoNodes.sharp),v=g.getNodeById(window.demoNodes.save);s.pos=[x+20,y+90];v.pos=[x+520,y+60];
   app.canvas.setDirty(true,true);},[fr[0]+fr[2]-560,fr[1]+fr[3]+120]);
  await h.drop(['ckpt','lora1','lora2','lora3','skip','msd','freeu','pos','neg','latent','cimg','canny','cprev','cnl','cna','ks','dec','prev']);
  const all=await h.bounds(['lup','ks2','dec2','prev2','uml','up','scale','sharp','save']);
  await h.setCam(h.camFor([all[0]+all[2]*0.32,all[1],all[2]*0.68,all[3]],30));await h.wait(500);
  await capture(page,'03-drop-to-snap',async()=>{
   for(const key of ['sharp','save']){
    const [x,y]=await h.nodeTitle(key);await h.moveTo(x,y,900);await h.wait(250);
    const target=await page.locator('.clt-cell').last().boundingBox();
    const above=await page.evaluate(()=>{const c=window.comfyAPI.app.app.extensions.find(e=>e.name==='VF.ComfyUI.GridLayout').controller;return c.frames[0].root.children.at(-1).nodes.length;});
    await h.dragTo(target.x+target.width*0.45,target.y+(above?target.height*0.85:70),1700);await h.wait(1300);
   }
   await h.moveTo(W-60,H-60,600);await h.wait(900);
  });
 },
 async 4(page,h){ // split cell, then 2x2 grid
  await page.evaluate(buildWorkflow,false);await h.grid(['pos','neg','latent','cimg','canny','cnl','cna'],'Prompts + ControlNet',['PROMPTS','CONTROLNET']);
  await h.drop(['ckpt','lora1','lora2','lora3','skip','msd','freeu','cprev','ks','dec','prev','lup','ks2','dec2','prev2','uml','up','scale','sharp','save']);
  await h.wait(800);const fit=async ms=>{const fr=await h.bounds('frame');const cam=h.camFor([fr[0]-20,fr[1]-60,fr[2]+40,fr[3]+120],20);if(ms)await h.fly(cam,ms);else await h.setCam(cam);};
  await fit(0);await h.wait(500);
  await capture(page,'04-split',async()=>{
   await h.wait(400);
   await h.click(page.getByRole('button',{name:'Cell options',exact:true}).nth(1),900);await h.wait(500);
   await h.click(page.getByRole('menuitem',{name:'Split into left / right',exact:true}),600);await h.wait(500);await fit(700);await h.wait(500);
   await h.click(page.locator('.clt-cell:has(.clt-hint)').last().getByRole('button',{name:'Cell options',exact:true}),800);await h.wait(500);
   await h.click(page.getByRole('menuitem',{name:'Create grid…',exact:true}),600);await h.wait(800);
   await h.click(page.locator('dialog').getByRole('button',{name:'OK',exact:true}),800);await h.wait(500);await fit(700);await h.wait(1300);
  });
 },
 async 5(page,h){ // appearance
  await page.evaluate(buildWorkflow,false);await h.grid(['pos','neg','latent','cimg','canny','cprev','cnl','cna'],'Prompts + ControlNet',['PROMPTS','CONTROLNET']);
  const fr=await h.bounds('frame');await h.setCam(h.camFor([fr[0]-30,fr[1]-40,fr[2]+60,fr[3]+80],30));await h.wait(500);
  const setColor=(label,value)=>page.getByLabel(label,{exact:true}).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await capture(page,'05-style',async()=>{
   await h.click(page.getByRole('button',{name:'Grid options',exact:true}),900);await h.wait(500);
   await h.click(page.getByRole('menuitem',{name:'Change Appearance…',exact:true}),600);await h.wait(700);
   const bg=page.getByLabel('Title bar background color',{exact:true});await h.click(bg,700);await page.keyboard.press('Escape').catch(()=>{});
   for(const c of ['#2a5d6b','#1f7a63','#e0663b']){await setColor('Title bar background color',c);await h.wait(380);}
   await h.wait(500);
   await h.click(page.locator('.clt-tab',{hasText:'Border'}),700);await h.wait(400);
   const style=page.getByLabel('Border style',{exact:true});await h.click(style,600);await style.selectOption('dashed');await h.wait(600);
   await setColor('Border color','#e0663b');await h.wait(300);
   const thick=page.getByLabel('Border thickness',{exact:true});const tb=await thick.boundingBox();
   await h.moveTo(tb.x+tb.width*0.15,tb.y+tb.height/2,600);await page.mouse.down();await h.moveTo(tb.x+tb.width*0.6,tb.y+tb.height/2,900);await page.mouse.up();await h.wait(600);
   await h.click(page.locator('.clt-tab',{hasText:'Grid Background'}),700);await h.wait(400);
   const enable=page.getByLabel('Enable container background color',{exact:true});if(!(await enable.isChecked()))await h.click(enable,600);
   await setColor('Container background color','#3a2a24');await h.wait(400);
   const pat=page.getByLabel('Repeating pattern',{exact:true});await h.click(pat,600);await pat.selectOption('hexagons');await h.wait(900);
   await h.click(page.locator('dialog').getByRole('button',{name:'OK',exact:true}),800);await h.moveTo(W-70,H-70,700);await h.wait(1300);
  });
 },
 async 6(page,h){ // minimize with external wires
  await page.evaluate(buildWorkflow,false);
  await h.grid(['cimg','canny','cprev','cnl','cna'],'ControlNet',['ControlNet']);
  await h.drop(['lup','ks2','dec2','prev2','uml','up','scale','sharp','save','ckpt','lora1','lora2','lora3','skip','msd','freeu']);
  const all=await h.bounds(['pos','neg','latent','cimg','canny','cprev','cnl','cna','ks','dec','prev']);
  await h.setCam(h.camFor([all[0],all[1]-80,all[2],all[3]+160],24));await h.wait(500);
  await capture(page,'06-minimize',async()=>{
   await h.wait(300);await h.click(page.getByRole('button',{name:'Minimize grid',exact:true}),1000);await h.wait(1600);
   await h.moveTo(...(await (async()=>{const b=await page.locator('.clt-port-in').boundingBox();return [b.x+b.width/2,b.y+b.height/2];})()),1000);await h.wait(2200);
   const o=await page.locator('.clt-port-out').boundingBox();await h.moveTo(o.x+o.width/2,o.y+o.height/2,900);await h.wait(2000);
   await h.click(page.getByRole('button',{name:'Restore grid',exact:true}),900);await h.wait(1500);
  });
 },
 async 7(page,h){ // collapse, drag, expand
  await page.evaluate(buildWorkflow,false);
  await h.grid(['pos','neg','latent','cimg','canny','cprev','cnl','cna'],'Prompts + ControlNet',['PROMPTS','CONTROLNET']);
  await h.drop(['lup','ks2','dec2','prev2','uml','up','scale','sharp','save','ckpt','lora1','lora2','lora3','skip','msd','freeu','ks','dec','prev']);
  const fr=await h.bounds('frame');await h.setCam(h.camFor([fr[0]-60,fr[1]-80,fr[2]+120,fr[3]+160],30));await h.wait(500);
  await capture(page,'07-collapse',async()=>{
   await h.wait(300);await h.click(page.getByRole('button',{name:'Collapse grid',exact:true}),1000);await h.wait(1300);
   const hb=await page.locator('.clt-frame-header .clt-label').boundingBox();await h.moveTo(hb.x+hb.width/2,hb.y+hb.height/2,800);await h.wait(200);
   await h.dragTo(hb.x+hb.width/2+60,hb.y+hb.height/2+380,1600);await h.wait(800);
   await h.click(page.getByRole('button',{name:'Expand grid',exact:true}),900);await h.wait(1600);
  });
 },
 async 8(page,h){ // lock
  await page.evaluate(buildWorkflow,false);
  await h.grid(['pos','neg','latent','cimg','canny','cprev','cnl','cna'],'Prompts + ControlNet',['PROMPTS','CONTROLNET']);
  await h.drop(['lup','ks2','dec2','prev2','uml','up','scale','sharp','save','ckpt','lora1','lora2','lora3','skip','msd','freeu','ks','dec','prev']);
  const fr=await h.bounds('frame');await h.setCam(h.camFor([fr[0]-60,fr[1]-80,fr[2]+120,fr[3]+160],30));await h.wait(500);
  await capture(page,'08-lock',async()=>{
   await h.wait(300);await h.click(page.getByRole('button',{name:'Lock frame',exact:true}),1000);await h.wait(900);
   const hb=await page.locator('.clt-frame-header .clt-label').boundingBox();await h.moveTo(hb.x+hb.width/2,hb.y+hb.height/2,800);
   await h.dragTo(hb.x+hb.width/2+200,hb.y+hb.height/2+160,1300);await h.wait(700);
   const e=await page.locator('.clt-resize-x').boundingBox();await h.moveTo(e.x+e.width/2,e.y+e.height*0.5,900);
   await h.dragTo(e.x+e.width/2+180,e.y+e.height*0.5,1200);await h.wait(1300);
  });
 },
 async 9(page,h){ // fill + undo/redo
  await page.evaluate(buildWorkflow,false);
  await h.grid(['pos','neg','latent','cimg','canny','cprev','cnl','cna','ks','dec','prev'],'Prompts → base pass',['PROMPTS','CONTROLNET','BASE PASS']);
  await h.drop(['lup','ks2','dec2','prev2','uml','up','scale','sharp','save','ckpt','lora1','lora2','lora3','skip','msd','freeu']);
  const fr=await h.bounds('frame');await h.setCam(h.camFor([fr[0]-40,fr[1]-60,fr[2]+80,fr[3]+120],30));await h.wait(500);
  await capture(page,'09-undo',async()=>{
   await h.click(page.getByRole('button',{name:'Grid options',exact:true}),900);await h.wait(500);
   await h.click(page.getByRole('menuitem',{name:'Fill cell height',exact:true}),600);await h.wait(1500);
   await h.moveTo(W/2,H-140,700);await page.mouse.click(W/2,H-140);await h.wait(400);
   await page.keyboard.press('Control+z');await h.wait(1600);await page.keyboard.press('Control+Shift+z');await h.wait(1700);
  });
 },
 async 10(page,h){ // hero
  await page.evaluate(buildWorkflow,false);await h.grid(null,'SDXL · ControlNet · Hires · Upscale',CELLS);
  await h.editFrame(f=>{Object.assign(f,{color:'#1f7a63',textColor:'#ffffff',fontSize:22,border:{color:'#54e3b5',width:4,style:'dashed'},containerMode:'color',containerColor:'#12333b',containerOpacity:0.55,containerPattern:'hexagons'});
   const palette=['#3d4f8a','#8a5a2b','#6b3d8a','#2b6f8a','#8a2b4f','#2f7a4a'];f.root.children.forEach((c,i)=>Object.assign(c,{color:palette[i],textColor:'#ffffff',fontSize:18}));});
  const fr=await h.bounds('frame');await h.setCam(h.camFor([fr[0]-30,fr[1]-30,fr[2]+60,fr[3]+60],16));await h.wait(800);
  await capture(page,'10-hero',async()=>{await h.wait(500);await h.fly(h.camFor([fr[0]-10,fr[1]-10,fr[2]+20,fr[3]+20],16),2600);await h.wait(400);});
 },
};

const failures=[];
try{
 for(const [key,beat] of Object.entries(beats)){
  if(only.length&&!only.includes(Number(key)))continue;
  const {context,page}=await openPage();
  try{await beat(page,helpers(page));}catch(e){failures.push(`${key}: ${e.message}`);console.log('FAILED beat',key,e.message);await page.screenshot({path:path.join(OUT,`failed-${key}.png`)}).catch(()=>{});}
  finally{await context.close();}
 }
}finally{await rm(path.join(OUT,'frames'),{recursive:true,force:true});await browser.close();}
if(failures.length){console.log('Failures:\n'+failures.join('\n'));process.exitCode=1;}
