'use strict';

(() => {
  const protocol = window.LongPetMediaProtocol;
  if (!protocol) throw new Error('LongPet media protocol must load before Motion Control');

  const { encodeFrame, decodeFrame, STREAM } = protocol;
  const MOTION_PROTOCOL_VERSION = 1;
  const CHASSIS_DIRECTIONS = new Set([
    'FORWARD', 'BACKWARD', 'ROTATE_LEFT', 'ROTATE_RIGHT'
  ]);
  const HEAD_ACTIONS = new Set(['LEFT', 'CENTER', 'RIGHT']);
  const KEY_BINDINGS = Object.freeze({
    KeyW: { channel: 'chassis', action: 'FORWARD' },
    KeyS: { channel: 'chassis', action: 'BACKWARD' },
    KeyA: { channel: 'chassis', action: 'ROTATE_LEFT' },
    KeyD: { channel: 'chassis', action: 'ROTATE_RIGHT' },
    KeyJ: { channel: 'head', action: 'LEFT' },
    KeyK: { channel: 'head', action: 'CENTER' },
    KeyL: { channel: 'head', action: 'RIGHT' },
    Space: { channel: 'safety', action: 'STOP' },
    Escape: { channel: 'safety', action: 'EXIT' }
  });

  function deriveMotionControlUrl(baseUrl, session) {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.port = String(session.port || 8790);
    url.pathname = '/motion-control/v1';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function keyboardBinding(code) {
    return KEY_BINDINGS[code] || null;
  }

  class MotionControlAdapter {
    constructor(options = {}) {
      this.onStatus = options.onStatus ?? (() => {});
      this.onMotionStatus = options.onMotionStatus ?? (() => {});
      this.onReady = options.onReady ?? (() => {});
      this.onFailure = options.onFailure ?? (() => {});
      this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
      this.socket = null;
      this.session = null;
      this.sequence = 0;
      this.authenticated = false;
      this.intentionalClose = false;
      this.failureReported = false;
      this.chassisTimer = null;
      this.headTimer = null;
      this.activeChassis = null;
      this.activeHead = null;
      this.refreshIntervalMs = 150;
      this.defaultSpeed = 20;
      this.headStepUs = 20;
      this.handleWindowBlur = () => this.emergencyStop('窗口失去焦点');
      this.handleVisibility = () => {
        if (document.visibilityState !== 'visible') this.emergencyStop('窗口不可见');
      };
      this.handlePageHide = () => this.emergencyStop('页面关闭');
      this.handleConnectionChanging = () => {
        this.emergencyStop('切换设备连接');
        void this.stop();
      };
    }

    async connect(baseUrl, session) {
      await this.stop();
      this.session = session;
      this.refreshIntervalMs = Math.max(50, Number(session.refreshIntervalMs) || 150);
      this.defaultSpeed = Math.min(100, Math.max(1, Number(session.defaultSpeed) || 20));
      this.headStepUs = Math.min(100, Math.max(1, Number(session.headStepUs) || 20));
      this.intentionalClose = false;
      this.failureReported = false;
      this.onStatus('正在连接 LongPet 运动控制通道');
      const socket = this.socketFactory(deriveMotionControlUrl(baseUrl, session));
      this.socket = socket;
      socket.binaryType = 'arraybuffer';

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('连接运动控制端口超时')), 6000);
        socket.addEventListener('open', () => {
          clearTimeout(timeout);
          this.sendControl({
            type: 'authenticate',
            protocol_version: MOTION_PROTOCOL_VERSION,
            session_id: session.sessionId,
            token: session.sessionToken
          });
          resolve();
        }, { once: true });
        socket.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('无法连接 LongPet 运动控制端口'));
        }, { once: true });
        socket.addEventListener('message', (event) => {
          if (this.socket === socket) this.handleMessage(event.data);
        });
        socket.addEventListener('close', (event) => {
          if (this.socket !== socket) return;
          this.clearHolds();
          this.authenticated = false;
          if (!this.intentionalClose) {
            this.reportFailure('MOTION_CONTROL_DISCONNECTED',
              event.reason || '运动控制连接已中断');
          }
        });
      });
      window.addEventListener('blur', this.handleWindowBlur);
      window.addEventListener('pagehide', this.handlePageHide);
      window.addEventListener('longpet-connection-changing', this.handleConnectionChanging);
      document.addEventListener('visibilitychange', this.handleVisibility);
      this.onStatus('会话令牌已发送，等待 Motion MCU 进入 MANUAL');
    }

    handleMessage(buffer) {
      try {
        const frame = decodeFrame(buffer);
        if (frame.streamType !== STREAM.control) return;
        const control = JSON.parse(new TextDecoder().decode(frame.payload));
        if (control.type === 'control_started') {
          this.authenticated = true;
          this.refreshIntervalMs = Math.max(50,
            Number(control.refresh_interval_ms) || this.refreshIntervalMs);
          this.defaultSpeed = Math.min(100, Math.max(1,
            Number(control.default_speed) || this.defaultSpeed));
          this.headStepUs = Math.min(100, Math.max(1,
            Number(control.head_step_us) || this.headStepUs));
          this.onStatus('远程操控已连接');
          this.onReady();
        } else if (control.type === 'motion_status') {
          this.onMotionStatus(control);
        } else if (control.type === 'error') {
          if (control.code === 'INVALID_COMMAND') {
            this.onStatus(control.message || '运动控制命令无效');
          } else {
            this.reportFailure(control.code || 'MOTION_CONTROL_ERROR',
              control.message || '远程运动控制发生错误');
          }
        }
      } catch (error) {
        this.reportFailure('INVALID_MOTION_FRAME', error.message);
      }
    }

    startChassis(direction, speed = this.defaultSpeed) {
      const normalized = String(direction || '').toUpperCase();
      const normalizedSpeed = Math.round(Number(speed));
      if (!this.authenticated || !CHASSIS_DIRECTIONS.has(normalized)
          || normalizedSpeed < 1 || normalizedSpeed > 100) return false;
      this.stopChassis(false);
      this.activeChassis = { direction: normalized, speed: normalizedSpeed };
      const refresh = () => {
        if (!this.activeChassis) return;
        this.sendControl({
          type: 'chassis',
          direction: this.activeChassis.direction,
          speed: this.activeChassis.speed
        });
      };
      refresh();
      this.chassisTimer = setInterval(refresh, this.refreshIntervalMs);
      return true;
    }

    stopChassis(sendStop = true) {
      clearInterval(this.chassisTimer);
      this.chassisTimer = null;
      const wasActive = Boolean(this.activeChassis);
      this.activeChassis = null;
      if (sendStop && (wasActive || this.authenticated)) {
        this.sendControl({ type: 'stop' });
      }
    }

    startHead(action, stepUs = this.headStepUs) {
      const normalized = String(action || '').toUpperCase();
      const normalizedStep = Math.round(Number(stepUs));
      if (!this.authenticated || !['LEFT', 'RIGHT'].includes(normalized)
          || normalizedStep < 1 || normalizedStep > 100) return false;
      this.stopHead();
      this.activeHead = { action: normalized, stepUs: normalizedStep };
      const refresh = () => {
        if (!this.activeHead) return;
        this.sendControl({
          type: 'head', action: this.activeHead.action,
          step_us: this.activeHead.stepUs
        });
      };
      refresh();
      this.headTimer = setInterval(refresh, this.refreshIntervalMs);
      return true;
    }

    stopHead() {
      clearInterval(this.headTimer);
      this.headTimer = null;
      this.activeHead = null;
    }

    centerHead() {
      if (!this.authenticated) return false;
      this.stopHead();
      this.sendControl({ type: 'head', action: 'CENTER' });
      return true;
    }

    emergencyStop(reason = 'STOP') {
      this.clearHolds();
      if (this.authenticated) this.sendControl({ type: 'stop' });
      this.onStatus(`${reason}，底盘已请求停车`);
    }

    clearHolds() {
      clearInterval(this.chassisTimer);
      clearInterval(this.headTimer);
      this.chassisTimer = null;
      this.headTimer = null;
      this.activeChassis = null;
      this.activeHead = null;
    }

    sendControl(object) {
      if (this.socket?.readyState !== 1) return false;
      this.sequence = (this.sequence + 1) >>> 0;
      this.socket.send(encodeFrame(STREAM.control, this.sequence,
        new TextEncoder().encode(JSON.stringify(object))));
      return true;
    }

    reportFailure(code, message) {
      if (this.failureReported || this.intentionalClose) return;
      this.failureReported = true;
      this.clearHolds();
      this.onFailure({ code, message });
    }

    async stop() {
      this.intentionalClose = true;
      window.removeEventListener('blur', this.handleWindowBlur);
      window.removeEventListener('pagehide', this.handlePageHide);
      window.removeEventListener('longpet-connection-changing', this.handleConnectionChanging);
      document.removeEventListener('visibilitychange', this.handleVisibility);
      const canSend = this.socket?.readyState === 1;
      this.clearHolds();
      if (canSend && this.authenticated) {
        this.sendControl({ type: 'stop' });
        this.sendControl({ type: 'release' });
      }
      this.socket?.close(1000, '退出远程运动控制');
      this.socket = null;
      this.session = null;
      this.authenticated = false;
      this.sequence = 0;
    }
  }

  window.LongPetMotionControlAdapter = MotionControlAdapter;
  window.LongPetMotionControlProtocol = Object.freeze({
    deriveMotionControlUrl,
    keyboardBinding,
    CHASSIS_DIRECTIONS,
    HEAD_ACTIONS,
    MOTION_PROTOCOL_VERSION
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MotionControlAdapter: window.LongPetMotionControlAdapter,
    LongPetMotionControlProtocol: window.LongPetMotionControlProtocol
  };
}
