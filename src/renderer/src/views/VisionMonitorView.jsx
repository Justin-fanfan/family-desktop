import React, { useEffect, useRef, useState } from 'react';
import { Button, Switch } from '@douyinfe/semi-ui';

const VisionMonitorAdapter = window.LongPetVisionMonitorAdapter;
const MotionControlAdapter = window.LongPetMotionControlAdapter;
const motionProtocol = window.LongPetMotionControlProtocol;

const STATE_TEXT = {
  SEARCHING: '正在寻找人物', DETECTED: '已检测到人物', TRACKING: '正在跟踪人物',
  CORRECTED: '检测器已校正目标', LOST: '人物已离开画面', REACQUIRED: '已重新找到人物'
};

const AUTO_HEAD_STATE_TEXT = {
  DISABLED: '已关闭',
  WAITING_FOR_VISION: '等待视觉服务',
  WAITING_FOR_MOTION: '等待 Motion MCU',
  SEARCHING: 'HEAD_ONLY · 正在寻找人物',
  TRACKING: 'HEAD_ONLY · 正在跟随',
  MANUAL_OVERRIDE: '人工遥控优先',
  VIDEO_CALL_SUSPENDED: '视频通话期间暂停',
  FAULT: 'Motion MCU 故障'
};

const CHASSIS_BUTTONS = [
  { direction: 'FORWARD', label: '前进', shortcut: 'W', className: 'forward' },
  { direction: 'ROTATE_LEFT', label: '原地左转', shortcut: 'A', className: 'left' },
  { direction: 'ROTATE_RIGHT', label: '原地右转', shortcut: 'D', className: 'right' },
  { direction: 'BACKWARD', label: '后退', shortcut: 'S', className: 'backward' }
];

function metric(value, digits = 1, suffix = '') {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : '--';
}

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

