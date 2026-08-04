# Quality & Governance 内部规范

> 状态：**v0.3，已于 2026-07-29 审核通过并冻结。**
> 冻结依据：spike Q1（硬检查 12/12 检出、0 误报）、Q4（漂移检测）、Q7（mock 检出 4/4、0 误报）、
> Q8（矛盾注入 primary 检出 4/4、漏报 0）全部通过；用户审核确认「质量治理没什么问题」。
> 冻结后的变更必须通过版本化 Spec 或 ADR。
> 上位规范：`system-spec.md` §7.3、`contract-skeleton.md` §6.3、`artifact-production-spec.md`、
> `agent-engine-spec.md`。
> 范围：Quality & Governance Port 的双轨评估、硬检查清单、审美 rubric、修复边界与交付门。
> 首个垂直媒介：Web。首个真实场景：本仓库 → agent 前端页（含自造 mock 后端）。

## 1. 目的与边界

本规范确定「评价设计与真实产物、执行策略门、形成可操作问题」这件事在内部怎么做。

**Quality 是阶段之后的独立复核，不是阶段内部的监督。** agent 在会话内部有自己的自验证闭环
（`agent-engine-spec.md` §6）——那是让它自己把活干好；Quality 是活干完之后的第二双眼睛。
两者互不替代：agent 自认通过不等于 Quality 通过，Quality 也不介入 agent 的工作过程。

本规范不改变 `src/oeydesign/ports.py:324-356` 中 `QualityGovernancePort` 的方法签名，不接管创作
决策，不定义 Artifact 的内部结构，不监督 agent 的中间状态。

本规范不覆盖：策略引擎 DSL、组织级策略与角色权限、视觉回归 baseline 对比、自动修复的回归测试集、
PPT/DOCX 的格式检查。

### v0.2 变更

配合 agent 引擎与仓库场景，新增三类检查：mock 保真声明与 delivery profile 的一致性、仓库事实与
产出物陈述的一致性、交互可用性。并明确 Quality 与 agent 自验证的分工。

## 2. 双轨原则

不变量 11：审美评价与正确性验证**必须**分别产生结论，再由交付门统一决策。

```text
                 真实渲染结果（截图 + console + 视口 + 资产）
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
  硬检查轨（确定性代码）           审美轨（模型 + 截图）
  FindingKind.HARD_ERROR         FindingKind.AESTHETIC
  可阻断                          不可阻断
        └───────────────┬───────────────┘
                        ▼
                  QualityDecision
                  verdict: PASS / REPAIR / BLOCK
                        │
                        ▼
                  authorizeTransition
                  （+ 匹配的 Approval）
```

两条轨的边界是硬的：

- 审美发现**不能**单独否决用户的选择。用户觉得好看就是好看，这是创作责任的归属问题。
- 任何未解决的硬错误**不能**授权正式交付。这不因用户偏好而松动。
- 审美轨**不得**产出 `HARD_ERROR`；硬检查轨**不得**产出 `AESTHETIC`。两条轨的实现不共用代码路径。

## 3. 硬检查轨

确定性代码，**不调模型**。输入是 `RenderBundle` 或 `ExportCandidate` 的真实渲染结果，不是源码
静态分析。

### 3.1 检查清单

| 组 | 检查项 | 严重度 |
|---|---|---|
| 结构完整性 | HTML 可解析、无未闭合关键结构 | 硬错误 |
| 资产完整性 | 引用的资源全部加载成功、无死链 | 硬错误 |
| 运行错误 | console error、未捕获异常 | 硬错误 |
| 运行警告 | console warning | 审美轨提示，不阻断 |
| 无障碍 | 图像有 alt、有 landmark、焦点可见、交互元素可键盘到达 | 硬错误 |
| 无障碍 | 文本对比度低于 WCAG AA | 硬错误 |
| 无障碍 | 动效未处理 `prefers-reduced-motion` | 硬错误 |
| 布局 | 代表性视口下的溢出、元素重叠、内容截断 | 硬错误 |
| 字体 | 声明字体加载失败并回退 | 取舍项，记录不阻断 |
| 权利 | 交付物中存在 `RightsStatus` 非 `CLEARED_FOR_DELIVERY` 的资产 | 硬错误 |
| 权利 | 交付物中存在 `RightsStatus.PROHIBITED` 的资产 | 硬错误，不可修复 |
| 契约偏离 | design contract 的 token 漂移 | 按模板角色，见 §5 |
| 契约偏离 | design contract 的 anchor 丢失 | 按模板角色，见 §5 |
| **交互** | 声明的交互路径实际点击失败 | 硬错误 |
| **保真声明** | 存在 mock 但未声明 | 硬错误，见 §3.4 |
| **保真声明** | 已声明 mock + `production` delivery profile | 硬错误，见 §3.4 |
| **保真声明** | 已声明 mock + `demo` delivery profile | 审美轨提示，不阻断 |
| **事实一致性** | 产出物陈述与仓库实际内容不符 | 硬错误，见 §3.5 |

