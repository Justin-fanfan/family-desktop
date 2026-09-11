'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const windowListeners = new Map();
global.window = {
  addEventListener(type, listener) { windowListeners.set(type, listener); },
  removeEventListener(type, listener) {
    if (windowListeners.get(type) === listener) windowListeners.delete(type);
  }
};
global.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {}
};
require('../src/renderer/video-call-media-adapter.js');
require('../src/renderer/motion-control-adapter.js');

const { MotionControlAdapter, LongPetMotionControlProtocol } = require(
  '../src/renderer/motion-control-adapter.js'
);

function decodedControls(socket) {
  return socket.sent.map((bytes) => {
    const frame = window.LongPetMediaProtocol.decodeFrame(bytes);
    return JSON.parse(new TextDecoder().decode(frame.payload));
  });
}

function fakeOpenSocket() {
  return {
    readyState: 1,
    sent: [],
    send(bytes) { this.sent.push(bytes); },
    close() {},
    addEventListener() {}
  };
}

test('motion control derives an independent websocket URL and maps keyboard keys', () => {
  assert.equal(
    LongPetMotionControlProtocol.deriveMotionControlUrl(
      'http://192.168.137.32:8787', { port: 8790 }
    ),
    'ws://192.168.137.32:8790/motion-control/v1'
  );
  assert.deepEqual(LongPetMotionControlProtocol.keyboardBinding('KeyW'),
    { channel: 'chassis', action: 'FORWARD' });
  assert.deepEqual(LongPetMotionControlProtocol.keyboardBinding('KeyJ'),
    { channel: 'head', action: 'LEFT' });
  assert.deepEqual(LongPetMotionControlProtocol.keyboardBinding('Space'),
    { channel: 'safety', action: 'STOP' });
  assert.deepEqual(LongPetMotionControlProtocol.keyboardBinding('Escape'),
    { channel: 'safety', action: 'EXIT' });
  assert.equal(LongPetMotionControlProtocol.keyboardBinding('ArrowUp'), null);
});

test('held chassis refreshes its lease and release sends STOP', async () => {
  const socket = fakeOpenSocket();
  const adapter = new MotionControlAdapter();
  adapter.socket = socket;
  adapter.authenticated = true;
  adapter.refreshIntervalMs = 25;
  assert.equal(adapter.startChassis('FORWARD', 20), true);
  await new Promise((resolve) => setTimeout(resolve, 70));
  adapter.stopChassis(true);
  const messages = decodedControls(socket);
  assert.ok(messages.filter((value) => value.type === 'chassis').length >= 2);
  assert.deepEqual(messages.at(-1), { type: 'stop' });
});

test('head hold never emits chassis STOP and emergency paths do', async () => {
  const socket = fakeOpenSocket();
  const statuses = [];
  const adapter = new MotionControlAdapter({ onStatus: (value) => statuses.push(value) });
  adapter.socket = socket;
  adapter.authenticated = true;
  adapter.refreshIntervalMs = 20;
  assert.equal(adapter.startHead('LEFT', 20), true);
  await new Promise((resolve) => setTimeout(resolve, 45));
  adapter.stopHead();
  let messages = decodedControls(socket);
  assert.ok(messages.filter((value) => value.type === 'head').length >= 2);
  assert.equal(messages.some((value) => value.type === 'stop'), false);
  adapter.emergencyStop('失焦');
  messages = decodedControls(socket);
  assert.deepEqual(messages.at(-1), { type: 'stop' });
  assert.match(statuses.at(-1), /停车/);
});

test('window focus loss uses the same emergency STOP path', () => {
  const socket = fakeOpenSocket();
  const adapter = new MotionControlAdapter();
  adapter.socket = socket;
  adapter.authenticated = true;
  adapter.startChassis('ROTATE_LEFT', 15);
  adapter.handleWindowBlur();
  const messages = decodedControls(socket);
  assert.deepEqual(messages.at(-1), { type: 'stop' });
  assert.equal(adapter.activeChassis, null);
});

test('unsupported shift direction is never accepted by the family adapter', () => {
  const adapter = new MotionControlAdapter();
  adapter.socket = fakeOpenSocket();
  adapter.authenticated = true;
  assert.equal(adapter.startChassis('SHIFT_LEFT', 20), false);
  assert.equal(adapter.socket.sent.length, 0);
});
