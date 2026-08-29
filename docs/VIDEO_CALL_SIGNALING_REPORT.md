# 家属端视频通话信令实施说明

> 2026-08-29 更新：本文是上一阶段信令基线。真正的双向媒体与新版接口见 `VIDEO_CALL_MEDIA_PROTOCOL.md` 和 `FAMILY_LINK_API.md` 第 7 节。

日期：2026-08-29

## 本轮完成

- 新增“视频通话”导航与状态页面；
- 每秒通过主进程轮询 LongPet 通话状态；
- 新呼叫自动切换到通话页；
- 支持接听、拒绝和挂断；
- 所有动作携带 `callId + expectedRevision`；
- Renderer 不持有 FamilyLink Bearer Token，也不直接发 HTTP；
- 默认设备地址更新为 `http://10.240.178.51:8787`；
- 首次连接失败后，重新配置成功仍会继续通话轮询。

## 调用链

```text
Renderer UI
  -> window.familyDesktop
  -> Preload IPC
  -> IpcController
  -> FamilyLinkService
  -> HttpFamilyLinkAdapter
  -> LongPet FamilyLink API
```

## 验证

- `npm run check`：通过；
- `npm test`：15/15 通过；
- `npm run build:release`：通过；
- 隐藏窗口 UI 冒烟截图：通过；
- 真实设备接口地址：`http://10.240.178.51:8787`。

本轮只完成控制信令，`mediaReady` 为 `false`。下一步加入 MJPEG 媒体通道时，Renderer 的摄像头/麦克风平台访问会继续封装在专用 Media Adapter 中。