无障碍项对应 `system-spec.md` §15.6 与 Phase 4 已验收的工作台无障碍要求；这里把同样的标准施加到
产出物本身。

### 3.2 权利检查的位置

权利检查在**交付物**上做，不在候选上做。设计过程中使用 `ANALYSIS_ONLY` 的素材是合法的；把它带进
交付物不合法（`system-spec.md` §15.4）。

**例外：AI 生成图像（2026-07-28 用户决定）。** 生成图记为 `CLEARED_FOR_DELIVERY` 并直接进入交付物，
**不设权利门禁**——理由与回退条件见 `design-intelligence-spec.md` §4.5.1。
Quality 对生成图的义务改为两条**清单义务**（不是门禁）：

- 交付物清单中**必须**列出所有 AI 生成图像及其来源模型；
- 交付物**必须**带 AI 生成内容免责声明。缺少声明是硬错误（这是可检的确定性条件），
  但生成图本身的存在不是。

用户素材（上传的图片、参考物）**不适用**本例外，仍按 `ANALYSIS_ONLY` / `PROHIBITED` 正常门禁。

### 3.3 契约偏离检测

输入：`ApprovedDirection.design_contract` + 当前产物抽取出的 contract。

- **token 漂移**：出现了 contract 之外的颜色值、字号阶或间距阶；
- **anchor 丢失**：contract 中列出的锚点在当前产物中不存在。

抽取器与 `design-intelligence-spec.md` §3 是**同一个**，`extractor_version` 必须一致。版本不一致时
不比对，报告为「契约版本不匹配，需重新确认方向」。

这是「Production 不得在未记录的情况下改变 Design Direction」（`system-spec.md` §12）的机械化落点。

### 3.4 Mock 保真检查

agent 自造 mock 后端是引擎的正常能力（`agent-engine-spec.md` §10），**不是缺陷**。Quality 不禁止
它，只做两件事：确认它被声明了，确认它与交付意图匹配。

| 情况 | 判定 |
|---|---|
| 有 mock，无声明 | **硬错误**。未声明的假数据是隐藏的保真降级，等同于静默降级 |
| 有声明，`demo` profile | 提示。演示用假数据是正常的 |
| 有声明，`production` profile | **硬错误**。声称生产交付却跑在假后端上 |

检测方式是确定性的：比对 `ArtifactRevision.tradeoffs` 与 `ExportCandidate.manifest` 中的 mock
声明，与产物中实际存在的 mock 层。声明缺失或不完整即硬错误。

**实现约束（硬性）**：检测器**必须只读产物代码**（`.html`/`.js`/`.ts` 等），
**禁止读取任何声明文件**。检测与比对必须是两个分离的步骤——只有比对步骤可以读声明。
否则检测结果会被 agent 的声明污染，「未声明的 mock」将永远检不出来。

实测（spike Q7）已验证的五类信号，可作为实现参考：

| 信号 | 含义 |
|---|---|
| `FETCH_XHR_INTERCEPT` | `fetch` / `XMLHttpRequest` 被覆盖或拦截 |
| `SERVICE_WORKER` | 注册了 service worker |
| `INLINE_FAKE_DATA` | 内联的假数据数组/对象 |
| `TIMEOUT_FAKE_DELAY` | `setTimeout` 模拟延迟后 resolve 假数据 |
| `MOCK_PATH_REF` | 引用 `mock/` 目录或 `*.mock.json` |

