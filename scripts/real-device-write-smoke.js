'use strict';

const { HttpFamilyLinkAdapter } = require('../src/main/adapters/http-family-link-adapter');
const { FamilyLinkService } = require('../src/main/services/family-link-service');

const baseUrl = process.env.LONGPET_FAMILY_SMOKE_BASE_URL?.trim();
const token = process.env.LONGPET_FAMILY_SMOKE_TOKEN?.trim();

if (!baseUrl || !token) {
  console.error('需要设置 LONGPET_FAMILY_SMOKE_BASE_URL 和 LONGPET_FAMILY_SMOKE_TOKEN');
  process.exit(2);
}

async function main() {
  const service = new FamilyLinkService(new HttpFamilyLinkAdapter({ baseUrl, token }));
  const dashboard = await service.getDashboard();
  const originalSettings = dashboard.settings;
  const savedSettings = await service.updateSettings({
    volume: originalSettings.volume,
    expectedRevision: originalSettings.revision
  });
  if (savedSettings.revision !== originalSettings.revision + 1) {
    throw new Error('设置 revision 未按预期递增');
  }

  let temporaryReminder = null;
  try {
    temporaryReminder = await service.createReminder({
      type: 'water',
      title: 'FamilyLink 联调临时提醒',
      timeOfDay: '23:59',
      scheduledDate: new Date().toISOString().slice(0, 10),
      repeatRule: 'daily',
      enabled: false
    });
    temporaryReminder = await service.updateReminder({
      ...temporaryReminder,
      title: 'FamilyLink 联调更新提醒',
      expectedRevision: temporaryReminder.revision
    });
    const deleted = await service.deleteReminder({
      id: temporaryReminder.id,
      expectedRevision: temporaryReminder.revision
    });
    temporaryReminder = null;
    console.log(JSON.stringify({
      deviceId: dashboard.status.device.id,
      settingsRevisionBefore: originalSettings.revision,
      settingsRevisionAfter: savedSettings.revision,
      reminderCreatedUpdatedDeleted: deleted.deleted === true
    }, null, 2));
  } finally {
    if (temporaryReminder) {
      try {
        await service.deleteReminder({
          id: temporaryReminder.id,
          expectedRevision: temporaryReminder.revision
        });
      } catch (error) {
        console.error(`临时提醒清理失败：${error.message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
