# ADR-0004：Agent 工作区与沙箱边界

> 状态：**已接受**。
> 日期：2026-08-03。
> 决策范围：工作区、agent session、工具执行、真实后端、网络门控与预算。

## 上下文

P6 需要执行模型生成的代码、构建 Web 项目、真实渲染并在重启后续跑。E1–E7 已证明 Job Object 单独
不能限制文件或网络，而零 capability AppContainer 能阻断工作区外访问和裸 IP；E5/E13 又证明真实
后端与依赖安装可以通过 trusted broker 保持不可信子进程零网络。

## 决策

- Windows 首版使用 **AppContainer + Job Object + 从空白构建的 allowlist env**。
- 工作区位于 `%LOCALAPPDATA%\Packages\<profile>\AC\`，结构固定为 `repo/`（只读）、`work/`、
  `out/`、`.agent/`；不得靠任意目录叶子 ACL 模拟容器根。
- AppContainer 负责文件与默认零网络；Job Object 在进程启动前绑定，负责进程树、内存、时间和结束
  回收；输出使用有界采集。
- session 的 workspace、turn history、工具日志和预算账本持久化；workflow stage 重入从现状续跑，
  不增加工具级业务 checkpoint。
- agent 的 `run_command`、构建脚本、包脚本和真实后端始终为零 capability。
- L2 网络由 trusted fetch broker 消费门批准的精确 URL；安装归档、lockfile、整树哈希和审计进入
  side-effect ledger。凭据仅进入 broker 单次内存请求。
- 真实后端运行在零 capability AppContainer + Job Object 中，由只绑定 `127.0.0.1` 的 trusted
  host broker 转发；不设置持久 loopback exemption。
- P6 初始预算 profile 为 60 步、250,000 total token、900 秒、最多 3 次 render；输出撞顶与 deadline
  均如实失败，续跑不重置预算。
- render 采用 ADR-0002 的独立 trusted host renderer，不与任意命令执行权限合并。

## 备选方案

### 仅 Job Object

六类文件逃逸全部成功，也不能封锁网络；只保留为进程资源控制组件。

### 默认 WSL2/Docker

隔离能力强，但增加平台依赖与文件桥接复杂度。AppContainer 已覆盖首片需求，WSL2/Docker 保留备选。

### 给安装或后端子进程 `internetClient`

边界更宽，且 E13 在本机 HTTPS 链路不可靠。trusted broker 更窄并已通过。

## 影响

不可信代码不会继承用户文件、凭据或任意网络；崩溃后工作区可恢复。代价是 Windows 专用 launcher、
AppContainer-friendly runtime 供给和 broker 服务。通用 Node/Vite、WebSocket 和高吞吐 IPC 不属于
首版承诺。

## 替换条件

当目标平台不是 Windows、AppContainer 无法运行冻结 profile、或真实并发/IPC 数据证明 broker 成为
瓶颈时，WSL2、容器或专用低权限账户可进入新 ADR。替代方案必须先通过 E1–E7/E13 安全与恢复套件。