实测结果：自然发生的未声明 2/2 + 人工构造的 2/2 = **检出 4/4**；纯静态对照页 **0 信号、0 误报**；
部分声明的样本算出 0.5 完整率并正确判为硬错误。

这条防的不是 agent 造假后端，而是**把假后端当真后端交付出去**。

> 根因提示：实测中未声明的两例，`completion_tokens` 均正好撞满上限——是**输出被截断**导致声明
> 文件没写出来，不是模型有意隐瞒。Quality 报告此类硬错误时应同时提示检查引擎侧的输出预算
> （`agent-engine-spec.md` §9.2）。

### 3.5 仓库事实一致性

有仓库输入时（本场景），产出物中关于该仓库的事实陈述必须与仓库实际内容一致。

- 陈述**必须**能通过 `SourceLocator`（`domain.py:261`，含 file path + line range）回溯到具体代码
  位置——这是 Phase 3 溯源能力在本场景的落点；
- 无法回溯的事实陈述按未确认处理，进入审美轨提示而非直接判错；
- 能回溯但与实际内容矛盾的陈述是**硬错误**（例如声称支持某个 API，而仓库中不存在）。

这条检查针对的是 agent 的一类典型失败：把「应该有」写成「已经有」。

**复核必须用双判据**（实测 spike E3）：

- **严格判据**：要求陈述显式引用事实 ID，用于提示模型「你漏标引用了」；
- **宽松判据**：不要求显式引用，只要陈述中的数字/标识符能在事实包中找到对应且不矛盾。

只用严格判据会产生约 5.7% 的假警报。实测 70 条事实性陈述中，4 条「无法回溯」的原因**全部是
`no citation given`**——内容是对的，只是漏标引用，在宽松判据下均为正确。因此
「无法回溯 ≠ 幻觉」，spec 对它的宽松处理是对的，但理由是**漏引用**而非**可能在编**。

### 3.6 已知缺口：字面为真但会误导

事实一致性检查只能保证「不矛盾」，**不能保证「不误导」**。

实测触发的真实例子：产出文案写「仓库包含 8 个测试文件、共 **42** 个测试函数」——字面完全正确
（确实有 42 个 `def test_`），但 `pytest` 实际收集到的是 **48** 个（差额来自参数化）。读者会被
误导，而复核器判为 `traceable_correct`，不会报警。

**问题在事实提取器的粒度，不在模型。** 因此要求：

- 事实提取器产出的每条事实**必须自带口径说明**（「测试函数数」而非含糊的「测试数」）；
- 数量类事实**必须**标注计数口径，Quality 对无口径的数量类事实降级为不可复核。

## 4. 审美轨

模型评估，**输入是真实渲染截图**，不是源码。看源码评审美是自欺欺人。

### 4.1 Rubric

| 维度 | 关注 |
|---|---|
| 视觉层级 | 焦点是否明确，重要信息是否先被看到 |
| 留白节奏 | 疏密是否有意图，还是均匀铺满 |
| 对比 | 大小、粗细、颜色的对比是否形成结构 |
| 排版一致性 | 字号阶与间距阶是否被贯彻，还是随机 |
| 意图契合 | 与 `DesignBrief.goal` 和 `acceptance_direction` 是否一致 |

规则：

- 每条发现**必须**指向具体锚点（`target_ref`），不接受「整体感觉一般」这类无法行动的评语；
- 每条发现**必须**说明「问题是什么」和「建议方向」，但**不得**代替用户做决定；
- 全部发现的 `kind` 一律为 `FindingKind.AESTHETIC`（`domain.py:117`），`severity` 表达强弱，
  **不产生**阻断力；
- **不输出综合审美评分。** 单一分数会把创作决定权从用户手里拿走，这是 `implementation-plan.md` §9
  明确列出的风险项。

### 4.2 候选评估与产物评估的差异

- `assess_candidate`：审美轨为主，硬检查只跑结构与运行错误。候选阶段的目标是帮用户比较方向，
  不是拦截。权利、无障碍与保真声明的完整检查不在此阶段阻断。
- `assess_artifact`：两轨全开。这是交付路径上的真实门。

### 4.3 与 agent 自验证的分工

agent 在会话内部已经渲染过、看过截图、修过问题（`agent-engine-spec.md` §6）。Quality 仍然要独立
跑一遍，原因有三：

