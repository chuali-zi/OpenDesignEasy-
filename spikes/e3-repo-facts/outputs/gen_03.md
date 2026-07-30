OEYdesign 是一个面向最终用户的「契约优先」设计工作流参考实现，其定位在 pyproject.toml 中被描述为 "Contract-first reference implementation for OEYdesign"[F0541]，当前版本为 0.1.0[F0540]，要求 Python 3.11 及以上环境运行[F0538]。

它的核心是一个项目控制平面：control.py 模块中的 ControlPlane 类承担「项目业务状态的唯一写入者」角色，提供 35 个方法覆盖创建项目、生成候选方案、审批方向、产出制品、校验、导出审批与交付等完整流程[F0107][F0143]。所有命令都以领域语言建模，domain.py 定义了从 CreateProject、GenerateCandidates 到 DeliverArtifact、RestoreProjectRevision 等一系列命令与领域对象[F0144][F0179][F0181][F0187][F0192]，保证每一方可替换适配器共享同一套厂商中立词汇。

架构上，系统通过 ports.py 中的一组 Protocol 端口（如 ProjectRepository、WorkflowRuntimePort、DesignIntelligencePort、DeliveryPort 等）与外部能力解耦[F0294][F0299][F0349][F0354][F0367]，并同时提供内存参考适配器[F0230]与 SQLite 持久化适配器[F0256][F0271]，运行时可由 composition.py 中的 SQLiteApplication 组合根装配[F0065][F0070]。工作流执行由 SQLite 支撑的 runtime 承担，支持断点、恢复与确定性故障注入[F0397][F0426]；上下文与证据层则提供 CSV、PNG 解析器与人工确认机制[F0071][F0082][F0084][F0089]。此外还附带一个零依赖的 HTTP 产品外壳[F0368]，以及 lab30min 目录下的动手实验脚本[F0063]。

整个项目零运行时第三方依赖[F0536]，仅构建期需要 setuptools>=68[F0537]；质量由 tests/ 下 8 个测试文件共 42 个测试函数保障，覆盖四个阶段的契约、持久化、运行时与产品外壳[F0535]。