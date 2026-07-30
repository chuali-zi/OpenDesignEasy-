# E6 工作区 + turn history 续跑 spike 工作日志

## 2026-07-26

- 读完 spikes/README.md、agent-engine-spec.md §3/§7、runtime-recovery.md §4。
- 按约束只实现 read_file/write_file/list_files 三个工具（tools.py），路径经
  os.path.realpath 校验，逃逸即 SandboxViolation，不真实执行 shell。
- session.py：AgentSession 持久化 turn history（turns.json）、预算账本
  （budget.json，累计不重置）、工具调用日志（tool_log.json，仅记 step/tool/
  path/ok，不记正文，遵守 runtime-recovery.md §8 allowlist）。crash 模拟 =
  在第 N 步后停止循环；resume = AgentSession.load() 纯读盘重建，无内存共享。
- 冒烟测试：单会话在 step2 处中断，resume 后从 step3 直接续做 styles.css/
  script.js，未重做 index.html，预算从 steps=2 累积到 steps=8（非重置）。
  初步证据支持 §7 设计。
- experiment.py：calibration 跑一次得基线步数 T0，取 25/50/75% 为中断点，
  每点 3 次重复（共 9 组）。每组：precrash（真实中断）→ Path A resume（拷贝
  工作区 + load 续跑）→ Path B rerun（清空重跑）。检测续跑后是否对已完成
  路径重复 write_file。
- 下一步：跑满 9 组，写 RESULT.md。
