'use strict';

const PAGE_TITLES = {
  dashboard: '设备状态',
  settings: '远程设置',
  reminders: '提醒管理',
  'video-call': '语音 / 视频通话'
};

const TYPE_LABELS = { medicine: '用药', water: '喝水', other: '其他' };
const REPEAT_LABELS = { daily: '每天', weekdays: '工作日', once: '仅一次' };
const STATUS_LABELS = {
  pending: '待完成',
  completed: '已完成',
  missed: '已错过',
  disabled: '已停用'
};

const state = {
  connection: null,
  dashboard: null,
  videoCall: null,
  activeView: 'dashboard',
  busy: false,
  toastTimer: null,
  callPollTimer: null,
  callPollBusy: false,
  notifiedCallId: null,
  mediaStatus: '等待设备呼叫',
  mediaSyncPromise: Promise.resolve()
};

const byId = (id) => document.getElementById(id);
const callMedia = new window.LongPetVideoCallMediaAdapter({
  remoteCanvas: byId('call-remote-video'),
  localVideo: byId('call-local-video'),
  onStatus: (message) => {
    state.mediaStatus = message;
    if (state.videoCall) renderVideoCall();
  },
  onFailure: (error) => { void reportMediaFailure(error); }
});

function setText(id, value) {
  byId(id).textContent = value ?? '--';
}

function localDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '--', time: '--:--' };
  return {
    date: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    }).format(date),
    time: new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date)
  };
}

