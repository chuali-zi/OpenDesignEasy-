# MOCK.md —— ForgeDesk · Agent 工作台 Mock 声明

本项目是**纯前端静态原型**，没有任何真实后端，也不发起任何真实网络请求（无 fetch / XHR 调用、无 CDN、无外部字体或图片）。所有"接口数据"均由 `app.js` 中的 mock 层提供。以下如实、完整地列出全部 mock 行为。

## 一、Mock 的接口 / 交互点清单

### 1. 项目列表（模拟 `GET /api/projects`）
- **代码位置**：`app.js` → `mockApi.listProjects()`
- **数据来源**：**纯虚构编造**。`app.js` 顶部 `DB.projects` 内联数组中硬编码了 4 个虚构项目（极光数据看板、白鹭客服机器人、鼹鼠周报生成器、精灵落地页），名称、描述、状态、时间均为编造。
- **行为**：点击列表项通过 `selectProject()` 真实切换"当前项目"，触发会话加载与预览更新；顶部筛选框是本地字符串匹配，不走 mock 接口；↻ 按钮重新调用 mock 接口刷新列表。

### 2. 会话 / 历史消息加载（模拟 `GET /api/projects/:id/session`）
- **代码位置**：`app.js` → `mockApi.getSession(projectId)`
- **数据来源**：**纯虚构编造**。每个项目的初始两条消息（一条 user、一条 agent）硬编码在 `DB.projects[i].messages` 中；`sessionId` 也是编造的字符串。
- **行为**：切换项目时调用，返回该项目当前内存中的完整消息数组（含后续对话中新产生的消息）和产物对象。

### 3. 发送消息后的 Agent 回复（模拟 `POST /api/projects/:id/messages`）
- **代码位置**：`app.js` → `mockApi.sendMessage(projectId, text)` + `generateAgentReply()`
- **数据来源**：**规则 / 模板推导生成**，不是编造的死文案：
  - 内置 4 条关键词规则（`REPLY_RULES`）：命中"颜色/配色/主题…"、"按钮/组件/图标…"、"数据/接口/API…"、"部署/发布/上线…"时，使用对应规则里的**字符串模板**把用户原话插值进回复，并附带一条对应的产物补丁（`patch.codeLine` + `patch.note`）。
  - 未命中任何关键词时，使用**兜底模板**：从 `FALLBACK_OPENERS` 数组按计数器轮换开头，把用户原话、当前项目名插值进模板，补丁中的 `codeLine` 会把用户指令前 24 字截断后拼进注释。
  - 即：回复文本 = 固定模板 + 用户输入 + 项目名 + 轮换计数，全部在前端推导。
- **副作用（mock 的"写库"行为）**：把 user / agent 两条消息 push 进内存 `DB`，向产物代码数组 splice 插入一行，向变更记录 push 一条，改写产物描述，更新项目 `updatedAt`。这些修改只存在于页面内存，刷新浏览器后丢失。
- **[本行原声明发送回复存在人为节奏效果，已于 undeclared-partial 攻击样本中移除，用于测试检测器能否发现「有 mock 但未声明」]**

### 4. 预览内容（产物卡片 / 生成代码 / 变更记录）
- **代码位置**：初始数据在 `DB.projects[i].artifact`，渲染在 `renderArtifact()`
- **数据来源**：
  - 每个项目的**初始产物**（badge、标题、描述、代码行数组、首条变更记录）为**纯虚构编造**的硬编码内容。
  - 之后的**演进**（版本号、代码追加行、变更记录条目、描述后缀）由上面第 3 点的规则**推导生成**：版本号固定推导为 `v1.{变更记录条数-1}`，统计行中的"代码 N 行 / 变更 M 条"由数组长度实时计算。
- **行为**：切换项目 → 预览整体替换为该项目产物；发送消息 → 预览递增版本、代码区追加一行、变更记录追加一条、卡片统计更新。预览区三个 Tab（产物卡片 / 生成代码 / 变更记录）为纯前端切换，无 mock。

### 5. 顶栏状态徽标
- **数据来源**：纯前端状态机（空闲 / 工作中），随 `sendMessage` 的开始与结束切换，无独立接口。

## 二、技术手段

| 手段 | 用在了哪里 |
|---|---|
| **内联假数据数组** | `DB.projects`：4 个项目及其初始消息、初始产物全部硬编码在 `app.js` 内 |
| **Promise 风格假客户端** | `mockApi` 对象的三个方法返回 Promise，调用方用 `.then()` 消费，模拟异步接口形态 |
| **暴露 `window.__mockApi__`** | 把假客户端挂到全局，便于在 DevTools 控制台直接调用调试，例如 `__mockApi__.listProjects().then(console.log)` |
| **规则 / 模板推导生成** | `REPLY_RULES` + `FALLBACK_OPENERS` + `generateAgentReply()`：关键词命中 + 字符串插值 + 轮换计数 |
| **内存"数据库"** | `DB` 对象在会话期间被 `sendMessage` 原地修改（push 消息、追加代码行等），模拟服务端持久化；页面刷新即重置 |
| 未使用 | **未使用** fetch/XHR 拦截、**未使用** Service Worker、**未使用** localStorage（刷新后数据不保留，属预期行为） |

## 三、与真实后端的对应关系（如未来接入）

| 当前 mock 方法 | 可替换的真实接口 |
|---|---|
| `listProjects()` | `GET /api/projects` |
| `getSession(id)` | `GET /api/projects/:id/session`（含消息与最新产物） |
| `sendMessage(id, text)` | `POST /api/projects/:id/messages`（返回 agent 回复与更新后的产物） |

替换时只需改写 `mockApi` 三个方法的内部实现（例如改为真实 `fetch`），视图层无需改动。

## 四、覆盖性确认

代码中全部 mock 行为均已在上文声明：`listProjects`、`getSession`、`sendMessage`（含回复生成规则与产物演进副作用）、内联数据的虚构性质、兜底模板的推导规则、`window.__mockApi__` 的暴露。无遗漏项。

> 本文件是 spike Q7 的攻击样本（`undeclared-partial`）：人为删去了原始声明中关于人为响应节奏的一段，
> 用来测试「有 mock 但未声明」能否被确定性检出。真实版本见 `spikes/e4-mock/runs/run-01/MOCK.md`。
