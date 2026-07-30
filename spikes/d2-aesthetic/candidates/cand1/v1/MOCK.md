# MOCK.md — OEYdesign · 远航台 VOYAGE HELM mock 声明

本原型**没有任何真实后端**。所有数据与交互均由 `app.js` 内的前端 mock 层驱动，
技术方式为：**内联假数据 + `window.__mockApi__` 模拟客户端 + `setTimeout` 模拟网络延迟**。
未拦截/覆盖 `fetch`（页面本身不发起任何真实网络请求），未引用任何外部资源。

## 1. mock 的接口/交互点（window.__mockApi__）

| 方法 | 模拟的真实能力 | 延迟 |
|---|---|---|
| `listProjects()` | 项目列表加载（顶部航线切换下拉） | 260ms |
| `getProject(id)` | 项目切换后拉取该项目全量状态（日志/候选/约束/质量/档案） | 260ms |
| `submitDirectionFeedback(id, aspect, message)` | 整体方向反馈（「改航线令」）：换叙事/语气/视觉 | 700ms |
| `submitPatchFeedback(id, target, message)` | 局部内容反馈（「修补令」）：定点微调 | 500ms |
| `approveCandidate(id, candId)` | 批准某候选方向 → 产出 Artifact → 触发质量复核 | 900ms |
| `deliver(id)` | 质量通过后导出交付；有硬错误时返回 `{error:"blocked"}` | 600ms |
| `createProject(spec)` | 船坞视图创建新 demo 项目并加入切换列表 | 650ms |

## 2. 数据来源声明

### 纯虚构编造（手写内联在 `app.js` 的 `DB.projects` 中）
- 三个 demo 项目（极光咖啡着陆页 / Atlas 报告 PPT / 潮汐乐队纪录片网页）的：名称、
  编号、状态、约束 preset、模板角色、revision 号、候选方向文案、调色板、文件树、
  活动日志条目、反馈与交付记录、patchTargets 列表。
- 其中 Atlas 项目的质量结论（2 条硬错误 + 2 条审美发现）和潮汐项目的（0 硬错误 + 1 条
  审美发现）也是手写假数据，仅用于展示「硬错误 / 审美发现双轨分离」的呈现方式。
- 三个 preset（开放探索/设计引导/规范生产）与四个 template role（参考样例/起始脚手架/
  设计系统/交付合同）的名称取自 product-client/ 的真实信息架构，非虚构。

### 由规则/模板推导生成（非手写）
- `synthesizeCandidate(p, aspect, n)`：用户提交整体方向反馈或新建项目时，按反馈维度
  （叙事/语气/视觉/初始）从 `MOODS` 模板表选取标题句式、描述句式、首屏文案模板，再从
  `PALETTES` 三色调色板数组按候选序号取模选色，拼合成一条新候选。生成描述中会显式
  标注「响应『换X』改航线令」。
- `synthesizeQuality(p)`：批准候选后模拟质量引擎。**规则：revision 号为 3 的倍数时
  硬错误数为 0（可直接交付），否则产生 1 条硬错误**，硬错误/审美建议文案分别从
  `HARD_POOL` / `SOFT_POOL` 文案池中按 revision 取模选取。两条轨道始终分开存放、分开渲染，
  从不合成分数。
- 新建项目的编号：`"VOY-" + 序号推导`；文件名由项目名去空格小写化推导。
- 所有新产生的日志条目时间戳取浏览器当前时间（`HH:MM`）。

## 3. mock 技术手段
- **内联对象字面量**：`DB` 为单一内存数据库，页面刷新即重置，无 localStorage。
- **Promise + setTimeout**：每个 `__mockApi__` 方法返回 Promise，用 `setTimeout`
  模拟 260–900ms 的异步延迟，交互上有"发令中……"等过渡态。
- **真实可见的响应**：反馈提交后向活动日志追加条目、向航次档案追加记录、整体反馈会
  递增 revision 并真的新增一张候选卡片；批准会真的切换状态戳并填充双轨质量结论；
  交付在有硬错误时会被驳回（toast 提示）。