- agent 的自验证判断**自己**是否满意；Quality 判断**是否可交付**。两个标准不同。
- agent 有动机把活报成完成；Quality 没有。
- 硬检查轨是确定性代码，与 agent 用的是不同机制，能发现 agent 漏掉的。

Quality **不得**因为「agent 说自验证过了」而跳过任何检查。反过来，Quality 也**不得**介入 agent
的工作过程——它只看最终产物。

## 5. 模板角色与严重度矩阵

延续 `contract-skeleton.md` §7，具体化到 Web 的契约偏离判定：

| 角色 | token 漂移 | anchor 丢失 | 结构重组 |
|---|---|---|---|
| 参考样例 | 审美信号 | 审美信号 | 审美信号 |
| 起始脚手架 | 审美信号 | 警告 | 警告 |
| 设计系统 | 硬错误 | 警告 | 警告 |
| 交付合同 | 硬错误 | 硬错误 | 硬错误 |

「警告」在实现上是 `FindingKind.AESTHETIC` 且 `severity` 较高，不阻断；「硬错误」是
`FindingKind.HARD_ERROR`，阻断。

`system-spec.md` §10：运行安全规则与事实/权利要求不能被创作自由度覆盖。表中任何角色都不会把
权利硬错误降级为信号。

## 6. Remediation

`plan_remediation` 把硬错误转成 `RemediationRequest`（`domain.py:596`）。

规则：

- 每条指令**必须**指向具体的锚点或 revision，说明**目标**与**不可破坏的约束**
  （`system-spec.md` §7.3）；
- 只有 `Finding.repairable` 为真的硬错误进入修复请求。不可修复项（如 `PROHIBITED` 资产）直接
  `BLOCK`，等待用户处理；
- `max_attempts` 有界（当前参照实现为 2）。次数耗尽后进入 `BLOCK`，向用户说明剩余问题，
  **不得**无限循环修复；
- 修复请求走 Artifact Production 的 Local Editor 路径（`artifact-production-spec.md` §4.3）：
  agent 拿到完整工作区与声明作用域，改完由事后验证复核，不触发整页重生成；
- 修复成本计入项目成本预算，超预算按 `CAPABILITY_UNAVAILABLE` 处理。

审美发现**不**进入自动修复。它们是给用户看的建议，用户决定是否采纳，采纳后走正常反馈路径。

## 7. 交付门

`authorize_transition` 的规则不变（`stubs.py` 已实现参照逻辑）：

```text
approved artifact revision
  -> export candidate
  -> 重新渲染实际导出物
  -> assess_artifact（两轨全开）
  -> authorize_transition（quality PASS + 匹配的 EXPORT approval）
  -> release Delivery Bundle
```

规则：

- 最终交付门**必须**依据**实际导出物的重新渲染结果**，不是 Artifact 的渲染结果
  （不变量 7、`artifact-production-spec.md` §4.5）。两者不一致本身就是需要报告的事实。
- `EXPORT` approval **必须**匹配具体的 `artifact_id` + `artifact_revision`。Artifact 发生变化后
  旧 approval 不再授权交付（`contract-skeleton.md` §2）。
- `QualityDecision` 只对其目标 revision 有效。目标 revision 变化后，findings **必须**重新确认，
  **不得**自动沿用为事实（`system-spec.md` §12）。
- 硬错误存在时 `authorized` 恒为 false，Client **不能**绕过。

## 8. 端口映射

| 端口方法（`ports.py`） | 内部实现 |
|---|---|
| `assess_candidate` (:327) | 审美轨 + 最小硬检查（结构、运行错误） |
| `assess_artifact` (:335) | 硬检查轨 + 审美轨，两轨全开 |
| `plan_remediation` (:344) | Remediation Planner |
| `authorize_transition` (:351) | 交付门 |

四个方法的签名、参数与返回类型**不变**。

## 9. 失败与降级

