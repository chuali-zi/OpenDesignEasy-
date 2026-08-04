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
- [ADR-0002：Web 渲染与验证技术](./0002-web-rendering-validation.md) —— Playwright + 系统
  Chrome、零外链、computed-style 验证、导出物重渲染与 `0.002` 局部修改阈值。
- [ADR-0003：能力平面与首批 provider 绑定](./0003-capability-provider-bindings.md) —— 保持端口
  vendor-neutral，首批 Kimi capability adapter；生图在首个 P6 场景中可选且默认关闭。
- [ADR-0004：Agent 工作区与沙箱边界](./0004-agent-workspace-sandbox.md) —— Windows
  AppContainer + Job Object + allowlist env，网络与真实后端仅经 trusted broker。
- [ADR-0005：框架应用基底](./0005-framework-application-base.md) —— 接受受限 P6 profile：
  React/MUI/Emotion + native esbuild，源码与验证后的 `dist/` 一并交付。

ADR-0002～0005 已于 2026-08-03 接受。它们把 Phase 5 冻结能力落实为 P6 技术边界；其中
ADR-0005 仅在 `framework` profile 范围内扩展 Design v0.4 与 Artifact v0.4，不授权任意
React/Vue/Vite/npm 工具链。E12 的 provider 超时风险已被显式接受，但超时仍必须如实失败。
