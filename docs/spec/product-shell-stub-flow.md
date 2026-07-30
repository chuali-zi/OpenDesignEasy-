# Phase 4：Product Shell 与 Stub 闭环

> 状态：v0.1，2026-07-24 采用。
> 上位规范：system-spec、implementation-plan、contract-skeleton、runtime-recovery、context-evidence-baseline。
> 范围：可恢复工作台、Project 投影、确定性 stub 操作、反馈、质量门、审批与交付演示。

## 1. 目标与边界

Phase 4 用现有 Project、Control Plane 和确定性 ports 证明完整产品心智模型。用户不接触
Agent、模型或工作流内部配置，也能从候选方向走到 Delivery Bundle。

本阶段不评价真实设计质量，不实现多人协作、账号、云部署、真实模型、真实导出器，
也不提前编写三个核心模块的内部 Spec。参考 Web shell 可以采用最小本地 HTTP adapter
和浏览器原生资产；这不是未来前端框架或部署技术的冻结决策。

## 2. 单一状态来源与恢复

- Project snapshot、revision、events 与 workflow query 是界面业务状态的唯一来源；
- 对话区是 Project activity 和可执行下一步的呈现，不建立第二套聊天数据库；
- 每个 mutation 都携带当前 Project revision 和独立 command id；过期操作显示冲突并刷新；
- 刷新页面或重开 SQLite application 后，相同 Project 投影恢复候选、审批、Artifact、
  Quality、反馈和 Delivery；
- Client 可以保留短暂的 hover、抽屉开关或候选预览焦点，但不得用 localStorage
  保存业务状态、审批或版本。

参考 HTTP 边界只暴露 UI 所需投影：

~~~text
GET  /api/projects                         -> Project summaries
POST /api/projects                         -> create deterministic demo Project
GET  /api/projects/{project_id}            -> recoverable workspace projection
GET  /api/projects/{project_id}/events     -> reconnectable activity stream
POST /api/projects/{project_id}/commands   -> revision-checked product action
GET  /api/health                           -> local shell readiness
~~~

API 不返回 SQLite row、Python pickle、供应商响应、原件正文或 adapter 私有 schema。

## 3. 工作台结构与视觉方向

界面采用“编辑部校样台”方向：暖纸色工作面、墨黑结构、信号橙状态标记和钴蓝批准动作，
用细密刻度、版本戳与校样批注体现可追踪生产，而不是通用聊天机器人或紫色渐变后台。

桌面工作台包含：

1. 左侧 Activity rail：项目状态、事件、系统说明、反馈入口和下一步动作；
2. 中央 Proof canvas：候选、Artifact、render、export 或已交付摘要的主预览；
3. 右侧 Project inspector：项目树、Constraint Profile、模板角色、审批、Quality 与版本；
4. 顶部 masthead：项目选择、revision、运行状态、Workspace/Settings 入口；
5. Settings：展示模型能力位置、模板角色、权限与导出配置位置，不暴露或伪造真实密钥。

窄屏将三栏折叠为“预览优先 + 可展开 rail/inspector”。所有交互可用键盘，焦点可见，
状态不只依赖颜色；动画遵守 `prefers-reduced-motion`。

> **2026-07-27 用户方向修正（影响 Phase 6，不改本阶段已验收记录）**
>
> 本节的三栏布局是 Phase 4 stub 阶段的验收形态。用户明确了目标形态是
> **类 Claude Design 的两栏：左侧「小」聊天栏 + 右侧「大」设计结果预览区**，
> 预览区应占据主要视觉面积，而不是与 rail/inspector 三分。
>
> 因此：
>
> - Phase 6 的工作台改造以两栏为目标，Project inspector 的内容退化为可展开面板或
>   预览区内的次级信息，不再占据独立主栏；
> - 候选生成（`design-intelligence-spec.md` §4.2 差异轴）在本场景下**不应**再默认产出三栏工作台；
> - 本节的三栏描述保留为 Phase 4 的历史验收依据，不再作为后续设计目标。
>
> 用户同时说明：当前阶段工作台「能看就行」，视觉细节由用户后续专门设计，
> 因此 Phase 6 不以美观度作为该项的验收门槛。

## 4. 产品动作与领域命令

| 产品动作 | 领域命令/结果 |
|---|---|
| 新建演示 | `CreateProject` + 已确认 stub Context/Brief 的 `PrepareProject` |
| 生成候选 | `GenerateCandidates`，产生 2–4 个完整候选与审美 findings |
| 批准方向 | `ApproveDirection`，冻结候选 revision |
| 整体换方向 | `SubmitFeedback(DIRECTION)`，进入 Design 路径并使旧批准失效 |
| 生产产物 | `ProduceArtifact`，产生可预览 Artifact revision |
| 局部修改 | `SubmitFeedback(ARTIFACT_LOCAL)`，只进入 Artifact 路径并创建新 revision |
| 事实/策略纠正 | `SubmitFeedback(FACT_OR_POLICY)`，进入 `NEEDS_INPUT` |
| 验证产物 | `ValidateArtifact`，分别展示 aesthetic findings 与 hard errors |
| 批准导出 | `ApproveExport`，只批准当前通过质量门的 Artifact revision |
| 交付 | `DeliverArtifact`，验证实际 export 后返回幂等 Delivery Bundle |

UI 根据 Project state 只开放合法动作；服务端仍以 Control Plane 为最终校验者。错误响应
保留 error category、可读消息和当前 revision，但不返回堆栈或存储细节。

## 5. Constraints、模板与质量呈现

三个 preset（开放探索、设计引导、规范生产）和四种模板角色（参考样例、起始脚手架、
设计系统、交付契约）直接来自 Project Constraint Profile。Inspector 显示每个约束的
值、强度和来源；模板角色必须在候选/质量投影中可见，而不是装饰性设置。

Quality 卡片分开呈现：

- aesthetic finding：建议与风险，不冒充硬门；
- hard error：阻断原因、target ref 与是否可修复；
- verdict：PASS、REPAIR 或 BLOCK；
- export approval：明确绑定 Artifact id + revision，实际 export 仍需再次验证。

## 6. Phase 4 验收

自动化与浏览器验收至少证明：

1. 新建演示后无需 Agent 配置即可完成候选、批准、生产、验证、导出批准与交付；
2. 三个 preset 和四种模板角色能出现在工作台并影响现有 stub/quality 行为；
3. 整体方向反馈和 Artifact 局部反馈进入不同 route、创建正确 revision 并失效正确审批；
4. aesthetic findings 与 hard errors 分开展示，硬错误不能被 Client 绕过；
5. approval 与实际 export revision 可见，Delivery Bundle 重试不重复发布；
6. 刷新及进程重启后，Project 投影与可执行下一步一致；
7. event cursor 能增量恢复 activity rail，过期 revision mutation 被拒绝；
8. Settings 展示能力、模板、权限和导出配置的产品位置，但没有秘密或供应商 payload；
9. 静态 shell 具备 landmark、label、键盘焦点、窄屏布局和 reduced-motion 支持；
10. Client 不保存独立业务状态，API/界面不泄漏原件正文、数据库结构或内部异常堆栈。

> 2026-07-24 验收记录：领域、HTTP、重启恢复、Client 静态契约与 48 项累计测试通过。
> 当前执行环境的浏览器安全策略拒绝 loopback URL，因此没有把实机点击、焦点和窄屏
> 运行效果标记为 browser PASS；该项保留为人工发布复核，不通过替代浏览器绕过策略。
