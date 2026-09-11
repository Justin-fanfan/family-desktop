'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FamilyLinkService,
  validateReminderDraft,
  validateSettingsPatch,
  validateVideoCallAction,
  validateVideoCallStart
} = require('../src/main/services/family-link-service');

function validReminder(overrides = {}) {
  return {
    type: 'medicine',
    title: '按时用药',
    timeOfDay: '08:30',
    scheduledDate: '2026-08-29',
    repeatRule: 'daily',
    enabled: true,
    ...overrides
  };
}

test('dashboard aggregates adapter results without exposing transport to UI', async () => {
  const calls = [];
  const adapter = {
    async getStatus() { calls.push('status'); return { device: { online: true } }; },
    async getSettings() { calls.push('settings'); return { volume: 60 }; },
    async listReminders() { calls.push('reminders'); return [{ id: 1 }]; }
  };
  const service = new FamilyLinkService(adapter);

  const dashboard = await service.getDashboard();

  assert.deepEqual(new Set(calls), new Set(['status', 'settings', 'reminders']));
  assert.equal(dashboard.status.device.online, true);
  assert.equal(dashboard.settings.volume, 60);
  assert.equal(dashboard.reminders[0].id, 1);
});

test('settings validation accepts LongPet ranges and revision', () => {
  assert.deepEqual(
    validateSettingsPatch({ volume: 80, petStyle: '活泼陪伴', expectedRevision: 3 }),
    { volume: 80, petStyle: '活泼陪伴', expectedRevision: 3 }
  );
  assert.throws(
    () => validateSettingsPatch({ volume: 101, expectedRevision: 0 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => validateSettingsPatch({ petStyle: '未知风格', expectedRevision: 0 }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('reminder validation aligns with ReminderDraft contract', () => {
  assert.deepEqual(validateReminderDraft(validReminder()), validReminder());
  assert.throws(
    () => validateReminderDraft(validReminder({ timeOfDay: '25:00' })),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => validateReminderDraft(validReminder({ title: '' })),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('service forwards update id separately and keeps expected revision', async () => {
  let captured = null;
  const adapter = {
    async updateReminder(id, payload) {
      captured = { id, payload };
      return { id, ...payload, revision: payload.expectedRevision + 1 };
    }
  };
  const service = new FamilyLinkService(adapter);

  await service.updateReminder(validReminder({ id: 7, expectedRevision: 4 }));

  assert.equal(captured.id, 7);
  assert.equal(captured.payload.expectedRevision, 4);
  assert.equal(Object.hasOwn(captured.payload, 'id'), false);
});

test('video call action validation and forwarding preserve call revision', async () => {
  let captured = null;
  const adapter = {
    async applyVideoCallAction(request) {
      captured = request;
      return { ...request, state: 'connected', revision: request.expectedRevision + 1 };
    }
  };
  const service = new FamilyLinkService(adapter);
  const request = { callId: 'call-123', action: 'accept', expectedRevision: 4 };

  const result = await service.applyVideoCallAction(request);

  assert.deepEqual(captured, request);
  assert.equal(result.state, 'connected');
  assert.deepEqual(validateVideoCallAction(request), request);
  assert.throws(
    () => validateVideoCallAction({ ...request, action: 'start' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('family initiated call validates voice/video mode and forwards it', async () => {
  let captured = null;
  const service = new FamilyLinkService({
    async startVideoCall(request) { captured = request; return { state: 'notifying_device', ...request }; }
  });
  const result = await service.startVideoCall({ mode: 'voice' });
  assert.deepEqual(captured, { mode: 'voice' });
  assert.equal(result.state, 'notifying_device');
  assert.deepEqual(validateVideoCallStart({ mode: 'video' }), { mode: 'video' });
  assert.throws(() => validateVideoCallStart({ mode: 'text' }),
    (error) => error.code === 'VALIDATION_ERROR');
});

test('AI view session is requested through the service boundary', async () => {
  let calls = 0;
  const service = new FamilyLinkService({
    async createVisionMonitorSession() {
      calls += 1;
      return { sessionId: 'view-2', sessionToken: 'once', port: 8789 };
    }
  });
  const session = await service.createVisionMonitorSession();
  assert.equal(calls, 1);
  assert.equal(session.sessionId, 'view-2');
});