function showToast(message, error = false) {
  const toast = byId('toast');
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('visible');
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function errorMessage(error) {
  if (error?.code === 'REVISION_CONFLICT') return `${error.message}（数据已自动刷新）`;
  if (error?.code === 'DEVICE_UNREACHABLE') return '无法连接设备，请检查地址、网络和板端服务';
  if (error?.code === 'REQUEST_TIMEOUT') return '设备响应超时，请稍后重试';
  return error?.message ?? '操作失败';
}

async function runBusy(task, button = null) {
  if (state.busy) return null;
  state.busy = true;
  if (button) button.disabled = true;
  try {
    return await task();
  } finally {
    state.busy = false;
    if (button) button.disabled = false;
  }
}

function switchView(view) {
  if (!PAGE_TITLES[view]) return;
  state.activeView = view;
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((element) => {
    element.classList.toggle('active', element.id === `view-${view}`);
  });
  setText('page-title', PAGE_TITLES[view]);
}

function renderConnection(online = null) {
  const connection = state.connection;
  const dot = byId('connection-dot');
  dot.classList.toggle('online', online === true);
  dot.classList.toggle('error', online === false);

  if (!connection) {
    setText('connection-mode', '准备连接');
    setText('connection-address', '--');
    return;
  }
  setText('connection-mode', connection.mode === 'mock' ? '演示模式' : (online === false ? '设备离线' : '局域网设备'));
  setText('connection-address', connection.baseUrl);
  byId('connection-button').textContent = '切换连接';
}

function renderDashboard() {
  if (!state.dashboard) return;
  const { status, settings, reminders } = state.dashboard;
  const { device, system, care } = status;
  const dateTime = formatDateTime(system.currentDateTime);

  setText('device-name', device.name);
  setText('device-version', `设备 ${device.id} · LongPet ${device.softwareVersion}`);
  setText('device-time', dateTime.time);
  setText('device-date', dateTime.date);
  const onlineBadge = byId('online-badge');
  onlineBadge.textContent = device.online ? '设备在线' : '设备离线';
  onlineBadge.classList.toggle('online', device.online);
  onlineBadge.classList.toggle('offline', !device.online);

  setText('network-value', system.networkAvailable ? '网络正常' : '网络不可用');
  setText('network-detail', device.networkSummary);
  setText('power-value', device.powerSummary || '状态未知');
  setText('battery-detail', system.batteryPercent >= 0 ? `电量 ${system.batteryPercent}%` : '无电池读数');
  setText('audio-value', device.audioSummary || '状态未知');
  setText('reminder-count', String(reminders.filter((item) => item.enabled).length));

  setText('care-water', `${care.waterCompleted}/${care.waterGoal}`);
  setText('care-medicine', `${care.medicineCompleted}/${care.medicineTotal}`);
  setText('care-activity', String(care.activityMinutes));
  setText('care-interaction', String(care.interactionCount));

  const next = reminders
    .filter((item) => item.enabled)
    .sort((left, right) => left.timeOfDay.localeCompare(right.timeOfDay))[0];
  const nextContainer = byId('next-reminder');
  nextContainer.replaceChildren();
  if (!next) {
    nextContainer.className = 'next-reminder empty';
    nextContainer.textContent = '暂无启用的提醒';
  } else {
    nextContainer.className = 'next-reminder';
    const title = document.createElement('strong');
    title.textContent = `${next.timeOfDay} · ${next.title}`;
    const detail = document.createElement('span');
    detail.textContent = `${TYPE_LABELS[next.type]} · ${REPEAT_LABELS[next.repeatRule]}`;
    nextContainer.append(title, detail);
  }

  renderSettings(settings);
  renderReminders(reminders);
  renderConnection(device.online);
  setText('sync-time', `同步于 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())}`);
}

function settingsAreWritable() {
  const reported = state.dashboard?.status?.capabilities?.settingsWrite;
  return reported ?? state.dashboard?.settings?.remoteWritable ?? true;
}

function remindersAreWritable() {
  const reported = state.dashboard?.status?.capabilities?.remindersWrite;
  return reported ?? true;
}

function renderSettings(settings) {
  byId('volume-input').value = settings.volume;
  byId('volume-output').value = `${settings.volume}%`;
  byId('brightness-input').value = settings.brightness;
  byId('brightness-output').value = `${settings.brightness}%`;
  byId('pet-style-input').value = settings.petStyle;
  setText('settings-revision', `版本 ${settings.revision}`);

  const volumeCapability = settings.capabilities?.volume;
  const brightnessCapability = settings.capabilities?.brightness;
  const writable = settingsAreWritable();
  setText('volume-summary', volumeCapability?.summary ?? '设备未报告音量能力');
  setText('brightness-summary', brightnessCapability?.summary ?? '设备未报告背光能力');
  byId('volume-input').disabled = !writable || volumeCapability?.available === false;
  byId('brightness-input').disabled = !writable || brightnessCapability?.available === false;
  byId('pet-style-input').disabled = !writable;
  byId('save-settings-button').disabled = !writable;
  setText(
    'settings-note',
    !writable
      ? '当前板端仅开放远程读取；设置写入将在后续小步接入。'
      : brightnessCapability?.available === false
      ? '当前设备不支持亮度调节；保存时只提交可用设置。'
      : '远程写入会经过设备端 SettingsService 校验。'
  );
}

function renderReminders(reminders) {
  const container = byId('reminder-list');
  const writable = remindersAreWritable();
  byId('add-reminder-button').disabled = !writable;
  container.replaceChildren();
  if (reminders.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无提醒，可以从家属端新增';
    container.append(empty);
    return;
  }

  const sorted = [...reminders].sort((left, right) => left.timeOfDay.localeCompare(right.timeOfDay));
  for (const reminder of sorted) {
    const item = document.createElement('article');
    item.className = 'reminder-item';

    const time = document.createElement('div');
    time.className = 'reminder-time';
    time.textContent = reminder.timeOfDay;

    const copy = document.createElement('div');
    copy.className = 'reminder-copy';
    const title = document.createElement('strong');
    title.textContent = reminder.title;
    const detail = document.createElement('span');
    detail.textContent = `${TYPE_LABELS[reminder.type]} · ${REPEAT_LABELS[reminder.repeatRule]} · ${reminder.scheduledDate}`;
    copy.append(title, detail);

    const badge = document.createElement('span');
    badge.className = `reminder-state${reminder.enabled ? '' : ' disabled'}`;
    badge.textContent = STATUS_LABELS[reminder.status] ?? reminder.status;

    const edit = document.createElement('button');
    edit.className = 'edit-reminder';
    edit.type = 'button';
    edit.dataset.reminderId = reminder.id;
    edit.textContent = writable ? '编辑' : '只读';
    edit.disabled = !writable;
    item.append(time, copy, badge, edit);
    container.append(item);
  }
}

function renderVideoCall() {
  const call = state.videoCall;
  const modeName = call?.mode === 'voice' ? '语音' : '视频';
  const stateText = {
    idle: ['当前没有通话', 'LongPet 发起呼叫后将在这里提醒您'],
    outgoing_ringing: [`LongPet 正在发起${modeName}通话`, '请接听或拒绝本次通话'],
    notifying_device: [`正在发起${modeName}通话`, '正在通知 LongPet，设备将在提示音结束后自动接通'],
    connecting_media: ['正在建立媒体通道', '正在打开双方麦克风和扬声器'],
    connected: [`${modeName}通话已连接`, '双向媒体正在实时传输'],
    rejected: ['已拒绝本次通话', 'LongPet 端会显示家属端暂时无法接听'],
    ended: ['通话已结束', '可以再次发起语音或视频通话'],
    failed: ['通话连接失败', call?.errorMessage || '请检查媒体权限、设备和网络']
  };
  const [title, detail] = stateText[call?.state] ?? stateText.idle;
  setText('call-state-title', title);
  setText('call-state-detail', detail);
  setText('call-remote-name', state.dashboard?.status?.device?.name || 'LongPet');
  setText('call-id', call?.callId ? `通话编号 ${call.callId.slice(0, 8)}` : '--');
  const connectedAt = call?.connectedAt ? new Date(call.connectedAt).getTime() : 0;
  const elapsed = connectedAt ? Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)) : 0;
  setText('call-duration', `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`);
  setText('call-media-state', state.mediaStatus);
  const active = ['outgoing_ringing', 'notifying_device', 'connecting_media', 'connected']
    .includes(call?.state);
  const videoActive = active && call?.mode === 'video';
  byId('call-placeholder').parentElement.classList.toggle('video-active', videoActive);
  byId('call-remote-video').classList.toggle('hidden', !videoActive);
  byId('call-local-video').classList.toggle('hidden', !videoActive);
  byId('start-voice-call-button').classList.toggle('hidden', active);
  byId('start-video-call-button').classList.toggle('hidden', active);
  byId('accept-call-button').classList.toggle('hidden', call?.state !== 'outgoing_ringing');
  byId('reject-call-button').classList.toggle('hidden', call?.state !== 'outgoing_ringing');
  byId('hangup-call-button').classList.toggle('hidden', !active || call?.state === 'outgoing_ringing');
}

