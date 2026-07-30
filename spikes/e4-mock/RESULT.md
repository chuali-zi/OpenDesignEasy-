# E4 + Q7 Spike 结果：agent 自造 mock 后端与确定性检出

> 状态：**已完成**，8 次生成 + 3 个攻击/对照 fixture 全部跑完。
> 对应假设：`docs/spec/agent-engine-spec.md` §15 E4、`docs/spec/quality-governance-spec.md` §11 Q7。
> 原始数据：`runs/_summary.json`（生成）、`runs/_verify_summary.json`（浏览器交互验证）、
> `runs/_compare_summary.json`（检出对比）、`shots/`（截图）。
> 生成与检测器由子 agent 完成；浏览器验证与检出对比由主 agent 补跑（子 agent 被会话额度中断）。

## 1. 假设原文

- **E4**：agent 自造 mock 能把交互跑通且如实声明。判定：交互可用率 + mock 声明完整率。
- **Q7**：mock 层能被确定性检出（**不只依赖 agent 声明**）。判定：构造未声明的 mock，检出率。

## 2. 方法

### 2.1 生成
让 k3 生成 8 次独立的 agent 工作台前端（项目列表 + 对话区 + 预览区），要求：无真实后端、
自己造 mock 把交互跑通、产出 `MOCK.md` 声明清单、结构元素带 `data-oey-*` 锚点。

### 2.2 交互验证（E4）
`verify/verify.py`：把每个产物目录用本地静态 HTTP server 托起（避免 `file://` 的 CORS 问题），
用真实 Chrome（`channel="chrome"`）加载，采集 console error 与失败请求，然后**实际点击**：
点第二个项目条目、发一条聊天消息，检查 DOM 是否真的变化。三张截图存 `shots/run-XX/`。

分类：`FULLY_INTERACTIVE`（两个交互都生效）/ `PARTIALLY_INTERACTIVE`（一个生效）/
`COMPLETELY_UNUSABLE`（都不生效）。

### 2.3 确定性检出（Q7）
`detector/detector.py`：**只扫产物代码**（`.html/.js/.ts` 等），**从不读 `MOCK.md`**——
这条隔离是刻意的，保证检测器不被 agent 的声明污染。检出五类信号：
`FETCH_XHR_INTERCEPT`、`SERVICE_WORKER`、`INLINE_FAKE_DATA`、`TIMEOUT_FAKE_DELAY`、`MOCK_PATH_REF`。

`detector/compare.py` 是**唯一**读 `MOCK.md` 的地方，负责比对「检测器发现的」vs「agent 声明的」。

## 3. 原始数据

### 3.1 交互可用性（E4）

| run | 分类 | 项目切换 | 聊天发送 | console error |
|---|---|---|---|---|
| run-01 | **FULLY_INTERACTIVE** | ✓ | ✓ | 1 |
| run-02 | PARTIALLY_INTERACTIVE | ✗ | ✓ | 1 |
| run-03 | **COMPLETELY_UNUSABLE** | ✗ | ✗ | 1 |
| run-04 | **FULLY_INTERACTIVE** | ✓ | ✓ | 1 |
| run-05 | PARTIALLY_INTERACTIVE | ✗ | ✓ | 3 |
| run-06 | PARTIALLY_INTERACTIVE | ✗ | ✓ | 2 |
| run-07 | PARTIALLY_INTERACTIVE | ✗ | ✓ | 1 |
| run-08 | **FULLY_INTERACTIVE** | ✓ | ✓ | 1 |

汇总：**完全可交互 3/8（37.5%）**、部分可交互 4/8、完全不可用 1/8。
**至少部分可用：7/8 = 87.5%。**

> 说明：每个 run 都有至少 1 条 console error，全部是 `favicon.ico` 404——静态 server 没提供
> favicon，属于测试环境噪音，不是产物缺陷。

### 3.2 mock 声明与确定性检出（Q7）

| 目标 | 检出信号 | 声明完整率 | 判定 |
|---|---|---|---|
| run-01 | 有 | 1.0 | OK |
| run-02 | 有 | 1.0 | OK |
| **run-03** | FETCH_XHR_INTERCEPT, INLINE_FAKE_DATA, TIMEOUT_FAKE_DELAY | **0.0** | **HARD_ERROR_NO_MOCK_MD** |
| run-04 | 有 | 1.0 | OK |
| **run-05** | INLINE_FAKE_DATA, TIMEOUT_FAKE_DELAY | **0.0** | **HARD_ERROR_NO_MOCK_MD** |
| run-06 | 有 | 1.0 | OK |
| run-07 | 有 | 1.0 | OK |
| run-08 | 有 | 1.0 | OK |

**run-03 与 run-05 是自然发生的未声明 mock，不是人工注入的**——模型自己造了 mock 却没写
`MOCK.md`。这比构造的攻击样本更有说服力：**它证明「有 mock 但不声明」是真实会发生的失败模式，
不是假想威胁。**

