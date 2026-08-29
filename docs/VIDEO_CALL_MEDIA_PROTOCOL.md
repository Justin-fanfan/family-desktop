# LongPet 局域网双向通话媒体协议与实现说明

日期：2026-08-29  
协议版本：1  
默认媒体端口：8788/TCP

## 1. 实现结果

家属端现在可以选择“语音通话”或“视频通话”并主动呼叫，也保留接听 LongPet 首页主动视频呼叫的能力。媒体不再停留在 FamilyLink 信令页：Electron Renderer 使用 Windows 默认摄像头、麦克风和扬声器，连接 LongPet 提供的临时 WebSocket 会话，双向发送 JPEG 与 PCM。

语音模式不会申请摄像头权限、不会创建视频轨道。视频采用非对称低负载参数：LongPet 摄像头发往电脑为 640×480、约 10 FPS；电脑发往单核 LongPet 为 480×360、8 FPS。采集画面按比例居中裁切后编码 JPEG，不拉伸。接收端解码繁忙时只保留最新 JPEG，WebSocket backlog 超过 256 KiB 时跳过新编码或发送，避免延迟持续累积。

音频格式固定为 PCM S16_LE、16 kHz、单声道、20 ms/帧（640 bytes）。Windows 播放端以约 60 ms 初始缓冲调度，积压超过约 250 ms 时重置到低延迟窗口。LongPet 端另有 3 帧起播、最多 12 帧的有界队列。

## 2. 地址与鉴权

媒体 URL 必须由用户配置的 FamilyLink URL 推导：

```text
http://device-host:8787  -> ws://device-host:<mediaPort>/media/v1
https://device-host     -> wss://device-host:<mediaPort>/media/v1
```

`mediaPort` 和一次性 `mediaToken` 来自 `GET/POST /api/v1/video-call` 快照。连接后的第一帧必须是 Control 流：

```json
{
  "type": "authenticate",
  "callId": "当前 callId",
  "token": "当前 mediaToken"
}
```

服务端验证失败会用 WebSocket Policy Violation 关闭连接。验证成功返回 `authenticated`；提示音结束且板端音频进程就绪后返回 `media_active`。UI 只有收到状态快照 `connected + mediaReady=true` 后才显示真正连接成功。

## 3. 二进制帧头

所有多媒体与控制消息都使用一个完整 WebSocket Binary Message，网络字节序（Big Endian）。帧头固定 24 bytes：

| 偏移 | 长度 | 字段 | 说明 |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `LPMF` |
| 4 | 1 | version | 当前为 `1` |
| 5 | 1 | streamType | 见下表 |
| 6 | 2 | flags | 预留，当前通常为 0 |
| 8 | 4 | sequence | 每种流独立递增的无符号序号 |
| 12 | 8 | timestampUsec | Unix epoch 微秒时间戳 |
| 20 | 4 | payloadLength | payload 字节数，最大 2 MiB |
| 24 | N | payload | JPEG、PCM 或 UTF-8 JSON |

流类型：

| 值 | 名称 | payload |
|---:|---|---|
| 1 | DeviceVideo | LongPet 摄像头 JPEG |
| 2 | FamilyVideo | Windows 摄像头 JPEG |
| 3 | DeviceAudio | LongPet USB 麦克风 PCM |
| 4 | FamilyAudio | Windows 默认麦克风 PCM |
| 5 | Control | UTF-8 JSON 控制消息 |

接收端必须验证 magic、version、类型、总长度和 2 MiB 上限。未知版本不能按当前协议继续解析。

## 4. 家属呼叫时序

```text
点击语音/视频呼叫
  -> POST /api/v1/video-call {mode}
  -> LongPet 返回 notifying_device
  -> 板端播放一次对应中文提示音
  -> 视频模式可在此时打开双方摄像头并完成媒体鉴权
  -> 提示音结束
  -> LongPet 状态变为 connecting_media
  -> 双方此时才打开麦克风；板端打开 USB 扬声器
  -> 媒体端返回 media_active
  -> LongPet 状态变为 connected、mediaReady=true
```

提示音期间取消会先通过 HTTP `hangup` 结束会话，板端立即终止 `aplay`、摄像头和 WebSocket。摄像头/麦克风权限失败时，家属端发送 `action=fail`，双方显示具体错误并释放所有 track、AudioContext、定时器和 socket。

## 5. Electron 媒体权限与生命周期

Electron 主进程只允许当前主窗口请求 `media` 权限，并启用本地通话需要的无手势音频播放策略。Renderer 仍需经过 Windows 隐私权限；拒绝时会显示可理解提示。

每次结束调用都会：

- `MediaStreamTrack.stop()` 释放摄像头和麦克风；
- 断开 ScriptProcessor/MediaStreamSource/Gain；
- 关闭 AudioContext；
- 清除视频发送定时器和待解码帧；
- 正常关闭 WebSocket；
- 清空序号和当前 callId。

因此连续呼叫不会保留 Windows 摄像头或麦克风占用。

## 6. 快速实测

1. 在家属端配置 `http://10.240.178.51:8787` 和板端 Bearer Token。
2. 先发起语音通话：确认板端只播放一次“语音通话”提示、无摄像头权限请求、提示结束后双方能互相听见。
3. 挂断后立刻再次语音呼叫，确认无 ALSA/麦克风占用错误。
4. 发起视频通话：确认提示阶段显示“正在通知设备”，随后双方视频和声音都出现。
5. 观察 LongPet 远端视频满屏裁切、等待时纯黑且没有本地小窗；触屏显示挂断，4 秒后隐藏。
6. 提示音未结束前在家属端取消，确认板端提示音立即停止并返回首页。
7. 通话中断开 Wi-Fi，确认双方显示网络/媒体中断且摄像头指示灯熄灭。
8. 一端通话中再尝试发起另一通话，确认 HTTP 409 `DEVICE_BUSY`。

## 7. 当前边界

- 这是可信局域网第一版：控制面有 Bearer Token、媒体会话有临时 Token，但 WebSocket `ws://` 本身未加 TLS；不要直接暴露到公网。
- 使用未压缩 PCM，单方向约 256 kbit/s；视频码率取决于画面复杂度和 JPEG 大小。
- Windows 侧请求浏览器级回声消除/降噪/自动增益，但板端没有专用 AEC；近距离扬声器和麦克风仍可能回声。
- 缓冲为固定低延迟窗口，不是自适应网络抖动算法。
- 第一版不做音视频唇音同步，也不做丢包重传；目标是稳定、低积压的局域网实时通话。
- 家属端通话时长从本机首次观察到 `connected` 时用单调时钟从 00:00 开始，不依赖板端系统时间，避免两台设备时钟偏差造成初始分钟数错误。
