# Family Remote Control V1 使用与验收

日期：2026-09-11  
状态：家属端实现与本地自动化测试完成；按本轮要求未进行交叉编译、板端部署或车辆动作测试。

## 1. 如何使用

1. 启动家属端并连接 LongPet 的 FamilyLink 地址；当前测试地址示例是 `http://192.168.137.32:8787`。
2. 打开“AI 视野”，等待实时画面连接。
3. 在右侧切换到“远程操控”。应用通过主进程申请短时控制会话，再连接独立的 `:8790` WebSocket。
4. 等待状态显示“可操控”。如果显示“安全锁定”，根据 MCU、模式和错误提示排查，不能绕过锁定。
5. 使用页面按钮或键盘控制；完成后按 Esc 或切回其他页面。

| 操作 | 键盘 | 鼠标/触控 |
|---|---|---|
| 前进 | W | 按住“前进” |
| 后退 | S | 按住“后退” |
| 原地左转 | A | 按住“左转” |
| 原地右转 | D | 按住“右转” |
| 立即停车 | Space | 点击红色 STOP |
| 头部向左 | J | 按住“头左” |
| 头部回中 | K | 点击“回中” |
| 头部向右 | L | 按住“头右” |
| 停车并退出 | Esc | 离开远程操控页面 |

底盘按钮必须按住才持续移动，松开立即 STOP。头部按住时连续步进，松开后保持当前位置；头部释放不会意外停止或启动底盘。SHIFT 平移没有开放。

“显示 AI 人物框”只控制本机 Canvas 叠加层，关闭它不会停止 LongPet 本地人物检测。AI/远控切换也不会重启摄像头。

## 2. 安全行为

应用会在以下情况清除全部按住状态并请求 STOP：

- 底盘键或按钮松开；
- 点击 STOP、按 Space 或 Esc；
- 窗口失去焦点、最小化、页面隐藏或关闭；
- 切换页面、切换设备连接；
- 控制 WebSocket 断开。

即使浏览器无法发出 STOP，LongPet 在默认 350 ms 内收不到刷新也会停车；若 LongPet 或 UART 同时失效，MCU 固件还应在 500 ms watchdog 到期后停车。

远控会话进入时由 LongPet 执行 `STOP -> MODE MANUAL -> STATUS`，退出时执行 `STOP -> MODE SAFE`。页面只有在 `uart_available=true`、`mcu_online=true`、`fault=false`、`mode=MANUAL` 时解锁。

## 3. 连接与错误提示

- “Motion MCU 未响应”：Linux 串口可能存在，但没有收到 MCU 状态回包。检查供电、固件、TX/RX 交叉、共地和串口节点。
- “串口未连接”：检查 `/dev/ttyS2`、`dialout` 权限和 service 配置。
- “已有家属正在远程控制”：同一时间只允许一个控制者，等待旧会话退出或短时会话过期。
- “MCU fault”：先处理硬件故障，应用不会继续动作。
- “MCU 已离开 MANUAL”：可能有其他模式抢占；LongPet 会停车并终止本次会话。
- “鉴权失败/超时”：重新进入远控申请新会话，不要复用旧 token。

FamilyLink 的长期 Bearer Token 只保存在 Electron 主进程内存；Renderer 只得到 30 秒有效的临时运动 token。当前局域网使用 HTTP/WS，不应把 8787、8789、8790 直接映射到公网。

## 4. 本地验证结果

家属端自动化测试覆盖：

- 控制 URL 从 FamilyLink URL 正确推导；
- W/S/A/D、J/K/L、Space、Esc 映射；
- 底盘按住立即发送并按周期刷新，松开 STOP；
- 头部按住刷新，松开保持且不发送 STOP；
- 手动急停、窗口失焦和退出清理；
- SHIFT/非法方向不会发送；
- HTTP Adapter、Service 和 IPC 会话入口。

最终 `npm test` 为 35/35 通过；`npm run check` 和 Vite 生产构建通过。Vite 仅报告现有 lottie 直接 `eval` 与 bundle 大小告警，不影响该功能。

## 5. 实机验收清单

首次测试必须架空车轮，并保持旁边有人可以断电：

1. 在板端确认 LongPet 日志已有 Motion MCU 状态，家属端显示“可操控”；
2. 先测头部左、右、回中，确认头部方向符合画面方向；
3. 每个底盘方向只短按，核对实际运动方向；发现反向立即 STOP 并修正 MCU/映射；
4. 验证按钮松开、键盘松开、Space、Esc 都能立即停车；
5. 分别测试切页、最小化、关闭应用、断开 Wi-Fi；
6. 长按移动时断网，确认最迟由 MCU 500 ms watchdog 停车；
7. 断开/恢复 UART，确认不能沿用旧移动指令；
8. 连续进入退出至少 10 次，确认无控制权残留；
9. 同时打开第二个家属端，确认返回 busy；
10. 测试结束确认 LongPet 回到 SAFE，`longpet.service` 正常运行。

ESP/Motion MCU 启动后已经确认 `/dev/ttyS2` 双向收发，MCU 返回的 SAFE/STOPPED 状态格式正确。本轮同时修复了 LongPet 将 termios 零长度读取误判为 EOF、导致串口每 2 秒重连的问题。修复后的二进制仍需重新部署；尚未发送 MOVE/HEAD，因此真实动作、安全停车时延和端到端响应速度仍是待验收项。

## 6. 相关文档

- `FAMILY_LINK_API.md`：HTTP 会话入口和 WebSocket 消息格式。
- LongPet 仓库 `docs/LongPet-Family-Remote-Control-V1-Report.md`：完整架构、UART 协议、文件清单和板端边界。
- LongPet 仓库 `deploy/配置说明.md`：service、用户组、串口和端口配置。
