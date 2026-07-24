# OEYdesign 系统总体规范

> 状态：v0.1，已于 2026-07-24 审核通过并冻结。
> 上位文档：`docs/prd.md`、`docs/architecture.md`。
> 范围：系统级组件、职责、状态、接口、控制流与非功能边界。
> 暂缓：智能设计层、Artifact 生产层、质量与治理层的内部架构、算法、具体技术栈和字段 schema。

## 1. 规范目的

本文把已经采用的总体架构落实为可实施的系统布局。它回答：

- 系统由哪些逻辑组件组成；
- 每个组件拥有什么状态和职责；
- 组件通过什么宏观契约协作；
- 一个设计项目如何从输入走到真实交付；
- 哪些约束是全系统必须维持的不变量；
- 哪些设计明确留给后续模块 Spec。

本文中的“必须”表示实现不得违反的系统不变量；“应当”表示默认方案，偏离时需要记录原因；“可以”表示兼容架构的可选实现。

这里定义的接口是逻辑接口，不预设它们最终是函数、进程内端口、消息、HTTP API 还是任务队列。

## 2. 系统目标与非目标

### 2.1 系统目标

系统必须支持：

1. 从自然语言、图片、文档、仓库、模板和品牌资产建立设计项目；
2. 在事实可靠和权限受控的前提下，让模型根据任务获得合适的创作自由；
3. 支持开放探索、设计引导和规范生产，以及各约束维度的独立组合；
4. 生成、预览、修改并导出 Web、PPT 和 DOCX；
5. 通过真实渲染、反馈、版本和审批持续迭代；
6. 在任务中断、模型切换和执行重启后恢复；
7. 让模型、模板、渲染器和外部工具可替换，而不破坏项目语义；
8. 以易部署、配置可视化的产品形式对用户隐藏内部编排复杂度。

### 2.2 当前非目标

本规范不要求：

- 使用一个通用视觉 IR 表达三种输出；
- 所有模型拥有完全一致的行为和工具；
- 所有任务都从空白开始或都从模板开始；
- 无人工参与地执行公开发布、高风险交付或不可逆操作；
- 立即支持任意模板、任意 Web 技术、任意 Office 特性；
- 在当前阶段确定三个核心生产模块的内部技术实现。

## 3. 系统不变量

任何实现都必须保持以下不变量：

1. **项目是真源**：聊天历史、模型会话和工作流 checkpoint 都不能单独成为项目真源。
2. **原件不被覆盖**：输入原件、解析观察、模型解释和人工确认分别保留，并通过派生关系连接。
3. **约束显式**：模板角色、品牌要求、事实要求、交付模式和权限边界必须可查询，不允许隐藏在提示词中成为不可见规则。
4. **候选责任统一**：一个候选在一次设计迭代中只有一个创作负责人；支持角色不能各自覆盖整体设计。
5. **语义共享、媒介分流**：三种输出共享项目语义，但允许使用不同创作与生产表示。
6. **版本不可逆覆盖**：恢复或修改产生新 revision；已交付和已审批版本保持可追溯。
7. **真实渲染验证**：任何正式交付必须验证实际构建物或导出物，不以编辑器预览或模型自述替代。
8. **高风险有审批**：公开发布、外部发送、删除、权限提升和显著成本行为必须经过策略判断，必要时取得用户批准。
9. **副作用可对账**：可重试任务中的外部副作用必须具备幂等或对账机制。
10. **供应商在边缘**：供应商消息、thread、file、memory 或 tool schema 不能污染规范项目状态。
11. **质量双轨**：审美评价与正确性验证分别产生结论，再由交付门统一决策。
12. **内部模块可替换**：智能设计、Artifact 生产和质量治理都必须能够在不改变上层项目生命周期的前提下替换内部实现。

## 4. 逻辑组件布局

