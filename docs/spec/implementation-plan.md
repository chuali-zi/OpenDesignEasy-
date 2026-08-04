# OEYdesign 架构实施计划

> 状态：**v0.2，已于 2026-08-03 审核通过并冻结。** v0.1 于 2026-07-24 冻结。
> 依据：`docs/architecture.md`、`docs/spec/system-spec.md`。
> 目标：确定总体架构如何分阶段落地，不在本计划中提前选择核心模块的内部技术栈。
> 冻结规则：阶段范围和退出条件的变更必须通过版本化 Spec 或 ADR；实施进度只更新状态，不改写已冻结要求。

## v0.2 变更说明

按上述冻结规则，Phase 5 的范围变更通过本次版本化处理。两项变更：

1. **Phase 5 交付物从 3 份 Spec 增加到 4 份**，新增 `agent-engine-spec.md`。
   理由：第一轮三份 Spec 把创作写成了单次模型调用，丢失了 `architecture.md` §11（Agent 职责
   模型）、§12（「更开放的创作空间和更直接的工作区工具」）、§14.1（「从既有仓库修改开始，
   项目源码是主要生产载体」）已要求的能力。同时本计划 §6 列出的 `isolated-execution/` 与
   `capability-boundary/` 两层始终没有对应 Spec。引擎必须单独成篇，因为 Design、Artifact 与
   Quality 修复三条路径都要驱动它。

2. **首个真实场景从「空白自然语言 → 产品官网」改为「本仓库 → agent 前端页」**。
   理由：前者不含仓库输入也基本用不上自造后端，恰好避开了产品最核心的两项能力，Phase 6 无法
   验证它们。后者使用本仓库作为输入，且 `product-client/` 中已有人手写的 Phase 4 工作台前端
   可作为对照基准。

配套的既有规范版本化：`system-spec.md` v0.2（§5 增加 Agent Workspace 与 Agent Session 概念身份）、
`context-evidence-baseline.md` v0.2（仓库只读接入与授权根路径规则）。

Phase 0–4 的范围、退出条件与验收记录不变。

## 1. 计划目标

本计划把总体 Spec 转化为一条可验证的建设路径。优先建立不会因模型、渲染器或输出媒介变化而推翻的系统骨架，再单独设计智能设计、Artifact 生产和质量治理内部实现。

计划需要避免两种风险：

- 先搭建庞大的通用 Agent 平台，却没有真实设计闭环；
- 先把某个模型、模板或导出器的内部格式扩散为全系统架构。

因此，前期产物以项目生命周期、接口契约、可恢复性、版本和最小端到端模拟为主，不以真实设计质量作为唯一进度指标。

## 2. 实施原则

1. **先稳定边界，再选择内部技术**：先让模块能替换，再优化模块本身。
2. **垂直验证优先**：每个阶段都必须产生可演示的用户路径，不只提交基础设施。
3. **真实项目状态优先**：不把聊天或模型消息当作临时数据库。
4. **风险边界前置**：项目隔离、审批、版本和副作用语义从骨架阶段存在。
5. **模块化单体优先**：逻辑边界先清楚，物理拆分由权限、运行依赖或伸缩需要推动。
6. **Stub 是正式工具**：三个待设计模块可以用确定性 stub 或人工适配器验证系统，不因缺少内部实现阻塞总体架构。
7. **一次只冻结一层决策**：总体接口通过后，再冻结模块内部架构；技术版本最后通过 ADR 固定。

## 3. 工作流划分

### 3.1 文档与决策治理

负责维护 PRD、架构、Spec、ADR、变更记录和归档优先级，确保研究结论不会未经审核变成规范。

### 3.2 Product Shell

负责左聊右预览、项目树、任务状态、对象反馈、版本、设置和导出入口。初期可以使用模拟预览，但交互必须围绕 Project，而不是单次对话。

### 3.3 Project Control Plane

负责 Project、revision、Constraint Profile、审批、命令和策略入口，是跨模块业务状态的中心。

### 3.4 Workflow Runtime Boundary

负责阶段化任务、暂停恢复、重试、取消、进度和副作用边界。初期先定义运行时接口和行为测试，再选择具体框架。

### 3.5 Context & Evidence

负责原件、来源、解析任务、事实与解释分离、资产权利、风格证据和 Context Package。先建设最小可验证路径，不一次覆盖所有格式。

### 3.6 Capability 与 Tool Boundary

负责模型、解析、图片、渲染和工具的能力描述、选择、审批与隔离接缝。初期只需要支持 stub 和少量实验 adapter。

### 3.7 三个核心模块端口

负责实现 `system-spec.md` 中的三个宏观端口和测试替身：

- Design Intelligence Port；
- Artifact Production Port；
- Quality & Governance Port。

