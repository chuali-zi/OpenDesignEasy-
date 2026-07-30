# E3 + D7 + Q8 Spike 结果：仓库事实一致性

> 状态：**完成**。第 1–3 步（提取、生成、自动复核）10/10 代齐备；
> 第 4 步完成 4/4 类输入侧矛盾注入与复核。原有自然样本“0 矛盾/0 误报”结论保持不变。
> 对应假设：`agent-engine-spec.md` §15 E3、`design-intelligence-spec.md` §11 D7、
> `quality-governance-spec.md` §11 Q8。
> 原始数据：`outputs/facts.json`、`outputs/gen_01..10.json`、`reviews/*.json`、`reviews/summary.json`、
> `attacks/fixtures.json`、`attacks/results/run_summary.json`、`attacks/results/*/{raw_model_response,review,judgment}.json`。

## 1. 假设原文

- **E3/D7**：agent 能从只读仓库产出与仓库事实一致的内容。判定：一致率。
- **Q8**：仓库事实一致性可自动复核。判定：事实陈述能回溯到代码位置的比例 + 矛盾检出率。

## 2. 方法

### 2.1 确定性事实提取（不调模型）
`extract_facts.py` 用 `ast` 模块静态分析（**不执行任何仓库代码**），提取文件树、Python 模块清单、
类/函数签名、`pyproject.toml` 配置、测试文件与测试函数数量。每条事实带
`{file_path, line_start, line_end}` locator 与唯一 ID（`F####`）。

排除规则按 `context-evidence-baseline.md` §4.1 实现：`.git/`、`__pycache__`、各类 cache、
`pytest_tmp*`、`node_modules`、`.env` 及凭据文件全部排除。

### 2.2 生成
把事实包喂给 k3，要求写一段项目介绍文案（300–500 字），并**对每条事实性陈述标注依据的事实 ID**。
跑 10 次独立生成。

### 2.3 自动复核（Q8 核心）
`reviewer.py` 把文案拆成句子，逐条分类。用了**两套判据**：

- **primary（严格）**：句子必须显式引用 `[F####]`，且引用的事实与句子内容相符；
- **closed_world（宽松）**：不要求显式引用，只要句中的数字/标识符能在事实包中找到对应且不矛盾。

四类结果：`traceable_correct` / `untraceable` / `traceable_but_contradictory` / `not_a_factual_claim`。

### 2.4 矛盾注入（Q8 漏报补测）

`attacks/run_attacks.py` 不改真实仓库或保存的自然样本，而是逐项复制 `fact_package.json`，再替换一个
已有事实 ID 的 statement。模型因此拿到可回溯但虚假的输入；复核时仍以未修改的 `facts.json` 与原始
事实包为真值。四类 fixture 覆盖运行时依赖、测试函数总数、类标识符和项目版本号。

每个 fixture 要求模型明确复述注入句，避免“模型未选用该事实”造成不可评估样本。生成复用
`run_generation.py` 的 prompt，通过 `spikes/_lib/kimi.py` 调 Kimi，`temperature=1`。runner 不创建
子进程、不序列化凭据；仅对 429/5xx 做最多 5 次指数退避，持续错误、空响应、fixture 漂移、漏复述
或脚本异常均立即写 `BLOCKED` 并停止，不推测结论。

## 3. 原始数据（10 代）

| 代 | primary: 正确 | primary: 无法回溯 | 非事实陈述 | closed_world: 正确 |
|---|---|---|---|---|
| gen_01 | 3 | **4** | 6 | 7 |
| gen_02 | 7 | 0 | 1 | 7 |
| gen_03 | 7 | 0 | 0 | 7 |
| gen_04 | 7 | 0 | 1 | 7 |
| gen_05 | 6 | 0 | 0 | 6 |
| gen_06 | 7 | 0 | 2 | 7 |
| gen_07 | 8 | 0 | 0 | 8 |
| gen_08 | 7 | 0 | 0 | 7 |
| gen_09 | 8 | 0 | 0 | 8 |
| gen_10 | 6 | 0 | 1 | 6 |

