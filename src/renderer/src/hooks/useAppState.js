import { useCallback, useEffect, useRef, useState } from 'react';

// adapter 由 main.jsx 的副作用导入执行并挂到 window（保持测试对原文件 require 兼容）
const VideoCallMediaAdapter = window.LongPetVideoCallMediaAdapter;

export const TYPE_LABELS = { medicine: '用药', water: '喝水', other: '其他' };
export const REPEAT_LABELS = { daily: '每天', weekdays: '工作日', once: '仅一次' };
export const STATUS_LABELS = { pending: '待完成', completed: '已完成', missed: '已错过', disabled: '已停用' };

export const PAGE_TITLES = {
  dashboard: '设备状态',
  settings: '远程设置',
  reminders: '提醒管理',
  'video-call': '语音 / 视频通话'
};

export function errorMessage(error) {
  if (error?.code === 'REVISION_CONFLICT') return `${error.message}（数据已自动刷新）`;
  if (error?.code === 'DEVICE_UNREACHABLE') return '无法连接设备，请检查地址、网络和板端服务';
  if (error?.code === 'REQUEST_TIMEOUT') return '设备响应超时，请稍后重试';
  return error?.message ?? '操作失败';
}

function localDateInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '--', time: '--:--' };
  return {
    date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date),
    time: new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  };
}

export const ACTIVE_CALL_STATES = ['outgoing_ringing', 'notifying_device', 'connecting_media', 'connected'];

