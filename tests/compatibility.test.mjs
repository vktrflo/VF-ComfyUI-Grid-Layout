import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFrame, splitCell, exportTemplate, importTemplate, validateFrame, KEY } from '../web/core/layout.js';

test('frames, splits and imports work on HTTP LAN origins without randomUUID', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
  try {
    const frames = Array.from({ length: 100 }, () => createFrame());
    splitCell(frames[0], frames[0].root.id, 'x');
    const imported = importTemplate(exportTemplate(frames[0]), [0, 0]);
    const ids = frames.flatMap(frame => [frame.id, frame.root.id]);
    assert.equal(new Set(ids).size, ids.length);
    assert.notEqual(imported.id, frames[0].id);
  } finally { Object.defineProperty(globalThis, 'crypto', original); }
});

test('layout IDs remain unique when no crypto API is available', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    const ids = Array.from({ length: 100 }, () => createFrame().id);
    assert.equal(new Set(ids).size, ids.length);
  } finally { Object.defineProperty(globalThis, 'crypto', original); }
});

test('example workflow is a real connected ComfyUI graph with populated layout metadata', async () => {
  const workflow = JSON.parse(await readFile(new URL('../examples/two-column.workflow.json', import.meta.url), 'utf8').catch(() => '{}'));
  assert.equal(workflow.version, 0.4);
  assert.deepEqual(workflow.nodes.map(n => n.type), ['EmptyImage', 'SaveImage']);
  assert.equal(workflow.links.length, 1);
  assert.equal(workflow.extra[KEY].version, 1);
  const frame = validateFrame(workflow.extra[KEY].frames[0]);
  assert.deepEqual(frame.root.children.map(cell => cell.nodes), [[1], [2]]);
});
