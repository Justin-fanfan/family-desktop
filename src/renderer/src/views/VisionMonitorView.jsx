import React, { useEffect, useRef, useState } from 'react';
import { Button, Switch } from '@douyinfe/semi-ui';

const VisionMonitorAdapter = window.LongPetVisionMonitorAdapter;

const STATE_TEXT = {
  SEARCHING: '正在寻找人物',
  DETECTED: '已检测到人物',
  TRACKING: '正在跟踪人物',
  CORRECTED: '检测器已校正目标',
  LOST: '人物已离开画面',
  REACQUIRED: '已重新找到人物'
};

function metric(value, digits = 1, suffix = '') {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : '--';
}

export default function VisionMonitorView({ active }) {
  const canvasRef = useRef(null);
  const adapterRef = useRef(null);
  const generationRef = useRef(0);
  const [status, setStatus] = useState('进入页面后连接实时画面');
  const [telemetry, setTelemetry] = useState(null);
  const [stats, setStats] = useState({ frameRate: 0, frameSequence: 0 });
  const [debug, setDebug] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    const generation = ++generationRef.current;
    let retryTimer = null;
    const scheduleRetry = () => {
      if (retryTimer) return;
      retryTimer = setTimeout(() => {
        if (generation === generationRef.current) {
          setRetryKey((value) => value + 1);
        }
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
    adapterRef.current = adapter;
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
        if (!['VISION_MONITOR_UNAVAILABLE', 'VISION_MONITOR_BUSY'].includes(error?.code)) {
          scheduleRetry();
        }
      }
    })();

    return () => {
      generationRef.current += 1;
      clearTimeout(retryTimer);
      if (adapterRef.current === adapter) adapterRef.current = null;
      void adapter.stop();
    };
  }, [active, retryKey]);

  const state = telemetry?.state || 'SEARCHING';
  const statusText = STATE_TEXT[state] || state;
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
          <p className="eyebrow">本地 AI 感知</p>
          <h2>{drawable ? statusText : state === 'LOST' ? STATE_TEXT.LOST : '正在分析画面'}</h2>
          <p className="vision-monitor-status">{status}</p>
          <div className="vision-monitor-summary">
            <span className={'vision-state-dot ' + (drawable ? 'tracking' : '')} />
            <div>
              <strong>{statusText}</strong>
              <small>最近更新 {telemetry ? metric(telemetry.age_ms, 0, ' ms') : '--'}</small>
            </div>
          </div>
          <label className="vision-debug-switch">
            <span><strong>显示 AI 调试信息</strong><small>用于开发和比赛演示</small></span>
            <Switch checked={debug} onChange={setDebug} aria-label="显示 AI 调试信息" />
          </label>
          {debug && (
            <dl className="vision-debug-grid" id="vision-debug-info">
              <div><dt>状态</dt><dd>{state}</dd></div>
              <div><dt>画面</dt><dd>{metric(stats.frameRate, 1, ' Hz')}</dd></div>
              <div><dt>目标更新</dt><dd>{metric(telemetry?.target_update_hz, 1, ' Hz')}</dd></div>
              <div><dt>帧序号</dt><dd>{stats.frameSequence || '--'} / {telemetry?.frame_sequence ?? '--'}</dd></div>
              <div><dt>Detector</dt><dd>{telemetry?.detector || 'Tinyissimo'}</dd></div>
              <div><dt>Tracker</dt><dd>{telemetry?.tracker || 'Sparse LK'}</dd></div>
              <div><dt>检测置信度</dt><dd>{metric(telemetry?.detector_confidence, 2)}</dd></div>
              <div><dt>跟踪置信度</dt><dd>{metric(telemetry?.tracker_confidence, 2)}</dd></div>
              <div><dt>特征点</dt><dd>{telemetry?.tracked_points ?? '--'}</dd></div>
              <div><dt>Detector 延迟</dt><dd>{metric(telemetry?.detector_ms, 1, ' ms')}</dd></div>
              <div><dt>Tracker 延迟</dt><dd>{metric(telemetry?.tracker_ms, 1, ' ms')}</dd></div>
              <div><dt>数据新鲜</dt><dd>{telemetry?.fresh ? '是' : '否'}</dd></div>
            </dl>
          )}
          <p className="vision-monitor-privacy">仅在本页面打开时传输画面；退出后立即停止远程视频，本地 AI 感知继续运行。</p>
          <Button onClick={() => setRetryKey((value) => value + 1)}>重新连接</Button>
        </aside>
      </div>
    </section>
  );
}
