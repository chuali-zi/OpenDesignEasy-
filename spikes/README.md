> **历史资料：已被 2026-09-12 的 D 路线替代。** 当前方案见 [文档入口](../docs/README.md)与 [ADR-0006](../docs/adr/0006-full-typescript-design-platform.md)：全 TypeScript、Pi SDK、完整直接编辑、人机双向同步、Web/CLI/TUI/Desktop 共用核心。
> 下文的“当前”“冻结”“已接受”、Python/sidecar/兼容层建议和阶段验收只适用于旧版本，不约束新实现。原文保留用于理解旧代码、研究结论与数据迁入；不能据此宣布新重构已完成。

# Phase 5 Spikes

验证 `docs/spec/` 四份规范末尾列出的技术假设。**目的是拿到实测数据，不是让 spike 通过。**
假设被证伪同样是有效结果，如实报告即可。

## 环境（已验证）

| 项 | 值 |
|---|---|
| 模型 | Kimi `k3`，endpoint `https://api.kimi.com/coding/v1`（OpenAI 兼容） |
| 凭据 | 仓库根 `.env` 的 `API_KEY` / `BASE_URL` / `MODEL`。**绝不打印到输出或日志** |
| Python | 3.12.10 |
| 浏览器 | Playwright 已装，但**未下载 bundled chromium**；必须用 `channel="chrome"` |

## 已知约束（踩过的坑，别重踩）

1. **`k3` 只接受 `temperature=1`**，其他值返回 HTTP 400。
2. `.env` 带 UTF-8 BOM，读取要用 `encoding="utf-8-sig"`。
3. Windows 终端默认 cp1252，跑任何有非 ASCII 输出的脚本前设 `PYTHONIOENCODING=utf-8`。
4. `k3` 是推理模型，返回含 `reasoning_content`，`usage` 含 `reasoning_tokens`。
5. Playwright bundled chromium 不存在 → `p.chromium.launch(channel="chrome")`。
6. **`max_tokens` 大时必须走流式。** 非流式在生成期间不发字节，会被 endpoint 的 nginx 打 504。
7. **端点过载会静默返回空产出**：HTTP 200 + `finish_reason="engine_overloaded"` +
   `completion_tokens=0` + 空内容，不报错。`chat_stream()` 现在遇到空内容直接抛
   `RuntimeError`；调用方应当带重试，因为这类失败与 prompt 无关。

## 共用客户端

`spikes/_lib/kimi.py`：

```python
import sys; sys.path.insert(0, "spikes/_lib")
from kimi import chat, MODEL, BASE_URL
msg, usage, elapsed = chat(messages, tools=None, max_tokens=4096)
```

`chat()` 返回 `(message_dict, usage_dict, elapsed_seconds)`，HTTP 错误抛 `RuntimeError`。

## 已验证的基础能力

- **D1 工具调用**：支持，`tool_calls` 返回规范，`arguments` 可 JSON 解析。
- **D6 图像输入**：支持，`image_url` + base64 data URI 可正确识别图像内容。

这两项是引擎设计的前提，均已通过。

## 约定

- 每个 spike 一个目录 `spikes/<id>-<name>/`，结果写入该目录的 `RESULT.md`。
- `RESULT.md` 必须包含：假设原文、方法、**原始数据**、结论（通过/证伪/部分）、对 Spec 的修订建议。
- 多个 spike 可能并发打同一个 API，遇 429/5xx 用指数退避重试。
- **不要判断审美好坏。** 涉及主观评价的部分只产出物料（截图、对比页），留给人审。
