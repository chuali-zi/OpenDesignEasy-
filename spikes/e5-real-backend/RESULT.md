# E5 Spike 结果：真实后端沙箱启动

> 状态：**通过并冻结**（2026-08-03）。
> 原始结果：[`result.json`](result.json)。复现：用 Windows Python 运行 `experiment.py`。

## 假设与口径

E5 要验证的不是“宿主机能起一个 localhost 服务”，而是：真实后端逻辑在不可信沙箱内执行，浏览器
仍能通过仅回环可达的入口调用它，同时文件、环境变量和进程生命周期边界不被破坏。

## 最终方案

- 后端进程运行在零 capability AppContainer 中，并在启动前加入 Job Object；
- 受信任 host broker 只绑定 `127.0.0.1`，把 HTTP 请求经 AppContainer 包目录内的有界 spool
  交给后端；
- 后端本身不获得 loopback、私网或公网 capability；
- broker 属于引擎基础设施，不执行用户后端代码，session 结束时与 Job Object 一并回收。

这一方案刻意不依赖 `CheckNetIsolation LoopbackExempt`。首轮探针证明：零 capability AppContainer
可以创建监听进程，但宿主无法直连其 loopback；而修改系统 loopback exemption 既需要额外系统权限，
也会形成持久安全配置。最终方案没有留下 exemption，也没有放宽后端网络边界。

## 实测

| 检查 | 结果 |
|---|---|
| `GET /health` 真实 HTTP 往返 | 通过 |
| `POST /echo` 请求体由沙箱内后端处理并原样返回 | 通过 |
| 后端读取工作区外探针文件 | 被 AppContainer 拒绝 |
| 宿主 `OEY_E5_EXPERIMENT_KEY` 进入后端 env | 否 |
| 测试期间后端存活 | 是 |
| 终止 Job Object 后后端进程仍存活 | 否 |
| session teardown 后 host broker loopback 端口仍可达 | 否 |

六项阻断检查全部通过，`result.json` 的 `passed=true`。

## 冻结结论与后续优化

首版 `start_real_backend` 冻结为“零 capability 后端 + trusted loopback broker”，不允许把真实后端
直接放到宿主运行，也不允许为它全局添加 loopback exemption。spool 是正确性优先的首版传输；
后续可在不扩大 capability 的前提下改成带 AppContainer ACL 的 named pipe，并补并发、背压、大请求体
与流式响应测试。这些是性能和覆盖优化，不阻塞 E5。
