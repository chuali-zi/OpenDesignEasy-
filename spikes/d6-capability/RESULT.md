# Spike D6 + 能力矩阵 + D4/D5 阻塞报告

> 执行者：主 agent（非子 agent）。日期：2026-07-26。
> 覆盖假设：**D6**（图像输入能力可绑定）、**D1 基础可用性**、**D4/D5**（Seedream，阻塞）。

## 1. 假设原文

- **D6**（`design-intelligence-spec.md` §11）：`design.critique` 的图像输入能力可绑定。Kimi 是否
  支持；不支持则须找到替代实例。**本场景阻塞项**，自验证闭环依赖它。
- **D4**：Seedream 的尺寸/风格可控性满足配图需要。
- **D5**：Seedream 输出的商用权利条款可确认，结论明确到能填 `RightsStatus`。

## 2. 环境实测

| 项 | 实测值 |
|---|---|
| endpoint | `https://api.kimi.com/coding/v1`（OpenAI 兼容 chat completions） |
| 可用模型 | `kimi-for-coding`、`kimi-for-coding-highspeed`、`k3`、`k3-256k` |
| 配置的 MODEL | `k3` |
| `/images/generations` | **HTTP 404** — 该 endpoint 不提供生图 |

## 3. 能力矩阵（实测）

| 模型 | 图像输入 | 工具调用 | 备注 |
|---|---|---|---|
| `k3` | ✅ 正确识别（红→"Red"，蓝→"Blue"） | ✅ | 推理模型，返回 `reasoning_content` |
| `k3-256k` | ✅ 正确识别（"Blue."） | ✅ | 长上下文变体 |
| `kimi-for-coding` | ❌ **返回空内容** | ✅ | 编码优化模型，**看不了截图** |

测试方法：程序生成 8×8 纯色 PNG → base64 data URI → `image_url` 消息块，问颜色。
工具调用测试：单个 `write_file` 函数定义，检查返回是否含合法 `tool_calls` 且 `arguments` 可 JSON 解析。

## 4. 已知约束（踩坑记录）

1. **`k3` 只接受 `temperature=1`**，其他值 HTTP 400：`invalid temperature: only 1 is allowed for this model`。
2. `usage` 含 `reasoning_tokens`（本次冒烟测试：48 completion tokens 里 32 是 reasoning）。
   **推理 token 要计入预算**，否则预算模型会严重低估。
3. `.env` 带 UTF-8 BOM，须 `encoding="utf-8-sig"`。
4. Windows 终端默认 cp1252，脚本有非 ASCII 输出必须设 `PYTHONIOENCODING=utf-8`。

## 5. 结论

### D6：**通过**，但绑定关系必须调整

图像输入可用，`agent-engine-spec.md` §6 的自验证闭环（agent 看自己的渲染截图找问题）**技术上成立**。

但有一个 spec 没预料到的约束：**`kimi-for-coding` 没有视觉能力。** 这意味着不能用「一个编码模型干所有事」，
`design.compose`（写代码）与 `design.critique`（看截图）如果都想用编码优化模型，后者会拿到空响应。

**对 `design-intelligence-spec.md` §5 的修订建议**：能力槽绑定明确为

| slot | 绑定 | 理由 |
|---|---|---|
| `design.compose` | `k3` / `k3-256k` | 需同时具备工具调用与长输出 |
| `design.critique` | `k3` / `k3-256k`（**不可用 `kimi-for-coding`**） | 需图像输入 |
| `code.understand` | `kimi-for-coding` 或 `k3-256k` | 纯文本，编码模型可胜任 |

并新增一条规则：**能力槽降级时必须校验目标实例仍具备该槽声明的必要模态**，否则报
`CAPABILITY_UNAVAILABLE`。当前 spec §5 只说了「降级不得丢失必要能力」，没说要**校验**——
`kimi-for-coding` 返回空内容而不是报错，是一个会静默失败的真实陷阱。

### D4 / D5：**阻塞，无法执行**

`.env` 只提供了 Kimi 凭据。没有 Seedream / 火山引擎 Ark 的 key，且当前 endpoint 无生图接口（404）。

**未执行，不做任何推测性结论。** 需要用户提供生图凭据后单独跑。

影响范围：
- `design-intelligence-spec.md` §4.5「Imagery Planner 与生图 Adapter」整节未验证；
- 生成图的 `RightsStatus` 结论（D5）未定，spec 中「条款未确认前记为 `ANALYSIS_ONLY`」的保守默认
  **继续有效**，正好是为这种情况设计的；
- 首个场景（本仓库 → agent 前端页）**不依赖生图**，因此 D4/D5 阻塞**不阻塞 Phase 6**。
  spec §5 已把 `image.generate` 标为本场景非阻塞项，该判断成立。

## 6. 待补

- 长输出容量探测（单次能否稳定产出 300+ 行完整页面）结果见 `long_output.txt`，
  与子 agent 的 D1/E7 spike 数据合并后再下结论。