```text
┌─────────────────────────────── Client ───────────────────────────────┐
│ Chat | Project Tree | Preview | Inspector | Feedback | Settings     │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ commands / events / streams
┌──────────────────────── Project Control Plane ──────────────────────┐
│ Project API | Revision Control | Approval | Policy | Configuration  │
└───────────────┬──────────────────┴──────────────────┬───────────────┘
                │                                     │
       ┌────────▼─────────┐                  ┌────────▼─────────┐
       │ Workflow Runtime │                  │ Capability Plane │
       │ state / resume   │                  │ models / tools   │
       └────────┬─────────┘                  └────────┬─────────┘
                │                                     │
     ┌──────────▼───────────┐                         │
     │ Context & Evidence   │◀────────────────────────┤
     │ ingest / understand  │                         │
     └──────────┬───────────┘                         │
                │ Context Package                     │
     ┌──────────▼───────────┐                         │
     │ Design Intelligence │◀────────────────────────┤
     │ strategy / candidates│                        │
     └──────────┬───────────┘                         │
                │ Approved Design Direction           │
     ┌──────────▼───────────┐                         │
     │ Artifact Production │◀────────────────────────┤
     │ materialize / render│                         │
     └──────────┬───────────┘                         │
                │ Render / Delivery Bundle            │
     ┌──────────▼───────────┐                         │
     │ Quality & Governance│◀────────────────────────┘
     │ assess / gate / repair policy                  │
     └──────────┬───────────┘
                │ decision / findings
     ┌──────────▼───────────┐
     │ Preview & Delivery   │
     │ display / export / deploy
     └──────────────────────┘

Cross-cutting: Project Store | Artifact Store | Audit & Observability | Isolated Execution
```

该布局是逻辑边界。首版可以是模块化单体加受隔离 worker，也可以后续拆分；部署形态不得改变接口所有权和系统不变量。

## 5. 核心项目域

本文不定义字段，但规定以下概念必须在系统中拥有独立、可版本化的身份：

| 概念 | 作用 | 主要所有者 |
|---|---|---|
| Project | 聚合一次持续设计工作的上下文和生命周期 | Project Control Plane |
| Source / Reference | 原始文件、仓库、URL、模板和品牌资产 | Context & Evidence |
| Context Package | 已整理的事实、来源、资产、风格知识和不确定性 | Context & Evidence |
| Design Brief | 用户目标、受众、内容和验收方向 | Project + Design Intelligence |
| Constraint Profile | 各维度约束及模板角色的有效组合 | Project Control Plane |
| Design Strategy | 候选数量、工作方式、模板与交付取向 | Design Intelligence |
| Design Candidate | 一个有统一创作责任的完整方向 | Design Intelligence |
| Approved Design Direction | 用户或策略确认的设计意图与基准 | Project Control Plane |
| Artifact Revision | 面向某一媒介的可渲染、可修改产物版本 | Artifact Production |
| Render Bundle | 真实渲染、截图、页面或交互检查所需结果 | Artifact Production |
| Feedback | 用户或系统针对方向、对象或交付的意见 | Project Control Plane |
| Quality Decision | 审美发现、硬检查、风险和门禁结论 | Quality & Governance |
| Delivery Bundle | 源文件、导出物、清单和交付说明 | Preview & Delivery |
| Workflow Run | 一次可恢复任务的执行状态 | Workflow Runtime |

这些概念可以在后续 schema 中拆分，但不得合并到无法独立追踪的聊天消息或供应商响应中。

## 6. 组件职责

### 6.1 Client Experience

负责用户交互、实时状态和结果展示，包括左侧对话、右侧预览、项目树、对象检查、批注、版本、设置和导出。

Client 必须：

- 展示当前项目阶段、运行进度、等待用户的原因和失败状态；
- 将用户输入转换成项目命令，而不是直接拼接隐藏 prompt；
- 支持重新连接运行流，并从项目状态恢复界面；
- 展示模板、模型、导出模式和重要降级选择；
- 不保存唯一的项目或 workflow 状态副本。

### 6.2 Project Control Plane

负责项目、权限、配置、revision 指针、审批、策略和命令入口。它是跨模块协调的业务真源。

它必须验证命令所针对的项目和版本，决定是否启动 workflow，记录重要决策，并保证已审批方向不会被后台任务静默替换。

### 6.3 Workflow Runtime

负责长任务的阶段、恢复、重试、超时、取消、人工中断和并行控制。它拥有执行状态，不拥有最终业务状态。

每个可恢复阶段必须具有明确输入、输出、版本和副作用边界。模型探索可以发生在阶段内部，但不能绕开 workflow 直接改变项目真源。

### 6.4 Context & Evidence

负责原件接入、安全初检、原生结构提取、OCR/视觉补充、事实与来源组织、资产权利、风格证据和面向任务的上下文组装。

它向下游提供 Context Package，并支持从事实、图片、风格结论回溯到原始区域。它不决定最终构图，也不将低置信解释伪装为已确认事实。

### 6.5 Capability Plane

负责描述和选择模型、图片能力、解析器、渲染器、工具及外部连接能力。选择依据是任务能力、策略、隐私、成本和可用性，而不是把供应商 ID 写入业务流程。

