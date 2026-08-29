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
