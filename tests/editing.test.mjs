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