它只返回满足要求的能力实例。降级不得丢失该阶段的必要模态、工具或结构可靠性。

### 6.6 Isolated Tool Execution

负责运行不可信解析、仓库检查、生成代码、构建、渲染和格式转换。任何工具调用必须经过项目范围、权限、资源、网络和输出限制。

这一边界可以被多个逻辑模块使用，但模块不得通过它绕过 Control Plane 的审批和审计。

### 6.7 Preview & Delivery

负责向 Client 提供隔离预览，并根据已批准 revision 执行下载、分享、部署或外部交付。交付动作必须携带其来源 revision 和质量决定。

## 7. 三个待细化模块的宏观接口

以下接口是当前必须稳定的系统接缝；内部实现留给后续 Spec。

### 7.1 Design Intelligence Port

职责：把 Context Package、Design Brief 和 Constraint Profile 转化为可评审的设计方向。

逻辑操作：

```text
planDesign(context, brief, constraints, capabilities)
  -> Design Strategy

createCandidates(strategy, context)
  -> Candidate Set

reviseCandidate(candidateRevision, feedback, context)
  -> Candidate Revision

commitDirection(candidateRevision, approval)
  -> Approved Design Direction
```

接口要求：

- 每个候选声明其创作责任、使用的模板角色和有效约束；
- 候选必须可渲染或可转换为预览，不能只返回设计说明；
- 方向确认前允许大幅改造，确认后必须保留可比较的基准；
- 输出不得直接执行外部发布或覆盖已批准 Artifact；
- 内部模型编排、prompt/harness、模板检索、图片生成和设计工具链为 **TODO**。

### 7.2 Artifact Production Port

职责：把 Approved Design Direction 变成面向 Web、PPT 或 DOCX 的稳定产物。

逻辑操作：

```text
materialize(direction, targetProfile, constraints)
  -> Artifact Revision

applyArtifactChange(artifactRevision, changeRequest)
  -> Artifact Revision

renderArtifact(artifactRevision, renderProfile)
  -> Render Bundle

exportArtifact(artifactRevision, deliveryProfile)
  -> Delivery Bundle Candidate
```

接口要求：

- 输入方向必须已获批准，或被明确标记为仅用于候选预览；
- 产物必须属于单一目标媒介，并保留与设计方向的派生关系；
- 修改产生新 revision，并尽可能保留稳定对象引用；
- render 和 export 是不同操作，最终导出物必须能够重新进入验证；
- 无法同时满足可编辑与保真时，必须返回显式取舍，不得静默降级；
- Web/PPT/DOCX 内部表示、渲染器、编译器和导出技术为 **TODO**。

### 7.3 Quality & Governance Port

职责：评价设计和真实产物、执行策略门、形成可操作问题，并决定是否允许进入下一阶段。

逻辑操作：

```text
assessCandidate(candidateRender, brief, constraints)
  -> Quality Decision

assessArtifact(renderBundle, deliveryProfile, context)
  -> Quality Decision

planRemediation(qualityDecision, currentRevision)
  -> Remediation Request

authorizeTransition(qualityDecision, requestedAction, approvals)
  -> Gate Decision
```

接口要求：

- 审美发现、事实/权利、安全和格式硬错误必须保持可区分；
- Quality 层可以阻止错误交付，但不能通过单一审美分数接管创作；
- 修复请求必须指向候选、revision 或稳定对象，说明目标和不可破坏约束；
- 自动修复必须有次数、成本和回归边界；
- 最终交付门必须依据实际导出或部署结果；
- 验证器、视觉 rubric、阈值、修复算法、策略引擎和技术栈为 **TODO**。

## 8. 跨模块通信规则

1. 模块只通过项目内可寻址的版本或 bundle 协作，不把长聊天记录作为接口输入。
2. 长操作默认可异步、可取消、可恢复，并向 Client 发布进度事件。
3. 每个输出都携带产生它的项目、revision、workflow 和能力版本关系。
4. 命令与事件分离：命令表达意图，事件表达已发生事实。
5. 模块输出先验证，再由 Control Plane 发布为当前版本。
6. 模块不得自行改变用户审批、Constraint Profile 或交付目标。
7. 同一输入的重试不得产生重复外部副作用。
8. 错误必须区分可重试、需要用户输入、策略阻止、能力不足和确定性失败。

具体消息字段、传输协议和事件 schema 留待后续接口规范。

