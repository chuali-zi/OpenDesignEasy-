> **历史资料：已被 2026-09-12 的 D 路线替代。** 当前方案见 [文档入口](../docs/README.md)与 [ADR-0006](../docs/adr/0006-full-typescript-design-platform.md)：全 TypeScript、Pi SDK、完整直接编辑、人机双向同步、Web/CLI/TUI/Desktop 共用核心。
> 下文的“当前”“冻结”“已接受”、Python/sidecar/兼容层建议和阶段验收只适用于旧版本，不约束新实现。原文保留用于理解旧代码、研究结论与数据迁入；不能据此宣布新重构已完成。

# gui_client — OEY*design* 桌面涂鸦版（壳子）

OEYdesign 真实产品路径的 PySide6 桌面工作台。
美术风格：小孩子涂鸦风（蜡笔配色、手绘抖动边框、Windows 自带手写字体
Segoe Print / Ink Free）。布局与功能 1:1 对照 web 版工作台。

## 运行

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\oeydesign-gui.exe `
  --data-root data/desktop `
  --dependency-image D:\path\to\frozen\node_modules
```

桌面程序会在当前进程内启动一个随机端口的 loopback 产品服务；不需要打开
Web 控制台。也可以通过 `OEYDESIGN_FRAMEWORK_DEPENDENCIES` 指定冻结依赖目录。
`--demo` 仅用于离线查看壳子，真实 MVP 不使用该模式。

冒烟截图（无头验证）：

```powershell
.\.venv\Scripts\python.exe gui_client\_smoke.py pytest_tmp/gui-smoke.png
```

## 结构

| 文件 | 职责 |
|---|---|
| `theme.py` | 涂鸦主题：蜡笔色板、手写字体、`DoodlePanel` / `DoodleButton` / `DoodleChip`（抖动墨线边框自绘） |
| `backend.py` | `Backend` Protocol、演示 Mock 和真实 loopback `HttpBackend`；处理 CSRF、幂等、revision、上传与下载 |
| `panels/brief.py` | 01/BRIEF 对话面板（气泡、run 状态条 Pause/Resume/Cancel、选中对象 chip、输入发送） |
| `panels/stage.py` | 02/LIVE PROOF 舞台（候选/Artifact tab、Qt WebEngine 真实预览、对象点选、审批动作） |
| `panels/inspector.py` | 03/PROJECT FILE 检查器（Readiness/Sources/Quality/Runs/History/Release） |
| `dialogs.py` | New Project / Sources（仓库或参考图）/ Kimi Provider 设置 |
| `app.py` | 主窗口、轮询、真实命令路由和本地 ZIP 保存 |
| `runtime.py` | 管理进程内 `ProductApplication`、随机 loopback 服务和安全关闭 |

## 连接已有服务

通常无需单独启动服务。调试时可用 `--server-url http://127.0.0.1:8765`
连接已启动的产品服务；该参数只接受无凭据、无额外路径的 loopback HTTP URL。
