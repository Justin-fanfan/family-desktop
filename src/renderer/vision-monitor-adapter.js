'use strict';

(() => {
  const protocol = window.LongPetMediaProtocol;
  if (!protocol) throw new Error('LongPet media protocol must load before Vision Monitor');

  const {
    encodeFrame, decodeFrame, normalizeCameraRotation,
    orientedImageSize, drawImageWithRotation, STREAM
  } = protocol;
  const VISION_PROTOCOL_VERSION = 1;
  const MAX_TARGET_AGE_MS = 1000;

  function deriveVisionMonitorUrl(baseUrl, session) {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.port = String(session.port || 8789);
    url.pathname = '/vision-monitor/v1';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function clampUnit(value) {
    return Math.min(1, Math.max(0, Number(value)));
  }

  function parseVisionMetadata(value, receivedAt = Date.now()) {
    if (!value || value.type !== 'vision_target'
        || value.protocol_version !== VISION_PROTOCOL_VERSION) {
      throw new Error('AI 视野元数据版本无效');
    }
    let bbox = null;
    if (value.bbox && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(value.bbox[key]))) {
      const x = clampUnit(value.bbox.x);
      const y = clampUnit(value.bbox.y);
      bbox = {
        x,
        y,
        w: Math.min(clampUnit(value.bbox.w), 1 - x),
        h: Math.min(clampUnit(value.bbox.h), 1 - y)
      };
      if (bbox.w <= 0 || bbox.h <= 0) bbox = null;
    }
    return {
      ...value,
      state: String(value.state || 'SEARCHING').toUpperCase(),
      present: value.present === true,
      fresh: value.fresh === true,
      bbox,
      receivedAt
    };
  }

  function shouldDisplayTarget(target, now = Date.now()) {
    if (!target?.present || !target.fresh || !target.bbox) return false;
    if (target.state === 'SEARCHING' || target.state === 'LOST') return false;
    if (Number(target.age_ms) > MAX_TARGET_AGE_MS) return false;
    return now - target.receivedAt <= MAX_TARGET_AGE_MS;
  }

  function targetColor(state) {
    if (state === 'DETECTED' || state === 'CORRECTED' || state === 'REACQUIRED') {
      return '#ff9f43';
    }
    return '#43d6a1';
  }

  class VisionMonitorAdapter {
    constructor(options = {}) {
      this.canvas = options.canvas;
      this.onStatus = options.onStatus ?? (() => {});
      this.onTelemetry = options.onTelemetry ?? (() => {});
      this.onStats = options.onStats ?? (() => {});
      this.onFailure = options.onFailure ?? (() => {});
      this.socket = null;
      this.sequence = 0;
      this.session = null;
      this.intentionalClose = false;
      this.failureReported = false;
      this.authenticated = false;
      this.pendingJpeg = null;
      this.decodeBusy = false;
      this.bitmap = null;
      this.target = null;
      this.frameSequence = 0;
      this.frameTimestampUsec = 0n;
      this.frameRate = 0;
      this.previousFrameAt = 0;
      this.generation = 0;
      this.drawTimer = null;
      this.resizeObserver = null;
      this.cameraRotation = 0;
      this.overlayVisible = true;
    }

    async connect(baseUrl, session) {
      await this.stop();
      this.session = session;
      this.intentionalClose = false;
      this.failureReported = false;
      this.onStatus('正在连接 LongPet AI 视野');
      const socket = new WebSocket(deriveVisionMonitorUrl(baseUrl, session));
      this.socket = socket;
      socket.binaryType = 'arraybuffer';

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('连接 AI 视野端口超时')), 6000);
        socket.addEventListener('open', () => {
          clearTimeout(timeout);
          this.sendControl({
            type: 'authenticate',
            protocol_version: VISION_PROTOCOL_VERSION,
            session_id: session.sessionId,
            token: session.sessionToken
          });
          resolve();
        }, { once: true });
        socket.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('无法连接 LongPet AI 视野端口'));
        }, { once: true });
        socket.addEventListener('message', (event) => {
          if (this.socket === socket) this.handleMessage(event.data);
        });
        socket.addEventListener('close', (event) => {
          if (this.socket === socket && !this.intentionalClose) {
            this.reportFailure('VISION_MONITOR_DISCONNECTED',
              event.reason || 'AI 视野连接已中断');
          }
        });
      });

      this.drawTimer = setInterval(() => this.draw(), 100);
      if (typeof ResizeObserver !== 'undefined' && this.canvas) {
        this.resizeObserver = new ResizeObserver(() => this.draw());
        this.resizeObserver.observe(this.canvas);
      }
      this.onStatus('会话令牌已发送，等待设备打开摄像头');
    }

    handleMessage(buffer) {
      try {
        const frame = decodeFrame(buffer);
        if (frame.streamType === STREAM.deviceVideo) {
          this.frameSequence = frame.sequence;
          this.frameTimestampUsec = frame.timestampUsec;
          this.updateFrameRate();
          this.queueJpeg(frame.payload);
          return;
        }
        if (frame.streamType !== STREAM.control) return;
        const control = JSON.parse(new TextDecoder().decode(frame.payload));
        if (control.type === 'stream_started') {
          this.authenticated = true;
          this.cameraRotation = normalizeCameraRotation(control.camera_rotation);
          this.onStatus(`实时画面已连接 · 目标 ${control.frame_rate || this.session?.frameRate || 7} FPS`);
        } else if (control.type === 'vision_target') {
          this.target = parseVisionMetadata(control);
          this.onTelemetry(this.target);
          this.draw();
        } else if (control.type === 'error') {
          this.reportFailure(control.code || 'VISION_MONITOR_ERROR',
            control.message || 'AI 视野服务发生错误');
        }
      } catch (error) {
        this.reportFailure('INVALID_VISION_FRAME', error.message);
      }
    }

    updateFrameRate() {
      const now = performance.now();
      if (this.previousFrameAt > 0) {
        const instantaneous = 1000 / Math.max(1, now - this.previousFrameAt);
        this.frameRate = this.frameRate > 0
          ? this.frameRate * 0.8 + instantaneous * 0.2 : instantaneous;
        this.onStats({ frameRate: this.frameRate, frameSequence: this.frameSequence });
      }
      this.previousFrameAt = now;
    }

    queueJpeg(payload) {
      this.pendingJpeg = payload;
      if (!this.decodeBusy) void this.decodeLatest();
    }

    async decodeLatest() {
      const payload = this.pendingJpeg;
      if (!payload) return;
      const generation = this.generation;
      this.pendingJpeg = null;
      this.decodeBusy = true;
      try {
        const bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }));
        if (generation !== this.generation) {
          bitmap.close();
          return;
        }
        this.bitmap?.close();
        this.bitmap = bitmap;
        this.draw();
      } catch (error) {
        console.warn('Vision Monitor JPEG decode failed:', error);
      } finally {
        this.decodeBusy = false;
        if (this.pendingJpeg) void this.decodeLatest();
      }
    }

    draw() {
      const canvas = this.canvas;
      if (!canvas) return;
      const pixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
      const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#151515';
      context.fillRect(0, 0, width, height);
      if (!this.bitmap) return;

      const oriented = orientedImageSize(
        this.bitmap.width, this.bitmap.height, this.cameraRotation);
      const scale = Math.min(width / oriented.width, height / oriented.height);
      const drawWidth = oriented.width * scale;
      const drawHeight = oriented.height * scale;
      const offsetX = (width - drawWidth) / 2;
      const offsetY = (height - drawHeight) / 2;
      drawImageWithRotation(context, this.bitmap, offsetX, offsetY,
        drawWidth, drawHeight, this.cameraRotation);

      if (!this.overlayVisible || !shouldDisplayTarget(this.target)) return;
      const { x, y, w, h } = this.target.bbox;
      const left = offsetX + x * drawWidth;
      const top = offsetY + y * drawHeight;
      const boxWidth = w * drawWidth;
      const boxHeight = h * drawHeight;
      const color = targetColor(this.target.state);
      context.strokeStyle = color;
      context.lineWidth = Math.max(3, 3 * pixelRatio);
      context.strokeRect(left, top, boxWidth, boxHeight);
      const label = `${this.target.state}  PERSON`;
      context.font = `600 ${Math.max(13, 13 * pixelRatio)}px Segoe UI, Microsoft YaHei`;
      const labelWidth = context.measureText(label).width + 16 * pixelRatio;
      const labelHeight = 25 * pixelRatio;
      context.fillStyle = color;
      context.fillRect(left, Math.max(0, top - labelHeight), labelWidth, labelHeight);
      context.fillStyle = '#102019';
      context.fillText(label, left + 8 * pixelRatio,
        Math.max(labelHeight - 7 * pixelRatio, top - 7 * pixelRatio));
    }

    sendControl(object) {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.sequence = (this.sequence + 1) >>> 0;
      this.socket.send(encodeFrame(STREAM.control, this.sequence,
        new TextEncoder().encode(JSON.stringify(object))));
    }

    setOverlayVisible(visible) {
      this.overlayVisible = visible !== false;
      this.draw();
    }

    reportFailure(code, message) {
      if (this.failureReported || this.intentionalClose) return;
      this.failureReported = true;
      this.onFailure({ code, message });
    }

    async stop() {
      this.intentionalClose = true;
      this.generation += 1;
      clearInterval(this.drawTimer);
      this.drawTimer = null;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendControl({ type: 'stop' });
      }
      this.socket?.close(1000, '退出 AI 视野');
      this.socket = null;
      this.bitmap?.close();
      this.bitmap = null;
      this.pendingJpeg = null;
      this.decodeBusy = false;
      this.target = null;
      this.authenticated = false;
      this.session = null;
      this.sequence = 0;
      this.frameRate = 0;
      this.previousFrameAt = 0;
      this.cameraRotation = 0;
      this.draw();
    }
  }

  window.LongPetVisionMonitorAdapter = VisionMonitorAdapter;
  window.LongPetVisionMonitorProtocol = Object.freeze({
    deriveVisionMonitorUrl,
    parseVisionMetadata,
    shouldDisplayTarget,
    MAX_TARGET_AGE_MS
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VisionMonitorAdapter: window.LongPetVisionMonitorAdapter,
    LongPetVisionMonitorProtocol: window.LongPetVisionMonitorProtocol
  };
}
