'use strict';

const { FamilyLinkError } = require('../../shared/family-link-error');

const REMINDER_TYPES = new Set(['medicine', 'water', 'other']);
const REPEAT_RULES = new Set(['daily', 'weekdays', 'once']);
const PET_STYLES = new Set(['温和陪伴', '活泼陪伴']);
const VIDEO_CALL_ACTIONS = new Set(['accept', 'reject', 'hangup', 'fail']);
const VIDEO_CALL_MODES = new Set(['voice', 'video']);

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FamilyLinkError('VALIDATION_ERROR', `${fieldName} 必须是对象`);
  }
}

function integerInRange(value, minimum, maximum, fieldName) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new FamilyLinkError(
      'VALIDATION_ERROR',
      `${fieldName} 必须是 ${minimum} 到 ${maximum} 之间的整数`
    );
  }
}

function validateSettingsPatch(patch) {
  requireObject(patch, '设置');
  const result = {};

  if (Object.hasOwn(patch, 'volume')) {
    integerInRange(patch.volume, 0, 100, '音量');
    result.volume = patch.volume;
  }
  if (Object.hasOwn(patch, 'brightness')) {
    integerInRange(patch.brightness, 0, 100, '亮度');
    result.brightness = patch.brightness;
  }
  if (Object.hasOwn(patch, 'petStyle')) {
    if (!PET_STYLES.has(patch.petStyle)) {
      throw new FamilyLinkError('VALIDATION_ERROR', '宠物风格不是支持的选项');
    }
    result.petStyle = patch.petStyle;
  }

  if (Object.keys(result).length === 0) {
    throw new FamilyLinkError('VALIDATION_ERROR', '没有可保存的设置字段');
  }

  integerInRange(patch.expectedRevision, 0, Number.MAX_SAFE_INTEGER, '设置版本');
  result.expectedRevision = patch.expectedRevision;
  return result;
}

function validateReminderDraft(draft, updating = false) {
  requireObject(draft, '提醒');
  const title = String(draft.title ?? '').trim();
  if (title.length < 1 || title.length > 40) {
    throw new FamilyLinkError('VALIDATION_ERROR', '提醒标题长度必须为 1 到 40 个字符');
  }
  if (!REMINDER_TYPES.has(draft.type)) {
    throw new FamilyLinkError('VALIDATION_ERROR', '提醒类型无效');
  }
  if (!REPEAT_RULES.has(draft.repeatRule)) {
    throw new FamilyLinkError('VALIDATION_ERROR', '重复规则无效');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(draft.timeOfDay ?? ''))) {
    throw new FamilyLinkError('VALIDATION_ERROR', '提醒时间必须使用 HH:mm 格式');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.scheduledDate ?? ''))) {
    throw new FamilyLinkError('VALIDATION_ERROR', '提醒日期必须使用 YYYY-MM-DD 格式');
  }
  if (typeof draft.enabled !== 'boolean') {
    throw new FamilyLinkError('VALIDATION_ERROR', '启用状态必须为布尔值');
  }

  const result = {
    type: draft.type,
    title,
    timeOfDay: draft.timeOfDay,
    scheduledDate: draft.scheduledDate,
    repeatRule: draft.repeatRule,
    enabled: draft.enabled
  };

  if (updating) {
    integerInRange(draft.id, 1, Number.MAX_SAFE_INTEGER, '提醒 ID');
    integerInRange(draft.expectedRevision, 0, Number.MAX_SAFE_INTEGER, '提醒版本');
    result.id = draft.id;
    result.expectedRevision = draft.expectedRevision;
  }

  return result;
}

function validateVideoCallAction(request) {
  requireObject(request, '通话操作');
  const callId = String(request.callId ?? '').trim();
  if (!callId || callId.length > 80) {
    throw new FamilyLinkError('VALIDATION_ERROR', '通话标识无效');
  }
  if (!VIDEO_CALL_ACTIONS.has(request.action)) {
    throw new FamilyLinkError('VALIDATION_ERROR', '通话操作只支持接听、拒绝或挂断');
  }
  integerInRange(request.expectedRevision, 0, Number.MAX_SAFE_INTEGER, '通话版本');
  return {
    callId,
    action: request.action,
    expectedRevision: request.expectedRevision,
    ...(request.errorCode ? { errorCode: String(request.errorCode).slice(0, 80) } : {}),
    ...(request.errorMessage ? { errorMessage: String(request.errorMessage).slice(0, 300) } : {})
  };
}

function validateVideoCallStart(request) {
  requireObject(request, '呼叫请求');
  if (!VIDEO_CALL_MODES.has(request.mode)) {
    throw new FamilyLinkError('VALIDATION_ERROR', '通话模式只支持语音或视频');
  }
  return { mode: request.mode };
}

function validateAutomaticHeadTrackingUpdate(request) {
  requireObject(request, '自动跟头设置');
  if (Object.keys(request).length !== 1 || typeof request.enabled !== 'boolean') {
    throw new FamilyLinkError('VALIDATION_ERROR', '自动跟头设置只允许布尔字段 enabled');
  }
  return { enabled: request.enabled };
}

class FamilyLinkService {
  constructor(adapter) {
    if (!adapter) {
      throw new FamilyLinkError('CONFIGURATION_ERROR', 'FamilyLink Adapter 未配置');
    }
    this.adapter = adapter;
  }

  async getDashboard() {
    const [status, settings, reminders] = await Promise.all([
      this.adapter.getStatus(),
      this.adapter.getSettings(),
      this.adapter.listReminders()
    ]);
    return { status, settings, reminders };
  }

  async updateSettings(patch) {
    return this.adapter.updateSettings(validateSettingsPatch(patch));
  }

  async createReminder(draft) {
    return this.adapter.createReminder(validateReminderDraft(draft, false));
  }

  async updateReminder(draft) {
    const validated = validateReminderDraft(draft, true);
    const { id, ...payload } = validated;
    return this.adapter.updateReminder(id, payload);
  }

  async deleteReminder(request) {
    requireObject(request, '删除请求');
    integerInRange(request.id, 1, Number.MAX_SAFE_INTEGER, '提醒 ID');
    integerInRange(request.expectedRevision, 0, Number.MAX_SAFE_INTEGER, '提醒版本');
    return this.adapter.deleteReminder(request.id, request.expectedRevision);
  }

  async getVideoCall() {
    return this.adapter.getVideoCall();
  }

  async startVideoCall(request) {
    return this.adapter.startVideoCall(validateVideoCallStart(request));
  }

  async applyVideoCallAction(request) {
    return this.adapter.applyVideoCallAction(validateVideoCallAction(request));
  }

  async createVisionMonitorSession() {
    return this.adapter.createVisionMonitorSession();
  }

  async createMotionControlSession() {
    return this.adapter.createMotionControlSession();
  }

  async getAutomaticHeadTracking() {
    return this.adapter.getAutomaticHeadTracking();
  }

  async setAutomaticHeadTracking(request) {
    return this.adapter.setAutomaticHeadTracking(
      validateAutomaticHeadTrackingUpdate(request)
    );
  }
}

module.exports = {
  FamilyLinkService,
  validateReminderDraft,
  validateSettingsPatch,
  validateAutomaticHeadTrackingUpdate,
  validateVideoCallAction,
  validateVideoCallStart
};
