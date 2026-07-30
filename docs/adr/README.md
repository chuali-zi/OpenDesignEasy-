# Architecture Decision Records

本目录记录会改变系统边界、长期依赖或跨模块契约的重要决策。

需要 ADR 的典型事项包括：

- 运行时、工作流、数据和隔离方案；
- 智能设计、Artifact 生产、质量治理三大模块的内部架构；
- Web、PPT、DOCX 的规范表示和导出策略；
- 会造成长期锁定的模型、协议或基础设施选择；
- 对已采用架构原则的修改。

每份 ADR 至少说明状态、上下文、决策、备选方案、影响和替换条件。尚未接受的 ADR 不具有规范效力。

## 已接受

- [ADR-0001：Phase 2 runtime 与持久化基础](./0001-runtime-persistence-foundation.md)

## 预告（未撰写，不具规范效力）

Phase 5 的四份 Spec 依赖以下三项决策。在对应 spike 完成并接受 ADR 之前，相关技术栈不视为
已冻结：

- **ADR-0002：Web 渲染与验证技术** —— headless 浏览器选择、导出物重渲染的一致性阈值、含 JS 与
  mock 层产物的交互检查方式、隔离预览方案。依据 `artifact-production-spec.md` §11 的 A1–A7。
- **ADR-0003：能力平面与首批 provider 绑定** —— capability slot 定义、Kimi 与 Seedream 的 adapter
  边界、`design.critique` 的图像输入能力归属、生成素材的权利结论、agent 会话的测试确定性方案。
  依据 `design-intelligence-spec.md` §11 的 D1–D7。
- **ADR-0004：Agent 工作区与沙箱边界** —— 沙箱技术选择、工具协议、agent 框架选择、
  session 持久化与续跑机制、预算与网络放行策略。依据 `agent-engine-spec.md` §15 的 E1–E7。

  **spike 已给出明确方向**（`spikes/e1-sandbox/ADDENDUM-appcontainer.md`）：
  **首选 Windows 原生 AppContainer + Job Object 组合**，WSL2/Docker 降为备选。
  实测该组合覆盖全部六个隔离维度、无需管理员权限：AppContainer 负责文件与网络
  （含裸 IP 均被 OS 拒绝），Job Object 负责进程树回收/内存/超时，白名单 env 负责凭据。
  这也是 Chromium 自身在 Windows 上的沙箱做法。

  ADR 撰写前**必须**补测两项：把真实 Node 运行时装进 AppContainer 包目录跑通；
  直接 Win32 API 层面（不经 `cmd.exe`）的逃逸尝试。

E1 与 D6 是最重的两项：前者决定 agent 能否安全地跑命令，后者决定自验证闭环能否成立。
**两项现均已通过**——E1 在换用 AppContainer 后由「部分证伪」转为通过，D6 直接通过。