此工作流当前不负责决定模块内部算法或技术。

### 3.8 集成、测试与可观测

负责端到端测试、状态恢复、revision 追踪、失败注入、审计和演示环境，确保模块集成行为符合 Spec。

## 4. 总体依赖关系

```text
Adopted Architecture + System Spec
                 │
                 ▼
Project Core + Workflow Contract + Revision Semantics
        │                │
        │                └──────── Capability / Tool Boundary
        ▼
Context & Evidence Baseline
        │
        ▼
Three Module Ports + Deterministic Stubs
        │
        ▼
Product Shell End-to-End Skeleton
        │
        ▼
Internal Module Specs + Technology ADRs
        │
        ▼
First Real Vertical Design Slice
        │
        ▼
Quality Hardening + Additional Media
```

Product Shell 可以与 Project Core 并行开始，但在 Project lifecycle 确定前不能建立独立的聊天状态模型。Context 与三个端口可以并行设计；真实模块实现必须等待其内部 Spec 和关键 ADR。

## 5. 阶段计划

## Phase 0：架构基线与文档治理

状态：已完成。

交付物：

- 正式采用的总体架构；
- 系统总体 Spec；
- 本实施计划；
- ADR 与 Spec 索引；
- 历史研究归档。

退出条件：

- 正式文档和归档优先级无歧义；
- 三个待细化模块的边界和 TODO 被明确记录；
- 所有现有文档链接有效；
- 本 Spec 获得审核。

## Phase 1：契约骨架

状态：已完成（2026-07-24）。

目标：在不选内部技术栈的情况下，固定系统最小语言和模块接缝。

交付物：

- Project lifecycle 和状态迁移定义；
- revision、approval、feedback 和 delivery 的语义；
- workflow start/resume/cancel/query 的抽象边界；
- 三个核心模块端口的代码中立契约；
- 命令、事件和错误类别规范；
- 一套内存或文件级的确定性 stub。

退出条件：

- 可以用 stub 完成“创建项目 → 候选 → 批准 → Artifact → QA → 交付”的模拟流程；
- 重试不会制造重复交付；
- 模块替换不会要求 Client 改变项目流程；
- 没有供应商消息格式进入核心契约。

本阶段不决定：真实模型、真实渲染器、数据库、工作流框架和三个模块内部结构。

## Phase 2：Project 与可恢复工作流基础

状态：已完成（2026-07-24）。

目标：建立可靠的产品状态和长任务控制。

交付物：

- Project、Artifact 和 Workflow 的持久生命周期；
- 创建、查询、暂停、恢复、取消和版本恢复路径；
- 审批与外部副作用门；
- Client 可重新连接的任务事件；
- 模拟失败、超时和重试的测试工具；
- 基础审计和运行观测。

退出条件：

- 刷新 Client 或重启执行进程后任务可恢复；
- 已完成阶段和外部副作用不会无条件重复；
- 状态迁移能拒绝过期 revision 的命令；
- `NEEDS_INPUT`、`BLOCKED`、`FAILED` 和 `CANCELED` 行为可演示。

此阶段需要形成运行时与持久化候选 ADR，但可以先做小型验证，不立即接受最终技术。

## Phase 3：Context & Evidence 最小基线

状态：已完成（2026-07-24）。

目标：让系统从真实输入建立可追踪上下文，而不是直接把附件塞给模型。

交付物：

- 原件接入、项目归属和安全初检；
- 至少一种结构化文件和一种图片输入的解析 adapter；
- 原生观察、模型解释和人工确认的分离；
- 来源定位和资产权利最小能力；
- Design Brief 与 Constraint Profile 的生成/确认路径；
- Context Package 接口。

退出条件：

- 用户能从一条事实或图片回到原始来源；
- 低置信度或权利不明内容不会被当作已确认素材；
- 系统只为实质不确定性进入 `NEEDS_INPUT`；
- 更换解析 adapter 不影响下游端口。

本阶段不追求一次支持全部 PDF、PPTX、DOCX 和仓库语义。

## Phase 4：Stub 驱动的产品闭环

状态：已完成（2026-07-24；代码与自动化门通过，实机浏览器复核受当前 loopback 策略限制）。

目标：在真实设计模块完成前验证整个产品交互和控制流。

交付物：

- 左侧对话、右侧预览和项目树骨架；
- 候选选择、方向批准和 Constraint Profile 查看；
- 确定性 Design stub 产生多个完整候选；
- Artifact stub 产生可渲染占位产物和版本；
- Quality stub 分别返回审美建议与硬错误；
- 对象级反馈、修复、导出审批和 Delivery Bundle 演示；
- 设置页面展示模型、模板、权限和导出配置的产品位置。

退出条件：

