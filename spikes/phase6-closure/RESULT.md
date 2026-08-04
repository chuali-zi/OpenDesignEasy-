# Phase 6 execution closure

> 运行日期：2026-08-03。结论：**通过**。

正式入口：

```powershell
$env:PYTHONPATH = "src"
python -m oeydesign.phase6_acceptance
```

最新指针为 `evidence/latest.json`，本次通过记录位于
`evidence/20260803-091403/phase6-closure.json`。

## 真实证据

- Windows AppContainer profile `OEYdesign.Phase6`，工作区位于 package `AC` 内，零 capability；进程在
  resume 前加入 Job Object，构建使用随机临时盘符。
- native esbuild 0.25.12 连续两次构建成功，dist tree SHA-256 均为
  `492e5a2e855a95c03fa3ef4a6eee887edb0c36e99e4b0b945fdc7a9d964525df`。
- 系统 Chrome `150.0.7871.187` 真渲染；截图 SHA-256 为
  `f8bc34eeab31ebfdbbd0b85422825c289b31cd5e6b7b1acbea7e320fc1c23354`；console/page/request 错误均为 0。
- 渲染后 DOM 有 12 个唯一 `data-oey-object` 和 1 个唯一 section；页面文本 3,582 字符，无横向溢出。
- Kimi `k3` 会话依次记录 `run_build`、`render`、`model/complete`，最终状态 `COMPLETED`；1 次 render，
  3,673 prompt token，222 completion token，会话计量 16.452 秒。
- 完整验收含依赖镜像复制与 hash，共 443.657 秒，低于冻结的 900 秒上限。

## 范围

此结果关闭正式 sandbox/build/Chrome/session 指定闭环，不代表整个 G5 完成。真实 Design、
`ArtifactProductionPort`、export/Quality/Delivery 纵切仍按 `docs/phase6/README.md` 推进。
