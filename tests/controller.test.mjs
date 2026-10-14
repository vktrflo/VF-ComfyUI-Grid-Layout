import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, splitCell, shrinkFrame, exportTemplate } from '../web/core/layout.js';
const { LayoutController } = await import('../web/core/controller.js').catch(() => ({}));
const { NodeAdapter } = await import('../web/core/adapter.js').catch(() => ({}));

function host() {
  assert.equal(typeof LayoutController, 'function', 'controller must be implemented');
  const node = { id: 1, pos: [0, 0], size: [300, 100], inputs: [{ link: 7 }], widgets: [{ value: 'hello' }], computeSize: () => [220, 80], setSize(size) { this.size = size; } };
  const graph = { extra: { unrelated: 42 }, _nodes: [node], getNodeById: id => String(id) === '1' ? node : null, setDirtyCanvas() {} };
  const events = [];
  const canvas = { graph, emitBeforeChange: () => events.push('before'), emitAfterChange: () => events.push('after'), ds: { scale: 2, offset: [10, 20] }, canvas: { getBoundingClientRect: () => ({ left: 50, top: 60 }) } };
  const app = { canvas, graph, configuringGraph: false };
  return { app, graph, node, events, controller: new LayoutController(app, { classicTitle: 30, defaultColumns: 1 }) };
}

test('create and attach persist in graph extra and balance native transactions', () => {
  const { controller, graph, node, events } = host();
  const frame = controller.create([100, 100]);
  controller.drop([1], [200, 250]);
  assert.equal(graph.extra.unrelated, 42);
  assert.equal(graph.extra[KEY].version, 1);
  assert.deepEqual(frame.root.nodes, [1]);
  assert.equal(node.size[0], frame.size[0] - 48);
  assert.deepEqual(node.widgets, [{ value: 'hello' }]);
  assert.deepEqual(node.inputs, [{ link: 7 }]);
  assert.deepEqual(events, ['before', 'after', 'before', 'after']);
});

test('move and resize reflow attached nodes; remove retains nodes and links', () => {
  const { controller, graph, node } = host();
  const frame = controller.create([100, 100]); controller.drop([1], [200, 250]);
  const start = [...node.pos];
  controller.edit(() => { frame.pos[0] += 50; frame.pos[1] += 60; frame.size[0] += 100; });
  assert.deepEqual(node.pos, [start[0] + 50, start[1] + 60]);
  assert.equal(node.size[0], frame.size[0] - 48);
  controller.remove(frame.id);
  assert.equal(controller.frames.length, 0);
  assert.equal(graph._nodes.length, 1);
  assert.equal(node.inputs[0].link, 7);
});

test('graph switching and history restoration use restored metadata instead of stale references', () => {
  const { controller, app, graph } = host();
  controller.create([0, 0]);
  const saved = JSON.parse(JSON.stringify(graph.extra));
  controller.create([700, 0]);
  graph.extra = saved;
  assert.equal(controller.frames.length, 1);
  app.canvas.graph = { extra: {}, _nodes: [], getNodeById: () => null };
  assert.equal(controller.frames.length, 0);
  app.canvas.graph = graph;
  assert.equal(controller.frames.length, 1);
});

test('failed edits restore metadata and release history transaction', () => {
  const { controller, graph, events } = host();
  controller.create([0, 0]);
  const saved = JSON.stringify(graph.extra);
  assert.throws(() => controller.edit(() => { controller.frames[0].label = 'broken'; throw new Error('failure'); }));
  assert.equal(JSON.stringify(graph.extra), saved);
  assert.equal(events.at(-1), 'after');
});

test('adapter accounts for zoom/pan and classic title geometry', () => {
  const { app, node } = host();
  assert.equal(typeof NodeAdapter, 'function');
  const adapter = new NodeAdapter(app, { classicTitle: 30, defaultColumns: 1 });
  assert.deepEqual(adapter.point({ clientX: 150, clientY: 180 }), [40, 40]);
  assert.deepEqual(adapter.measure(node), { minWidth: 220, height: 100, minHeight: 80, collapsed: false, titleHeight: 30 });
});

test('adapter uses ComfyUI tuple-based coordinate conversion', () => {
  const { app } = host();
  app.clientPosToCanvasPos = point => { assert.deepEqual(point, [150, 180]); return [40, 40]; };
  const adapter = new NodeAdapter(app);
  assert.deepEqual(adapter.point({ clientX: 150, clientY: 180 }), [40, 40]);
});

test('Nodes 2.0 retains the graph title offset when stacking nodes', () => {
  const { app, node } = host();
  const adapter = new NodeAdapter(app, { classicTitle: 30, isVue: () => true });
  assert.equal(adapter.measure(node).titleHeight, 30);
});

test('drop outside detaches; unsupported metadata is preserved and rejected on edit', () => {
  const { controller, graph } = host();
  const frame = controller.create([0, 0]); controller.drop([1], [100, 100]);
  controller.drop([1], [-500, -500]);
  assert.deepEqual(frame.root.nodes, []);
  graph.extra[KEY] = { version: 999, frames: [] };
  assert.throws(() => controller.create([0, 0]), /version/);
  assert.equal(graph.extra[KEY].version, 999);
});

test('content minimum widths can grow without treating imposed cell width as a minimum', () => {
  const { app, node } = host();
  const adapter = new NodeAdapter(app);
  assert.equal(adapter.measure(node).minWidth, 220);
  adapter.apply(node, { x: 0, y: 0, width: 600, height: 100 });
  node.computeSize = () => [node.size[0], 100];
  assert.equal(adapter.measure(node).minWidth, 220);
  node.min_size = [500, 100]; node.computeSize = () => [500, 100];
  assert.equal(adapter.measure(node).minWidth, 500);
});