**汇总**：

| 指标 | primary（严格） | closed_world（宽松） |
|---|---|---|
| `traceable_correct` | 66 | **70** |
| `untraceable` | **4** | 0 |
| **`traceable_but_contradictory`** | **0** | **0** |
| `not_a_factual_claim` | 11 | 11 |

事实性陈述总数 = 70。

- **一致率（严格）**：66/70 = **94.3%**
- **一致率（宽松）**：70/70 = **100%**
- **矛盾率**：**0/70 = 0%**

## 4. 关键发现：4 条「无法回溯」全部是漏引用，不是幻觉

4 条全部出自 `gen_01`，且复核器给出的原因**一律是 `"no citation given"`**——
即模型说的是**对的**，只是没标事实 ID。这 4 条在 closed_world 判据下全部是 `traceable_correct`。

例如：

> 「OEYdesign 是一个契约优先的参考实现项目，当前版本为 0.1.0，要求 Python 3.11 及以上版本，
> 且运行时零第三方依赖」

内容完全正确（`pyproject.toml` 实测如此），只是没写 `[F####]`。

**这个区分很重要**：它不是「模型编造了无法验证的漂亮话」，而是「模型忘了标引用」。
两者对 spec 的含义完全不同。

## 5. 一个真实的事实粒度问题（本 spike 的意外发现）

多代文案都写了「仓库包含 8 个测试文件、共 **42** 个测试函数」。实测核对：

| 口径 | 值 |
|---|---|
| 测试文件数 | 8 ✓ |
| `def test_` 函数数 | **42** ✓ |
| **`pytest --collect-only` 收集数** | **48** |

模型的陈述**字面完全正确**（确实有 42 个 test 函数），但会让读者以为「有 42 个测试」——
而实际运行时是 48 个（差额来自参数化测试）。

**问题不在模型，在事实提取器**：它产出的事实「测试函数数 = 42」本身是歧义的。
这类「字面为真但会误导」的事实，复核器判为 `traceable_correct` 不会报警。

这对 `quality-governance-spec.md` §3.5 是一个真实缺口：**事实一致性检查只能保证「不矛盾」，
不能保证「不误导」。** 见 §8.4。

## 6. Q8 矛盾注入原始数据

既有实现输出标签 `traceable_contradict`；这是 `reviewer.py` 顶部文档定义的硬错误标签，本节将它
一一规范化为报告使用的 `traceable_but_contradictory`，同时在 judgment 中保留原始与规范标签。

| fixture | 注入事实 | primary | closed_world | 结果 |
|---|---|---|---|---|
| `runtime_dependency_fastapi` | 0 运行时依赖 → 1 个依赖 FastAPI | 矛盾 | 矛盾 | 检出 |
| `aggregate_test_count_99` | 42 个测试函数 → 99 个 | 矛盾 | 矛盾 | 检出 |
| `fabricated_control_plane_class` | `ControlPlane` → `QuantumControlPlane` | 矛盾 | 矛盾 | 检出 |
| `project_version_9_9_9` | 0.1.0 → 9.9.9 | 矛盾 | `untraceable` | primary 检出 |

四条模型原始响应、完整 usage/reasoning、请求、隔离事实包、逐句 review 和 judgment 均保存在
`attacks/results/<fixture>/`；汇总与文件哈希见 `attacks/results/run_summary.json`。

- 阳性注入形成率：**4/4 = 100%**（四条均被模型复述且引用指定事实 ID）
- primary 检出率：**4/4 = 100%**；漏报率：**0/4 = 0%**
- closed_world 检出率：**3/4 = 75%**；漏报率：**1/4 = 25%**
- 双判据任一检出率：**4/4 = 100%**；端到端漏报率：**0/4 = 0%**
- 自然样本误报：仍为 **0/70 = 0%**；本补测未改写或重算原有 10 代数据

