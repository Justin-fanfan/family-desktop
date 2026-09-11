'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.window = {};
require('../src/renderer/video-call-media-adapter.js');
const {
  encodeFrame, decodeFrame, deriveMediaUrl, normalizeCameraRotation,
  orientedImageSize, STREAM, VIDEO_SETTINGS
} =
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
    deriveMediaUrl('http://192.168.137.32:8787', { mediaPort: 8788 }),
    'ws://192.168.137.32:8788/media/v1'
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

test('camera rotation accepts quarter turns and swaps oriented dimensions', () => {
  assert.equal(normalizeCameraRotation(180), 180);
  assert.equal(normalizeCameraRotation('270'), 270);
  assert.equal(normalizeCameraRotation(45), 0);
  assert.deepEqual(orientedImageSize(640, 480, 180), { width: 640, height: 480 });
  assert.deepEqual(orientedImageSize(640, 480, 90), { width: 480, height: 640 });
});