test('malformed workflow layout metadata is rejected before recursive geometry', () => {
  const { controller, graph } = host();
  const frame = controller.create([0, 0]);
  frame.root.children = [frame.root];
  assert.throws(() => controller.geometry(), /Invalid|complex|circular/i);
  assert.equal(graph.extra.unrelated, 42);
});

test('growth beyond serialization bounds rolls back to an exportable layout', () => {
  const { controller } = host();
  controller.create([0, 0]);
  let rejected = false;
  for (let i = 0; i < 16; i++) {
    try {
      controller.edit(() => {
        const frame = controller.frames[0]; let cell = frame.root;
        while (cell.children) cell = cell.children[0];
        splitCell(frame, cell.id, 'x');
      });
    } catch { rejected = true; break; }
  }
  assert.ok(rejected);
  assert.doesNotThrow(() => controller.geometry());
  assert.doesNotThrow(() => exportTemplate(controller.frames[0]));
});

test('invalid drag updates roll back even within an already-open history gesture', () => {
  const { controller, events } = host();
  controller.create([0, 0]);
  const original = JSON.stringify(controller.frames);
  controller.begin();
  assert.throws(() => controller.edit(() => { controller.frames[0].size = [Infinity, 500]; }));
  controller.end();
  assert.equal(JSON.stringify(controller.frames), original);
  assert.doesNotThrow(() => controller.export(controller.frames[0]));
  assert.deepEqual(events, ['before', 'after', 'before', 'after']);
});

 test('new layout defaults to one row of two equal empty cells', () => {
 const {app}=host(); const controller=new LayoutController(app);
 const frame=controller.create([100,100]);
 assert.equal(frame.root.axis,'x'); assert.deepEqual(frame.root.ratios,[0.5,0.5]);
 assert.equal(frame.root.children.length,2);
 assert.ok(frame.root.children.every(cell=>cell.nodes.length===0));
 const cells=controller.geometry()[0].cells; assert.equal(cells[0].rect[2],cells[1].rect[2]);
 });

test('selected nodes size each column to its widest node, preserve connections, and transfer membership',()=>{
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
 const {controller,graph,node,events}=host();
 let otherResized=false,thirdResized=false;
 const other={...node,id:2,pos:[700,200],size:[260,100],inputs:[{link:8}],setSize(size){otherResized=true;this.size=size;}};
 const third={...node,id:3,pos:[15,300],size:[420,100],setSize(size){thirdResized=true;this.size=size;}};
 graph._nodes.push(other,third);graph.getNodeById=id=>graph._nodes.find(n=>String(n.id)===String(id));
 const f=controller.createFromNodes([3,2,1],'columns');
 assert.equal(f.root.children.length,2);assert.deepEqual(f.root.children.map(c=>c.nodes),[[1,3],[2]]);
 close(node.size[0],420);assert.equal(third.size[0],420);assert.equal(other.size[0],260);
 assert.equal(thirdResized,false,'widest node in column 1 is not resized');
 assert.equal(otherResized,false,'widest node in column 2 is not resized');
 const cells=controller.geometry()[0].cells;
 close(cells[0].rect[2],420+24);
 close(cells[1].rect[2],260+24);
 assert.equal(other.inputs[0].link,8);assert.deepEqual(events,['before','after']);
 node.size=[310,100];other.size=[480,100];otherResized=false;
 const stacked=controller.createFromNodes([1,2],'stack');assert.deepEqual(stacked.root.nodes,[1,2]);
 close(node.size[0],480);assert.equal(other.size[0],480);
 assert.equal(otherResized,false,'widest node in single stack is not resized');
 close(controller.geometry()[1].cells[0].rect[2],480+24);
 assert.deepEqual(f.root.children.map(c=>c.nodes),[[3],[]]);
 controller.edit(()=>shrinkFrame(stacked,controller.metrics()));
 close(node.size[0],220);close(other.size[0],220);
 assert.throws(()=>controller.createFromNodes([],'columns'),/Select/);
});

test('Nodes 2.0 CSS minimum width overrides classic computation without affecting legacy mode',()=>{
 const {app,node}=host();const adapter=new NodeAdapter(app);
 const previous={LiteGraph:globalThis.LiteGraph,document:globalThis.document,CSS:globalThis.CSS,getComputedStyle:globalThis.getComputedStyle};
 try {
 globalThis.LiteGraph={vueNodesMode:true};globalThis.document={querySelector:()=>({})};globalThis.CSS={escape:String};globalThis.getComputedStyle=()=>({minWidth:'225px'});
 assert.equal(adapter.measure(node).minWidth,225);
 globalThis.LiteGraph.vueNodesMode=false;assert.equal(adapter.measure(node).minWidth,220);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('controller targetNode respects cautious detection and target ignores locked frames', () => {
  const { controller } = host();
  const frame = controller.create([100, 100]);
  const node = { id: 99, pos: [150, 200], size: [150, 80] };
  assert.ok(controller.targetNode(node), 'valid node inside cell is targeted');

  const outsideNode = { id: 98, pos: [50, 200], size: [150, 80] };
  assert.equal(controller.targetNode(outsideNode), null, 'outside node is not targeted');

  frame.lock = true;
  assert.equal(controller.targetNode(node), null, 'locked frame is not targeted by targetNode');
  assert.equal(controller.target([150, 200]), null, 'locked frame is not targeted by target');
});