| 情况 | 错误类别 | 处理 |
|---|---|---|
| 审美轨模型不可用 | 降级 | 只出硬检查结论，明确标注审美评估缺失，**不**因此阻断 |
| 硬检查轨自身失败 | `DETERMINISTIC_FAILURE` | **必须**阻断。检查不出结论不等于通过 |
| 渲染结果缺失 | `INVALID_TRANSITION` | 没有真实渲染就没有评估，不接受源码替代 |
| contract 版本不匹配 | `NEEDS_INPUT` | 要求重新确认方向 |
| 仓库源不可达（事实无法复核） | `NEEDS_INPUT` | 不默认通过，要求重新接入仓库 |
| 修复次数耗尽 | `QUALITY_GATE_FAILED` | 进入 `BLOCK`，列出剩余问题 |

这条不对称是刻意的：**审美轨可以降级，硬检查轨不可以。** 前者缺失只是少了建议，后者缺失意味着
交付门失效。

## 10. 观测

记录：两轨各自的 finding 数量与分布、verdict 分布、修复尝试次数与成功率、被硬错误拦截的交付比例、
审美发现的用户采纳率、契约偏离的类型分布、mock 声明缺失率、事实不一致检出率、agent 自验证通过
但 Quality 拦截的比例、评估耗时与成本。默认不记录页面正文与截图原图，只记录摘要、哈希与结论。

审美发现的采纳率是校准 rubric 的主要依据（`implementation-plan.md` Phase 7）。
「agent 自验证通过但被 Quality 拦截」的比例是校准引擎自验证门槛的依据。

## 11. 待 spike 验证的技术假设

| # | 假设 | 状态 | 实测结论 |
|---|---|---|---|
| Q1 | 对比度、溢出、焦点可见性能可靠检出 | ⬜ **未跑** | 库已实现（WCAG 对比度含 alpha 叠加），fixture 未构造 |
| Q2 | 审美发现能指向具体锚点 | 🔒 待人工审核 | — |
| Q3 | 审美 rubric 跨次结论稳定 | 🔒 待人工审核 | — |
| Q4 | 契约偏离检测的误报率可接受 | ⬜ **未跑** | 与 A3 的「契约保持」检查部分重叠，可先看 A3 数据 |
| Q5 | 有界修复能真正收敛 | ⬜ **未跑** | — |
| Q6 | 导出物重渲染与 Artifact 渲染差异在阈值内 | ⬜ **未跑** | 与 `artifact-production-spec.md` A5 共用 |
| Q7 | mock 层能被确定性检出 | ✅ **通过** | 检出 4/4（含 2 例自然发生的未声明）；纯静态对照 **0 误报** |
| Q8 | 仓库事实一致性可自动复核 | ⚠️ **部分** | 0 矛盾、94.3% 严格可回溯；但**矛盾注入未测，漏报能力无数据** |

对应 ADR：**ADR-0002 Web 渲染与验证技术**、**ADR-0003 能力平面与首批 provider 绑定**、
**ADR-0004 Agent 工作区与沙箱边界**（均已于 2026-08-03 接受）。

## 12. 验收条件

本规范被实现时，至少应能证明：

1. 同一次评估分别返回审美发现与硬错误，两者在数据与界面上都不混淆；
2. 硬错误阻止交付，且 Client 无法绕过；审美发现不阻止任何操作；
3. 系统不输出综合审美评分；
4. 全部评估基于真实渲染结果，缺少渲染时拒绝评估而不是退回源码分析；
5. Quality 独立于 agent 自验证运行，不因「agent 说通过了」而跳过任何检查；
6. 权利未确认的资产进入交付物时被判为硬错误；
7. 未声明的 mock 被判为硬错误；已声明的 mock 在 `demo` 下放行、在 `production` 下阻断；
8. 产出物中与仓库矛盾的事实陈述被判为硬错误，可回溯的陈述能定位到代码位置；
9. 声明的交互路径实际点击失败时被判为硬错误；
10. design contract 的 token 漂移与 anchor 丢失能被检出，并按模板角色给出正确严重度；
11. 修复请求指向具体锚点、有次数上限，耗尽后进入 `BLOCK` 并列出剩余问题；
12. 审美发现不进入自动修复；
13. 最终交付门依据实际导出物的重新渲染，`EXPORT` approval 与 Artifact revision 精确匹配；
14. 目标 revision 变化后旧 findings 不被自动沿用；
15. 审美轨模型不可用时降级但不阻断，硬检查轨失败时必须阻断；
16. 用真实实现替换 `DeterministicQualityPort` 后，Client 命令流程与 Project 状态机不变。
