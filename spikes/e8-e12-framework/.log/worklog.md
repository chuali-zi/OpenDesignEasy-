# Work log

2026-07-30: Started E8-E12 framework baseline spike. Fixed React, Vite, and MUI versions; added a 20-instance anchor fixture and six-role shell theme. Raw measurements and conclusions will be generated after sandbox/build/agent runs.

2026-07-30: 完成 E8-E12。E8 因 Node 在 AppContainer 内 lstat C:\ 被拒而失败；E9/E10 通过；E11 受控 6 色但真实候选 10 色，记部分；E12 95,249 token，构建超时且未截图自验，失败。报告与原始 JSON、截图已保存。

2026-07-30: 将结果回填 `agent-engine-spec.md` v0.4：修正 Node bootstrap 结论，更新 E8-E12 状态与适用边界，新增主题 token 归属检查、完整截图闭环和 framework 解锁门禁；同步 spec README 版本。

2026-07-30: 根因追加实验完成。E8 用临时盘符 + native esbuild 在零网络 AppContainer 内双次确定构建并通过渲染；E11 strict theme 的交互态六色并集通过；E12 构建/渲染降至约3秒，但 Kimi 长推理使会话超900秒。方案与 spec v0.5 已更新。
