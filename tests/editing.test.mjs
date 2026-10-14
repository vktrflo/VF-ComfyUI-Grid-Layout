import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as engine from '../web/core/layout.js';
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);

test('deleting nested leaves collapses parents and retains surviving IDs and memberships', () => {
 const f=engine.createFrame(); engine.gridCell(f,f.root.id,1,3);
 const [a,b,c]=engine.leaves(f.root); a.nodes=[1]; b.nodes=[2]; c.nodes=[3];
 engine.splitCell(f,b.id,'y'); const keep=b.children[0];
 engine.deleteCell(f,b.children[1].id); assert.equal(f.root.children[1].id,keep.id);
 engine.deleteCell(f,c.id); assert.equal(engine.leaves(f.root).length,2);
 engine.deleteCell(f,a.id); assert.equal(f.root.id,keep.id); assert.deepEqual(f.root.nodes,[2]);
 engine.deleteCell(f,keep.id); assert.deepEqual(f.root.nodes,[]); assert.doesNotThrow(()=>engine.validateFrame(f));
});

test('right edge preserves other columns in the user nested example and clamps at minimum', async () => {
 const fixture=JSON.parse(await readFile(new URL('./fixtures/nested-columns.json',import.meta.url),'utf8'));
 const f=structuredClone(fixture.frame);
 const metrics=new Map(fixture.metrics);
 const before=engine.layoutFrame(f,metrics).cells.map(c=>c.rect);
 engine.resizeRightEdge(f,120,metrics);
 const after=engine.layoutFrame(f,metrics).cells.map(c=>c.rect);
 for(let i=0;i<4;i++) before[i].forEach((v,j)=>close(v,after[i][j]));
 close(after[4][0],before[4][0]); close(after[4][2],before[4][2]+120);
 engine.resizeRightEdge(f,-1e5,metrics);
 const shrunk=engine.layoutFrame(f,metrics).cells;
 close(shrunk[4].rect[2],184);
 for(let i=0;i<4;i++) close(shrunk[i].rect[2],before[i][2]);
});

test('right edge resizes boundary cells in every grid row without moving inner dividers',()=>{
 const f=engine.createFrame(); engine.gridCell(f,f.root.id,2,3);
 const before=engine.layoutFrame(f,new Map()).cells.map(c=>c.rect);
 engine.resizeRightEdge(f,100,new Map());
 const after=engine.layoutFrame(f,new Map()).cells.map(c=>c.rect);
 after.forEach((r,i)=>{close(r[0],before[i][0]); close(r[2],before[i][2]+(i%3===2?100:0));});
});

test('frame height snaps to content and shrinks after content removal, including nested rows',()=>{
 const f=engine.createFrame(); f.size[1]=4000; f.root.nodes=[1,2];
 const m=new Map([[1,{minWidth:160,height:100,titleHeight:30}],[2,{minWidth:160,height:200,titleHeight:30}]]);
 engine.layoutFrame(f,m); close(f.size[1],50+130+230+12+60);
 f.root.nodes=[1]; engine.layoutFrame(f,m); close(f.size[1],50+130+60);
 engine.addBottomRow(f); engine.layoutFrame(f,m); close(f.size[1],50+130+114+12+60);
 f.root.ratios=[.01,.99]; engine.layoutFrame(f,m); close(f.size[1],50+130+114+12+60);
 f.root.children[0].nodes=[]; engine.layoutFrame(f,m); close(f.size[1],114*2+12+60);
});

test('divider drag clamps at content minimum without enlarging frame or unrelated column',()=>{
 const f=engine.createFrame(); engine.gridCell(f,f.root.id,1,3); f.size[0]=1100;
 f.root.children[0].nodes=[1]; f.root.children[1].nodes=[2];
 const m=new Map([[1,{minWidth:260,height:100,titleHeight:30}],[2,{minWidth:300,height:100,titleHeight:30}]]);
 const before=engine.layoutFrame(f,m), size=f.size[0];
 const available=before.dividers[0].available;
 engine.resizeDivider(f.root,0,10,available,m);
 const after=engine.layoutFrame(f,m);
 close(f.size[0],size); close(after.cells[2].rect[2],before.cells[2].rect[2]);
 close(after.cells[1].rect[2],324);
 engine.resizeDivider(f.root,0,-10,available,m);
 close(engine.layoutFrame(f,m).cells[0].rect[2],284); close(f.size[0],size);
});

test('divider clamp respects nested split minimums and stays stable on repeated reflows',()=>{
 const f=engine.createFrame(); engine.gridCell(f,f.root.id,1,3);
 engine.splitCell(f,f.root.children[1].id,'x'); f.root.children[1].ratios=[.25,.75];
 f.root.children[1].children[0].nodes=[1];
 const m=new Map([[1,{minWidth:300,height:100,titleHeight:30}]]);
 const before=engine.layoutFrame(f,m), width=f.size[0];
 engine.resizeDivider(f.root,0,100,before.dividers.find(d=>d.cell===f.root).available,m);
 for(let i=0;i<20;i++) close(engine.layoutFrame(f,m).cells[3].rect[2],before.cells[3].rect[2]);
 close(f.size[0],width);
});