## 9. 项目状态机

```text
NEW
  -> INGESTING
  -> NEEDS_INPUT -----------┐
  -> READY_FOR_DESIGN       │ user response
  -> DESIGNING <------------┘
  -> AWAITING_DIRECTION_APPROVAL
  -> DESIGNING              (reject / revise)
  -> PRODUCING              (approve)
  -> VALIDATING
  -> PRODUCING              (repairable issue)
  -> AWAITING_EXPORT_APPROVAL
  -> READY_TO_DELIVER
  -> DELIVERING
  -> DELIVERED
```

任一运行态都可以进入：

- `NEEDS_INPUT`：缺少会实质改变结果的信息或批准；
- `BLOCKED`：策略、权利、能力或外部依赖阻止继续；
- `FAILED`：不可恢复的执行失败；
- `CANCELED`：用户取消，已完成 revision 仍然保留。

规则：

- 状态迁移由 Control Plane 接受 workflow 结果后提交；
- workflow 失败不能留下指向未验证产物的当前 revision；
- `DELIVERED` 后的修改开启新 revision 和新的验证/交付链；
- 一个 Project 可以拥有多个媒介 Artifact，各自维护生产状态，但共享上层方向和上下文。

## 10. 约束配置规范

每个项目必须拥有可解析的有效 Constraint Profile，至少覆盖：事实与证据、内容与叙事、品牌与风格、构图与模板、交付属性、运行与权限。

三个预设只用于建立默认值：

- 开放探索；
- 设计引导；
- 规范生产。

项目和具体 Artifact 可以覆盖各维度。系统必须记录覆盖来源是用户、模板、组织策略、目标格式还是系统安全规则。

模板必须声明其角色：参考样例、起始脚手架、设计系统或交付合同。Design Intelligence 根据角色决定可变范围；Artifact Production 根据角色保留结构；Quality & Governance 根据角色判断偏离是创意变化、警告还是阻断错误。

运行安全规则不能被设计自由度覆盖。事实和权利要求也不能通过切换到开放探索而取消。

## 11. 主控制流

### 11.1 新项目与候选方向

```text
Client -> Control Plane: create project + submit sources
Control Plane -> Workflow: start intake
Workflow -> Context: ingest and build context
Context -> Control Plane: context ready / unresolved issues
Control Plane -> Client: clarification when material
Workflow -> Design Intelligence: plan + create candidates
Design Intelligence -> Artifact Production: preview materialization if needed
Artifact Production -> Quality: rendered candidates
Quality -> Control Plane: findings and comparison signals
Control Plane -> Client: candidate review
Client -> Control Plane: approve / revise / change constraints
```

### 11.2 方向确认到交付

```text
Control Plane -> Artifact Production: materialize approved direction
Artifact Production -> Quality: render bundle
Quality -> Control Plane: pass / repair / block / needs approval
Control Plane -> Artifact Production: bounded repair request
Artifact Production -> Quality: new render bundle
Control Plane -> Client: final approval when required
Artifact Production -> Preview & Delivery: export candidate
Preview & Delivery -> Quality: actual exported result
Quality -> Control Plane: final gate
Control Plane -> Preview & Delivery: release delivery
```

### 11.3 对象级反馈

```text
Client -> Control Plane: feedback(target revision/object, intent)
Control Plane routes:
  design-direction change -> Design Intelligence
  artifact-local change   -> Artifact Production
  policy/fact correction  -> Context + Quality
result -> new revision -> render -> quality -> publish
```

反馈路由必须依据用户意图和当前阶段，不能把“整体不喜欢”强制转换成局部属性修改，也不能因局部错字重新生成完整方向。

### 11.4 模板驱动任务

```text
Template source -> Context: native structure + role + rights
Control Plane: effective constraint profile
Design Intelligence: interpret editable and creative space
Artifact Production: preserve required production structure
Quality: template adherence + normal quality checks
```

## 12. Revision 与反馈规则

- Candidate、Artifact、Render、Quality 和 Delivery 均引用明确 revision。
- “恢复旧版本”创建一个以旧版本为基础的新 revision，不抹除中间历史。
- 用户批准绑定到具体方向或 Artifact revision；内容变化超过其批准范围时需要重新确认。
- 局部反馈应绑定稳定对象引用；无法稳定定位时退化到页面、幻灯片、章节或整个 Artifact。
- Production 不得在未记录的情况下改变 Design Direction；必要的媒介适配必须形成可审阅差异。
- Quality findings 在目标 revision 变化后需要重新确认，不能自动沿用为事实。