- 一位用户可以不接触内部 Agent 配置完成完整模拟任务；
- “整体换方向”和“局部修改”进入不同处理路径；
- 开放、引导和规范生产可以在同一工作台演示；
- 模板四种角色能够影响流程和 Quality 行为；
- 所有界面状态可从 Project 恢复。

Phase 4 的目的不是评估设计美观，而是证明总体架构和产品心智模型成立。

## Phase 5：核心模块内部 Spec 与 Agent 引擎

状态：**已完成并冻结。** 四份 Spec、关键 spike 与 ADR-0002～0005 均已接受。

目标：在系统接缝已验证后，完成内部架构和技术选型。

产生（v0.2 由 3 份扩为 4 份）：

1. `agent-engine-spec.md`（v0.2 新增，是另外三份的基础）；
2. `design-intelligence-spec.md`；
3. `artifact-production-spec.md`；
4. `quality-governance-spec.md`。

`agent-engine-spec.md` 承接本计划 §6 中 `isolated-execution/` 与 `capability-boundary/` 两层，
定义工作区、工具目录、agent 循环、自验证闭环、session 续跑、沙箱分级与预算。前三份模块 Spec
共用它，不各自重复定义。

每份 Spec 至少需要：

- 内部职责与子模块；
- 输入、输出和 revision 语义；
- 模型、工具或确定性算法的分工；
- 模板、设计系统和 Constraint Profile 的使用方式；
- 失败、重试、降级和观测；
- 候选技术与选择理由；
- 与总体端口的 conformance 测试；
- 不进入首个垂直切片的能力。

退出条件：

- 四份 Spec 分别审核通过；
- 首个垂直媒介和真实用户场景已经选择；
- 关键技术通过 spike，而不是只根据文档决定；
- 相关 ADR 已接受；
- 总体端口无需为某项内部技术破坏性改动。

进展记录（更新至 2026-08-03）：

| 退出条件 | 当前状态 |
|---|---|
| 四份 Spec 分别审核通过 | **已通过并冻结**：engine v0.6、Design v0.4、Artifact v0.4、Quality v0.3 |
| 首个垂直媒介与真实场景已选择 | 已选：Web + 「本仓库 → agent 前端页（含自造 mock 后端）」 |
| 关键技术通过 spike | **已执行并回填规范**；agent engine E1–E13 已终结，其中 E12 为已知风险接受 |
| 相关 ADR 已接受 | **已完成**：ADR-0002/0003/0004/0005 于 2026-08-03 接受；`framework` 仅启用受限 P6 profile |
| 总体端口无需破坏性改动 | 已确认：`ports.py` 三个 Protocol 签名不变，domain 只新增可选字段 |

其他已作出的内部选择：

- 候选表示为「agent 直出可运行 Web 项目 + 批准时机械抽取 design contract」；
- 创作与局部修改由 agent 会话完成，作用域约束采用**事后验证**而非事前限制；
- 模型编排为自建 vendor-neutral capability harness，首批绑定 Kimi（设计推理与代码理解）与
  Seedream（生图）；`design.critique` 需要图像输入能力，为本场景阻塞项；
- 仓库**只读**接入；写用户仓库本轮不实现。真实后端安全方案已由 E5 冻结为用户批准后通过
  trusted loopback broker 驱动 zero-capability AppContainer 后端，产品功能仍待实现。

Phase 5 至此关闭；后续变更遵循各冻结 Spec 与 ADR 的替换条件。

## Phase 6：首个真实垂直切片

状态：**已于 2026-08-03 启动；P6.0/P6.1 完成，P6.2 workspace/session/action loop 边界、P6.3
capability registry/broker 与 P6.4 framework artifact/renderer/builder 契约已完成，P6.5 已有
确定性 hard-check 与 delivery gate 边界。** 真实 agent、
框架前端和端到端证据尚未完成，不得据此宣称 P6 退出条件通过。接力计划见 `docs/phase6/README.md`。

目标：使用真实模块替换 stub，验证设计质量与交付可靠性。

范围在 Phase 5 决定，但必须完整覆盖：

- 真实参考物接入；
- Brief 与 Constraint Profile；
- 至少一个可评审设计候选；
- 真实渲染和用户反馈；
- Artifact revision；
- 审美与硬检查；
- 最终导出物重新验证；
- 失败恢复、成本和时延记录。

退出条件：

- 真实用户可以交付一个可使用产物；
- 设计问题、内容问题、生产问题和导出问题能够分别定位；
- 模型或内部 adapter 更换不改变项目生命周期；
- 质量和人工修改数据足以决定下一阶段。

## Phase 7：质量硬化与媒介扩展

目标：把第一个闭环变成稳定能力，并逐步接入其他媒介。

工作包括：