function queueMediaSync(call) {
  state.mediaSyncPromise = state.mediaSyncPromise
    .catch(() => {})
    .then(() => syncMediaForCall(call));
  return state.mediaSyncPromise;
}

async function syncMediaForCall(call) {
  const terminal = !call?.callId
    || ['idle', 'rejected', 'ended', 'failed'].includes(call.state);
  if (terminal) {
    await callMedia.stop();
    state.mediaStatus = call?.state === 'failed'
      ? (call.errorMessage || '媒体通道失败') : '等待设备呼叫';
    return;
  }
  if (call.state === 'outgoing_ringing') {
    state.mediaStatus = '收到来自 LongPet 的呼叫';
    return;
  }
  if (state.connection?.mode !== 'http') {
    state.mediaStatus = '演示模式不连接真实媒体设备';
    return;
  }
  await callMedia.connect(state.connection.baseUrl, call);
  if (call.state === 'connecting_media' || call.state === 'connected') {
    await callMedia.enableAudio();
  }
}

async function reportMediaFailure(error) {
  const message = error?.message || '家属端媒体初始化失败';
  showToast(message, true);
  try {
    const current = await window.familyDesktop.getVideoCall();
    state.videoCall = current;
    if (['outgoing_ringing', 'notifying_device', 'connecting_media', 'connected']
      .includes(current.state)) {
      state.videoCall = await window.familyDesktop.applyVideoCallAction({
        callId: current.callId,
        action: 'fail',
        expectedRevision: current.revision,
        errorCode: error?.code || 'FAMILY_MEDIA_FAILED',
        errorMessage: message
      });
    }
  } catch (reportError) {
    showToast(`${message}；设备状态同步失败：${errorMessage(reportError)}`, true);
  } finally {
    await callMedia.stop();
    renderVideoCall();
  }
}

async function refreshVideoCall(silent = true) {
  if (state.callPollBusy) return state.videoCall;
  state.callPollBusy = true;
  try {
    const previousCallId = state.videoCall?.callId;
    state.videoCall = await window.familyDesktop.getVideoCall();
    renderVideoCall();
    void queueMediaSync(state.videoCall).catch((error) => reportMediaFailure(error));
    if (state.videoCall.state === 'outgoing_ringing'
        && state.videoCall.callId
        && state.notifiedCallId !== state.videoCall.callId) {
      state.notifiedCallId = state.videoCall.callId;
      switchView('video-call');
      showToast('LongPet 正在发起视频通话');
    } else if (previousCallId && state.videoCall.callId !== previousCallId) {
      state.notifiedCallId = null;
    }
    return state.videoCall;
  } catch (error) {
    if (!silent) showToast(errorMessage(error), true);
    return null;
  } finally {
    state.callPollBusy = false;
  }
}

