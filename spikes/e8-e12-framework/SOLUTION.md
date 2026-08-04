# Framework 基底失败根因与推荐解法

> 日期：2026-07-30。证据见 `results/e8-diagnostics.json`、`results/e11-diagnostics.json`、
> `results/e12.json` 与 `results/e12-attempts/`。

## 结论

不需要重构 AppContainer + Job Object 沙箱。首版采用一个受限、可证明的 profile：

```text
React + MUI source
      ↓
固定依赖镜像（只读）
      ↓
随机临时盘符根 + native esbuild.exe（零网络 AppContainer + Job Object）
      ↓
dist/ 哈希与契约检查
      ↓
受信任 host renderer 提供本地预览与截图
```

暂不在 AppContainer 内支持 Vite、npm、任意 Node 脚本或 dev server。长期等待/采用含 AppContainer
named-pipe 修复的 Node/libuv 或 Bun 后，再扩展通用 runtime profile。

## E8

### 根因

1. Node 主入口真实路径解析从盘符根开始；AppContainer 可读自己的包目录，但 `lstat C:\` 被拒。
2. 临时映射 `S:\` 后主入口、文件读取和 React package resolution 都成功，证明路径层可绕过。
3. Node `v25.6.1` 内置 libuv `1.51.0` 在 AppContainer 中创建管道时没有使用
   `\\.\pipe\LOCAL\...`，所以 `child_process` 的 pipe 永久挂起。
4. Vite/esbuild JS API 依赖管道型 esbuild service；因此即使关闭 Vite 的 esbuild transform，Vite
   导入/构建仍挂起。`stdio: inherit` 正常，进一步确认不是一般子进程权限。

该问题已有上游依据：libuv PR #5181 于 2026-07-13 合并，专门为 AppContainer 的 unique named pipe
加入 `LOCAL` 前缀；当前 Node 尚未包含该修复。Bun PR #33119 也修复了祖先解析和 AppContainer pipe，
但本机 Bun `1.3.12` 早于该变更。

### 短期方案

- launcher 从空闲盘符中随机选择一个，用 `DefineDosDevice`/`subst` 将 AppContainer package workspace
  映射为盘符根；esbuild 的 CWD、入口和输出全部使用该盘符。
- 依赖镜像显式固定 `esbuild` 与平台二进制版本；本次为 `0.25.12`。
- 直接启动 `esbuild.exe`，不经过 Node JS API，不创建 esbuild service pipe。
- HTML 入口由受信任 builder 从固定模板生成或验证；agent 不控制最终 script 路径。
- 创建 AppContainer 进程时同时通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 附加 Job Object，启用
  `KILL_ON_JOB_CLOSE`、时间与内存限制；禁止 breakaway。
- 构建后立即删除精确的 DOS mapping。映射不改变目标 ACL；使用随机盘符、互斥锁和精确 target 校验
  防止同用户会话中的名称碰撞。

### 已验证

- 两次沙箱构建成功：0.45 秒 / 0.22 秒；依赖镜像前后哈希不变。
- 两个输出树逐文件与整树 SHA-256 完全一致。
- 零网络边界不变；依赖镜像无写入。
- 构建后真实渲染无外链、无 console error，20 个复用组件锚点全部唯一存活。

### 限制

- 只承诺首版 React/MUI 单页应用；不承诺 Vite plugin、HMR、Vue SFC、SSR 或任意 codegen。
- 若产品必须支持通用 Node/Vite，优先等待包含 libuv #5181 的正式 Node；其次评估包含 Bun #33119
  的稳定 Bun。不要给 `C:\` 或用户目录增加宽泛 AppContainer ACL。

## E11

### 根因

MUI 会自动补 `light/dark/contrastText`、status、grey、action alpha；组件还会生成 hover、focus、
disabled 和 ripple 颜色。agent 也会在 `sx` 中直接写 hex/rgba。只数静止态颜色会漏掉交互态，且可能
出现“总数仍为 6，但其中一个是未登记默认灰”的假通过。

### 方案

- agent 只产出六个不透明角色 token，不直接写 `createTheme`。
- 引擎用受信任 strict theme factory 显式填满 palette、status、grey、action 和组件 override。
- 交互态在六个 token 间切换，使用边框宽度/几何变化表达状态；禁用颜色 transition 与 ripple，避免
  过渡帧产生额外 alpha 色。
- `theme.js` 作为生成后只读文件；AST lint 禁止 shell 组件出现 raw color、`alpha/lighten/darken`、
  `color-mix`。内层 artifact 在独立模块与 `data-oey-preview-root` 下拥有自己的 palette。
- Playwright 覆盖 rest、hover、focus、disabled、selected、open portal；检查 color/background/border/
  outline/SVG/shadow，并要求 `rendered shell colors == declared tokens`，不再只看数量。

受控 fixture 的交互态并集已通过：恰为六个声明 token，未归属颜色 0。

## E12

### 根因

修复 builder 后，构建为 0.15 秒、渲染为 2.90 秒，框架执行不再是瓶颈。今天的重试表现为：

- 两次非流式调用在大文件生成前 read timeout；
- 改工具调用为流式后，16k 单次上限被 564 秒推理耗尽；
- 提高到 40k 后成功生成候选，但方向调用耗时 767 秒、页面文件调用耗时 275 秒；会话总计
  1,082 秒，超过 900 秒。

最新候选会话外诊断构建/渲染成功，有 12 个唯一锚点、3,582 字内容、外链与 console error 均为 0。
因此 E12 当前是 provider/model 时延失败，不是 framework tool time 失败。

### 方案

1. 按真实架构拆预算：艺术方向由 Design Intelligence 上游产出并批准，framework implementation
   session 只消费方向，不再要求它重新写 `DIRECTION.json`。
2. strict theme 由引擎生成，减少模型源码量与犯错面；agent 主要写组件和内容。
3. 大工具参数继续使用流式组装，单次上限 40k；记录 reasoning、provider time、tool time。
4. 900 秒是硬 deadline，必须能取消正在进行的 HTTP 流，不能只在两个 agent step 之间检查。
5. provider timeout/overload 后从工作区和 turn history 续跑，预算不重置；不要重做已有文件。
6. 用至少 3 个“已批准方向 → 实现 → build → screenshot → revision”会话重测。若 Kimi 仍有长尾，
   framework coding capability 应绑定更快的非长推理模型，而不是放宽沙箱或构建预算。
