'use strict';

(() => {
  const MAGIC = [0x4c, 0x50, 0x4d, 0x46];
  const VERSION = 1;
  const HEADER_SIZE = 24;
  const STREAM = { deviceVideo: 1, familyVideo: 2, deviceAudio: 3, familyAudio: 4, control: 5 };
  const MAX_SOCKET_BACKLOG = 256 * 1024;
  const FAMILY_VIDEO_WIDTH = 480;
  const FAMILY_VIDEO_HEIGHT = 360;
  const FAMILY_VIDEO_INTERVAL_MS = 125;

  function normalizeCameraRotation(value) {
    const degrees = Number(value);
    return [0, 90, 180, 270].includes(degrees) ? degrees : 0;
  }

  function orientedImageSize(width, height, rotationDegrees) {
    const rotation = normalizeCameraRotation(rotationDegrees);
    return rotation === 90 || rotation === 270
      ? { width: height, height: width }
      : { width, height };
  }

  function drawImageWithRotation(context, image, x, y, width, height,
    rotationDegrees) {
    const rotation = normalizeCameraRotation(rotationDegrees);
    if (rotation === 0) {
      context.drawImage(image, x, y, width, height);
      return;
    }
    const swapsAxes = rotation === 90 || rotation === 270;
    const sourceWidth = swapsAxes ? height : width;
    const sourceHeight = swapsAxes ? width : height;
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2,
      sourceWidth, sourceHeight);
    context.restore();
  }

  function deriveMediaUrl(baseUrl, call) {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.port = String(call.mediaPort || 8788);
    url.pathname = '/media/v1';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function encodeFrame(streamType, sequence, payload) {
    const source = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const buffer = new ArrayBuffer(HEADER_SIZE + source.byteLength);
    const bytes = new Uint8Array(buffer);
    bytes.set(MAGIC, 0);
    const view = new DataView(buffer);
    view.setUint8(4, VERSION);
    view.setUint8(5, streamType);
    view.setUint16(6, 0, false);
    view.setUint32(8, sequence >>> 0, false);
    view.setBigUint64(12, BigInt(Date.now()) * 1000n, false);
    view.setUint32(20, source.byteLength, false);
    bytes.set(source, HEADER_SIZE);
    return buffer;
  }

  function decodeFrame(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_SIZE) {
      throw new Error('收到不完整的媒体帧');
    }
    const bytes = new Uint8Array(buffer);
    if (!MAGIC.every((value, index) => bytes[index] === value) || bytes[4] !== VERSION) {
      throw new Error('媒体协议版本或帧头无效');
    }
    const view = new DataView(buffer);
    const length = view.getUint32(20, false);
    if (length > 2 * 1024 * 1024 || HEADER_SIZE + length !== buffer.byteLength) {
      throw new Error('媒体帧长度无效');
    }
    return {
      streamType: view.getUint8(5),
      sequence: view.getUint32(8, false),
      timestampUsec: view.getBigUint64(12, false),
      payload: buffer.slice(HEADER_SIZE)
    };
  }

  class VideoCallMediaAdapter {
    constructor(options = {}) {
      this.remoteCanvas = options.remoteCanvas;
      this.localVideo = options.localVideo;
      this.onStatus = options.onStatus ?? (() => {});
      this.onFailure = options.onFailure ?? (() => {});
      this.socket = null;
      this.call = null;
      this.sequences = new Uint32Array(6);
      this.videoStream = null;
      this.audioStream = null;
      this.videoTimer = null;
      this.videoCanvas = document.createElement('canvas');
      this.videoCanvas.width = FAMILY_VIDEO_WIDTH;
      this.videoCanvas.height = FAMILY_VIDEO_HEIGHT;
      this.videoEncoding = false;
      this.remoteDecodeBusy = false;
      this.pendingRemoteJpeg = null;
      this.audioContext = null;
      this.audioProcessor = null;
      this.audioSource = null;
      this.silentGain = null;
      this.audioSamples = [];
      this.playbackTime = 0;
      this.intentionalClose = false;
      this.failureReported = false;
      this.authenticated = false;
      this.mediaActive = false;
      this.cameraRotation = 0;
    }

    async connect(baseUrl, call) {
      if (this.call?.callId === call.callId && this.socket) return;
      await this.stop();
      this.call = call;
      this.intentionalClose = false;
      this.failureReported = false;
      if (call.mode === 'video') await this.startVideo();

      const mediaUrl = deriveMediaUrl(baseUrl, call);
      this.onStatus('正在连接设备媒体端口');
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(mediaUrl);
        this.socket = socket;
        socket.binaryType = 'arraybuffer';
        const timeout = setTimeout(() => reject(new Error('连接媒体端口超时')), 6000);
        socket.addEventListener('open', () => {
          clearTimeout(timeout);
          this.sendControl({ type: 'authenticate', callId: call.callId, token: call.mediaToken });
          resolve();
        }, { once: true });
        socket.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('无法连接设备媒体端口'));
        }, { once: true });
        socket.addEventListener('message', (event) => this.handleMessage(event.data));
        socket.addEventListener('close', (event) => {
          if (!this.intentionalClose) {
            this.reportFailure('MEDIA_DISCONNECTED',
              event.reason || '与 LongPet 的媒体连接已中断');
          }
        });
      });
      this.onStatus(call.state === 'notifying_device' ? '正在通知设备' : '媒体通道鉴权中');
    }

    async enableAudio() {
      if (this.audioStream) return;
      this.onStatus('正在申请麦克风权限');
      try {
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        await this.startAudioCapture();
        this.onStatus('麦克风已就绪，等待设备媒体确认');
      } catch (error) {
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        const wrapped = new Error(denied
          ? 'Windows 麦克风权限被拒绝，请在系统隐私设置中允许 LongPet Family 使用麦克风'
          : `无法打开 Windows 默认麦克风：${error?.message || '未知错误'}`);
        wrapped.code = denied ? 'PERMISSION_DENIED' : 'MICROPHONE_UNAVAILABLE';
        throw wrapped;
      }
    }

    async startVideo() {
      try {
        this.videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: FAMILY_VIDEO_WIDTH },
            height: { ideal: FAMILY_VIDEO_HEIGHT },
            frameRate: { ideal: 8, max: 10 }
          },
          audio: false
        });
        this.localVideo.srcObject = this.videoStream;
        await this.localVideo.play();
        this.startVideoSending();
      } catch (error) {
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        const wrapped = new Error(denied
          ? 'Windows 摄像头权限被拒绝，请在系统隐私设置中允许 LongPet Family 使用摄像头'
          : `无法打开 Windows 默认摄像头：${error?.message || '未知错误'}`);
        wrapped.code = denied ? 'PERMISSION_DENIED' : 'CAMERA_UNAVAILABLE';
        throw wrapped;
      }
    }

    startVideoSending() {
      clearInterval(this.videoTimer);
      const context = this.videoCanvas.getContext('2d', { alpha: false });
      this.videoTimer = setInterval(() => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN
            || this.videoEncoding || this.socket.bufferedAmount > MAX_SOCKET_BACKLOG
            || this.localVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        this.videoEncoding = true;
        const sourceWidth = this.localVideo.videoWidth || FAMILY_VIDEO_WIDTH;
        const sourceHeight = this.localVideo.videoHeight || FAMILY_VIDEO_HEIGHT;
        const sourceAspect = sourceWidth / sourceHeight;
        const targetAspect = FAMILY_VIDEO_WIDTH / FAMILY_VIDEO_HEIGHT;
        let sourceX = 0;
        let sourceY = 0;
        let cropWidth = sourceWidth;
        let cropHeight = sourceHeight;
        if (sourceAspect > targetAspect) {
          cropWidth = sourceHeight * targetAspect;
          sourceX = (sourceWidth - cropWidth) / 2;
        } else if (sourceAspect < targetAspect) {
          cropHeight = sourceWidth / targetAspect;
          sourceY = (sourceHeight - cropHeight) / 2;
        }
        context.drawImage(this.localVideo, sourceX, sourceY, cropWidth, cropHeight,
          0, 0, FAMILY_VIDEO_WIDTH, FAMILY_VIDEO_HEIGHT);
        this.videoCanvas.toBlob(async (blob) => {
          try {
            if (blob && this.socket?.readyState === WebSocket.OPEN
                && this.socket.bufferedAmount <= MAX_SOCKET_BACKLOG) {
              this.sendFrame(STREAM.familyVideo, await blob.arrayBuffer());
            }
          } finally {
            this.videoEncoding = false;
          }
        }, 'image/jpeg', 0.6);
      }, FAMILY_VIDEO_INTERVAL_MS);
    }

    async startAudioCapture() {
      this.audioContext ??= new AudioContext({ latencyHint: 'interactive' });
      await this.audioContext.resume();
      this.audioSource = this.audioContext.createMediaStreamSource(this.audioStream);
      this.audioProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);
      this.silentGain = this.audioContext.createGain();
      this.silentGain.gain.value = 0;
      this.audioProcessor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const ratio = this.audioContext.sampleRate / 16000;
        for (let outputIndex = 0; outputIndex < input.length / ratio; outputIndex += 1) {
          const sourceIndex = Math.min(input.length - 1, Math.floor(outputIndex * ratio));
          const sample = Math.max(-1, Math.min(1, input[sourceIndex]));
          this.audioSamples.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
        }
        while (this.audioSamples.length >= 320) {
          const pcm = new Int16Array(320);
          for (let index = 0; index < pcm.length; index += 1) pcm[index] = this.audioSamples.shift();
          if (this.socket?.readyState === WebSocket.OPEN
              && this.socket.bufferedAmount <= MAX_SOCKET_BACKLOG) {
            this.sendFrame(STREAM.familyAudio, pcm.buffer);
          }
        }
      };
      this.audioSource.connect(this.audioProcessor);
      this.audioProcessor.connect(this.silentGain);
      this.silentGain.connect(this.audioContext.destination);
    }

    handleMessage(buffer) {
      try {
        const frame = decodeFrame(buffer);
        if (frame.streamType === STREAM.deviceVideo && this.call?.mode === 'video') {
          this.queueRemoteVideo(frame.payload);
        } else if (frame.streamType === STREAM.deviceAudio) {
          this.playRemoteAudio(frame.payload);
        } else if (frame.streamType === STREAM.control) {
          const control = JSON.parse(new TextDecoder().decode(frame.payload));
          if (control.type === 'authenticated') {
            this.authenticated = true;
            this.cameraRotation = normalizeCameraRotation(
              control.cameraRotation ?? control.camera_rotation);
            this.onStatus(this.call?.state === 'notifying_device'
              ? '正在通知设备' : '媒体鉴权成功，正在打开音频');
          } else if (control.type === 'media_active') {
            this.mediaActive = true;
            this.onStatus('双向音视频通道已连接');
          }
        }
      } catch (error) {
        this.reportFailure('INVALID_MEDIA_FRAME', error.message);
      }
    }

    queueRemoteVideo(payload) {
      this.pendingRemoteJpeg = payload;
      if (this.remoteDecodeBusy) return;
      this.decodeLatestRemoteVideo();
    }

    async decodeLatestRemoteVideo() {
      const payload = this.pendingRemoteJpeg;
      if (!payload) return;
      this.pendingRemoteJpeg = null;
      this.remoteDecodeBusy = true;
      try {
        const bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }));
        const canvas = this.remoteCanvas;
        const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
        const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext('2d', { alpha: false });
        const oriented = orientedImageSize(
          bitmap.width, bitmap.height, this.cameraRotation);
        const scale = Math.max(width / oriented.width, height / oriented.height);
        const drawWidth = oriented.width * scale;
        const drawHeight = oriented.height * scale;
        context.fillStyle = '#151515';
        context.fillRect(0, 0, width, height);
        drawImageWithRotation(context, bitmap,
          (width - drawWidth) / 2, (height - drawHeight) / 2,
          drawWidth, drawHeight, this.cameraRotation);
        bitmap.close();
      } finally {
        this.remoteDecodeBusy = false;
        if (this.pendingRemoteJpeg) this.decodeLatestRemoteVideo();
      }
    }

    async playRemoteAudio(payload) {
      if (!this.audioStream) return;
      this.audioContext ??= new AudioContext({ latencyHint: 'interactive' });
      await this.audioContext.resume();
      const pcm = new Int16Array(payload);
      const audioBuffer = this.audioContext.createBuffer(1, pcm.length, 16000);
      const channel = audioBuffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32768;
      const now = this.audioContext.currentTime;
      if (this.playbackTime < now + 0.02 || this.playbackTime > now + 0.25) {
        this.playbackTime = now + 0.06;
      }
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.start(this.playbackTime);
      this.playbackTime += audioBuffer.duration;
    }

    sendFrame(streamType, payload) {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.sequences[streamType] = (this.sequences[streamType] + 1) >>> 0;
      this.socket.send(encodeFrame(streamType, this.sequences[streamType], payload));
    }

    sendControl(object) {
      this.sendFrame(STREAM.control, new TextEncoder().encode(JSON.stringify(object)));
    }

    reportFailure(code, message) {
      if (this.failureReported || this.intentionalClose) return;
      this.failureReported = true;
      this.onFailure({ code, message });
    }

    beginTermination() {
      this.intentionalClose = true;
    }

    async stop(sendHangup = false) {
      this.intentionalClose = true;
      clearInterval(this.videoTimer);
      this.videoTimer = null;
      if (sendHangup && this.socket?.readyState === WebSocket.OPEN) {
        this.sendControl({ type: 'hangup' });
      }
      this.socket?.close(1000, '通话结束');
      this.socket = null;
      for (const stream of [this.videoStream, this.audioStream]) {
        stream?.getTracks().forEach((track) => track.stop());
      }
      this.videoStream = null;
      this.audioStream = null;
      this.localVideo.srcObject = null;
      this.audioProcessor?.disconnect();
      this.audioSource?.disconnect();
      this.silentGain?.disconnect();
      this.audioProcessor = null;
      this.audioSource = null;
      this.silentGain = null;
      if (this.audioContext) await this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.audioSamples = [];
      this.pendingRemoteJpeg = null;
      this.remoteDecodeBusy = false;
      this.authenticated = false;
      this.mediaActive = false;
      this.cameraRotation = 0;
      this.call = null;
      this.sequences.fill(0);
    }
  }

  window.LongPetVideoCallMediaAdapter = VideoCallMediaAdapter;
  window.LongPetMediaProtocol = Object.freeze({
    encodeFrame,
    decodeFrame,
    deriveMediaUrl,
    normalizeCameraRotation,
    orientedImageSize,
    drawImageWithRotation,
    STREAM,
    VIDEO_SETTINGS: Object.freeze({
      familyVideoWidth: FAMILY_VIDEO_WIDTH,
      familyVideoHeight: FAMILY_VIDEO_HEIGHT,
      familyVideoIntervalMs: FAMILY_VIDEO_INTERVAL_MS
    })
  });
})();
// --- CJS 导出 shim（为 Vite/React 构建提供直接 import；行为不变，Node 测试仍通过 require 读取 window 全局） ---
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VideoCallMediaAdapter: window.LongPetVideoCallMediaAdapter,
    LongPetMediaProtocol: window.LongPetMediaProtocol
  };
}