async function applyVideoCallAction(action, button) {
  if (!state.videoCall?.callId) return;
  await runBusy(async () => {
    try {
      if (action === 'hangup') callMedia.beginTermination();
      state.videoCall = await window.familyDesktop.applyVideoCallAction({
        callId: state.videoCall.callId,
        action,
        expectedRevision: state.videoCall.revision
      });
      renderVideoCall();
      if (action === 'hangup') await callMedia.stop(true);
      else void queueMediaSync(state.videoCall).catch((error) => reportMediaFailure(error));
      showToast(action === 'accept' ? '已接听，正在建立媒体通道'
        : action === 'reject' ? '已拒绝通话' : '通话已挂断');
    } catch (error) {
      showToast(errorMessage(error), true);
      await refreshVideoCall(true);
    }
  }, button);
}

async function startVideoCall(mode, button) {
  if (state.connection?.mode !== 'http') {
    showToast('请先连接真实 LongPet 设备再发起通话', true);
    return;
  }
  await runBusy(async () => {
    try {
      state.mediaStatus = '正在请求设备建立通话';
      state.videoCall = await window.familyDesktop.startVideoCall({ mode });
      switchView('video-call');
      renderVideoCall();
      await queueMediaSync(state.videoCall);
      showToast(mode === 'video' ? '正在通知设备并预热摄像头' : '正在通知设备');
    } catch (error) {
      showToast(errorMessage(error), true);
      await callMedia.stop();
      await refreshVideoCall(true);
    }
  }, button);
}

function startVideoCallPolling() {
  clearInterval(state.callPollTimer);
  state.callPollTimer = setInterval(() => {
    void refreshVideoCall(true);
  }, 1000);
}

async function refreshDashboard(silent = false) {
  try {
    state.dashboard = await window.familyDesktop.getDashboard();
    renderDashboard();
    if (!silent) showToast('设备数据已刷新');
  } catch (error) {
    renderConnection(false);
    showToast(errorMessage(error), true);
    throw error;
  }
}

function openConnectionDialog() {
  const connection = state.connection;
  byId('mock-mode-input').checked = connection?.mode !== 'http';
  if (connection?.mode === 'http') byId('base-url-input').value = connection.baseUrl;
  byId('token-input').value = '';
  updateConnectionFields();
  byId('connection-dialog').showModal();
}

function updateConnectionFields() {
  const mock = byId('mock-mode-input').checked;
  byId('base-url-input').disabled = mock;
  byId('token-input').disabled = mock;
}

