'use strict';

const { FamilyLinkError } = require('../../shared/family-link-error');

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class MockFamilyLinkAdapter {
  constructor(options = {}) {
    this.delayMs = options.delayMs ?? 80;
    this.settings = {
      volume: 61,
      brightness: 72,
      petStyle: '温和陪伴',
      revision: 1,
      updatedAt: nowIso(),
      capabilities: {
        volume: { available: true, summary: 'USB PnP Sound Device / Speaker' },
        brightness: { available: false, summary: '未检测到可调背光' }
      }
    };
    this.reminders = [
      {
        id: 1,
        type: 'medicine',
        title: '晚间用药',
        timeOfDay: '20:30',
        scheduledDate: todayLocal(),
        repeatRule: 'daily',
        enabled: true,
        revision: 1,
        status: 'pending',
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      {
        id: 2,
        type: 'water',
        title: '记得喝水',
        timeOfDay: '10:00',
        scheduledDate: todayLocal(),
        repeatRule: 'weekdays',
        enabled: true,
        revision: 1,
        status: 'completed',
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
    ];
    this.nextReminderId = 3;
    this.videoCall = clone(options.videoCall ?? {
      callId: '',
      state: 'idle',
      mode: 'video',
      direction: 'device_to_family',
      remoteName: 'LongPet',
      startedAt: null,
      updatedAt: null,
      revision: 0,
      mediaReady: false,
      mediaPort: 8788,
      mediaToken: 'mock-media-token',
      errorCode: null,
      errorMessage: null
    });
  }

  async wait() {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  async getStatus() {
    await this.wait();
    return {
      apiVersion: '1.0',
      capabilities: {
        settingsRead: true,
        settingsWrite: true,
        remindersRead: true,
        remindersWrite: true,
        videoCallSignaling: true
      },
      device: {
        id: 'longpet-demo-001',
        name: '客厅 LongPet',
        softwareVersion: '0.2-dev',
        online: true,
        lastSeenAt: nowIso(),
        networkSummary: 'Wi-Fi 已连接',
        powerSummary: '外接电源',
        audioSummary: 'USB 声卡可用',
        brightnessSummary: '不支持亮度调节'
      },
      system: {
        currentDateTime: nowIso(),
        weatherSummary: '--',
        networkKnown: true,
        networkAvailable: true,
        batteryPercent: -1
      },
      care: {
        waterCompleted: 3,
        waterGoal: 8,
        medicineCompleted: 1,
        medicineTotal: 2,
        activityMinutes: 12,
        interactionCount: 4,
        lastUpdated: nowIso()
      }
    };
  }

  async getSettings() {
    await this.wait();
    return clone(this.settings);
  }

  async updateSettings(payload) {
    await this.wait();
    if (payload.expectedRevision !== this.settings.revision) {
      throw new FamilyLinkError('REVISION_CONFLICT', '设置已被其他家属修改，请刷新后重试', {
        status: 409
      });
    }
    for (const key of ['volume', 'brightness', 'petStyle']) {
      if (Object.hasOwn(payload, key)) {
        this.settings[key] = payload[key];
      }
    }
    this.settings.revision += 1;
    this.settings.updatedAt = nowIso();
    return clone(this.settings);
  }

  async listReminders() {
    await this.wait();
    return clone(this.reminders);
  }

  async createReminder(payload) {
    await this.wait();
    const reminder = {
      ...payload,
      id: this.nextReminderId++,
      revision: 1,
      status: payload.enabled ? 'pending' : 'disabled',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.reminders.push(reminder);
    return clone(reminder);
  }

  async updateReminder(id, payload) {
    await this.wait();
    const index = this.reminders.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new FamilyLinkError('REMINDER_NOT_FOUND', '提醒不存在', { status: 404 });
    }
    if (payload.expectedRevision !== this.reminders[index].revision) {
      throw new FamilyLinkError('REVISION_CONFLICT', '提醒已被修改，请刷新后重试', {
        status: 409
      });
    }
    this.reminders[index] = {
      ...this.reminders[index],
      ...payload,
      revision: this.reminders[index].revision + 1,
      status: payload.enabled ? 'pending' : 'disabled',
      updatedAt: nowIso()
    };
    return clone(this.reminders[index]);
  }

  async deleteReminder(id, expectedRevision) {
    await this.wait();
    const index = this.reminders.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new FamilyLinkError('REMINDER_NOT_FOUND', '提醒不存在', { status: 404 });
    }
    if (expectedRevision !== this.reminders[index].revision) {
      throw new FamilyLinkError('REVISION_CONFLICT', '提醒已被修改，请刷新后重试', {
        status: 409
      });
    }
    this.reminders.splice(index, 1);
    return { deleted: true, id };
  }

  async getVideoCall() {
    await this.wait();
    return clone(this.videoCall);
  }

  async createVisionMonitorSession() {
    await this.wait();
    throw new FamilyLinkError(
      'VISION_MONITOR_UNAVAILABLE',
      '演示模式不连接真实摄像头，请先连接 LongPet 设备'
    );
  }

  async startVideoCall(payload) {
    await this.wait();
    if (['outgoing_ringing', 'notifying_device', 'connecting_media', 'connected']
      .includes(this.videoCall.state)) {
      throw new FamilyLinkError('DEVICE_BUSY', '设备正在通话，请稍后再试', { status: 409 });
    }
    this.videoCall = {
      ...this.videoCall,
      callId: `mock-${Date.now()}`,
      state: 'notifying_device',
      mode: payload.mode,
      direction: 'family_to_device',
      startedAt: nowIso(),
      connectedAt: null,
      updatedAt: nowIso(),
      revision: this.videoCall.revision + 1,
      mediaReady: false,
      errorCode: null,
      errorMessage: null
    };
    return clone(this.videoCall);
  }

  async applyVideoCallAction(payload) {
    await this.wait();
    if (payload.callId !== this.videoCall.callId) {
      throw new FamilyLinkError('CALL_MISMATCH', '通话标识与当前通话不一致', {
        status: 409
      });
    }
    if (payload.expectedRevision !== this.videoCall.revision) {
      throw new FamilyLinkError('REVISION_CONFLICT', '通话状态已变化，请刷新后重试', {
        status: 409
      });
    }
    const allowed = payload.action === 'accept'
      ? this.videoCall.state === 'outgoing_ringing'
      : payload.action === 'reject'
      ? this.videoCall.state === 'outgoing_ringing'
      : ['outgoing_ringing', 'notifying_device', 'connecting_media', 'connected']
        .includes(this.videoCall.state);
    if (!allowed) {
      throw new FamilyLinkError('INVALID_CALL_STATE', '当前通话不能执行该操作', {
        status: 409
      });
    }
    this.videoCall.state = payload.action === 'accept'
      ? 'connecting_media'
      : payload.action === 'reject'
      ? 'rejected'
      : payload.action === 'fail'
      ? 'failed' : 'ended';
    this.videoCall.errorCode = payload.errorCode ?? null;
    this.videoCall.errorMessage = payload.errorMessage ?? null;
    this.videoCall.revision += 1;
    this.videoCall.updatedAt = nowIso();
    return clone(this.videoCall);
  }
}

module.exports = { MockFamilyLinkAdapter };
