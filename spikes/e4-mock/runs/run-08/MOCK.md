# ForgeDesk · Mock 声明

本原型**没有任何真实后端**，所有数据与交互均由前端 mock 层驱动。本文件如实列出全部
mock 行为，与 `app.js` 中的实现一一对应，无遗漏。

## 一、技术手段总览

| 手段 | 用在哪里 |
|---|---|
| 内联数组假数据 | `SEED_PROJECTS`（4 个虚构项目及其种子对话）、`REPLY_TEMPLATES`（4 条回复模板）、`CONTEXT_HINTS`（5 个上下文词） |
| `setTimeout` 包装成 Promise 模拟网络延迟 | 所有 `mockApi` 方法都通过 `delay(min, max)` 随机延迟后返回 |
| 暴露假客户端 `window.__mockApi__` | 整个 mock 层挂载在全局，可在 DevTools 控制台直接调用验证 |
| 前端内存态读写 | 发送消息、新建项目、清空对话都直接读写 `SEED_PROJECTS` 数组，刷新页面即重置 |

没有使用 fetch/XHR 拦截，也没有使用 Service Worker。

## 二、Mock 的接口 / 交互点清单

以下 5 个"伪接口"模拟了 REST 风格的后端，定义在 `app.js` 的 `mockApi` 对象中：

1. **`mockApi.listProjects()`（模拟 `GET /api/projects`）**
   - 用途：启动时加载项目列表。
   - 数据来源：**纯虚构编造**。`SEED_PROJECTS` 里的 4 个项目（极光客服机器人 / Atlas
     报表生成器 / Quill 文案助手 / Sentinel 告警巡检）及各自的种子消息均为手写虚构，
     与任何真实数据无关。
   - 延迟：随机 200–500ms。

2. **`mockApi.getProject(id)`（模拟 `GET /api/projects/:id`）**
   - 用途：按 id 查询单个项目（当前主流程中作为备用查询手段保留，可从控制台调用）。
   - 数据来源：同上，虚构种子数据。
   - 延迟：随机 150–400ms。

3. **`mockApi.createProject(name)`（模拟 `POST /api/projects`）**
   - 用途：点击「+ 新建」创建项目。
   - 数据来源：**部分虚构 + 规则推导**。项目 id 由随机字符串生成
     （`"p-" + Math.random().toString(36).slice(2, 8)`），模型名从两个固定值中随机选，
     创建时间取当天日期，描述文案为固定模板，name 取用户输入。
   - 延迟：随机 250–500ms。

4. **`mockApi.sendMessage(projectId, text)`（模拟 `POST /api/projects/:id/messages`）**
   - 用途：发送用户消息并返回 agent 回复，是对话区的核心 mock。
   - 数据来源：**模板 + 规则推导**，不是预写死的固定回复。生成规则
     （`generateReply`）：从 4 条 `REPLY_TEMPLATES` 中随机抽一条，将其中的
     `{q}` 替换为用户输入（超过 24 字截断加省略号）、`{project}` 替换为当前项目名、
     `{ctx}` 替换为从 5 个上下文词中随机抽取的一个。因此同一句输入每次回复可能不同，
     不同项目的回复也不同。
   - 同时把 user/agent 两条消息追加进内存中的项目数据，并返回模拟的
     `latencyMs`（真实计时）与 `tokens`（按字符数 × 系数的推导值，非真实 token 计数）。
   - 延迟：随机 700–1800ms（期间界面显示"Agent 正在生成回复…"打字指示器）。

5. **`mockApi.getPreview(projectId)`（模拟 `GET /api/projects/:id/preview`）**
   - 用途：生成右侧预览区的全部内容（代码 / 摘要 / 动态 / 指标）。
   - 数据来源：**规则推导**，不是静态文本。推导规则（`generateCodePreview`）：
     - 代码草稿：按固定模板逐行拼接，内容随项目 id/名称/模型/标签变化，且
       `steps` 数组的条目数 = 当前对话轮次 + 1（上限 6 条），每条 task 取对应轮
       用户消息的前 16 个字——因此**发消息会让预览代码真实变化**；
     - 摘要文案：由项目 tag、创建日期、模型名、消息条数拼句生成；
     - 最近动态：取项目最后 6 条消息反转后截断 40 字；
     - 指标面板：消息总数与轮次来自内存数据实时统计，Token 为累计模拟值，
       响应耗时来自上一次 `sendMessage` 的真实计时。
   - 延迟：随机 120–300ms。

## 三、交互联动说明（均经过 mock 层真实驱动）

- **点击项目列表项** → `switchProject` 更新 `state.currentId`，重新渲染列表高亮、
  对话区（标题/模型徽标/消息气泡）、并调用 `getPreview` 刷新预览区三页签。
- **发送消息**（按钮或 Enter）→ `sendMessage` 写入内存数据并返回推导生成的 agent
  回复 → 对话区追加气泡、列表项的消息计数 +2、预览代码/摘要/指标全部更新。
- **新建项目 / 清空对话 / 搜索过滤 / 复制代码 / 页签切换**：均为前端本地行为，
  其中新建项目会走 `createProject` 伪接口，清空与过滤不走伪接口（属纯 UI 状态）。
- 刷新页面后一切回到初始种子状态——这是内存 mock 的预期行为，原型未做持久化。

## 四、锚点规范

结构容器使用 `data-oey-section`（`projects` / `chat` / `preview`），关键信息元素使用
`data-oey-object`（如 `projects.item.name`、`chat.message.bubble`、
`preview.codeContent` 等），动态渲染的列表项与消息气泡同样带有锚点，便于自动化
测试或 DOM 探测定位。
