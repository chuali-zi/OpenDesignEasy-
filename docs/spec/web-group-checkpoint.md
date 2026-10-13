# R4 分组暂停恢复检查点

> 已接续：恢复后的失败定位、产品修复与完整通过结果见[原生组记录](web-groups.md)。下文保留保存检查点时的历史状态；远端检查点分支仍指向原提交。

2026-10-13 10:55 UTC。父线程报告执行环境断连并要求暂停新增功能、保存恢复点。此时 shell、typecheck 与 Git 远端读取实际可用；暂停开发，避免新容器重复实现或竞争推送。

稳定分支 `codex/r4-web-editor` / `6b8d1ce1b9ee7320bcf4f53763531509fd040471` 已正常推送。该提交的完整离线120/120、CLI build/tsc、Web build及修复后Chromium16/16通过。此前富文本提交为 `2a2135fe6fe0d24232dab5b1011bb2009c78a109`。本检查点的未完成分组代码不构成稳定提交通过的证据。

恢复分支 `codex/checkpoint-r4-groups-20261013-1055` 以稳定提交为基线，保留7个改动文件及本说明：WebNode原生组标识、组/解组/组缩放纯操作、Web编辑器手势与入口、复制依赖补齐、内核组样式的锁定后代保护、3个离线组检查与1个真实浏览器组场景。分组只覆盖连续兄弟的像素绝对定位；外部CSS、几何响应式覆盖/变换、锁定树等明确拒绝。新代码尚未完成、不可标记Web验收通过；R5 Doc仍未开始。

本检查点最新typecheck通过。离线组3/3曾通过；暂停时再跑组/选择定向检查保存独立日志。浏览器组检查连续两次失败：完成分组、拖动、比例缩放和撤销/重做后，在 `apps/web/e2e/web-groups.spec.ts:40` 的第二次缩放 `mouse.move` 达到30秒超时；取消手势、解组及源码往返部分尚未在该场景中运行到。不能把早期断言通过推断为整个新组能力通过。

继续时先复现定位该手势问题，不简单提高超时或删去检查。先确认恢复分支HEAD与依赖workspace解析到本checkout；仍按Web完成门槛推进，之后进入实际R5 Doc模块。模型维持K2.8/kimi-for-coding；本阶段新真实模型请求0。恢复不自动重放旧live请求，不创建代码ZIP，不改主分支/权限/CI/App设置，不force-push。

正常复现命令（Node24.21.0，预置Chromium）：

```sh
npm run typecheck
node --import tsx --test packages/editor/test/web-groups.test.ts packages/editor/test/web-selection.test.ts
npm run build:web
OEY_BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:web -- web-groups
```

本容器证据在 `/workspace/oey-cloud-evidence/r4-tree-actions/`、`/workspace/oey-cloud-evidence/r4-rich/` 及 `/workspace/oey-cloud-evidence/r4-group-checkpoint/`。本地证据路径不会随Git克隆迁移；仓库保存完整测试与本失败说明，可独立复现。原工作树 `/workspace/OpenDesignEasy-` 仍为干净的 `6f754fe9b1cee72da616a71c14ae1ddf6d3c9477`，不丢弃源任务已有成果。
