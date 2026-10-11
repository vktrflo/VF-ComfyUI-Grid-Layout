import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

test('validateFrame validates container appearance properties on frames', () => {
  const frame = engine.createFrame([0, 0]);
  frame.containerColor = '#182024';
  frame.containerOpacity = 0.75;
  frame.containerPattern = 'dots';
  frame.containerImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  frame.containerImageMode = 'cover';

  const validated = engine.validateFrame(frame);
  assert.equal(validated.containerColor, '#182024');
  assert.equal(validated.containerOpacity, 0.75);
  assert.equal(validated.containerPattern, 'dots');
  assert.equal(validated.containerImage, frame.containerImage);
  assert.equal(validated.containerImageMode, 'cover');

  // Bad values are sanitized or dropped
  const bad = engine.createFrame([0, 0]);
  bad.containerColor = 'invalid-color';
  bad.containerOpacity = 'not-a-number';
  bad.containerPattern = 'nonexistent-pattern';
  bad.containerImage = 12345;
  bad.containerImageMode = 'unknown-mode';

  const sanitized = engine.validateFrame(bad);
  assert.equal('containerColor' in sanitized, false);
  assert.equal('containerOpacity' in sanitized, false);
  assert.equal('containerPattern' in sanitized, false);
  assert.equal('containerImage' in sanitized, false);
  assert.equal('containerImageMode' in sanitized, false);
});

test('container appearance is frame-level only and never attaches to cells', () => {
  const frame = engine.createFrame([0, 0]);
  frame.root.containerColor = '#182024';
  frame.root.containerOpacity = 0.5;
  frame.root.containerPattern = 'grid';

  const validated = engine.validateFrame(frame);
  assert.equal('containerColor' in validated.root, false);
  assert.equal('containerOpacity' in validated.root, false);
  assert.equal('containerPattern' in validated.root, false);
});

test('container appearance survives export and template import', () => {
  const frame = engine.createFrame([10, 20]);
  frame.containerColor = '#223344';
  frame.containerOpacity = 0.6;
  frame.containerPattern = 'hexagons';
  frame.containerImageMode = 'repeat';

  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.containerColor, '#223344');
  assert.equal(template.frame.containerOpacity, 0.6);
  assert.equal(template.frame.containerPattern, 'hexagons');
  assert.equal(template.frame.containerImageMode, 'repeat');

  const restored = engine.importTemplate(template, [100, 200]);
  assert.equal(restored.containerColor, '#223344');
  assert.equal(restored.containerOpacity, 0.6);
  assert.equal(restored.containerPattern, 'hexagons');
  assert.equal(restored.containerImageMode, 'repeat');
});

test('appearance normalization helpers sanitize inputs correctly', () => {
  // normalizePattern
  assert.equal(engine.normalizePattern('DOTS'), 'dots');
  assert.equal(engine.normalizePattern('grid'), 'grid');
  assert.equal(engine.normalizePattern('none'), undefined);
  assert.equal(engine.normalizePattern('unknown'), undefined);
  assert.equal(engine.normalizePattern(123), undefined);

  // normalizeOpacity
  assert.equal(engine.normalizeOpacity(0.5), 0.5);
  assert.equal(engine.normalizeOpacity('0.75'), 0.75);
  assert.equal(engine.normalizeOpacity(1.5), 1);
  assert.equal(engine.normalizeOpacity(-0.5), 0);
  assert.equal(engine.normalizeOpacity(0.3333), 0.33);
  assert.equal(engine.normalizeOpacity('invalid'), undefined);

  // normalizeImage
  assert.equal(engine.normalizeImage('  data:image/png;base64,abc  '), 'data:image/png;base64,abc');
  assert.equal(engine.normalizeImage('https://example.com/test.png'), undefined, 'remote images are not fetched');
  assert.equal(engine.normalizeImage('ftp://example.com/test.png'), undefined);
  assert.equal(engine.normalizeImage('not-an-image'), undefined);

  // normalizeImageMode
  assert.equal(engine.normalizeImageMode('REPEAT'), 'repeat');
  assert.equal(engine.normalizeImageMode('cover'), 'cover');
  assert.equal(engine.normalizeImageMode('contain'), undefined);

  // normalizeContainerMode
  assert.equal(engine.normalizeContainerMode('COLOR'), 'color');
  assert.equal(engine.normalizeContainerMode('image'), 'image');
  assert.equal(engine.normalizeContainerMode('pattern'), undefined);
  assert.equal(engine.normalizeContainerMode(123), undefined);
});

test('containerMode validates and round-trips correctly', () => {
  const frame = engine.createFrame([0, 0]);
  frame.containerMode = 'image';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.containerMode, 'image');

  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.containerMode, 'image');

  const restored = engine.importTemplate(template, [10, 20]);
  assert.equal(restored.containerMode, 'image');
});

test('a background image at the upload limit survives saving', () => {
  const base64Length = n => Math.ceil(n / 3) * 4;
  const atLimit = `data:image/png;base64,${'A'.repeat(base64Length(engine.MAX_IMAGE_BYTES))}`;
  assert.equal(engine.normalizeImage(atLimit), atLimit, 'a 2 MB file encodes to a value that is kept');
  const tooBig = `data:image/png;base64,${'A'.repeat(base64Length(engine.MAX_IMAGE_BYTES) + 1024)}`;
  assert.equal(engine.normalizeImage(tooBig), undefined);
});
