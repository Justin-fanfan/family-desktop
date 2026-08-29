# LongPet 家属端 Electron MVP 实施报告

- 日期：2026-08-29
- 项目目录：`D:\code\family-desktop`
- 版本：`0.1.0`
- Node.js：`v24.19.0`
- npm：`11.17.0`
- Electron：`44.0.0`
- electron-builder：`26.15.3`

## 1. 本轮范围

报告覆盖家属端 MVP、开发板真实连接以及设置/提醒写入：

1. 远程查看设备、网络、供电、音频、关怀与提醒摘要；
2. 远程修改音量、亮度和宠物风格；
3. 远程创建、编辑和删除提醒；
4. 提供 Mock Adapter，使界面和业务流程不依赖板端即可验证；
5. 提供正式 HTTP Adapter 和完整 v1 接口规范；
6. 建立参数校验、错误模型与乐观锁冲突处理；
7. 完成 Node 自动测试与 Windows Release 打包入口。

开发板现已提供带 Bearer Token 的 FamilyLink HTTP 读写服务。家属端能够真实读取状态和能力，并经板端 Service 修改设置与提醒。应用不会使用 SSH 或直接访问板端数据库来伪造接通状态。

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

板端链路：

```text
FamilyLinkHttpAdapter
  -> FamilyLinkController
  -> FamilyLinkService
  -> System / Settings / Reminder / Care Service
  -> Repository / 硬件 Adapter
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
真实板端报告 `settingsWrite=true`；可用字段启用，不可用的亮度能力继续单独禁用。保存时携带最近读取的 revision，冲突后自动刷新。

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

最终验证结果：`npm run check` 通过，`npm test` 共执行 12 项测试，12 项全部通过、0 项失败。

## 7. 界面与打包产物冒烟测试

使用真实 Electron 运行时分别加载三个业务页面，由入口代码断言目标页面已经激活后截图并自动退出：

| 页面 | 结果 | 截图 |
|---|---|---|
| 设备状态 | 通过 | [dashboard.png](screenshots/dashboard.png) |
| 远程设置 | 通过 | [settings.png](screenshots/settings.png) |
| 提醒管理 | 通过 | [reminders.png](screenshots/reminders.png) |

真实开发板冒烟测试：

| 页面 | 结果 | 截图 |
|---|---|---|
| 真实设备状态 | 通过 | [real-dashboard.png](screenshots/real-dashboard.png) |
| 真实设置页（只读基线历史截图） | 通过 | [real-settings.png](screenshots/real-settings.png) |
| 真实提醒页（只读基线历史截图） | 通过 | [real-reminders.png](screenshots/real-reminders.png) |

此外，最终打包后的 `LongPet Family.exe` 已连接真实设备，状态页正确渲染并以退出码 0 结束；截图见 [real-packaged-dashboard.png](screenshots/real-packaged-dashboard.png)。

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
- SHA-256：`B70A953957CAC00658D138E6FFC6C44C06C4FDA3E4967FAA035480DD26866105`；
- 当前仍使用 Electron 默认图标，不影响功能，后续可单独补充品牌图标。

## 9. 开发板局域网探测

对 `10.188.219.51` 进行了只读 TCP 探测：

| 端口 | 结果 | 含义 |
|---|---|---|
| `22/tcp` | 可连接 | 开发板在线，SSH 服务可达 |
| `8787/tcp` | 可连接 | LongPet 进程正在提供带 Token 的 FamilyLink API |

最终部署后只读检查确认设备 `longpet-ls-gd` 在线，`settingsWrite=true`、`remindersWrite=true`，USB 声卡和网络状态正常。按用户要求，最终版的设置与提醒写操作由用户手工测试，Codex 不再写入设备数据。

## 10. 用户手工验收

1. 运行 `release\win-unpacked\LongPet Family.exe`；
2. 点击“切换连接”，选择局域网设备；
3. 地址填写 `http://10.188.219.51:8787`，输入当前 FamilyLink Token；
4. 连接后确认设备名称、网络、USB 音频、设置和提醒都来自真实板端；
5. 在远程设置页小幅修改音量或切换宠物风格，保存后版本号应增加；
6. 本板亮度能力不可用，滑块应禁用，不能伪报保存成功；
7. 新增一条未来时间的测试提醒，再编辑标题或时间，最后删除；
8. 每一步都检查板端页面是否同步，并在测试结束后确认没有残留测试提醒。

发生 `REVISION_CONFLICT` 时客户端会刷新数据并提示重新保存，这是并发保护，不是连接失败。

## 11. 已知限制

1. 当前使用手动刷新，没有 WebSocket 推送；
2. 配对令牌签发、撤销与权限模型尚未实现；
3. 未做公网中转，不能跨家庭网络使用；
4. 未做安装器与自动更新，只生成 Windows unpacked Release；
5. 当前仅支持简体中文和 Windows 首轮验证；
6. 本板背光能力不可用，亮度字段被禁用并由板端拒绝远程写入；
7. Token 目前由 systemd 运维配置，只适用于受控局域网，不得映射到公网。

## 12. 下一步最小功能建议

下一轮最适合实现板端一次性配对码与 Token 签发/撤销，让家属端不再依赖手工读取 systemd Token。公网连接和事件推送仍应留到后续独立步骤。
