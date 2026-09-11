# LongPet FamilyLink HTTP API v1

## 1. 目标与边界

该协议用于家属端读取 LongPet 状态，并通过 LongPet 既有 Service 修改设置和提醒。网络层不得直接读写 SQLite，也不得直接操作 ALSA、背光或其他硬件。

板端推荐调用链：

```text
HTTP Adapter
  -> FamilyLinkService / FamilyLinkController
  -> SystemService / SettingsService / ReminderService / CareService
  -> Repository / Platform Adapter
```

家属端调用链：

```text
Renderer UI
  -> preload/contextBridge
  -> IPC Controller
  -> FamilyLinkService
  -> HttpFamilyLinkAdapter
```

## 2. 传输约定

- 默认局域网地址：`http://<device-ip>:8787`；
- API 前缀：`/api/v1`；
- 请求和响应编码：UTF-8 JSON；
- 时间戳：UTC ISO 8601，例如 `2026-08-29T00:30:00Z`；
- 日期：`YYYY-MM-DD`；
- 时间：24 小时制 `HH:mm`；
- 客户端标识：`X-LongPet-Client: family-desktop/0.1`；
- 鉴权：非回环监听必须设置 `LONGPET_FAMILY_LINK_TOKEN`，客户端使用 `Authorization: Bearer <pairing-token>`；
- 密码、配对码和令牌不得出现在 URL、日志或错误详情中。

比赛局域网阶段可以使用 HTTP，但服务只能监听受信任局域网接口。离开受控网络后必须升级为 HTTPS/WSS，并通过中转服务连接，禁止直接把开发板端口映射到公网。

## 3. 通用错误模型

