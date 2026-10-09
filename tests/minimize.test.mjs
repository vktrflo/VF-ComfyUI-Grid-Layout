import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

const metrics = new Map([[1, { minWidth: 250, height: 100, titleHeight: 30 }], [2, { minWidth: 340, height: 200, titleHeight: 30 }]]);
const populated = () => {
  const frame = engine.createFrame([100, 200]);
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [first, second] = engine.leaves(frame.root);
  engine.dropNodes([frame], frame.id, first.id, [1]);
  engine.dropNodes([frame], frame.id, second.id, [2]);
  engine.layoutFrame(frame, metrics);
  return frame;
};

test('validateFrame keeps frame minimized true and drops everything else', () => {
  const frame = engine.createFrame([1, 2]);
  frame.minimized = true;
  frame.lock = true;
  const validated = engine.validateFrame(frame);
  assert.equal(validated.minimized, true);
  assert.equal(validated.lock, true, 'minimized and lock coexist');

  for (const bad of [false, 'yes', 1, null, undefined]) {
    const f = engine.createFrame([0, 0]);
    f.minimized = bad;
    assert.equal('minimized' in engine.validateFrame(f), false, `expected ${String(bad)} to be dropped`);
  }

  const cells = engine.createFrame([0, 0]);
  engine.splitCell(cells, cells.root.id, 'x');
  cells.root.minimized = true; // frame-level only
  assert.equal('minimized' in engine.validateFrame(cells).root, false);
});

test('minimizedNodes survives only while minimized and never ships in a template', () => {
  const frame = populated();
  frame.minimized = true;
  frame.minimizedNodes = [1, 2, 2, 'text-id', NaN, Infinity];
  assert.deepEqual(engine.validateFrame(frame).minimizedNodes, [1, 2, 'text-id'], 'ids are deduped and filtered');

  const restored = engine.validateFrame({ ...frame, minimized: false });
  assert.equal('minimizedNodes' in restored, false);

  const bare = engine.validateFrame({ ...frame, minimizedNodes: undefined });
  assert.equal('minimizedNodes' in bare, false, 'no list means no entry');

  const template = engine.exportTemplate(frame);
  assert.equal('minimizedNodes' in template.frame, false, 'a template carries no node references');
  assert.equal('minimized' in template.frame, false, 'a template does not ship minimized state');
});

test('a minimized frame reduces size to FRAME_TITLE, returns empty cells and dividers, and emits placements at the header', () => {
  const frame = populated();
  const expanded = engine.layoutFrame(frame, metrics);
  assert.equal(expanded.placements.length, 2, 'expanded grid has geometry');
  assert.ok(frame.size[1] > engine.FRAME_TITLE, 'expanded frame height is larger than FRAME_TITLE');

  frame.minimized = true;
  const minimized = engine.layoutFrame(frame, metrics);
  assert.equal(frame.size[1], engine.FRAME_TITLE, 'minimized frame size is clamped to FRAME_TITLE (header height)');
  assert.deepEqual(minimized.cells, [], 'a minimized frame offers no drop targets / cells');
  assert.deepEqual(minimized.dividers, [], 'a minimized frame has no dividers');
  assert.equal(minimized.placements.length, 2, 'contained nodes still have placements tracking the header');

  for (const placement of minimized.placements) {
    assert.equal(placement.x, frame.pos[0] + engine.PAD, 'placement x aligns with frame header');
    assert.equal(placement.y, frame.pos[1] + engine.FRAME_TITLE, 'placement y sits at frame header');
    assert.equal(placement.height, 0, 'placement height is 0');
  }

  // An empty minimized frame
  const bare = engine.createFrame([0, 0]);
  bare.minimized = true;
  assert.deepEqual(engine.layoutFrame(bare, metrics).placements, []);
  assert.equal(bare.size[1], engine.FRAME_TITLE);
});

test('restoring from minimize restores full geometry and content-derived height', () => {
  const frame = populated();
  frame.minimized = true;
  engine.layoutFrame(frame, metrics);
  assert.equal(frame.size[1], engine.FRAME_TITLE);

  delete frame.minimized;
  const { cells, dividers, placements } = engine.layoutFrame(frame, metrics);
  assert.equal(cells.length, 2);
  assert.equal(dividers.length, 1);
  assert.equal(placements.length, 2);
  assert.ok(frame.size[1] > engine.FRAME_TITLE, 'the frame grows back to fit its content');
  assert.ok(placements[0].height > 0);
  assert.ok(placements[1].height > 0);
});

test('a minimized frame refuses operations that need a body', () => {
  const frame = populated();
  frame.minimized = true;
  assert.throws(() => engine.addBottomRow(frame), /Restore the grid before adding a bottom row\./);
});