## 13. 媒介级最低契约

### 13.1 Web

必须拥有可运行项目或等价的可交付源码、隔离的真实浏览器预览、代表性视口验证、对象到可修改来源的关系，以及源码或部署交付能力。

### 13.2 PPT

必须拥有幻灯片级结构、真实字体和画布渲染、可编辑/保真/混合交付模式、导出 PPTX 的重新渲染验证，以及模板或母版约束的显式处理。

### 13.3 DOCX

必须拥有章节与证据关系、原生模板语义的保留策略、分页预览、DOCX 与 PDF 结果验证，以及对正式模板中不可变区域的处理。

三种媒介的内部 IR、编辑器和 exporter 不在本规范中确定。

## 14. 人机协作与审批

系统应当主动完成低风险设计决策，只在以下情况打断用户：

- 缺失事实会显著改变内容；
- 资产权利、品牌或模板要求不清；
- 多个方向代表实质不同的产品选择；
- 交付需要在可编辑和保真之间取舍；
- 操作涉及公开发布、外部发送、删除、权限或显著成本；
- 质量与策略在高严重度问题上冲突。

审批必须显示所批准的对象、revision、动作、影响和任何已知降级。普通创作步骤不应要求用户逐步批准。

## 15. 非功能要求

### 15.1 可恢复性

任务在 Client 断开或执行进程重启后应能恢复。已完成阶段不重复运行，除非版本或策略要求重新计算。

### 15.2 安全与隔离

输入、生成代码和第三方工具均视为不可信。文件、网络、进程、凭据和外部副作用由真实隔离与策略控制，而不是依赖 prompt。

### 15.3 模型与工具可移植性

更换供应商不得要求迁移项目业务状态。每种能力的必要模态、限制和降级行为必须可测试。

### 15.4 来源与权利

事实、证据图片、参考风格和生成素材应能追踪来源和允许用途。未知权利的素材默认不能进入公开交付物。

### 15.5 可观测性

系统应记录项目阶段、模型与工具选择、时延、成本、重试、降级、审批和 Artifact 关系，同时默认避免记录敏感原文。

### 15.6 可访问与可理解

工作台和输出应支持基本无障碍要求。系统选择模板、降级交付或阻止操作时，必须向用户提供可理解原因。

### 15.7 可部署性

部署单元和依赖数量应受控，用户配置应集中可视化。逻辑组件允许同进程实现，只有权限、资源或伸缩需求要求时才拆分。

具体性能、成本和可用性数值在首个垂直场景确定后写入验收规范。

## 16. 系统级验收条件

本总体 Spec 被实现时，至少应能证明：

1. 用户可以创建项目、上传混合参考物并看到处理状态；
2. 系统能因实质问题暂停追问，并在刷新或重启后恢复；
3. Constraint Profile 能表达开放设计与严格模板的组合；
4. Design Intelligence 可以被 stub 或真实实现替换，而上层流程不变；
5. 一个候选可以被真实预览、批准并转成 Artifact revision；
6. Artifact Production 可以按统一端口接入任一媒介实现；
7. Quality 能分别返回审美发现与硬错误，并阻止错误交付；
8. 用户反馈能路由到方向修改、局部生产修改或事实修正；
9. 导出结果经过二次验证后才成为 Delivery Bundle；
10. 模型切换不改变项目真源，工具重试不重复执行外部副作用；
11. 版本恢复不会删除历史，审批能回溯到准确 revision；
12. 归档研究、正式架构、Spec 和 ADR 的优先级清楚。

## 17. 后续模块 Spec TODO

| 后续规范 | 必须解决 | 当前保留接口 |
|---|---|---|
| `design-intelligence-spec.md` | 创作 loop、模型 harness、候选策略、模板/设计系统使用、素材与生图、上下文管理 | Design Intelligence Port |
| `artifact-production-spec.md` | Web/PPT/DOCX 工作表示、对象标识、渲染、编辑、导出与重渲染 | Artifact Production Port |
| `quality-governance-spec.md` | 硬检查、视觉批评、门槛、修复、权利、安全、审批和策略 | Quality & Governance Port |

在上述规范完成前，可以使用 stub、人工步骤或最小实验实现接口，但不得把实验内部结构升级为全系统依赖。

运行时、存储、沙箱、模型网关和观测技术也需要后续 ADR。选择时必须服从本规范，而不是修改接口来迁就某个框架。