非 2xx 响应统一使用：

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "提醒已被其他家属修改",
    "details": {
      "currentRevision": 4
    }
  }
}
```

建议状态码：

| HTTP | code | 含义 |
|---|---|---|
| 400 | `BAD_REQUEST` | HTTP 或 JSON 请求结构无效 |
| 401 | `AUTHENTICATION_REQUIRED` | 未提供或令牌无效 |
| 403 | `PERMISSION_DENIED` | 已鉴权但无操作权限 |
| 404 | `REMINDER_NOT_FOUND` | 提醒不存在 |
| 409 | `REVISION_CONFLICT` | 乐观锁版本冲突 |
| 413/431 | `REQUEST_TOO_LARGE` | 正文或请求头超过限制 |
| 422 | `VALIDATION_ERROR` | 字段格式、枚举或范围错误 |
| 429 | `RATE_LIMITED` | 请求过于频繁 |
| 500 | `INTERNAL_ERROR` | 未分类板端错误 |
| 503 | `CAPABILITY_UNAVAILABLE` | 硬件或平台能力当前不可用 |

错误消息可供用户阅读，但不得包含数据库路径、SQL、调用栈、令牌、Wi-Fi 密码或平台内部句柄。

## 4. 状态接口

### `GET /api/v1/status`

返回设备、系统和今日关怀摘要。

响应：

```json
{
  "apiVersion": "1.0",
  "capabilities": {
    "settingsRead": true,
    "settingsWrite": true,
    "remindersRead": true,
    "remindersWrite": true,
    "videoCallSignaling": true,
    "visionMonitor": true,
    "motionControl": true
  },
  "device": {
    "id": "longpet-ls-gd-001",
    "name": "客厅 LongPet",
    "softwareVersion": "0.2.0",
    "online": true,
    "lastSeenAt": "2026-08-29T00:30:10Z",
    "networkSummary": "Wi-Fi 已连接",
    "powerSummary": "外接电源",
    "audioSummary": "USB PnP Sound Device / Speaker",
    "brightnessSummary": "未检测到可调背光"
  },
  "system": {
    "currentDateTime": "2026-08-29T00:30:10Z",
    "weatherSummary": "--",
    "networkKnown": true,
    "networkAvailable": true,
    "batteryPercent": -1
  },
  "care": {
    "waterCompleted": 3,
    "waterGoal": 8,
    "medicineCompleted": 1,
    "medicineTotal": 2,
    "activityMinutes": 12,
    "interactionCount": 4,
    "lastUpdated": "2026-08-29T00:28:00Z"
  }
}
```

字段映射：

- `system` 对齐 LongPet `SystemStatus`；
- `device.*Summary` 对齐 `DeviceSummary`；
- `care` 对齐 `CareSummary`；
- 无电池读数时 `batteryPercent` 为 `-1`，不得伪造百分比；
- `online` 表示该次请求由设备实时响应，不是云端缓存猜测。

## 5. 设置接口

### `GET /api/v1/settings`

响应：

```json
{
  "volume": 61,
  "brightness": 72,
  "petStyle": "温和陪伴",
  "revision": 7,
  "remoteWritable": true,
  "capabilities": {
    "volume": {
      "available": true,
      "summary": "USB PnP Sound Device / Speaker"
    },
    "brightness": {
      "available": false,
      "summary": "未检测到可调背光"
    }
  }
}
```

### `PATCH /api/v1/settings`

只提交需要修改且设备支持的字段，同时必须携带读取时的 `expectedRevision`：

```json
{
  "volume": 74,
  "petStyle": "活泼陪伴",
  "expectedRevision": 7
}
```

约束：

- `volume`：整数，`0..100`；
- `brightness`：整数，`0..100`；能力不可用时不得写入；
- `petStyle`：当前为 `温和陪伴` 或 `活泼陪伴`；
- `expectedRevision`：非负整数；不匹配时返回 HTTP 409；
- 至少包含一个可修改字段；
- 板端先由 `SettingsService` 持久化期望值，再通过既有 `settingApplyRequested` 应用硬件；
- 对应硬件能力不可用时，板端在持久化前返回 HTTP 503 `CAPABILITY_UNAVAILABLE`；不会只保存而伪报已经应用。

成功响应返回完整设置对象和更新后的 revision；`capabilities` 是硬件应用后的最新 Adapter 状态。

## 6. 提醒接口

枚举对应 LongPet `ReminderModels.h`：

| JSON | C++ |
|---|---|
| `medicine` | `ReminderType::Medicine` |
| `water` | `ReminderType::Water` |
| `other` | `ReminderType::Other` |
| `daily` | `ReminderRepeatRule::Daily` |
| `weekdays` | `ReminderRepeatRule::Weekdays` |
| `once` | `ReminderRepeatRule::Once` |
| `pending` | `ReminderOccurrenceStatus::Pending` |
| `completed` | `ReminderOccurrenceStatus::Completed` |
| `missed` | `ReminderOccurrenceStatus::Missed` |
| `disabled` | `ReminderOccurrenceStatus::Disabled` |

### `GET /api/v1/reminders`

响应：

```json
{
  "items": [
    {
      "id": 12,
      "type": "medicine",
      "title": "晚间用药",
      "timeOfDay": "20:30",
      "scheduledDate": "2026-08-29",
      "repeatRule": "daily",
      "enabled": true,
      "revision": 3,
      "status": "pending",
      "createdAt": "2026-08-20T10:00:00Z",
      "updatedAt": "2026-08-28T22:00:00Z"
    }
  ],
  "remoteWritable": true
}
```

### `POST /api/v1/reminders`

创建请求：

```json
{
  "type": "water",
  "title": "下午喝水",
  "timeOfDay": "15:00",
  "scheduledDate": "2026-08-29",
  "repeatRule": "daily",
  "enabled": true
}
```

成功返回 HTTP 201 和完整 `Reminder`；初始 `revision` 为 `1`。

### `PUT /api/v1/reminders/{id}`

更新请求采用完整草稿，并携带版本：

```json
{
  "type": "water",
  "title": "下午补水",
  "timeOfDay": "15:30",
  "scheduledDate": "2026-08-29",
  "repeatRule": "weekdays",
  "enabled": true,
  "expectedRevision": 3
}
```

成功返回更新后的完整 `Reminder`；版本递增。板端必须调用 `ReminderService::save()`，不得由 HTTP Adapter 直接写仓库。

### `DELETE /api/v1/reminders/{id}?expectedRevision={revision}`

成功可返回：

```json
{
  "deleted": true,
  "id": 12
}
```

板端必须调用 `ReminderService::remove()`。版本不匹配返回 HTTP 409，避免家属端删除刚被老人或另一位家属修改的提醒。

## 7. 语音 / 视频通话控制接口

这些 JSON 接口只负责鉴权、呼叫状态和媒体会话参数。PCM/JPEG 帧使用独立 WebSocket 媒体端口传输，详见 `VIDEO_CALL_MEDIA_PROTOCOL.md`。以下接口均沿用 FamilyLink Bearer Token。

### `POST /api/v1/video-call`

家属端主动发起呼叫。`mode` 只允许 `voice` 或 `video`。

```json
{ "mode": "voice" }
```

成功返回 HTTP 201。设备会先进入 `notifying_device` 并播放一次对应提示音；设备已有活跃通话时返回 HTTP 409：

```json
{
  "error": {
    "code": "DEVICE_BUSY",
    "message": "设备正在通话，请稍后再试"
  }
}
```

鉴权失败返回 401，且不会播放提示音。摄像头或媒体端口预热失败返回 503 `MEDIA_INITIALIZATION_FAILED`。

### `GET /api/v1/video-call`

```json
{
  "callId": "7aeaa037-658e-4b39-b5c6-842bb9a6b723",
  "state": "connecting_media",
  "mode": "video",
  "direction": "family_to_device",
  "remoteName": "家属端",
  "startedAt": "2026-08-29T12:00:00Z",
  "connectedAt": null,
  "updatedAt": "2026-08-29T12:00:04Z",
  "revision": 2,
  "mediaReady": false,
  "mediaProtocolVersion": 1,
  "mediaPort": 8788,
  "mediaToken": "per-call-random-token",
  "errorCode": null,
  "errorMessage": null
}
```

家属端用已配置 FamilyLink URL 的主机名推导媒体地址，只替换协议和 `mediaPort`。例如 `http://10.240.178.51:8787` 推导为 `ws://10.240.178.51:8788/media/v1`，代码不保存固定板端 IP。

