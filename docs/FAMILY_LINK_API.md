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
- 时间戳：带时区的 ISO 8601，例如 `2026-08-29T08:30:00+08:00`；
- 日期：`YYYY-MM-DD`；
- 时间：24 小时制 `HH:mm`；
- 客户端标识：`X-LongPet-Client: family-desktop/0.1`；
- 鉴权：`Authorization: Bearer <pairing-token>`；
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
| 400 | `VALIDATION_ERROR` | 字段格式或范围错误 |
| 401 | `AUTHENTICATION_REQUIRED` | 未提供或令牌无效 |
| 403 | `PERMISSION_DENIED` | 已鉴权但无操作权限 |
| 404 | `REMINDER_NOT_FOUND` | 提醒不存在 |
| 409 | `REVISION_CONFLICT` | 乐观锁版本冲突 |
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
  "device": {
    "id": "longpet-ls-gd-001",
    "name": "客厅 LongPet",
    "softwareVersion": "0.2.0",
    "online": true,
    "lastSeenAt": "2026-08-29T00:30:10+08:00",
    "networkSummary": "Wi-Fi 已连接",
    "powerSummary": "外接电源",
    "audioSummary": "USB PnP Sound Device / Speaker",
    "brightnessSummary": "未检测到可调背光"
  },
  "system": {
    "currentDateTime": "2026-08-29T00:30:10+08:00",
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
    "lastUpdated": "2026-08-29T00:28:00+08:00"
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
  "updatedAt": "2026-08-29T00:30:00+08:00",
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
  "petStyle": "活力伙伴",
  "expectedRevision": 7
}
```

约束：

- `volume`：整数，`0..100`；
- `brightness`：整数，`0..100`；能力不可用时不得写入；
- `petStyle`：当前为 `温和陪伴` 或 `活力伙伴`；
- `expectedRevision`：非负整数；不匹配时返回 HTTP 409；
- 至少包含一个可修改字段；
- 板端先由 `SettingsService` 持久化期望值，再通过既有 `settingApplyRequested` 应用硬件；
- 若数据库成功但硬件应用失败，响应必须明确区分“已保存”和“已应用”，不能伪报成功。

建议成功响应继续返回完整设置对象，并可增加：

```json
{
  "applyResults": {
    "volume": { "applied": true, "message": "" },
    "brightness": { "applied": false, "message": "设备不支持亮度调节" }
  }
}
```

当前桌面客户端会读取完整设置响应；附加 `applyResults` 不会破坏兼容性。

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
      "createdAt": "2026-08-20T10:00:00+08:00",
      "updatedAt": "2026-08-28T22:00:00+08:00"
    }
  ]
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

## 7. 配对与鉴权建议

当前客户端已经支持 Bearer Token，但板端签发流程尚未实现。建议下一步：

1. LongPet 设置页显示一次性六位配对码或二维码；
2. 家属端提交设备 ID 与一次性码；
3. 板端签发随机高熵令牌，并只保存令牌摘要；
4. 一次性码使用后立即失效，并设置较短过期时间；
5. 提供设备端“解除全部家属配对”入口；
6. 后续区分只读、管理提醒、管理设备等权限。

比赛阶段不得直接把 root SSH 密码包装成家属端鉴权，也不得让 Electron 通过 SSH 修改数据库或 systemd。

## 8. 后续事件接口

当前 MVP 使用手动刷新。后续可增加 `/api/v1/events` WebSocket，用于：

- 设备在线状态变化；
- 今日关怀数据变化；
- 提醒创建、更新、完成或错过；
- Emergency 事件。

事件必须包含单调递增序列号或事件 ID，断线重连后通过 REST 全量刷新，不能只依赖易丢失的实时消息。
