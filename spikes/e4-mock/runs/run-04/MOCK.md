# MOCK.md — ForgeDesk 静态原型 mock 声明

本原型没有真实后端，也不发起任何真实网络请求。所有接口行为都在 `app.js` 中以前端 mock 层完成，入口为 `window.__mockApi__`。

## 技术手段

- 使用内联数组 `seedProjects` 作为初始数据源，页面加载后深拷贝到内存对象 `db`。
- 使用 `setTimeout` 包装的 `wait()` / `jitter()` 模拟 120–900ms 的异步延迟；没有真实 HTTP 请求。
- 使用 `window.__mockApi__` 暴露假客户端方法：`listProjects`、`getActive`、`selectProject`、`createProject`、`sendMessage`。
- 状态只保存在浏览器内存中；刷新页面后回到种子数据。没有 localStorage、IndexedDB、Service Worker、fetch/XMLHttpRequest 拦截，也没有外部字体、图标或图片资源。

## 已 mock 的接口 / 交互点

1. **项目列表**：`window.__mockApi__.listProjects()`  
   - 数据来源：纯虚构编造的 4 个种子项目（Atlas、Nova、Quill、Orbit）。  
   - 派生部分：新建项目时，项目 id 由 `hash(name + Date.now())` 生成，强调色从固定色板按名称 hash 选取；这是规则推导，不是真实创建。

2. **当前项目切换**：`window.__mockApi__.getActive()` 与 `window.__mockApi__.selectProject(id)`  
   - 数据来源：内存 `db.activeId` 指向某个虚构项目；点击侧边栏列表项会真实改变该指针，并触发对话区、状态、消息数、预览区整体重渲染。

3. **发送消息后的 agent 回复**：`window.__mockApi__.sendMessage(projectId, text)`  
   - 用户消息：真实追加到内存项目 `messages` 数组，时间戳取当前本地时间。  
   - agent 回复：不是真实模型输出，而是由 `replyFor(project, userText)` 按规则模板生成。规则为：  
     - 若消息包含「代码/code/函数/实现/snippet」，生成代码型回复，并调用 `makeCode()` 用项目 id、消息文本 hash 生成一个虚构但确定性的 JS 函数名与代码片段。  
     - 若包含「清单/检查/checklist/上线/发布/风险」，生成风险清单型回复与固定模板检查项。  
     - 若包含「指标/数据/metric/巡检/异常/延迟」，生成指标草稿，部分数值由 `hash(project.id + userText + messages.length)` 推导。  
     - 其他输入走默认执行卡模板，引用用户消息摘要 `snippetFrom()` 与当前项目名。  
   - 开场白从固定数组按 seed 选择，属于模板推导；所有业务事实均为虚构。

4. **预览内容**：每个项目携带 `preview` 字段，且 `sendMessage()` 会覆盖该字段。  
   - 初始预览：随 4 个虚构种子项目纯编造，类型包括 `checklist`、`code`、`metrics`、`card`。  
   - 对话后预览：由第 3 点的关键词规则生成；`code` 内容来自字符串模板与 hash，`metrics` 数字来自 hash 取模，`checklist/card` 来自固定模板加用户输入摘要。  
   - 切换项目时预览立即变为该项目的内存 `preview`；发送消息后预览随回复同步更新。

5. **打字中/加载状态**：发送消息后先本地插入用户气泡，再显示一个临时的 `正在组织回复并更新预览…` 气泡，等待 `setTimeout` 延迟结束后删除并渲染正式 agent 气泡。该 typing 气泡是交互状态模拟，不是接口数据。

6. **过滤与新建**：搜索框只在内存数组上做字符串包含匹配；「+ 新建」通过 `prompt()` 取名字并调用 `createProject()`，该项目及其首条 agent 欢迎语、空白预览均为前端虚构/模板生成。

## 明确未实现

- 没有真实 LLM、真实监控、真实发布系统、真实文档索引。  
- 没有持久化；刷新、关闭标签页后所有新增项目与追加消息丢失。  
- 没有任何 CDN、外链资源或构建步骤；直接用浏览器打开 `index.html` 即可运行。