- 扩大真实回归集；
- 完善权限、权利、隔离和审计；
- 校准视觉批评和修复策略；
- 增加模板与设计系统管理；
- 接入第二、第三种 Artifact Production 实现；
- 形成组织级配置、部署和运维能力。

每增加一种媒介都必须通过相同总体端口，不得复制一套独立项目和聊天架构。

## 6. 逻辑代码布局建议

在具体语言和框架确定前，代码至少保持以下逻辑边界：

```text
product-client/          用户工作台
project-core/            Project、revision、approval、constraints
workflow-boundary/       可恢复任务抽象
context-evidence/        输入、来源和 Context Package
capability-boundary/     模型与工具能力选择
design-port/             Design Intelligence 接口与 stub
artifact-port/           Artifact Production 接口与 stub
quality-port/            Quality & Governance 接口与 stub
preview-delivery/        预览、导出和交付
isolated-execution/      不可信任务运行边界
adapters/                供应商和具体技术 adapter
conformance-tests/       跨实现契约测试
```

这些名称不是最终仓库目录要求。重要的是依赖方向：产品和核心领域依赖端口，不直接依赖供应商 adapter；adapter 实现端口，而不是反向拥有项目状态。

## 7. 测试计划

### 7.1 Contract Tests

为三个核心端口、workflow boundary、capability boundary 和 delivery 建立共同测试，确保 stub 与真实实现行为一致。

### 7.2 State Transition Tests

覆盖合法和非法迁移、过期 revision、重复命令、取消、恢复、审批失效和交付后修改。

### 7.3 Failure Injection

在解析、模型、渲染、质量、导出和外部发布阶段强制失败，验证恢复和副作用行为。

### 7.4 Golden Project Tests

保存少量权利清晰的项目输入、约束、候选、渲染和交付预期。早期用于结构回归，真实模块接入后再增加视觉和用户偏好评价。

### 7.5 Security Boundary Tests

覆盖越界路径、恶意附件、生成代码网络访问、凭据隔离、未审批发布和不可信工具输出。

## 8. 决策门

| 决策门 | 需要确认 | 当前状态 |
|---|---|---|
| G0 架构采用 | 总体原则与分层 | 已完成 |
| G1 系统 Spec | 组件、状态、接口、控制流 | 已完成 |
| G2 Contract Skeleton | 接口可被 stub 验证 | 已完成 |
| G3 Runtime Foundation | 工作流、状态、存储与隔离方向 | 已完成（ADR-0001） |
| G4 Module Specs | 三个模块内部架构 + Agent 引擎 | **已完成**：四份 Spec 冻结，ADR-0002～0005 已接受 |
| G5 Vertical Slice | 首个媒介、场景和质量门 | **进行中**：P6 已启动；Web / 本仓库 → agent 前端页；P6.0 骨架已完成 |
| G6 Expansion | 第二媒介和产品化范围 | 待真实数据 |

任何决策门未通过时，可以继续做不依赖该决策的实验，但不能把实验选择固化为跨模块契约。

## 9. 主要风险与控制

| 风险 | 控制方式 |
|---|---|
| 总体端口过早承载内部细节 | 只规定语义输入输出，不规定字段和传输 |
| stub 与真实模块差距过大 | 使用同一 conformance tests，并在真实 spike 后修订 Spec |
| 创作到生产交接丢失设计意图 | Approved Design Direction 和基准渲染共同进入生产 |
| 模板能力被弱化或过度锁定 | 显式四种模板角色和多维 Constraint Profile |
| workflow 框架污染领域模型 | runtime boundary 和应用自有项目状态 |
| 三种媒介各自复制产品逻辑 | 共享 Project、workflow、feedback 和 quality gate |
| 质量层接管审美 | 审美发现与硬门分离，用户选择和创作责任保留 |
| 为“模型兼容”使用最低公分母 | capability-specific harness 和契约测试 |
| 过早微服务化 | 逻辑边界优先，物理拆分由真实需求推动 |

## 10. 当前下一步

Phase 4 已通过可恢复 Project 投影、三栏 Product Shell、三类反馈、三种 preset、
四种模板角色、Quality hard gate、实际 export 复验、幂等 Delivery、HTTP 安全边界
和静态工作台契约验收。P1–P4 范围至此完成。

Phase 5、三份配套 v0.2 与 ADR-0002～0005 已冻结，P6 已获准启动。当前按
`docs/phase6/README.md` 只完成 P6.0：

1. 建立可注入真实 adapter 的 composition root，保持 P1～P4 确定性实现兼容；
2. 固定首片 profile 与 capability version 槽位；缺少真实实现时 readiness 必须失败；
3. 为 Luna 留出 P6.1～P6.6 的逐段交付、测试与退出条件；
4. 在所有真实槽位和端到端证据齐备前，G5 保持进行中，不宣称 P6 完成。
