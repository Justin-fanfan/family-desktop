'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.window = {};
require('../src/renderer/video-call-media-adapter.js');
require('../src/renderer/vision-monitor-adapter.js');

const {
  deriveVisionMonitorUrl,
  parseVisionMetadata,
  shouldDisplayTarget,
  MAX_TARGET_AGE_MS
} = global.window.LongPetVisionMonitorProtocol;

test('AI view derives its websocket host from the configured FamilyLink URL', () => {
  assert.equal(
    deriveVisionMonitorUrl('http://192.168.137.32:8787', { port: 8789 }),
    'ws://192.168.137.32:8789/vision-monitor/v1'
  );
  assert.equal(
    deriveVisionMonitorUrl('https://longpet.lan/api', { port: 9444 }),
    'wss://longpet.lan:9444/vision-monitor/v1'
  );
});

test('AI target metadata keeps normalized bbox and clamps invalid edges', () => {
  const target = parseVisionMetadata({
    type: 'vision_target', protocol_version: 1, present: true, fresh: true,
    state: 'tracking', age_ms: 42,
    bbox: { x: 0.85, y: -0.1, w: 0.4, h: 0.7 }
  }, 1000);
  assert.deepEqual(target.bbox, { x: 0.85, y: 0, w: 0.15000000000000002, h: 0.7 });
  assert.equal(target.state, 'TRACKING');
  assert.equal(shouldDisplayTarget(target, 1000), true);
});

test('AI overlay hides searching, lost, stale and absent observations', () => {
  const base = {
    type: 'vision_target', protocol_version: 1, present: true, fresh: true,
    state: 'TRACKING', age_ms: 20, bbox: { x: 0.2, y: 0.1, w: 0.3, h: 0.7 }
  };
  assert.equal(shouldDisplayTarget(parseVisionMetadata({ ...base, state: 'SEARCHING' })), false);
  assert.equal(shouldDisplayTarget(parseVisionMetadata({ ...base, state: 'LOST' })), false);
  assert.equal(shouldDisplayTarget(parseVisionMetadata({ ...base, fresh: false })), false);
  assert.equal(shouldDisplayTarget(parseVisionMetadata({ ...base, present: false })), false);
  assert.equal(shouldDisplayTarget(parseVisionMetadata(base, 1000),
    1000 + MAX_TARGET_AGE_MS + 1), false);
});

test('AI target metadata rejects an incompatible protocol version', () => {
  assert.throws(() => parseVisionMetadata({
    type: 'vision_target', protocol_version: 2
  }), /版本无效/);
});