test('shrink layout fits nested columns to control minimums independently of old ratios',()=>{
 const f=engine.createFrame(); engine.gridCell(f,f.root.id,1,3); f.size[0]=5000;
 f.root.ratios=[.1,.2,.7]; f.root.children[0].nodes=[1,2]; f.root.children[1].nodes=[3];
 const m=new Map([[1,{minWidth:220,height:100,titleHeight:30}],[2,{minWidth:300,height:100,titleHeight:30}],[3,{minWidth:250,height:100,titleHeight:30}]]);
 engine.shrinkFrame(f,m); const result=engine.layoutFrame(f,m);
 close(f.size[0],324+274+184+24+24);
 result.cells.forEach((c,i)=>close(c.rect[2],[324,274,184][i]));
 assert.deepEqual(result.cells[0].cell.nodes,[1,2]);
 const size=[...f.size]; engine.shrinkFrame(f,m); assert.deepEqual(f.size,size);
});

test('bottom rows have blank titles that survive validation and template reuse',()=>{
 const f=engine.createFrame(); engine.addBottomRow(f);
 assert.equal(engine.leaves(f.root).at(-1).label,'');
 assert.equal(engine.leaves(engine.validateFrame(f).root).at(-1).label,'');
 assert.equal(engine.leaves(engine.importTemplate(engine.exportTemplate(f),[0,0]).root).at(-1).label,'');
});

test('left-edge resizing changes only boundary cells and keeps the right edge fixed',()=>{
 const f=engine.createFrame(); engine.gridCell(f,f.root.id,2,3); f.size[0]=1200;
 const before=engine.layoutFrame(f,new Map()).cells.map(c=>c.rect), right=f.pos[0]+f.size[0];
 engine.resizeLeftEdge(f,-100,new Map());
 const after=engine.layoutFrame(f,new Map()).cells.map(c=>c.rect);
 close(f.pos[0]+f.size[0],right);
 after.forEach((r,i)=>{close(r[0],before[i][0]-(i%3===0?100:0));close(r[2],before[i][2]+(i%3===0?100:0));});
 engine.resizeLeftEdge(f,10000,new Map());close(f.pos[0]+f.size[0],right);
 close(engine.layoutFrame(f,new Map()).cells[0].rect[2],184);
});

test('border settings validate, survive reload/template reuse and transfer on splits',()=>{
 const f=engine.createFrame();f.border={color:'#123456',width:4,style:'dashed'};f.root.border={color:'#abcdef',width:2,style:'dotted'};
 assert.deepEqual(engine.validateFrame(f).border,f.border);
 engine.splitCell(f,f.root.id,'x');assert.equal(f.root.children[0].border.style,'dotted');
 const restored=engine.importTemplate(engine.exportTemplate(f),[0,0]);assert.deepEqual(restored.border,f.border);assert.deepEqual(restored.root.children[0].border,f.root.children[0].border);
 assert.equal(engine.normalizeBorder({color:'#fff',width:99,style:'solid'}),undefined);
});

test('splitting a column left/right or into a sub-grid preserves sibling column and node widths', () => {
 const f = engine.createFrame();
 engine.gridCell(f, f.root.id, 1, 6);
 const cols = engine.leaves(f.root);
 cols.forEach((col, i) => { col.nodes = [i + 1]; });
 const m = new Map([
  [1, { minWidth: 220, height: 120, titleHeight: 30 }],
  [2, { minWidth: 260, height: 90, titleHeight: 30 }],
  [3, { minWidth: 300, height: 140, titleHeight: 30 }],
  [4, { minWidth: 240, height: 180, titleHeight: 30 }],
  [5, { minWidth: 240, height: 160, titleHeight: 30 }],
  [6, { minWidth: 200, height: 110, titleHeight: 30 }],
 ]);
 engine.shrinkFrame(f, m);
 engine.addBottomRow(f);
 const before = engine.layoutFrame(f, m);
 const beforeWidths = new Map(before.placements.map(p => [p.nodeId, p.width]));

 // Split column 4 (node 4) into left/right
 engine.splitCell(f, cols[3].id, 'x', m);
 const afterSplit = engine.layoutFrame(f, m);
 for (const p of afterSplit.placements) {
  close(p.width, beforeWidths.get(p.nodeId));
 }

 // Nested split inside the right half of column 4 also keeps all existing nodes at their widths
 const rightHalfId = cols[3].children[1].id;
 engine.gridCell(f, rightHalfId, 2, 2, m);
 const afterGrid = engine.layoutFrame(f, m);
 for (const p of afterGrid.placements) {
  close(p.width, beforeWidths.get(p.nodeId));
 }
});