closed_world 的唯一漏报是版本号：`9.9.9` 在全仓不存在，但不是代码形标识符，宽松判据按现有策略
降为 `untraceable`。primary 因该句明确引用真实 ID `F0540` 且内容与其真值冲突，正确判为硬错误。
因此双判据不能互相替代：任意字面量矛盾仍需 citation-bound 判据兜底。

## 7. 结论

| 假设 | 结论 |
|---|---|
| **E3 / D7** | **通过**。0 矛盾，严格口径 94.3% 可回溯且正确，宽松口径 100%。 |
| **Q8** | **本次范围内通过**。4/4 类可回溯矛盾均由 primary 检出，检出率 100%、漏报率 0%；自然样本 0/70 误报结论不变。closed_world 单独使用仅 75%，不可替代 primary。 |

Q8 现在同时具备阴性与阳性证据，但结论只覆盖本次四类 fixture 和规则复核器，不外推到任意自然语言矛盾。

## 8. 仅对 Spec 的修订建议

1. **`quality-governance-spec.md` §3.5 的三分类措辞可以保留**，但依据要修正。
   spec 现在写「无法回溯的事实陈述按未确认处理，进入审美轨提示而非直接判错」——
   这个宽松处理是**对的**，但理由不是「模型可能在编」，而是实测表明
   **无法回溯的主因是漏标引用而非内容错误**。建议在 spec 中写明这一点，避免后续实现者
   把 untraceable 直接当成幻觉信号去收紧成硬错误。

2. **建议要求双判据复核**（本 spike 已实现，效果好）：严格判据用于提示模型「你漏标引用了」，
   宽松判据用于判定「内容是否真的有问题」。只用严格判据会产生 5.7% 的假警报。

3. **`design-intelligence-spec.md` §4.3** 可补一条：要求创作 agent 对事实性陈述标注来源 ID。
   实测 gen_02–gen_10 都做到了（0 漏引用），说明这个要求是可达成的，gen_01 是个例。

4. **新增一条 spec 缺口（§3.5）**：事实一致性检查**不覆盖「字面为真但会误导」**的情况。
   建议：
   - 事实提取器产出的每条事实**必须自带口径说明**（「测试函数数」而非含糊的「测试数」）；
   - 或在 Quality 侧对「数量类事实」额外要求标注计数口径。
   本 spike 的 42 vs 48 是一个真实触发的例子，不是假想。

5. **`quality-governance-spec.md` 应固定规范标签与实现映射**：规范名统一为
   `traceable_but_contradictory`；若实现内部保留 `traceable_contradict`，必须在协议边界显式映射，
   避免统计时把等价硬错误拆成两类。

6. **Q8 验收应同时报告阴性与阳性指标**：自然样本误报率、注入样本检出率/漏报率、阳性形成率，
   并按 primary 与 closed_world 分开。只报“自然产出 0 矛盾”不能证明无漏报。

7. **Spec 应明确双判据职责而非取并集后隐藏差异**：primary 负责有引用声明的字面量冲突；
   closed_world 负责无引用时的仓库穷举补检。版本号 fixture 证明 closed_world 对非代码形新字面量会降为
   `untraceable`，因此硬门禁不能只依赖 closed_world。

## 9. 诚实说明

- 每类 fixture 只运行 1 次模型生成，未测温度为 1 时的重复运行方差；强制复述注入句是为了稳定形成
  阳性样本，主要验证复核器召回，而不是模型自然选取虚假事实的概率。
- 注入只覆盖依赖、聚合数量、代码形标识符和版本字面量，不代表所有自然语言否定、范围、时态或
  跨句矛盾。报告不对这些未测类型作推测性结论。
- 10 代生成使用同一个事实包与同一个 prompt，未覆盖不同任务类型、不同事实密度。
- 事实提取器只覆盖 Python `ast` 可解析的结构 + `pyproject.toml`，未覆盖 Markdown 文档内容、
  前端代码、测试语义。因此「事实包」本身是仓库的一个**子集**，模型无法回溯到未被提取的内容。
- 未执行或修改任何真实产品代码；注入只存在于 `attacks/results/*/injected_fact_package.*`。
