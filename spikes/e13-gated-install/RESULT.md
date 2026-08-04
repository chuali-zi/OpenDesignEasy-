# E13 Spike 结果：会话内门控依赖安装

> 状态：**通过并冻结**（2026-08-03）。
> 原始结果：[`result.json`](result.json)。复现：用 Windows Python 运行 `experiment.py`。

## 假设与安全口径

验证链路为：agent 申请精确依赖 → 引擎门批准 → 仅批准的 URL 被取回 → 独立沙箱子进程安装 →
lockfile、下载包哈希、依赖整树哈希和审计记录留存。普通 `run_command` 在整个过程中必须继续保持
零 capability。

实验使用公开小包 `is-number@7.0.0`。宿主临时设置了可丢弃的
`OEY_E13_EXPERIMENT_KEY`，只用作凭据泄漏哨兵；未使用真实凭据，也没有把哨兵值写进结果或账本。

## 根因实验与最终方案

直接给独立 AppContainer 子进程 `internetClient` 在本机并不可靠：它从零 capability 时的 DNS 拒绝
前进到了可解析域名，但 HTTPS 先遇到 Schannel 吊销服务不可达，调整为 best-effort 后仍在连接阶段
超时。因此，“给包脚本开 `internetClient`”没有通过，不能作为冻结实现。

最终通过方案把网络能力收回受信任 engine fetch broker：broker 只消费门批准的精确 URL，取回归档后
写入 AppContainer 包目录；独立安装子进程仍为零 capability，只负责解包/安装。该方案比原提案更窄：
不可信包脚本和 agent 都没有网络。

## 实测

| 检查 | 结果 |
|---|---|
| 普通 agent 零 capability 访问同一 registry URL | DNS 拒绝，rc=6，无下载文件 |
| trusted broker 下载批准 URL | 通过，3.219s |
| 零 capability 安装子进程解包 | 通过，rc=0，0.078s |
| 安装版本 | `7.0.0` |
| lockfile 安装前后 | SHA-256 完全一致 |
| 下载归档 | SHA-256 已记录 |
| 依赖树 | 4 文件，整树 SHA-256 已记录 |
| side-effect ledger | 1 条完整记录 |
| 临时实验 key 进入两个沙箱子进程或工作区 | 否 |

九项阻断检查全部通过，`result.json` 的 `passed=true`。

## 冻结结论与后续优化

E13 冻结为“trusted fetch broker + zero-capability installer”，不再采用“给安装子进程
`internetClient`”的做法。后续再补 registry 来源策略、重定向逐跳复核、`postinstall` 限制、包扫描、
缓存、并发和私有 registry 认证；认证即使加入，也只能进入 broker 的单次内存请求，不得进入工作区、
子进程 env 或 ledger。这些防护栏是后续优化，不阻塞首版冻结。
