# E8-E12 Spike 报告：框架应用基底

> **冻结后裁决（2026-08-03）：** 下文保留 2026-07-30 的原始失败结论，不改写实验事实。E12 的
> provider 超时风险现已直接接受并冻结，不再要求重测、不再阻塞 agent engine spec；超时仍必须如实
> 失败。`framework` 是否启用改由 ADR-0005 决定。E13 已以 trusted fetch broker profile 通过，见
> `../e13-gated-install/RESULT.md`。

> 日期：2026-07-30
> 环境：Windows 11、Node `v25.6.1`、npm `11.9.0`、React `19.1.1`、Vite `7.1.3`、MUI `7.3.1`
> 原始数据：`results/e8-e11.json`、`results/e8-diagnostics.json`、`results/e11-diagnostics.json`、`results/e12.json`
> 截图：`results/fixture.png`、`results/e12-final.png`
> 复现：`python experiment.py`、`python e8_diagnostics.py`、`python e11_diagnostics.py`；E12 会产生模型费用，单独运行 `python e12_agent.py`
> 解决方案：`SOLUTION.md`。后续诊断结论覆盖首轮 Node/Vite 候选，但保留首轮数据供追溯。

## 1. 结论

| # | 假设 | 结论 | 关键数据 |
|---|---|---|---|
| E8 | 预置依赖镜像能在零网络沙箱内完成构建 | **通过（React/MUI + 固定 esbuild profile）** | 临时盘符根 + 原生 esbuild，两次沙箱构建 0.45s / 0.22s；Node/Vite profile 仍不支持 |
| E9 | 构建是确定性的 | **通过（沙箱内固定 builder）** | 两次沙箱构建相对路径、文件 SHA-256、整树 SHA-256 全部一致 |
| E10 | `data-oey-*` 穿过组件抽象与构建存活 | **通过** | 复用组件 20 实例得到 20 个唯一锚点；缺失 0、重复 0 |
| E11 | 组件库路线的 token 纪律不劣于既有基底 | **通过（受控 theme factory）** | rest/hover/focus/disabled 并集恰为声明的 6 色；自由生成主题仍不保证通过 |
| E12 | 框架候选的完整创作在预算内完成 | **不通过（provider/model bound）** | 固定构建 0.15s、渲染 2.90s；Kimi 单次方向推理 767s，完整会话 1,082s |

**当时判定（2026-07-30）：ADR-0005 仍不应接受，`framework` 基底不得进入产品。** E8–E11 在
受限实现 profile 下已有可行解，当时剩余门禁是 E12 的 provider/model 时长与真正的截图自验闭环。
当前裁决以上方“冻结后裁决”为准。

## 2. 实验方法

### 2.1 固定依赖镜像与 fixture

- `package-lock.json` 固定 React、Vite、MUI、Emotion 的确切版本；安装发生在沙箱外。
- fixture 使用 MUI 主题和一个被复用 20 次的 `ObjectCard` 组件；每次实例化通过 prop 获得
  `card-01` 至 `card-20`，不在组件内部生成不稳定 ID。
- 依赖镜像共 7,505 个文件。复制到 AppContainer 包目录后最长路径 200 字符，未触发 Windows
  路径长度问题。
- 构建期间比较 `node_modules` 的逐文件哈希与 lockfile 哈希，确认没有写入依赖镜像。

### 2.2 沙箱口径

- 使用零 capability AppContainer，工作区位于其包目录
  `%LOCALAPPDATA%\Packages\OEYdesignFrameworkSpike\AC\Temp\fw\w`。
- `node.exe` 复制进包目录后运行；不引用宿主 Node 安装目录。
- 用 `curl http://1.1.1.1` 做裸 IP 网络探针，不依赖 DNS 或代理变量。
- 首次保留符号链接的诊断启动导致 Node 忙循环；发现后终止唯一的实验进程，并在 harness 中加入
  超时时按 PID 回收整棵进程树。正式原始数据使用可在 30 秒内终止的绝对入口探针。

### 2.3 DOM 与 token 口径

- 构建后用 Playwright + 系统 Chrome 真实渲染；除本地临时 HTTP 服务外的请求全部阻断。
- 锚点从渲染后 DOM 抽取，不从 JSX 源码做正则匹配。
- token 纪律沿用 `aesthetic-ab/measure2.py`：排除 `data-oey-preview-root` 内层产物，扫描外壳计算样式；
  同一颜色至少出现 2 次才计入。

### 2.4 E12 真实 agent 会话

- 预算上限沿用 E7 外推值：60 步、250,000 total token、900 秒、最多 3 次渲染。
- agent 必须先写 `DIRECTION.json`，再用 React + MUI 完成页面，并执行
  `run_build -> render_preview -> 看截图 -> 必要时修复`。