| state | 含义 |
|---|---|
| `idle` | 当前没有通话 |
| `outgoing_ringing` | LongPet 主动呼叫家属端，等待接听 |
| `notifying_device` | 家属端呼叫已鉴权，板端正在播放一次提示音 |
| `connecting_media` | 提示音已结束，双方正在打开音频并鉴权媒体通道 |
| `connected` | 双向媒体通道已经可用，此时 `mediaReady=true` |
| `rejected` | 家属端拒绝了 LongPet 主动呼叫 |
| `ended` | 任一方正常挂断 |
| `failed` | 权限、设备或网络失败，读取 `errorCode/errorMessage` |

### `POST /api/v1/video-call/actions`

```json
{
  "callId": "7aeaa037-658e-4b39-b5c6-842bb9a6b723",
  "action": "hangup",
  "expectedRevision": 4
}
```

- `accept`/`reject` 只用于 LongPet 主动发起的 `outgoing_ringing`；
- 家属端主动呼叫由 LongPet 自动接通，不发送 `accept`；
- `hangup` 可用于所有活跃状态，包括提示音尚未结束时的取消；
- `fail` 用于家属端报告摄像头、麦克风或权限错误，可额外传 `errorCode` 与 `errorMessage`；
- `callId` 和 `expectedRevision` 必须匹配当前快照，否则返回 HTTP 409 `CALL_MISMATCH` 或 `REVISION_CONFLICT`。

家属端每秒读取一次状态；只在 `connected && mediaReady` 时显示“通话已连接”，不会再把控制信令成功误报为媒体已连接。

## 8. Family Remote Control 会话

运动控制不通过 FamilyLink HTTP 逐条发送。HTTP 只完成长期 Bearer Token 鉴权并签发短时会话；实时控制使用独立 WebSocket，避免与 JPEG 画面争用队列。

### `POST /api/v1/motion-control/sessions`

无请求体。成功返回 HTTP 201：

```json
{
  "sessionId": "temporary-session-id",
  "sessionToken": "temporary-random-token",
  "port": 8790,
  "protocolVersion": 1,
  "mediaFrameVersion": 1,
  "refreshIntervalMs": 150,
  "leaseTimeoutMs": 350,
  "defaultSpeed": 20,
  "headStepUs": 20,
  "expiresAt": "2026-09-11T12:00:30.000Z"
}
```

- 临时会话有效期为 30 秒，只用于建立一次控制连接；
- 同一时间只允许一个待连接或活跃控制会话；
- 已有控制者时返回 HTTP 409 `MOTION_CONTROL_BUSY`；
- Motion Service 未启动时返回 HTTP 503 `MOTION_CONTROL_UNAVAILABLE`；
- `sessionToken` 不得持久化、记录到日志或放入 URL。

