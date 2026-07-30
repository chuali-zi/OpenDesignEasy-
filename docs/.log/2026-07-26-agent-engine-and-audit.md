# 2026-07-26 Agent 引擎补写与全文档一致性审计

用户指出 Spec 里找不到 agent 模块。核查属实，且比预期严重：第一轮三份 Spec 把
`architecture.md` 已冻结的能力写丢了——§11 的「创作负责人统筹」退化成单次模型调用，§12 的
「工作区工具」完全缺失，§14.1 的「既有仓库修改 / 项目源码是主要生产载体」被写成三个静态文件。
`implementation-plan.md` §6 的 `isolated-execution/` 与 `capability-boundary/` 两层始终无 Spec。

架构本身没错，`system-spec.md` §6.3 早已允许「模型探索发生在阶段内部」。第一轮没走进这扇门。

修正：新建 `agent-engine-spec.md`，确立「沙箱内最大自由，边界上严格纪律」——阶段内部给工作区、
工具、自验证闭环，不逐步监督；边界上只有经 port 的产出进项目真源，外部副作用需门。

三份 Spec 升 v0.2：Composer 改为 agent 会话；Web 产物改为可运行项目；**§4.3 从「事前只给模型
片段」改为「给整个工作区 + 事后验证无关锚点未变」**——同样的保证，更大的自由，这是这次 push
逼出的真实改进。Quality 新增 mock 保真声明与仓库事实一致性两类硬检查。

审计结论：`architecture.md`、`contract-skeleton.md`、`runtime-recovery.md`、
`product-shell-stub-flow.md` 四份**无冲突不改**。runtime-recovery 的 stage 粒度不动，改由
「workspace 持久 + turn history 持久 + stage 重入续跑」承担。

按冻结规则走版本化的三份：`system-spec.md` v0.2（§5 补 Agent Workspace/Session 概念身份）、
`context-evidence-baseline.md` v0.2（§4「不得读任意本地路径」改为「仅授权根内」，新增
CODE_REPOSITORY 与 file+line locator）、`implementation-plan.md` v0.2（Phase 5 由 3 份扩 4 份，
场景改为「本仓库 → agent 前端页」）。

未做：spike 与 ADR-0004。E1 沙箱与 D6 图像输入是两个最重的未验证假设。
