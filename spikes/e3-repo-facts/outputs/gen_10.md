OEYdesign 是一个「契约优先」（contract-first）的参考实现项目，旨在用清晰、可替换、可恢复的架构，演示一条从设计简报到成品交付的完整设计生产工作流 [F0064][F0541]。

它的核心是一套与厂商无关的领域语言：从 `ProjectState`、`WorkflowStatus` 等状态枚举，到 `DesignBrief`、`ContextPackage`、`EvidenceRecord`、`Candidate`、`ArtifactRevision`、`QualityDecision`、`DeliveryBundle` 等冻结数据类，把设计项目从创建、准备、生成候选、审批方向、产出工件、校验、批准导出到交付的每一步都建模为显式的命令与事件 [F0144][F0169][F0193]。所有业务状态由唯一的写入者——项目控制平面 `ControlPlane` 统一驱动，它提供 35 个方法来处理命令分发、工作流恢复与审计 [F0107][F0143]。

架构上采用端口与适配器模式：`ports.py` 定义了 `DesignIntelligencePort`、`ArtifactProductionPort`、`QualityGovernancePort`、`DeliveryPort` 等可替换的协议接口 [F0294][F0354][F0364]，同时提供确定性的无副作用桩实现 [F0439]、内存参考适配器 [F0230] 以及 SQLite 持久化与工作流运行时，后者还支持确定性故障注入与断点恢复 [F0256][F0397]。证据与上下文管理覆盖 CSV、PNG 解析、人工确认和上下文组装 [F0071][F0082][F0084][F0103]，并附带一个零依赖的 HTTP 产品外壳 `product_shell.py`，可直接启动本地演示服务 [F0368][F0388]。

整个项目运行时依赖为零，仅要求 Python 3.11 及以上 [F0536][F0538]；质量由 tests/ 目录下 8 个测试文件、共 42 个测试函数保障 [F0535]，另附 30 分钟动手实验脚本帮助快速上手 [F0063][F0463]。如果你希望学习如何构建契约清晰、可测试、可恢复的系统，这是一个绝佳的范本。