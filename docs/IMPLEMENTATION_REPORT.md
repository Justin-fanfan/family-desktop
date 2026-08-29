# LongPet 家属端 Electron MVP 实施报告

- 日期：2026-08-29
- 项目目录：`D:\code\family-desktop`
- 版本：`0.1.0`
- Node.js：`v24.19.0`
- npm：`11.17.0`
- Electron：`44.0.0`
- electron-builder：`26.15.3`

## 1. 本轮范围

本轮只实现家属端 MVP 客户端，不修改 LongPet 板端源码：

1. 远程查看设备、网络、供电、音频、关怀与提醒摘要；
2. 远程修改音量、亮度和宠物风格；
3. 远程创建、编辑和删除提醒；
4. 提供 Mock Adapter，使界面和业务流程不依赖板端即可验证；
5. 提供正式 HTTP Adapter 和完整 v1 接口规范；
6. 建立参数校验、错误模型与乐观锁冲突处理；
7. 完成 Node 自动测试与 Windows Release 打包入口。

“远程”客户端能力已经实现，但实际开发板尚未提供 FamilyLink HTTP 服务。应用不会使用 SSH 或直接访问板端数据库来伪造接通状态。

## 2. 现有 LongPet 模型映射

实现前读取并对齐了 LongPet 当前模型：

- `UserSettings`：`volume`、`brightness`、`petStyle`；
- `DeviceSummary`：软件、网络、家属、音频、亮度和电源摘要；
- `SystemStatus`：时间、天气、网络、电量；
- `Reminder` / `ReminderDraft`：类型、标题、时间、日期、重复、启用、版本和状态；
- `CareSummary`：饮水、用药、活动、互动和最后更新时间。

远端提醒保留 `revision/expectedRevision`，避免多家属或设备本地编辑发生静默覆盖。

## 3. 分层与信号流

```text
Application (Electron app)
  -> IpcController
  -> FamilyLinkService
  -> HttpFamilyLinkAdapter / MockFamilyLinkAdapter
  -> Renderer UI (通过 preload 白名单返回结果)
```

### 3.1 读取状态

```text
Renderer refresh
  -> family:dashboard:get
  -> FamilyLinkService.getDashboard()
  -> Adapter.getStatus/getSettings/listReminders
  -> 聚合结果
  -> Renderer renderDashboard()
```

### 3.2 保存设置

```text
Settings form
  -> preload.updateSettings()
  -> FamilyLinkService.validateSettingsPatch()
  -> Adapter.updateSettings()
  -> 板端 PATCH /api/v1/settings
  -> 返回新 revision
```

不支持的亮度能力会在 UI 禁用，客户端不会发送 brightness 字段。

### 3.3 编辑提醒

```text
Reminder dialog
  -> create/update/delete IPC
  -> FamilyLinkService 参数校验
  -> Adapter REST 请求
  -> 板端 ReminderService
  -> 刷新完整 dashboard
```

## 4. 安全边界

- Renderer 禁用 Node 集成；
- 开启上下文隔离和 Renderer 沙箱；
- CSP 禁止 Renderer 网络连接；
- 网络访问、Bearer Token 和错误映射仅存在于主进程；
- preload 只暴露七个明确方法，不暴露通用 IPC；
- 配对令牌不写磁盘；
- URL 禁止嵌入用户名和密码；
- 外部导航和新窗口默认拒绝；
- HTTP 错误转为结构化错误，不向 UI 泄露调用栈。

## 5. 文件说明

| 文件 | 作用 |
|---|---|
| `src/main/index.js` | Electron 生命周期和安全 BrowserWindow |
| `src/main/ipc-controller.js` | IPC 控制层与连接切换 |
| `src/main/services/family-link-service.js` | 设置/提醒校验与业务编排 |
| `src/main/adapters/http-family-link-adapter.js` | 带超时和错误映射的 HTTP 客户端 |
| `src/main/adapters/mock-family-link-adapter.js` | 可交互内存后端 |
| `src/preload/index.js` | contextBridge 白名单 |
| `src/renderer/index.html` | 三个业务视图与对话框 |
| `src/renderer/styles.css` | 桌面布局和状态样式 |
| `src/renderer/app.js` | UI Controller 与状态渲染 |
| `tests/*.test.js` | Service、Mock CRUD、HTTP 契约测试 |
| `docs/FAMILY_LINK_API.md` | 板端 v1 API 规范 |

## 6. 自动测试

无需 Electron 运行时即可先运行核心测试：

```powershell
npm test
```

当前覆盖：

- dashboard 聚合；
- 设置范围、风格和 revision 校验；
- 提醒标题、时间、日期和枚举校验；
- 提醒新增、修改、删除；
- 设置与提醒 revision 冲突；
- HTTP Bearer Token、客户端标识和 JSON 请求体；
- HTTP 提醒集合解包；
- HTTP 409 结构化错误映射；
- URL 协议和凭据安全校验。

最终验证结果：`npm run check` 通过，`npm test` 共执行 11 项测试，11 项全部通过、0 项失败。

## 7. 界面与打包产物冒烟测试

使用真实 Electron 运行时分别加载三个业务页面，由入口代码断言目标页面已经激活后截图并自动退出：

| 页面 | 结果 | 截图 |
|---|---|---|
| 设备状态 | 通过 | [dashboard.png](screenshots/dashboard.png) |
| 远程设置 | 通过 | [settings.png](screenshots/settings.png) |
| 提醒管理 | 通过 | [reminders.png](screenshots/reminders.png) |

此外，最终打包后的 `LongPet Family.exe` 已实际启动，设备状态页正确渲染并以退出码 0 结束；截图见 [packaged-dashboard.png](screenshots/packaged-dashboard.png)。

## 8. Release 构建

```powershell
npm run check
npm test
npm run build:release
```

最终构建成功，输出：

```text
release/win-unpacked/LongPet Family.exe
```

- 文件版本：`0.1.0`；
- 文件大小：`244440576` 字节；
- SHA-256：`12EC844841D6C9661A62871CB3212E6FAF23A132C53BF7DF769CAFD5E044A47B`；
- 当前仍使用 Electron 默认图标，不影响功能，后续可单独补充品牌图标。

## 9. 开发板局域网探测

对 `10.188.219.51` 进行了只读 TCP 探测：

| 端口 | 结果 | 含义 |
|---|---|---|
| `22/tcp` | 可连接 | 开发板在线，SSH 服务可达 |
| `8787/tcp` | 不可连接 | 板端 FamilyLink HTTP 服务尚未监听 |

因此当前应用的演示模式可完整使用，真实局域网模式会在连接测试时失败。失败点在板端 API 尚未实现，并非 Electron 客户端地址或网络层错误。

## 10. 已知限制

1. 板端尚未实现 `/api/v1`，真实局域网模式当前不可用；
2. 当前使用手动刷新，没有 WebSocket 推送；
3. 配对令牌签发、撤销与权限模型尚未实现；
4. 未做公网中转，不能跨家庭网络使用；
5. 未做安装器与自动更新，只生成 Windows unpacked Release；
6. 当前仅支持简体中文和 Windows 首轮验证；
7. 亮度能力不可用时仅展示板端事实，不伪造调节结果。

## 11. 下一步最小功能建议

下一轮在 LongPet 板端实现“只读状态接口”一个最小闭环：

```text
GET /api/v1/status
```

板端调用 `SystemService::status()`、`SystemService::deviceSummary()` 和 `CareService::summary()` 聚合 DTO；先不开放任何写操作。完成 Release 交叉构建、CTest 和板端局域网验证后，再分别增加设置写入与提醒写入接口。