- 工具只允许读写工作区、固定 Vite 构建和固定 Playwright 渲染；不接受模型提供任意 shell 命令，
  不允许安装依赖。
- E12 只有一个正式样本；它回答可行性，不提供稳定的消耗分布。

## 3. 原始结果

### 3.1 E8 首轮：Node/Vite 候选不通过

| 检查项 | 结果 |
|---|---|
| 复制后的 Node 运行 | 通过，AppContainer 内输出 `v25.6.1` |
| 零网络 | 通过，裸 IP 请求 rc=28、无输出文件 |
| 依赖镜像只读纪律 | 通过，构建前后整树摘要均为 `9ecd9f5a...8377` |
| lockfile 不变 | 通过 |
| 路径长度 | 通过，最长 200 字符 |
| Vite 构建 | **失败**，rc=1 |

失败发生在 Node 解析 Vite 入口时：

```text
Error: EPERM: operation not permitted, lstat 'C:\'
    at Object.realpathSync (node:fs:2717:25)
    at Module._findPath (node:internal/modules/cjs/loader:780:22)
```

这说明“二进制复制进包目录后能执行”不等于“真实 Node 模块解析能工作”。`node --version` 不访问模块
路径所以成功；Vite 入口触发 `realpathSync`，Node 从盘符根开始 `lstat`，而零 capability AppContainer
无权读取 `C:\`。最长依赖路径只有 200，原先担心的深路径不是本次阻塞点。

本结论只证伪当前 `Node 25 + AppContainer 包目录` 候选，不证明所有 Windows 沙箱路线都不可行。
应分别补测 Node LTS 22、最小祖先 traverse ACL 的安全边界，以及 WSL2/专用低权限账户备选。

### 3.2 E9 首轮：宿主构建通过

由于 E8 未能在 AppContainer 内启动 Vite，E9 独立在宿主运行同一固定工具链，两次均成功转换
905 个模块：

| 文件 | build A SHA-256 | build B SHA-256 |
|---|---|---|
| `index.html` | `da2e91ae...c20ca` | 相同 |
| `assets/index-*.js` | `43001600...31f2b` | 相同 |
| 整树 | `6b94cf3f...6ddae` | 相同 |

完整哈希以 `results/e8-e11.json` 为准。相对路径集合与所有文件字节均一致，故 Vite/React/MUI
固定版本下的生产构建具备确定性。此结论不包含不同机器、不同 Node 版本或不同 OS 的跨环境确定性。

### 3.3 E10：通过

- `ObjectCard` 复用 20 次，构建后 DOM 按顺序得到 `card-01` 至 `card-20`。
- 锚点总数 20、唯一数 20、缺失 0、意外值 0。
- 页面另有 section、conversation message 与 preview root 锚点，均在构建后存活。
- 外链请求 0、console error 0。

可行模式是“调用方持有业务对象 ID，并显式通过 prop 传给复用组件”。不能让组件内部用数组下标、
随机数或 React 自动 ID 充当持久对象身份。

### 3.4 E11 首轮：部分通过

受控 fixture 把艺术方向注册为 MUI 主题，并显式覆盖 outlined button 等会派生状态色的组件后，
外壳计算样式为 **6 色**，达到 bespoke/system 的 5-6 色参考范围。

但 E12 的真实 agent 候选虽然声明“exactly six shell color tokens”，渲染后仍为 **10 色**。额外值来自：

- `text.secondary` / `text.disabled` 的多个 alpha 变体；
- signal 的选中态 alpha 变体；
- MUI 遗留默认灰 `rgb(118,118,118)`；
- 主题中自行加入的 `primary.dark/light` 与 hover 色。

因此组件库路线**可以**达到纪律要求，但“声明六个 token”不会自动保证渲染后只有六色。需要确定性
检查同时验证：颜色总数不超过阈值，且每个计算后颜色都能映射到允许 token 或预先登记的 alpha 状态。

### 3.5 E12 首轮：不通过

| 维度 | 上限 | 实测 |
|---|---:|---:|
| 步数 | 60 | 13 |
| total token | 250,000 | 95,249 |
| prompt / completion | - | 83,028 / 12,221 |
| reasoning token | - | 1,133 |
| 会话内构建 | - | 2 次，均在 120 秒超时 |
| 会话内渲染 | 最多 3 | **0** |
| 终止原因 | 正常自止 | **API SSL EOF** |

token 与步数都有充足余量，失败点是构建往返和端点可靠性，而不是模型输出额度。两次构建超时后，
agent 继续读文件并尝试修复配置，但始终没有获得可渲染的 `dist`，所以没有看到真实截图，未满足完整
创作闭环。

会话终止后的诊断不计为 agent 完成：同一最终源码后来构建成功（68.6 秒）、零外链渲染成功
（23.07 秒），有 15 个唯一对象锚点、2,653 字正文、console error 0。截图见
`results/e12-final.png`。这证明源码本身可用，但不能倒推“agent 已在预算内自验完成”。

该诊断还暴露两个问题：最终外壳为 10 色；900 秒上限附近发生 API SSL EOF。即便放宽 900 秒，
本次也不能判通过，因为会话内渲染次数仍为 0、终止原因也不是正常自止。

### 3.6 后续诊断：E8/E11 找到受限可行解，E12 定位到模型

E8 的失败由两层组成：Node 主入口会从 `C:\` 开始 `realpath/lstat`；临时映射到可访问的 `S:\`
后这层消失，但 Node `v25.6.1` 内置 libuv `1.51.0` 无法在 AppContainer 的合法 `LOCAL` named-pipe
命名空间创建管道，`child_process` pipe、Vite 导入与 Vite build 都会挂起。`stdio: inherit` 正常，
证明第二层是管道而不是一般进程创建。

不改 AppContainer 的短期解法已经实测：工作区映射为临时盘符根，直接运行依赖镜像中的原生
`esbuild.exe`，由受信任 builder 复制固定 HTML 壳。两次零网络沙箱构建分别为 0.45 秒和 0.22 秒，
整树哈希均为 `95aa2d95...13825`；依赖镜像前后 7,269 文件、整树哈希完全不变；构建后真实渲染
无外链、无 console error，20/20 锚点存活。

E11 使用 strict theme factory 后，显式覆盖 MUI palette/status/grey/action、禁用 ripple 和颜色 transition，
并让 hover/focus/disabled 只在六个不透明 token 间切换。Playwright 对 rest、所有按钮 hover、focus、
disabled 的颜色并集恰为声明的 6 色，无未归属颜色。该通过依赖**引擎生成并锁定 theme**，不能允许
agent 自由写 raw hex/rgba 后只靠 prompt 自觉。

E12 今天多次重试：非流式出现读超时；工具调用改为流式后，16k 单次上限被 564 秒推理耗尽；提高到
40k 后生成了可构建候选，但方向调用单独消耗 22,429 reasoning token / 767 秒，后续页面文件 275 秒，
总会话 1,082 秒。会话外固定构建仅 0.15 秒、渲染 2.90 秒，候选有 12 个唯一锚点且静止态 6 色。
因此 E12 当前失败主要属于 Kimi 推理时延与实验把“方向生成”重复塞进实现会话，不再是框架构建开销。

## 4. 对规范与 ADR 的建议

1. **2026-07-30 建议已被冻结裁决替代。** ADR-0005 仍未接受，故产品当前仍不开放 `framework`；
   但 E12 重测不再是接受 ADR 的前置门禁。
2. **首版 framework profile 固定为 React + MUI + native esbuild。** 不承诺 Vite plugin、dev server、
   任意 Node 脚本或 Vue SFC；这些能力等含 AppContainer pipe 修复的 Node/Bun 运行时再开放。
3. **AppContainer 结构不改。** launcher 增加随机临时盘符映射，并在创建进程时同时附加 Job Object；
   builder 结束后由受信任 host renderer 服务 `dist/`，不在容器内开放 dev server。
4. **对象锚点契约明确传递模式。** 业务层生成稳定对象 ID，组件 prop 透传，registry 从构建后 DOM 抽取。
5. **主题改为受信任生成物。** agent 只提交六个角色 token；theme factory 生成 MUI 主题并设为只读，
   静态检查禁 raw color，渲染检查覆盖 rest/hover/focus/disabled 的 token 归属。
6. **E12 优化（非阻塞）。** 艺术方向是上游已批准输入，不应在 framework 实现会话里重复生成；API
   调用必须受 900 秒硬 deadline 取消。多样本分布与 provider/tool time 分列转入后续优化。

## 5. 诚实说明

- E8 的通过只适用于固定原生 esbuild profile；Node/Vite 仍失败，不能把结论外推到任意 npm 工具链。
- E11 的通过适用于受控 theme factory；agent 自由生成主题时仍可能产生未登记交互态颜色。
- E12 正式与重试样本均受 Kimi 长推理/超时影响；结论是“当前 provider 绑定未通过”，不是框架执行超预算。
- E12 报告的总墙钟包含终止后的诊断构建/渲染，原始值不能直接当会话耗时；但失败不依赖这一数值，
  因为会话内渲染为 0 且终止异常。
