import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

test('validateFrame keeps frame lock true and drops everything else', () => {
  const frame = engine.createFrame([1, 2]);
  frame.lock = true;
  frame.fill = true;
  const validated = engine.validateFrame(frame);
  assert.equal(validated.lock, true);
  assert.equal(validated.fill, true, 'lock and fill coexist');

  for (const bad of [false, 'yes', 1, null, undefined]) {
    const f = engine.createFrame([0, 0]);
    f.lock = bad;
    assert.equal('lock' in engine.validateFrame(f), false, `expected ${String(bad)} to be dropped`);
  }

  const cells = engine.createFrame([0, 0]);
  engine.splitCell(cells, cells.root.id, 'x');
  cells.root.lock = true; // frame-level only
  assert.equal('lock' in engine.validateFrame(cells).root, false);
});

test('frame lock survives splits, grids, and template round trips', () => {
  const frame = engine.createFrame([10, 20]);
  frame.lock = true;
  engine.splitCell(frame, frame.root.id, 'x');
  engine.gridCell(frame, frame.root.children[1].id, 2, 2);
  assert.equal(frame.lock, true);
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(engine.exportTemplate(frame))), [5, 6]);
  assert.equal(restored.lock, true);
});