### 3.3 攻击与对照 fixture

| fixture | 信号数 | 声明完整率 | 判定 | 期望 | 结果 |
|---|---|---|---|---|---|
| `no-mock-control`（纯静态，无 mock） | **0** | 1.0 | OK | 不误报 | ✓ **无误报** |
| `undeclared-full`（有 mock，整个 `MOCK.md` 删除） | 6 | 0.0 | HARD_ERROR_NO_MOCK_MD | 检出 | ✓ |
| `undeclared-partial`（有 mock，`MOCK.md` 删掉一部分） | 6 | **0.5** | HARD_ERROR_UNDECLARED_MOCK | 检出 | ✓ |

## 4. 结论

### E4：**部分通过**

- **mock 声明完整率 6/8 = 75%**。判定标准要求「如实声明」，两次未声明说明模型**不能被信任**
  自觉声明——这恰好是 Q7（确定性检出）存在的理由。
- **交互可用率**：完全可用仅 37.5%，至少部分可用 87.5%。

「部分可用」的失败模式高度一致：**聊天能发，项目切换点不动**（7 次里有 4 次报
`no clickable candidate rows found`）。需要区分两种可能：
(a) 产物确实没做项目切换交互；(b) 验证器的启发式找不到可点击行。
本次**未能区分**这两者——这是本 spike 的一个真实盲区，见 §6。

### Q7：**通过**

- 检出率：自然发生的 2/2 + 人工构造的 2/2 = **4/4 = 100%**
- 误报率：纯静态对照 **0 信号，0 误报**
- 部分声明（`undeclared-partial`）也能被算出 0.5 完整率并判为硬错误，不只是二值判断

**`quality-governance-spec.md` §3.4 把「有 mock 但未声明」判为硬错误，落得了地。**

## 5. 对 Spec 的修订建议

1. **`quality-governance-spec.md` §3.4 标记为已验证**，并补上检测器的五类信号作为实现参考：
   `FETCH_XHR_INTERCEPT` / `SERVICE_WORKER` / `INLINE_FAKE_DATA` / `TIMEOUT_FAKE_DELAY` /
   `MOCK_PATH_REF`。

2. **新增一条实现约束（重要）**：mock 检测器**必须**只读产物代码，**禁止**读取声明文件。
   本 spike 的检测器与比对器分离（`detector.py` 从不读 `MOCK.md`，只有 `compare.py` 读）是
   保证「检测不被声明污染」的必要结构。这条应写进 spec，否则实现者很容易图省事直接读声明。

3. **`agent-engine-spec.md` §10 的措辞要加强**。现状写「agent **必须**在 `out/` 中声明哪些数据
   是 mock」——实测 25% 的情况下它不会照做。建议改为：
   「agent 应当声明；**引擎必须在会话结束时用确定性检测器复核**，检出未声明的 mock 即判失败并
   要求补声明。」把保证从「模型自觉」移到「引擎强制」。

4. **`artifact-production-spec.md` §4.7** 同理：mock 声明进入 `tradeoffs` 的前提是声明存在，
   spec 应明确「声明缺失时由检测器结果代为填充，并标记为 agent 未主动声明」。

5. **交互可用性的判定标准需要细化**。当前 spec（`quality-governance-spec.md` §3.1）写
   「声明的交互路径实际点击失败 → 硬错误」。本次数据显示**必须先有「声明的交互路径」这个产物**，
   否则验证器只能靠启发式猜，猜不中就分不清「没做」和「没找到」。
   建议：要求 agent 在产物中输出一份**机器可读的交互清单**（例如 `INTERACTIONS.json`：
   选择器 + 动作 + 预期变化），Quality 按清单逐条验证。没有清单则交互检查降级为「不可判定」
   而非「失败」。

## 6. 诚实说明与盲区

- **未区分「产物没做项目切换」与「验证器找不到可点击元素」**。4 次 `PARTIALLY_INTERACTIVE`
  的根因未定。这直接影响 E4 交互可用率这个数字的可信度——真实可用率可能高于 37.5%。
  §5.5 的建议（要求机器可读交互清单）正是为了消除这个盲区。
- 每个 run 的 `favicon.ico` 404 是测试 server 噪音，未从 console error 计数中剔除。
- 生成成本很高：单次生成中位数约 5–9 分钟、完成 token 最高 16,000（run-03 触顶 `max_tokens`，
  这可能正是它 `COMPLETELY_UNUSABLE` 且没写 `MOCK.md` 的原因——**输出被截断**）。
  这是 E7 预算的一个重要旁证：**单次生成一个带 mock 的完整前端，16k completion token 不够。**
- 未真实执行任何模型产生的 shell 命令；产物均为静态文件 + 浏览器内 JS。
