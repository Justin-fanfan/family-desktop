# LongPet Family Desktop

LongPet 家属端桌面应用 MVP。它提供设备状态查看、远程设置和提醒管理界面，并通过 Electron 主进程中的 FamilyLink 分层客户端访问 LongPet。

## 当前状态

- 演示模式已经形成完整可操作闭环：查看状态、保存设置、创建/编辑/删除提醒；
- 正式 HTTP 客户端及接口校验已经实现；
- 板端已实现带 Token 的 `FamilyLink` 读写闭环，可真实读取状态并远程修改设置、创建/编辑/删除提醒；
- 配对令牌仅保存在 Electron 主进程内存中，关闭应用后清除。

![真实开发板设备状态](docs/screenshots/real-dashboard.png)

## 运行

```powershell
npm install
npm start
```

应用默认使用演示数据。点击右上角“切换连接”，可以配置：

- 演示模式：不依赖开发板；
- 局域网模式：默认地址 `http://10.188.219.51:8787`；
- 配对令牌：作为 Bearer Token 发送，不写入磁盘。

当前板端会报告 `settingsWrite=true` 和 `remindersWrite=true`，家属端据此启用保存、添加、编辑和删除按钮。不可用的单项硬件能力仍单独禁用，例如本板的亮度滑块。

## 测试与 Release 构建

```powershell
npm run check
npm test
npm run build:release
```

Windows Release 输出目录为：

```text
release/win-unpacked/
```

CI 或本地可通过 `LONGPET_FAMILY_SMOKE_CAPTURE` 指定 PNG 路径，并用 `LONGPET_FAMILY_SMOKE_VIEW` 选择 `dashboard`、`settings` 或 `reminders`。设置 `LONGPET_FAMILY_SMOKE_BASE_URL` 后会等待真实设备数据加载完成再截图；未设置时使用演示模式。应用截图后自动退出，普通启动不受这些变量影响。

写入版提供可清理的真实设备冒烟脚本。它会把音量写回原值以验证设置 revision，然后创建、更新并删除一条停用的临时提醒：

```powershell
$env:LONGPET_FAMILY_SMOKE_BASE_URL='http://10.188.219.51:8787'
$env:LONGPET_FAMILY_SMOKE_TOKEN='<当前 Token>'
npm run smoke:real-write
```

该命令会真实修改板端数据，只应在明确需要自动验证时运行；普通用户手工测试不需要执行它。

## 架构

```text
Renderer UI
  -> preload/contextBridge
  -> Electron Main IPC Controller
  -> FamilyLinkService
  -> HttpFamilyLinkAdapter / MockFamilyLinkAdapter
  -> LongPet FamilyLink API
```

Renderer 启用了以下边界：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- `sandbox: true`；
- CSP `connect-src 'none'`，禁止 Renderer 直接联网；
- 仅通过 preload 暴露的白名单方法访问主进程；
- 外部导航和新窗口默认拒绝。

## 目录

```text
src/
  main/
    adapters/             HTTP 与演示 Adapter
    services/             参数校验与业务编排
    index.js              Electron Application
    ipc-controller.js     Renderer 与 Service 的控制层
  preload/                最小 IPC 白名单桥接
  renderer/               HTML/CSS/JS 界面
  shared/                 跨主进程模块错误模型
tests/                    Node 内置测试
docs/
  FAMILY_LINK_API.md      板端接口规范
  IMPLEMENTATION_REPORT.md 实施与验证报告
  screenshots/            三个业务页面的冒烟测试截图
```

## 重要文档

- [FamilyLink API 规范](docs/FAMILY_LINK_API.md)
- [MVP 实施报告](docs/IMPLEMENTATION_REPORT.md)