客户端根据 FamilyLink URL 主机推导控制地址：

```text
http://<device>:8787 -> ws://<device>:8790/motion-control/v1
https://<device>     -> wss://<device>:8790/motion-control/v1
```

WebSocket 消息使用现有 LPMF 二进制帧，`streamType=control`，payload 为 UTF-8 JSON。第一帧必须在 6 秒内发送：

```json
{
  "type": "authenticate",
  "protocol_version": 1,
  "session_id": "temporary-session-id",
  "token": "temporary-random-token"
}
```

客户端指令：

```json
{ "type": "chassis", "direction": "FORWARD", "speed": 20 }
{ "type": "chassis", "direction": "BACKWARD", "speed": 20 }
{ "type": "chassis", "direction": "ROTATE_LEFT", "speed": 20 }
{ "type": "chassis", "direction": "ROTATE_RIGHT", "speed": 20 }
{ "type": "stop" }
{ "type": "head", "action": "LEFT", "step_us": 20 }
{ "type": "head", "action": "CENTER" }
{ "type": "head", "action": "RIGHT", "step_us": 20 }
{ "type": "release" }
```

底盘方向没有 SHIFT。方向速度范围为 `1..100`，头部步长范围为 `1..100 us`。底盘按住期间客户端按 `refreshIntervalMs` 重发指令，松开立即发送 `stop`；头部松开只停止步进刷新并保持位置，不发送底盘 STOP。

鉴权并进入 MANUAL 后，服务端先发送：

```json
{
  "type": "control_started",
  "protocol_version": 1,
  "refresh_interval_ms": 150,
  "lease_timeout_ms": 350,
  "default_speed": 20,
  "head_step_us": 20
}
```

运行中发送状态：

```json
{
  "type": "motion_status",
  "protocol_version": 1,
  "uart_available": true,
  "mcu_online": true,
  "fault": false,
  "remote_control_active": true,
  "mode": "MANUAL",
  "motion": "STOPPED",
  "stop_reason": "家属端请求停车",
  "servo_us": 1570,
  "imu_available": true,
  "detail": "Motion MCU 状态正常",
  "updated_at": "2026-09-11T12:00:01.000Z"
}
```

错误消息为：

```json
{ "type": "error", "code": "MOTION_MCU_OFFLINE", "message": "Motion MCU 没有响应" }
```

可能的 code 包括 `AUTHENTICATION_FAILED`、`AUTHENTICATION_TIMEOUT`、`INVALID_COMMAND`、`MOTION_CONTROL_BUSY`、`MOTION_UART_UNAVAILABLE`、`MOTION_UART_DISCONNECTED`、`MOTION_MCU_OFFLINE`、`MOTION_MCU_FAULT`、`MOTION_MODE_CHANGED`、`MOTION_COMMAND_FAILED`、`MOTION_WRITE_FAILED` 和 `MOTION_CONTROL_ENDED`。

安全时序和用户操作说明见 `FAMILY_REMOTE_CONTROL_V1.md`。

## 9. 配对与鉴权建议

当前板端已经要求 Bearer Token 并开放设置和提醒写入；家属端仍必须依据状态接口的能力字段决定是否启用每类写操作。Token 目前由运维配置，板端签发流程尚未实现。建议下一步：

1. LongPet 设置页显示一次性六位配对码或二维码；
2. 家属端提交设备 ID 与一次性码；
3. 板端签发随机高熵令牌，并只保存令牌摘要；
4. 一次性码使用后立即失效，并设置较短过期时间；
5. 提供设备端“解除全部家属配对”入口；
6. 后续区分只读、管理提醒、管理设备等权限。

比赛阶段不得直接把 root SSH 密码包装成家属端鉴权，也不得让 Electron 通过 SSH 修改数据库或 systemd。

## 10. 后续事件接口

当前 MVP 使用手动刷新。后续可增加 `/api/v1/events` WebSocket，用于：

- 设备在线状态变化；
- 今日关怀数据变化；
- 提醒创建、更新、完成或错过；
- Emergency 事件。

事件必须包含单调递增序列号或事件 ID，断线重连后通过 REST 全量刷新，不能只依赖易丢失的实时消息。