export function useAppState({ onToast }) {
  const [connection, setConnection] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [videoCall, setVideoCall] = useState(null);
  const [activeView, setActiveView] = useState('dashboard');
  const [busy, setBusy] = useState(false);
  const [mediaStatus, setMediaStatus] = useState('等待设备呼叫');
  const [connectionOnline, setConnectionOnline] = useState(null);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [reminderDialogState, setReminderDialogState] = useState({ open: false, reminder: null });
  const [callNow, setCallNow] = useState(0);

  const busyRef = useRef(false);
  const connectionRef = useRef(null);
  const dashboardRef = useRef(null);
  const videoCallRef = useRef(null);
  const mediaSyncPromiseRef = useRef(Promise.resolve());
  const notifiedCallIdRef = useRef(null);
  const callPollBusyRef = useRef(false);
  const timedCallRef = useRef({ callId: null, startedAt: 0 });
  const remoteCanvasRef = useRef(null);
  const localVideoRef = useRef(null);
  const adapterRef = useRef(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  const showToast = useCallback((message, error = false) => {
    onToastRef.current(message, error);
  }, []);

  const runBusy = useCallback(async (task) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      return await task();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  // ---- 设置 ----
  const settingsAreWritable = useCallback(() => {
    const reported = dashboardRef.current?.status?.capabilities?.settingsWrite;
    return reported ?? dashboardRef.current?.settings?.remoteWritable ?? true;
  }, []);

  const remindersAreWritable = useCallback(() => {
    const reported = dashboardRef.current?.status?.capabilities?.remindersWrite;
    return reported ?? true;
  }, []);

  // ---- 视频通话媒体 ----
  const handleMediaStatus = useCallback((message) => {
    setMediaStatus(message);
  }, []);

  const syncMediaForCall = useCallback(async (call) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const terminal = !call?.callId || ['idle', 'rejected', 'ended', 'failed'].includes(call.state);
    if (terminal) {
      await adapter.stop();
      setMediaStatus(call?.state === 'failed' ? (call.errorMessage || '媒体通道失败') : '等待设备呼叫');
      return;
    }
    if (call.state === 'outgoing_ringing') {
      setMediaStatus('收到来自 LongPet 的呼叫');
      return;
    }
    if (connectionRef.current?.mode !== 'http') {
      setMediaStatus('演示模式不连接真实媒体设备');
      return;
    }
    await adapter.connect(connectionRef.current.baseUrl, call);
    if (call.state === 'connecting_media' || call.state === 'connected') {
      await adapter.enableAudio();
    }
  }, []);

  const queueMediaSync = useCallback((call) => {
    mediaSyncPromiseRef.current = mediaSyncPromiseRef.current
      .catch(() => {})
      .then(() => syncMediaForCall(call));
    return mediaSyncPromiseRef.current;
  }, [syncMediaForCall]);

  const handleMediaFailure = useCallback(async (error) => {
    const message = error?.message || '家属端媒体初始化失败';
    showToast(message, true);
    try {
      const current = await window.familyDesktop.getVideoCall();
      videoCallRef.current = current;
      setVideoCall(current);
      if (ACTIVE_CALL_STATES.includes(current.state)) {
        const updated = await window.familyDesktop.applyVideoCallAction({
          callId: current.callId,
          action: 'fail',
          expectedRevision: current.revision,
          errorCode: error?.code || 'FAMILY_MEDIA_FAILED',
          errorMessage: message
        });
        videoCallRef.current = updated;
        setVideoCall(updated);
      }
    } catch (reportError) {
      showToast(`${message}；设备状态同步失败：${errorMessage(reportError)}`, true);
    } finally {
      await adapterRef.current?.stop();
    }
  }, [showToast]);

  const refreshVideoCall = useCallback(async (silent = true) => {
    if (callPollBusyRef.current) return videoCallRef.current;
    callPollBusyRef.current = true;
    try {
      const previousCallId = videoCallRef.current?.callId;
      const call = await window.familyDesktop.getVideoCall();
      videoCallRef.current = call;
      setVideoCall(call);
      void queueMediaSync(call).catch((error) => handleMediaFailure(error));
      if (call.state === 'outgoing_ringing' && call.callId && notifiedCallIdRef.current !== call.callId) {
        notifiedCallIdRef.current = call.callId;
        setActiveView('video-call');
        showToast('LongPet 正在发起视频通话');
      } else if (previousCallId && call.callId !== previousCallId) {
        notifiedCallIdRef.current = null;
      }
      return call;
    } catch (error) {
      if (!silent) showToast(errorMessage(error), true);
      return null;
    } finally {
      callPollBusyRef.current = false;
    }
  }, [queueMediaSync, handleMediaFailure, showToast]);

  const applyVideoCallAction = useCallback(async (action) => {
    const call = videoCallRef.current;
    if (!call?.callId) return;
    await runBusy(async () => {
      try {
        if (action === 'hangup') adapterRef.current?.beginTermination();
        const updated = await window.familyDesktop.applyVideoCallAction({
          callId: call.callId,
          action,
          expectedRevision: call.revision
        });
        videoCallRef.current = updated;
        setVideoCall(updated);
        if (action === 'hangup') await adapterRef.current?.stop(true);
        else void queueMediaSync(updated).catch((error) => handleMediaFailure(error));
        showToast(action === 'accept' ? '已接听，正在建立媒体通道'
          : action === 'reject' ? '已拒绝通话' : '通话已挂断');
      } catch (error) {
        showToast(errorMessage(error), true);
        await refreshVideoCall(true);
      }
    });
  }, [runBusy, queueMediaSync, handleMediaFailure, refreshVideoCall, showToast]);

  const startVideoCall = useCallback(async (mode) => {
    if (connectionRef.current?.mode !== 'http') {
      showToast('请先连接真实 LongPet 设备再发起通话', true);
      return;
    }
    await runBusy(async () => {
      try {
        setMediaStatus('正在请求设备建立通话');
        const call = await window.familyDesktop.startVideoCall({ mode });
        videoCallRef.current = call;
        setVideoCall(call);
        setActiveView('video-call');
        await queueMediaSync(call);
        showToast(mode === 'video' ? '正在通知设备并预热摄像头' : '正在通知设备');
      } catch (error) {
        showToast(errorMessage(error), true);
        await adapterRef.current?.stop();
        await refreshVideoCall(true);
      }
    });
  }, [runBusy, queueMediaSync, refreshVideoCall, showToast]);

  // ---- 仪表盘 / 连接 ----
  const refreshDashboard = useCallback(async (silent = false) => {
    try {
      const data = await window.familyDesktop.getDashboard();
      dashboardRef.current = data;
      setDashboard(data);
      setConnectionOnline(data.status?.device?.online ?? null);
      if (!silent) showToast('设备数据已刷新');
      return data;
    } catch (error) {
      setConnectionOnline(false);
      showToast(errorMessage(error), true);
      throw error;
    }
  }, [showToast]);

  const configureConnection = useCallback(async (request) => {
    await runBusy(async () => {
      try {
        await adapterRef.current?.stop();
        const conn = await window.familyDesktop.configureConnection(request);
        connectionRef.current = conn;
        setConnection(conn);
        await refreshDashboard(true);
        await refreshVideoCall(true);
        showToast(request.mode === 'mock' ? '已进入演示模式' : 'LongPet 连接成功');
        return conn;
      } catch (error) {
        showToast(errorMessage(error), true);
        throw error;
      }
    });
  }, [runBusy, refreshDashboard, refreshVideoCall, showToast]);

  // ---- 设置保存 ----
  const saveSettings = useCallback(async (draft) => {
    if (!dashboardRef.current) return;
    const current = dashboardRef.current.settings;
    const patch = {
      expectedRevision: current.revision,
      petStyle: draft.petStyle
    };
    if (current.capabilities?.volume?.available !== false) patch.volume = Number(draft.volume);
    if (current.capabilities?.brightness?.available !== false) patch.brightness = Number(draft.brightness);

    await runBusy(async () => {
      try {
        const updated = await window.familyDesktop.updateSettings(patch);
        dashboardRef.current = { ...dashboardRef.current, settings: updated };
        setDashboard(dashboardRef.current);
        showToast('设备设置已保存');
      } catch (error) {
        showToast(errorMessage(error), true);
        if (error.code === 'REVISION_CONFLICT') await refreshDashboard(true);
      }
    });
  }, [runBusy, refreshDashboard, showToast]);

  // ---- 提醒 ----
  const submitReminder = useCallback(async (draft, action) => {
    if (!remindersAreWritable()) {
      showToast('当前板端仅开放提醒读取', true);
      return false;
    }
    let succeeded = false;
    await runBusy(async () => {
      try {
        if (action === 'delete') {
          await window.familyDesktop.deleteReminder({ id: draft.id, expectedRevision: draft.expectedRevision });
          showToast('提醒已删除');
        } else if (draft.id > 0) {
          await window.familyDesktop.updateReminder(draft);
          showToast('提醒已更新');
        } else {
          const { id: _id, expectedRevision: _rev, ...rest } = draft;
          await window.familyDesktop.createReminder(rest);
          showToast('提醒已创建');
        }
        succeeded = true;
        await refreshDashboard(true);
      } catch (error) {
        showToast(errorMessage(error), true);
        if (error.code === 'REVISION_CONFLICT') await refreshDashboard(true);
      }
    });
    return succeeded;
  }, [remindersAreWritable, runBusy, refreshDashboard, showToast]);

  // ---- 初始化（挂载后执行一次） ----
  useEffect(() => {
    const adapter = new VideoCallMediaAdapter({
      remoteCanvas: remoteCanvasRef.current,
      localVideo: localVideoRef.current,
      onStatus: handleMediaStatus,
      onFailure: (error) => { void handleMediaFailure(error); }
    });
    adapterRef.current = adapter;

    let cancelled = false;
    (async () => {
      try {
        const conn = await window.familyDesktop.getConnection();
        if (cancelled) return;
        connectionRef.current = conn;
        setConnection(conn);
        await refreshDashboard(true);
        await refreshVideoCall(true);
      } catch (error) {
        if (cancelled) return;
        showToast(errorMessage(error), true);
        setConnectionDialogOpen(true);
      }
    })();

    const pollTimer = setInterval(() => { void refreshVideoCall(true); }, 1000);
    const tickTimer = setInterval(() => setCallNow(Date.now()), 1000);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(tickTimer);
      void adapter.stop();
      adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 通话时长 ----
  const callElapsedSeconds = useCallback((call) => {
    if (!call?.callId || call.state !== 'connected') {
      timedCallRef.current = { callId: null, startedAt: 0 };
      return 0;
    }
    if (timedCallRef.current.callId !== call.callId) {
      timedCallRef.current = { callId: call.callId, startedAt: Date.now() };
    }
    return Math.max(0, Math.floor((Date.now() - timedCallRef.current.startedAt) / 1000));
  }, []);

  return {
    // 数据
    connection,
    connectionOnline,
    dashboard,
    videoCall,
    activeView,
    setActiveView,
    busy,
    mediaStatus,
    callNow,
    connectionDialogOpen,
    setConnectionDialogOpen,
    reminderDialogState,
    setReminderDialogState,
    // 逻辑
    refreshDashboard,
    refreshVideoCall,
    configureConnection,
    saveSettings,
    submitReminder,
    startVideoCall,
    applyVideoCallAction,
    settingsAreWritable,
    remindersAreWritable,
    callElapsedSeconds,
    localDateInputValue,
    remoteCanvasRef,
    localVideoRef,
    showToast
  };
}
