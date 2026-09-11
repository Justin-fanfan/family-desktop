'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result?.ok) {
    const error = new Error(result?.error?.message ?? '操作失败');
    error.code = result?.error?.code ?? 'UNKNOWN_ERROR';
    error.status = result?.error?.status ?? null;
    error.details = result?.error?.details ?? null;
    throw error;
  }
  return result.data;
}

contextBridge.exposeInMainWorld('familyDesktop', Object.freeze({
  getConnection: () => invoke('family:connection:get'),
  configureConnection: (request) => invoke('family:connection:configure', request),
  getDashboard: () => invoke('family:dashboard:get'),
  updateSettings: (request) => invoke('family:settings:update', request),
  createReminder: (request) => invoke('family:reminders:create', request),
  updateReminder: (request) => invoke('family:reminders:update', request),
  deleteReminder: (request) => invoke('family:reminders:delete', request),
  getVideoCall: () => invoke('family:video-call:get'),
  startVideoCall: (request) => invoke('family:video-call:start', request),
  applyVideoCallAction: (request) => invoke('family:video-call:act', request),
  startVisionMonitor: () => invoke('family:vision-monitor:start'),
  startMotionControl: () => invoke('family:motion-control:start'),
  getAutomaticHeadTracking: () => invoke('family:automatic-head-tracking:get'),
  setAutomaticHeadTracking: (request) =>
    invoke('family:automatic-head-tracking:set', request)
}));