async function configureConnection(event) {
  if ((event.submitter?.value ?? 'default') !== 'default') return;
  event.preventDefault();
  const button = byId('connect-submit-button');
  await runBusy(async () => {
    try {
      await callMedia.stop();
      const mock = byId('mock-mode-input').checked;
      state.connection = await window.familyDesktop.configureConnection({
        mode: mock ? 'mock' : 'http',
        baseUrl: byId('base-url-input').value,
        token: byId('token-input').value
      });
      byId('token-input').value = '';
      byId('connection-dialog').close();
      await refreshDashboard(true);
      await refreshVideoCall(true);
      showToast(mock ? '已进入演示模式' : 'LongPet 连接成功');
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }, button);
}

async function saveSettings(event) {
  event.preventDefault();
  if (!state.dashboard) return;
  if (!settingsAreWritable()) {
    showToast('当前板端仅开放设置读取', true);
    return;
  }
  const current = state.dashboard.settings;
  const patch = {
    expectedRevision: current.revision,
    petStyle: byId('pet-style-input').value
  };
  if (current.capabilities?.volume?.available !== false) {
    patch.volume = Number(byId('volume-input').value);
  }
  if (current.capabilities?.brightness?.available !== false) {
    patch.brightness = Number(byId('brightness-input').value);
  }

  await runBusy(async () => {
    try {
      state.dashboard.settings = await window.familyDesktop.updateSettings(patch);
      renderSettings(state.dashboard.settings);
      showToast('设备设置已保存');
    } catch (error) {
      showToast(errorMessage(error), true);
      if (error.code === 'REVISION_CONFLICT') await refreshDashboard(true);
    }
  }, byId('save-settings-button'));
}

function openReminderDialog(reminder = null) {
  setText('reminder-dialog-title', reminder ? '编辑提醒' : '新增提醒');
  byId('reminder-id').value = reminder?.id ?? '';
  byId('reminder-revision').value = reminder?.revision ?? '';
  byId('reminder-title').value = reminder?.title ?? '';
  byId('reminder-type').value = reminder?.type ?? 'medicine';
  byId('reminder-repeat').value = reminder?.repeatRule ?? 'daily';
  byId('reminder-time').value = reminder?.timeOfDay ?? '08:00';
  byId('reminder-date').value = reminder?.scheduledDate ?? localDateInputValue();
  byId('reminder-enabled').checked = reminder?.enabled ?? true;
  byId('delete-reminder-button').classList.toggle('hidden', !reminder);
  byId('reminder-dialog').showModal();
  byId('reminder-title').focus();
}

function reminderFormValue() {
  return {
    id: Number(byId('reminder-id').value),
    expectedRevision: Number(byId('reminder-revision').value),
    title: byId('reminder-title').value,
    type: byId('reminder-type').value,
    repeatRule: byId('reminder-repeat').value,
    timeOfDay: byId('reminder-time').value,
    scheduledDate: byId('reminder-date').value,
    enabled: byId('reminder-enabled').checked
  };
}

async function submitReminder(event) {
  const action = event.submitter?.value ?? 'default';
  if (!['default', 'delete'].includes(action)) return;
  event.preventDefault();
  if (!remindersAreWritable()) {
    showToast('当前板端仅开放提醒读取', true);
    return;
  }
  const draft = reminderFormValue();

  if (action === 'delete') {
    if (!window.confirm(`确定删除“${draft.title}”吗？`)) return;
    await runBusy(async () => {
      try {
        await window.familyDesktop.deleteReminder({
          id: draft.id,
          expectedRevision: draft.expectedRevision
        });
        byId('reminder-dialog').close();
        await refreshDashboard(true);
        showToast('提醒已删除');
      } catch (error) {
        showToast(errorMessage(error), true);
        if (error.code === 'REVISION_CONFLICT') await refreshDashboard(true);
      }
    }, byId('delete-reminder-button'));
    return;
  }

  if (!byId('reminder-form').reportValidity()) return;
  await runBusy(async () => {
    try {
      if (draft.id > 0) {
        await window.familyDesktop.updateReminder(draft);
      } else {
        delete draft.id;
        delete draft.expectedRevision;
        await window.familyDesktop.createReminder(draft);
      }
      byId('reminder-dialog').close();
      await refreshDashboard(true);
      showToast(draft.id > 0 ? '提醒已更新' : '提醒已创建');
    } catch (error) {
      showToast(errorMessage(error), true);
      if (error.code === 'REVISION_CONFLICT') await refreshDashboard(true);
    }
  }, byId('save-reminder-button'));
}

function registerEvents() {
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  document.querySelectorAll('[data-jump]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.jump));
  });
  byId('connection-button').addEventListener('click', openConnectionDialog);
  byId('mock-mode-input').addEventListener('change', updateConnectionFields);
  byId('connection-form').addEventListener('submit', configureConnection);
  byId('refresh-button').addEventListener('click', () =>
    runBusy(() => refreshDashboard(false), byId('refresh-button')).catch(() => {})
  );
  byId('settings-form').addEventListener('submit', saveSettings);
  byId('volume-input').addEventListener('input', (event) => {
    byId('volume-output').value = `${event.target.value}%`;
  });
  byId('brightness-input').addEventListener('input', (event) => {
    byId('brightness-output').value = `${event.target.value}%`;
  });
  byId('add-reminder-button').addEventListener('click', () => openReminderDialog());
  byId('reminder-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-reminder-id]');
    if (!button || !state.dashboard) return;
    const reminder = state.dashboard.reminders.find((item) => item.id === Number(button.dataset.reminderId));
    if (reminder) openReminderDialog(reminder);
  });
  byId('reminder-form').addEventListener('submit', submitReminder);
  byId('start-voice-call-button').addEventListener('click', () =>
    startVideoCall('voice', byId('start-voice-call-button'))
  );
  byId('start-video-call-button').addEventListener('click', () =>
    startVideoCall('video', byId('start-video-call-button'))
  );
  byId('accept-call-button').addEventListener('click', () =>
    applyVideoCallAction('accept', byId('accept-call-button'))
  );
  byId('reject-call-button').addEventListener('click', () =>
    applyVideoCallAction('reject', byId('reject-call-button'))
  );
  byId('hangup-call-button').addEventListener('click', () =>
    applyVideoCallAction('hangup', byId('hangup-call-button'))
  );
}

async function initialize() {
  registerEvents();
  try {
    state.connection = await window.familyDesktop.getConnection();
    renderConnection();
    await refreshDashboard(true);
    await refreshVideoCall(true);
  } catch (error) {
    showToast(errorMessage(error), true);
    openConnectionDialog();
  }
  startVideoCallPolling();
}

window.addEventListener('beforeunload', () => {
  clearInterval(state.callPollTimer);
  void callMedia.stop();
});

void initialize();