export default function VisionMonitorView({ state: appState, active }) {
  const canvasRef = useRef(null);
  const visionAdapterRef = useRef(null);
  const motionAdapterRef = useRef(null);
  const generationRef = useRef(0);
  const motionGenerationRef = useRef(0);
  const autoHeadGenerationRef = useRef(0);
  const autoHeadRequestRef = useRef(0);
  const autoHeadWriteRef = useRef(false);
  const pressedChassisRef = useRef(new Map());
  const activeChassisCodeRef = useRef(null);
  const activeHeadCodeRef = useRef(null);
  const [status, setStatus] = useState('进入页面后连接实时画面');
  const [telemetry, setTelemetry] = useState(null);
  const [stats, setStats] = useState({ frameRate: 0, frameSequence: 0 });
  const [debug, setDebug] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [panelMode, setPanelMode] = useState('ai');
  const [bboxVisible, setBboxVisible] = useState(true);
  const [motionStatus, setMotionStatus] = useState(null);
  const [motionMessage, setMotionMessage] = useState('切换后建立安全控制连接');
  const [motionReady, setMotionReady] = useState(false);
  const [motionRetryKey, setMotionRetryKey] = useState(0);
  const [autoHead, setAutoHead] = useState(null);
  const [autoHeadBusy, setAutoHeadBusy] = useState(false);
  const [autoHeadError, setAutoHeadError] = useState('');

  useEffect(() => {
    if (!active) return undefined;
    const generation = ++generationRef.current;
    let retryTimer = null;
    const scheduleRetry = () => {
      if (retryTimer) return;
      retryTimer = setTimeout(() => {
        if (generation === generationRef.current) setRetryKey((value) => value + 1);
      }, 2000);
    };
    const adapter = new VisionMonitorAdapter({
      canvas: canvasRef.current,
      onStatus: setStatus,
      onTelemetry: setTelemetry,
      onStats: setStats,
      onFailure: (error) => {
        if (generation !== generationRef.current) return;
        setStatus(`${error.message}，2 秒后重连`);
        scheduleRetry();
      }
    });
    adapter.setOverlayVisible(bboxVisible);
    visionAdapterRef.current = adapter;
    setTelemetry(null);
    setStats({ frameRate: 0, frameSequence: 0 });

    (async () => {
      try {
        const session = await window.familyDesktop.startVisionMonitor();
        if (generation !== generationRef.current) return;
        await adapter.connect(session.baseUrl, session);
      } catch (error) {
        if (generation !== generationRef.current) return;
        setStatus(error?.message || '无法启动 AI 视野');
        if (!['VISION_MONITOR_UNAVAILABLE', 'VISION_MONITOR_BUSY'].includes(error?.code)) scheduleRetry();
      }
    })();

    return () => {
      generationRef.current += 1;
      clearTimeout(retryTimer);
      if (visionAdapterRef.current === adapter) visionAdapterRef.current = null;
      void adapter.stop();
    };
  }, [active, retryKey, appState.connection?.baseUrl]);

  useEffect(() => {
    visionAdapterRef.current?.setOverlayVisible(bboxVisible);
  }, [bboxVisible]);

  useEffect(() => {
    if (!active || panelMode !== 'ai') return undefined;
    if (appState.dashboard?.status?.capabilities?.automaticHeadTracking === false) {
      setAutoHead(null);
      setAutoHeadError('当前 LongPet 版本不支持自动跟头');
      return undefined;
    }
    const generation = ++autoHeadGenerationRef.current;
    let timer = null;
    let stopped = false;
    const refresh = async () => {
      if (autoHeadWriteRef.current) {
        timer = setTimeout(refresh, 250);
        return;
      }
      const request = ++autoHeadRequestRef.current;
      try {
        const snapshot = await window.familyDesktop.getAutomaticHeadTracking();
        if (stopped || generation !== autoHeadGenerationRef.current
          || request !== autoHeadRequestRef.current) return;
        setAutoHead(snapshot);
        setAutoHeadError('');
      } catch (error) {
        if (stopped || generation !== autoHeadGenerationRef.current
          || request !== autoHeadRequestRef.current) return;
        setAutoHeadError(error?.message || '无法读取自动跟头状态');
      } finally {
        if (!stopped && generation === autoHeadGenerationRef.current) {
          timer = setTimeout(refresh, 1000);
        }
      }
    };
    void refresh();
    return () => {
      stopped = true;
      autoHeadGenerationRef.current += 1;
      clearTimeout(timer);
    };
  }, [active, panelMode, appState.connection?.baseUrl,
    appState.dashboard?.status?.capabilities?.automaticHeadTracking]);

  const setAutomaticHeadTracking = async (enabled) => {
    if (autoHeadBusy) return;
    autoHeadWriteRef.current = true;
    const generation = autoHeadGenerationRef.current;
    const request = ++autoHeadRequestRef.current;
    setAutoHeadBusy(true);
    try {
      const snapshot = await window.familyDesktop.setAutomaticHeadTracking({ enabled });
      if (request !== autoHeadRequestRef.current
        || generation !== autoHeadGenerationRef.current) return;
      setAutoHead(snapshot);
      setAutoHeadError('');
      appState.showToast(enabled ? '自动跟随头部已开启' : '自动跟随头部已关闭');
    } catch (error) {
      if (request !== autoHeadRequestRef.current
        || generation !== autoHeadGenerationRef.current) return;
      setAutoHeadError(error?.message || '自动跟头设置失败');
      appState.showToast(error?.message || '自动跟头设置失败', true);
    } finally {
      autoHeadWriteRef.current = false;
      setAutoHeadBusy(false);
    }
  };

  useEffect(() => {
    if (!active || panelMode !== 'remote') return undefined;
    const generation = ++motionGenerationRef.current;
    const adapter = new MotionControlAdapter({
      onStatus: (message) => {
        if (generation === motionGenerationRef.current) setMotionMessage(message);
      },
      onMotionStatus: (snapshot) => {
        if (generation === motionGenerationRef.current) setMotionStatus(snapshot);
      },
      onReady: () => {
        if (generation === motionGenerationRef.current) setMotionReady(true);
      },
      onFailure: (error) => {
        if (generation !== motionGenerationRef.current) return;
        setMotionReady(false);
        setMotionMessage(error?.message || '远程运动控制连接失败');
        appState.showToast(error?.message || '远程运动控制连接失败', true);
      }
    });
    motionAdapterRef.current = adapter;
    setMotionReady(false);
    setMotionStatus(null);
    setMotionMessage('正在申请远程运动控制');
    (async () => {
      try {
        const session = await window.familyDesktop.startMotionControl();
        if (generation !== motionGenerationRef.current) return;
        await adapter.connect(session.baseUrl, session);
      } catch (error) {
        if (generation !== motionGenerationRef.current) return;
        await adapter.stop();
        setMotionReady(false);
        setMotionMessage(error?.message || '无法启动远程运动控制');
        appState.showToast(error?.message || '无法启动远程运动控制', true);
      }
    })();

    return () => {
      motionGenerationRef.current += 1;
      pressedChassisRef.current.clear();
      activeChassisCodeRef.current = null;
      activeHeadCodeRef.current = null;
      setMotionReady(false);
      if (motionAdapterRef.current === adapter) motionAdapterRef.current = null;
      void adapter.stop();
    };
  }, [active, panelMode, motionRetryKey, appState.connection?.baseUrl]);

  const controlsEnabled = motionReady && motionStatus?.mcu_online === true
    && motionStatus?.fault !== true && motionStatus?.mode === 'MANUAL';
  const startChassis = (direction) => {
    if (controlsEnabled) motionAdapterRef.current?.startChassis(direction);
  };
  const stopChassis = () => motionAdapterRef.current?.stopChassis(true);
  const startHead = (action) => {
    if (controlsEnabled) motionAdapterRef.current?.startHead(action);
  };
  const stopHead = () => motionAdapterRef.current?.stopHead();
  const centerHead = () => {
    if (controlsEnabled) motionAdapterRef.current?.centerHead();
  };
  const emergencyStop = (reason = '手动 STOP') => {
    pressedChassisRef.current.clear();
    activeChassisCodeRef.current = null;
    activeHeadCodeRef.current = null;
    motionAdapterRef.current?.emergencyStop(reason);
  };

  useEffect(() => {
    if (!active || panelMode !== 'remote') return undefined;
    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;
      const binding = motionProtocol.keyboardBinding(event.code);
      if (!binding) return;
      event.preventDefault();
      if (event.repeat) return;
      if (binding.channel === 'chassis') {
        pressedChassisRef.current.delete(event.code);
        pressedChassisRef.current.set(event.code, binding.action);
        activeChassisCodeRef.current = event.code;
        startChassis(binding.action);
      } else if (binding.channel === 'head') {
        if (binding.action === 'CENTER') centerHead();
        else {
          activeHeadCodeRef.current = event.code;
          startHead(binding.action);
        }
      } else if (binding.action === 'STOP') {
        emergencyStop('键盘 STOP');
      } else if (binding.action === 'EXIT') {
        emergencyStop('退出远程操控');
        setPanelMode('ai');
      }
    };
    const onKeyUp = (event) => {
      const binding = motionProtocol.keyboardBinding(event.code);
      if (!binding) return;
      event.preventDefault();
      if (binding.channel === 'chassis') {
        pressedChassisRef.current.delete(event.code);
        if (activeChassisCodeRef.current === event.code) {
          const remaining = [...pressedChassisRef.current.entries()].at(-1);
          if (remaining) {
            activeChassisCodeRef.current = remaining[0];
            startChassis(remaining[1]);
          } else {
            activeChassisCodeRef.current = null;
            stopChassis();
          }
        }
      } else if (binding.channel === 'head' && activeHeadCodeRef.current === event.code) {
        activeHeadCodeRef.current = null;
        stopHead();
      }
    };
    const onBlur = () => {
      pressedChassisRef.current.clear();
      activeChassisCodeRef.current = null;
      activeHeadCodeRef.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, panelMode, controlsEnabled]);

  const holdHandlers = (start, stop) => ({
    onPointerDown: (event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      start();
    },
    onPointerUp: (event) => {
      event.preventDefault();
      stop();
    },
    onPointerCancel: stop,
    onContextMenu: (event) => event.preventDefault()
  });

  const trackingState = telemetry?.state || 'SEARCHING';
  const statusText = STATE_TEXT[trackingState] || trackingState;
  const drawable = window.LongPetVisionMonitorProtocol.shouldDisplayTarget(telemetry);

  return (
    <section className={'view' + (active ? ' active' : '')} id="view-ai-view" aria-labelledby="page-title">
      <div className="vision-monitor-layout">
        <article className="panel vision-monitor-stage">
          <canvas ref={canvasRef} id="vision-monitor-canvas" aria-label="LongPet 摄像头实时画面与 AI 人物框" />
          <div className={'vision-monitor-live-badge' + (stats.frameSequence ? ' is-live' : '')}>
            <span />{stats.frameSequence ? `LIVE · ${metric(stats.frameRate, 1, ' FPS')}` : 'WAITING'}
          </div>
          {!stats.frameSequence && <div className="vision-monitor-placeholder">{status}</div>}
        </article>

        <aside className="panel vision-monitor-info">
          <div className="vision-mode-tabs" role="tablist" aria-label="AI 视野模式">
            <button type="button" className={panelMode === 'ai' ? 'active' : ''} onClick={() => setPanelMode('ai')}>AI 视野</button>
            <button type="button" className={panelMode === 'remote' ? 'active' : ''} onClick={() => setPanelMode('remote')}>远程操控</button>
          </div>

          {panelMode === 'ai' ? (
            <>
              <p className="eyebrow">本地 AI 感知</p>
              <h2>{drawable ? statusText : trackingState === 'LOST' ? STATE_TEXT.LOST : '正在分析画面'}</h2>
              <p className="vision-monitor-status">{status}</p>
              <div className="vision-monitor-summary">
                <span className={'vision-state-dot ' + (drawable ? 'tracking' : '')} />
                <div><strong>{statusText}</strong><small>最近更新 {telemetry ? metric(telemetry.age_ms, 0, ' ms') : '--'}</small></div>
              </div>
              <label className="vision-debug-switch auto-head-switch">
                <span>
                  <strong>自动跟随头部</strong>
                  <small>{autoHeadError || AUTO_HEAD_STATE_TEXT[autoHead?.state]
                    || (autoHead ? autoHead.detail : '正在读取设备状态')}</small>
                </span>
                <Switch
                  checked={autoHead?.enabled === true}
                  disabled={autoHeadBusy || !autoHead
                    || appState.dashboard?.status?.capabilities?.automaticHeadTracking === false}
                  loading={autoHeadBusy}
                  onChange={setAutomaticHeadTracking}
                  aria-label="自动跟随头部"
                />
              </label>
              <label className="vision-debug-switch">
                <span><strong>显示 AI 调试信息</strong><small>用于开发和比赛演示</small></span>
                <Switch checked={debug} onChange={setDebug} aria-label="显示 AI 调试信息" />
              </label>
              {debug && (
                <dl className="vision-debug-grid" id="vision-debug-info">
                  <div><dt>状态</dt><dd>{trackingState}</dd></div><div><dt>画面</dt><dd>{metric(stats.frameRate, 1, ' Hz')}</dd></div>
                  <div><dt>目标更新</dt><dd>{metric(telemetry?.target_update_hz, 1, ' Hz')}</dd></div><div><dt>帧序号</dt><dd>{stats.frameSequence || '--'} / {telemetry?.frame_sequence ?? '--'}</dd></div>
                  <div><dt>Detector</dt><dd>{telemetry?.detector || 'Tinyissimo'}</dd></div><div><dt>Tracker</dt><dd>{telemetry?.tracker || 'Sparse LK'}</dd></div>
                  <div><dt>检测置信度</dt><dd>{metric(telemetry?.detector_confidence, 2)}</dd></div><div><dt>跟踪置信度</dt><dd>{metric(telemetry?.tracker_confidence, 2)}</dd></div>
                  <div><dt>特征点</dt><dd>{telemetry?.tracked_points ?? '--'}</dd></div><div><dt>Detector 延迟</dt><dd>{metric(telemetry?.detector_ms, 1, ' ms')}</dd></div>
                  <div><dt>Tracker 延迟</dt><dd>{metric(telemetry?.tracker_ms, 1, ' ms')}</dd></div><div><dt>数据新鲜</dt><dd>{telemetry?.fresh ? '是' : '否'}</dd></div>
                  <div><dt>Auto Head</dt><dd>{autoHead?.state || '--'}</dd></div><div><dt>Motion 模式</dt><dd>{autoHead?.active ? 'HEAD_ONLY' : '--'}</dd></div>
                  <div><dt>目标 dx / dy</dt><dd>{autoHead ? `${autoHead.dx} / ${autoHead.dy}` : '--'}</dd></div><div><dt>目标年龄</dt><dd>{metric(autoHead?.targetAgeMs, 0, ' ms')}</dd></div>
                </dl>
              )}
              <p className="vision-monitor-privacy">仅在本页面打开时传输画面；退出后立即停止远程视频，本地 AI 感知继续运行。</p>
              <Button onClick={() => setRetryKey((value) => value + 1)}>重新连接</Button>
            </>
          ) : (
            <div className="motion-control-panel">
              <div className="motion-control-heading">
                <div><p className="eyebrow">Family Remote Control</p><h2>实时遥控</h2></div>
                <span className={'motion-ready-badge ' + (controlsEnabled ? 'online' : '')}>{controlsEnabled ? '可操控' : '安全锁定'}</span>
              </div>
              <p className="vision-monitor-status">{motionMessage}</p>
              <label className="vision-debug-switch">
                <span><strong>显示 AI 人物框</strong><small>{statusText} · Vision 持续运行</small></span>
                <Switch checked={bboxVisible} onChange={setBboxVisible} aria-label="显示 AI 人物框" />
              </label>
              <div className="motion-section">
                <div className="motion-section-title"><strong>头部</strong><small>J / K / L</small></div>
                <div className="head-control-row">
                  <button type="button" disabled={!controlsEnabled} {...holdHandlers(() => startHead('LEFT'), stopHead)}>头左 <kbd>J</kbd></button>
                  <button type="button" disabled={!controlsEnabled} onClick={centerHead}>回中 <kbd>K</kbd></button>
                  <button type="button" disabled={!controlsEnabled} {...holdHandlers(() => startHead('RIGHT'), stopHead)}>头右 <kbd>L</kbd></button>
                </div>
              </div>
              <div className="motion-section">
                <div className="motion-section-title"><strong>底盘</strong><small>按住移动，松开停车</small></div>
                <div className="chassis-control-grid">
                  {CHASSIS_BUTTONS.map((button) => (
                    <button type="button" key={button.direction} className={button.className} disabled={!controlsEnabled}
                      {...holdHandlers(() => startChassis(button.direction), stopChassis)}>{button.label} <kbd>{button.shortcut}</kbd></button>
                  ))}
                  <button type="button" className="motion-stop-button" disabled={!motionAdapterRef.current}
                    onClick={() => emergencyStop('手动 STOP')}>STOP <kbd>Space</kbd></button>
                </div>
              </div>
              <dl className="motion-status-grid">
                <div><dt>MCU</dt><dd>{motionStatus?.mcu_online ? '在线' : motionStatus?.uart_available ? '无响应' : '未连接'}</dd></div>
                <div><dt>模式</dt><dd>{motionStatus?.mode || '--'}</dd></div>
                <div><dt>底盘</dt><dd>{motionStatus?.motion || 'STOPPED'}</dd></div>
                <div><dt>头部脉宽</dt><dd>{Number(motionStatus?.servo_us) > 0 ? `${motionStatus.servo_us} us` : '--'}</dd></div>
              </dl>
              {motionStatus?.fault && <p className="motion-fault">Motion MCU fault，请先排除硬件故障。</p>}
              {!motionReady && <Button onClick={() => setMotionRetryKey((value) => value + 1)}>重新连接控制</Button>}
              <p className="motion-keyboard-help">Esc：立即停车并退出远控。窗口失焦、最小化、断网或切换页面也会停车。</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
