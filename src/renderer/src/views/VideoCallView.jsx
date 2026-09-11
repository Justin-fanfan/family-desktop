import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { ACTIVE_CALL_STATES } from '../hooks/useAppState';

const STATE_TEXT = {
  idle: ['当前没有通话', 'LongPet 发起呼叫后将在这里提醒您'],
  outgoing_ringing: ['LongPet 正在发起通话', '请接听或拒绝本次通话'],
  notifying_device: ['正在发起通话', '正在通知 LongPet，设备将在提示音结束后自动接通'],
  connecting_media: ['正在建立媒体通道', '正在打开双方麦克风和扬声器'],
  connected: ['通话已连接', '双向媒体正在实时传输'],
  rejected: ['已拒绝本次通话', 'LongPet 端会显示家属端暂时无法接听'],
  ended: ['通话已结束', '可以再次发起语音或视频通话'],
  failed: ['通话连接失败', '请检查媒体权限、设备和网络']
};

export default function VideoCallView({ state, active }) {
  const {
    connection, dashboard, videoCall, mediaStatus, callNow, busy,
    startVideoCall, applyVideoCallAction, callElapsedSeconds,
    remoteCanvasRef, localVideoRef
  } = state;

  const call = videoCall;
  const modeName = call?.mode === 'voice' ? '语音' : '视频';
  const [stateTitle, stateDetail] = STATE_TEXT[call?.state] ?? STATE_TEXT.idle;
  if (call?.state === 'failed') STATE_TEXT.failed[1] = call.errorMessage || '请检查媒体权限、设备和网络';

  const remoteName = dashboard?.status?.device?.name || 'LongPet';
  const callIdText = call?.callId ? `通话编号 ${call.callId.slice(0, 8)}` : '--';
  const elapsed = callElapsedSeconds(call);
  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  void callNow;

  const activeCall = ACTIVE_CALL_STATES.includes(call?.state);
  const videoActive = activeCall && call?.mode === 'video';

  return (
    <section className={'view' + (active ? ' active' : '')} id="view-video-call" aria-labelledby="page-title">
      <div className="call-layout">
        <article className={'panel call-stage' + (videoActive ? ' video-active' : '')}>
          <canvas className={'call-remote-video' + (videoActive ? '' : ' hidden')} id="call-remote-video" ref={remoteCanvasRef} />
          <video className={'call-local-video' + (videoActive ? '' : ' hidden')} id="call-local-video" ref={localVideoRef} muted playsInline />
          <div className={'call-placeholder' + (videoActive ? ' hidden' : '')} id="call-placeholder">
            <span className="call-symbol">LP</span>
            <strong id="call-state-title">{stateTitle}</strong>
            <p id="call-state-detail">{stateDetail}</p>
            <span className="call-duration" id="call-duration">{duration}</span>
            <small id="call-id">{callIdText}</small>
          </div>
        </article>

        <aside className="panel call-controls">
          <span className="eyebrow">通话控制</span>
          <h2 id="call-remote-name">{remoteName}</h2>
          <p id="call-media-state">{mediaStatus}</p>
          <div className="call-actions">
            <Button className={activeCall ? 'hidden' : ''} id="start-voice-call-button"
              theme="solid" size="large" loading={busy}
              onClick={() => startVideoCall('voice')}>
              发起语音通话
            </Button>
            <Button className={activeCall ? 'hidden' : ''} id="start-video-call-button"
              theme="solid" size="large" loading={busy}
              onClick={() => startVideoCall('video')}>
              发起视频通话
            </Button>
            <Button className={call?.state !== 'outgoing_ringing' ? 'hidden' : ''} id="accept-call-button"
              theme="solid" size="large" loading={busy}
              onClick={() => applyVideoCallAction('accept')}>
              接听
            </Button>
            <Button className={call?.state !== 'outgoing_ringing' ? 'hidden' : ''} id="reject-call-button"
              type="danger" theme="solid" size="large" loading={busy}
              onClick={() => applyVideoCallAction('reject')}>
              拒绝
            </Button>
            <Button className={!activeCall || call?.state === 'outgoing_ringing' ? 'hidden' : ''} id="hangup-call-button"
              type="danger" theme="solid" size="large" loading={busy}
              onClick={() => applyVideoCallAction('hangup')}>
              挂断
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}
