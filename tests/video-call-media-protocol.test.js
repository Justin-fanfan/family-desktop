'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.window = {};
require('../src/renderer/video-call-media-adapter.js');
const { encodeFrame, decodeFrame, deriveMediaUrl, STREAM, VIDEO_SETTINGS } =
  global.window.LongPetMediaProtocol;

test('binary media frame preserves versioned header and payload', () => {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const encoded = encodeFrame(STREAM.familyAudio, 27, payload);
  const decoded = decodeFrame(encoded);
  assert.equal(decoded.streamType, STREAM.familyAudio);
  assert.equal(decoded.sequence, 27);
  assert.deepEqual([...new Uint8Array(decoded.payload)], [...payload]);
  const invalid = encoded.slice(0);
  new Uint8Array(invalid)[0] = 0;
  assert.throws(() => decodeFrame(invalid), /帧头无效/);
});

test('media URL derives host from configured FamilyLink URL and only replaces port', () => {
  assert.equal(
    deriveMediaUrl('http://10.240.178.51:8787', { mediaPort: 8788 }),
    'ws://10.240.178.51:8788/media/v1'
  );
  assert.equal(
    deriveMediaUrl('https://longpet.lan/api', { mediaPort: 9443 }),
    'wss://longpet.lan:9443/media/v1'
  );
});

test('family video sent to LongPet uses the low-CPU profile', () => {
  assert.deepEqual(VIDEO_SETTINGS, {
    familyVideoWidth: 480,
    familyVideoHeight: 360,
    familyVideoIntervalMs: 125
  });
});
