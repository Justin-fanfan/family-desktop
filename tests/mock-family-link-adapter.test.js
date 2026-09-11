'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { MockFamilyLinkAdapter } = require('../src/main/adapters/mock-family-link-adapter');
const { FamilyLinkService } = require('../src/main/services/family-link-service');

function draft(overrides = {}) {
  return {
    type: 'water',
    title: '下午喝水',
    timeOfDay: '15:00',
    scheduledDate: '2026-08-29',
    repeatRule: 'daily',
    enabled: true,
    ...overrides
  };
}

test('mock adapter provides a complete interactive dashboard', async () => {
  const service = new FamilyLinkService(new MockFamilyLinkAdapter({ delayMs: 0 }));
  const dashboard = await service.getDashboard();

  assert.equal(dashboard.status.device.online, true);
  assert.equal(dashboard.status.capabilities.settingsWrite, true);
  assert.equal(dashboard.settings.capabilities.volume.available, true);
  assert.ok(dashboard.reminders.length >= 2);
});

test('mock reminder create, update and delete preserve optimistic revisions', async () => {
  const service = new FamilyLinkService(new MockFamilyLinkAdapter({ delayMs: 0 }));
  const created = await service.createReminder(draft());
  assert.equal(created.revision, 1);

  const updated = await service.updateReminder({
    ...draft({ title: '下午补水' }),
    id: created.id,
    expectedRevision: created.revision
  });
  assert.equal(updated.title, '下午补水');
  assert.equal(updated.revision, 2);

  await assert.rejects(
    service.updateReminder({
      ...draft({ title: '过期修改' }),
      id: created.id,
      expectedRevision: 1
    }),
    (error) => error.code === 'REVISION_CONFLICT'
  );

  const deleted = await service.deleteReminder({
    id: created.id,
    expectedRevision: updated.revision
  });
  assert.deepEqual(deleted, { deleted: true, id: created.id });
});

test('mock settings rejects stale writes', async () => {
  const service = new FamilyLinkService(new MockFamilyLinkAdapter({ delayMs: 0 }));
  const original = (await service.getDashboard()).settings;
  const saved = await service.updateSettings({ volume: 75, expectedRevision: original.revision });
  assert.equal(saved.revision, original.revision + 1);

  await assert.rejects(
    service.updateSettings({ volume: 50, expectedRevision: original.revision }),
    (error) => error.code === 'REVISION_CONFLICT'
  );
});

test('mock video call accepts and hangs up with optimistic revisions', async () => {
  const service = new FamilyLinkService(new MockFamilyLinkAdapter({
    delayMs: 0,
    videoCall: {
      callId: 'demo-call',
      state: 'outgoing_ringing',
      direction: 'device_to_family',
      remoteName: 'LongPet',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1,
      mediaReady: false
    }
  }));

  const ringing = await service.getVideoCall();
  const connected = await service.applyVideoCallAction({
    callId: ringing.callId,
    action: 'accept',
    expectedRevision: ringing.revision
  });
  assert.equal(connected.state, 'connecting_media');

  const ended = await service.applyVideoCallAction({
    callId: connected.callId,
    action: 'hangup',
    expectedRevision: connected.revision
  });
  assert.equal(ended.state, 'ended');
  assert.equal(ended.revision, 3);
});

test('mock family call selects voice mode and reports busy while active', async () => {
  const service = new FamilyLinkService(new MockFamilyLinkAdapter({ delayMs: 0 }));
  const started = await service.startVideoCall({ mode: 'voice' });
  assert.equal(started.mode, 'voice');
  assert.equal(started.direction, 'family_to_device');
  assert.equal(started.state, 'notifying_device');
  await assert.rejects(
    service.startVideoCall({ mode: 'video' }),
    (error) => error.code === 'DEVICE_BUSY'
  );
});

test('mock automatic head tracking is off by default and can be toggled', async () => {
  const service = new FamilyLinkService(new MockFamilyLinkAdapter({ delayMs: 0 }));
  assert.equal((await service.getAutomaticHeadTracking()).enabled, false);
  const enabled = await service.setAutomaticHeadTracking({ enabled: true });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.state, 'SEARCHING');
  const disabled = await service.setAutomaticHeadTracking({ enabled: false });
  assert.equal(disabled.state, 'DISABLED');
});
