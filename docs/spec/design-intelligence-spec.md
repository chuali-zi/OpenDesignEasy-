# Design Intelligence 内部规范

> 状态：**v0.4，已于 2026-07-30 审核通过并冻结。**
> 冻结依据：spike D1/D3/D6/D7/D8 通过；审美实验两轮（`spikes/aesthetic-ab/RESULT2.md`）定下
> 艺术方向阶段与反收敛机制；用户裁决首批视觉领地为 `graphite` + `paper`，`daylight` 不采纳。
> 冻结后的变更必须通过版本化 Spec 或 ADR。D4/D5（生图）仍因凭据阻塞，其变更范围限于 §4.5。
> v0.4 依据审美实验第二轮新增 §4.2.1 艺术方向阶段、§4.2.3 领地库与入库判据、§3.1 预览边界锚点，
> 修订 §4.2（差异轴必须被供给）、§7（设计系统角色接离线 vendor 包），
> 并把假设 D2 从「待人工审核」改为**已证伪（限 agent 自选方向的情形）**。
> v0.3 依据 spike D3/D6 修订 §3（抽取必须基于计算样式）、§5（能力槽绑定与静默失败校验），
> 并按用户决定新增 §4.5.1（生图全暴露、不做占位、以 README 免责替代权利门禁）。
> 上位规范：`system-spec.md` §7.1、`contract-skeleton.md` §6.1、`agent-engine-spec.md`、
> `implementation-plan.md` Phase 5。
> 范围：Design Intelligence Port 的内部子模块、候选表示、design contract、模型能力平面与失败语义。
> 首个垂直媒介：Web。首个真实场景：本仓库 → agent 前端页（含自造 mock 后端）。
> 规范化扩展：ADR-0005 已于 2026-08-03 接受第三种 `framework` 实现基底；仅限其冻结的
> React/MUI/native-esbuild P6 profile，不改变 `bespoke` / `system` 的既有语义。

## 1. 目的与边界

本规范确定「把 Context Package、Design Brief 和 Constraint Profile 变成可评审设计方向」这件事在
内部怎么做。它定义 **design contract**——Artifact 与 Quality 两份 Spec 的输入。

创作**不是**一次模型调用。`architecture.md` §11 把创作负责人定义为**统筹**候选整体的角色，
§12 要求强模型获得「更开放的创作空间和更直接的工作区工具」。本模块通过驱动
`agent-engine-spec.md` 定义的引擎实现这一点：给目标、给工作区、给工具、给预算，不给步骤。

本规范不改变 `src/oeydesign/ports.py:252-286` 中 `DesignIntelligencePort` 的方法签名，不改变
Project 状态机，不定义 Artifact 的文件结构，不定义质量阈值，不定义引擎内部机制。

本规范不覆盖：PPT/DOCX 候选生成、参考图风格模仿、设计系统自动生成、跨候选借鉴、用户偏好学习。
这些留待第二个场景与后续版本。

### v0.2 变更

v0.1 把 Candidate Composer 写成了单次模型调用，丢掉了 `architecture.md` §11/§12 要求的 agent
工作区与工具能力。v0.2 修正：§4.3 与 §4.6 改为驱动 agent 引擎；场景从「空白自然语言 → 产品
官网」改为「本仓库 → agent 前端页」；能力平面新增 `code.understand`。

## 2. 候选表示决定

**候选就是一个完整可运行的 Web 项目。** agent 直出代码，不经过中间视觉 IR。

这条决定的理由：首个媒介是 Web，网页的设计语言本身就是代码；引入中间表示会在「模型能表达的设计」
和「IR 能表达的设计」之间制造损耗，而 `system-spec.md` §2.2 已把统一视觉 IR 列为当前非目标。
`system-spec.md` §13.1 同时要求 Web 必须拥有**可运行项目**或等价的可交付源码——候选允许包含
JS、多文件结构和 agent 自造的 mock 层，不限于单个静态文件。

这条决定的代价必须被显式抵消。如果候选与 Artifact 是同一份代码，`DIRECTION` 与 `ARTIFACT_LOCAL`
两条反馈路径（`system-spec.md` §11.3，Phase 4 已验收）就失去区分依据。因此：

- 区分点从「表示形式」移到 **「谁改、改多大范围」**；
- `DIRECTION` 反馈由 Design Intelligence 开启新会话重做，产生新的 Candidate revision；
- `ARTIFACT_LOCAL` 反馈由 Artifact Production 在声明作用域内改写，产生新的 Artifact revision，
  完成后**验证**无关锚点未变（`artifact-production-spec.md` §4.3）；
- 批准时冻结 baseline 代码，并**机械抽取**一层 design contract，使 Quality 能判定「是否偏离已批准
  方向」，而不必依赖模型主观判断。

## 3. Design Contract

Design Contract 是从已批准候选代码中**确定性抽取**的薄契约。它不是设计的完整描述，只是后续阶段
需要机械校验的那一部分。

```text
DesignContract
  ├─ tokens
  │    ├─ color   : 出现频次达阈值的颜色值集合 + 其角色推断（背景/前景/强调）
  │    ├─ type    : font-family 集合 + font-size 阶梯 + font-weight 集合
  │    └─ space   : padding/margin/gap 的数值阶梯
  ├─ anchors      : 有序的 data-oey-section / data-oey-object 清单
  └─ extractor_version
```

规则：

- 抽取器**必须**是纯确定性代码，不调用模型。同一份代码必须抽出同一份 contract。
- **抽取必须基于真实渲染后的计算样式（computed style），不得只做源码静态分析。**
  这条不是风格偏好：实测（spike D3）对 8 个真实 agent 产物，源码正则抽出的颜色/字号/间距
  **全部为 0**——因为真实产物是多文件项目，CSS 在独立的 `styles.css` 里。计算后样式路径
  8/8 成功且 3 次重复字节级一致。源码正则**同样满足「确定性、不调模型」**却完全不可用，
  所以这条必须写死，不能留给实现者选。
- **锚点清单同样必须从渲染后的 DOM 取，不能从源码取。** 产物用 mock 在运行时生成的带锚点元素
  不在静态 HTML 里，两种口径实测最大相差 15 个锚点。口径不一致会让 Quality 的契约比对产生
  双向假警报（把运行时锚点当「新增」、把被 JS 替换的源码锚点当「丢失」）。
- 抽取器**必须**声明 `extractor_version`；版本变化视为 contract 变化，需要重新确认。
- 抽取失败**必须**报 `DETERMINISTIC_FAILURE`，不得产出空 contract 蒙混过关。
  注意判据：浏览器的 HTML5 解析器有强制错误恢复，**几乎永不拒绝产出 DOM**（纯垃圾文本也会
  渲染成一个近乎空的页面）。因此「无法解析」这个失败态在计算样式路径下基本不会触发，
  **必须改为「抽取结果为空或异常稀疏时判为失败」**，不能只依赖解析异常。

> 注意：「不调模型」不等于「不需要浏览器」。抽取依赖真实渲染能力，这对 `commit_direction`
> 的耗时与依赖有实际影响。
- Contract **不**记录布局的像素级细节。它回答「用了哪些 token、有哪些结构锚点」，不回答「长什么样」。
  「长什么样」的基准是 `baseline_code` 本身和它的渲染截图。

`ApprovedDirection`（`src/oeydesign/domain.py:524`）新增一个可选字段承载它：

```python
design_contract: DesignContract | None = None
```

现有字段 `baseline_preview_html` 语义升级为「批准时冻结的完整页面代码」，字段名不变，以免破坏
Phase 4 的持久化与 Product Shell 投影。

### 3.1 预览边界锚点：contract 必须知道自己在量哪一层

候选产物里可能存在**两层设计**：工作台外壳，和预览区里那个「正在被设计的产物」。后者是用户的
成品，有它自己的视觉语言，**不应当**与外壳共享 token。

因此产物**必须**用一个专用锚点声明这条边界：

```html
<div data-oey-preview-root>  <!-- 以下是被设计的产物，自带视觉语言 -->
```

抽取器据此产出**分层的** contract：外壳一份、内层一份。规则：

- 漂移判定**必须**分层进行。把两层混在一起量会同时产生两种假象：
  内层用了自己的品牌色会被当成外壳「引入了方向外的新值」；
  而内层**被外壳同化**（token 数不升反降）反而会被读成「纪律很好」。
- 产物没有声明该锚点时，contract 记为**单层**并标注 `preview_root_declared=false`，
  不得猜测边界。Quality 对未声明的产物不做分层漂移判定。

> 依据：`spikes/aesthetic-ab/RESULT2.md` §4。第一轮用**整页**颜色数判定某一组「token 纪律
> 胜出」（5-7 色 vs 对照组 23-31 色）。分层重测后，那一组的内层产物只有 4 色、比外壳还少、
> 整页数等于外壳数——它根本没做出独立的产物，整页数低是**两层未隔离**的结果。
> 该轮六个产物的边界元素命名互不相同（`preview` / `bench` / `artifact` / `page-root` / 无），
> 没有稳定的机器可识别边界，所以这条必须是产物**声明**的，不能靠启发式推断。

## 4. 内部子模块

每个子模块有单一职责、明确输入输出，可独立测试。

### 4.1 Brief Resolver

输入：用户自然语言 + 现有 `ContextPackage`（本场景含仓库结构证据）。
输出：`DesignBrief`（`domain.py:221`：goal / audience / medium / acceptance_direction）+ 不确定性清单。

规则：

- 只有**会实质改变内容**的缺口才写入 `material_uncertainties` 并触发 `NEEDS_INPUT`
  （`system-spec.md` §14）。典型：产品到底是什么、面向谁、有没有必须出现的事实数字。
- 风格偏好类缺口（配色倾向、语气、要不要动效）**不得**触发追问，由 Strategy Planner 转成候选之间
  的差异轴。这是「主动完成低风险设计决策」的落点。
- Resolver 必须区分「用户没说」和「用户说了但含糊」。后者可以先给出解释并在候选中体现，不追问。
- 有仓库输入时，**能从仓库读出来的事实不得拿去问用户**。项目叫什么、有哪些模块、API 是什么形状，
  都应从证据层获得而不是追问。

Context Package 没有任何 `source_refs` 是合法状态（纯自然语言输入），不是错误。

### 4.2 Strategy Planner

输入：`DesignBrief` + `ConstraintProfile` + 能力清单。
输出：`DesignStrategy`（`domain.py:487`）。

除了已有的 `candidate_count`，Planner 内部还要确定并记录：

| 决定 | 依据 |
|---|---|
| 每个候选的差异轴 | 候选之间必须代表**实质不同的产品选择**，不是同一版式换配色 |
| 每个候选的**视觉领地** | 从策展的领地库中**分配**，不由模型自选，见下 |
| 每个候选的**实现基底** | `bespoke`、`system`，或 ADR-0005 受限的 `framework`，见 §4.2.2 |
| 模板角色允许的可变范围 | `ConstraintProfile.template_role`，见 §7 |
| 是否需要生成配图 | 内容大纲中有无「需要视觉但无素材」的位置 |
| 每个候选的成本上限 | 单候选的 token 与生图次数上限 |

`candidate_count` 沿用现有约束：下限 2、上限 4。

**差异轴与视觉领地必须来自被供给的策展库，Planner 只做分配，不得让模型自己想。**
这条不是偏好，是实测结论：给三个刻意不同的气质出发点让 agent 自定方向，产出的三份方向
底色 `#F6F2E9`/`#F2EFE7`/`#F5F2EC`、强调色 `#C23B1B`/`#C2500F`/`#C2410C`、隐喻全是「校样台」——
连强调色的前两位都相同。加上另外两次，**5 次独立生成全部落在同一处**。

更要紧的是其中的机制：当时的提示词点名排除了最常见的组合（深色主题 + 蓝紫渐变 + 圆角卡片 +
系统字体）。**点名排除第一众数之后，模型只是确定地滑到了第二众数。**「禁止求平均」不产生原创，
只是换一个平均值。因此**反收敛必须靠外部供给的领地，不能靠提示词里的否定句**。

领地库中每块领地**必须**钉住模型反复收敛的那几个变量（外壳明度、强调色温度、分层手段），
其余（确切色值、字体配对、版式比例、signature move）留给 §4.2.1 的艺术指导。
实测钉住这些变量后配色确实分开了；但**隐喻层仍然收敛**（三个方向仍全叫「××校样台」），
说明领地维度本身也需要覆盖概念框架，而不只是视觉变量。

> 依据：`spikes/aesthetic-ab/RESULT2.md` §5，原始数据 `runs2/_convergence/`。

### 4.2.1 Art Direction 阶段（常开）

输入：分配到的视觉领地 + `DesignBrief` + 离线字体供给表（`artifact-production-spec.md` §3.1）。
输出：一份 `ArtDirection`——**可独立审核**的产物，用户可以在写任何代码之前否掉它。

这是把审美失败拦在最便宜位置的地方：否掉一份方向的成本是几千 token，
否掉一个完整候选的成本是几万 token 加一次渲染。

`ArtDirection` 与 §3 的 `DesignContract` **同构**，方向相反：

| 形态 | 时机 | 作用 |
|---|---|---|
| 处方（`ArtDirection`） | 生成前 | 约束创作 |
| 描述（`DesignContract`） | 生成后 | 检测漂移 |

内容：确切色值（bg / surface / ink / ink_muted / line / accent）、字体配对（含**必须**指定的 CJK 族）、
字号阶、间距阶、版式原型、一处 signature move、方向自订的禁止项。

规则：

- **色值必须是确切 hex，字体必须来自离线供给表。** 让模型写「深灰」或「一个好看的无衬线体」
  等于没有约束；写表外的字体则会产出一个必须联网才好看的产物。
- **signature move 必须声明它服务于哪一条具体信息**（让什么更容易被找到或判断）。
  只要求「与众不同」会得到为怪而怪的结果：实测那一轮产出了一个 96px 的版本号，
  不对齐任何东西、不承担任何信息，读起来像渲染错误。**新奇只能是功能的副产品。**
- **可读性下限优先于艺术方向**，方向撞破下限时按下限走。下限至少包括：
  正文不得使用等宽字体；需要连续阅读的文字 ≥14px；正文对比度 ≥7:1、次要文字 ≥4.5:1；
  全大写仅限 ≤2 词的标签；可点击行 ≥32px；不得存在大面积空白面板。
  这些**应当**在渲染后由计算样式机械校验（`quality-governance-spec.md` 的硬检查轨），
  不能只写在提示词里。
- 方向**不得**蔓延进预览区内层（§3.1）。方向管的是工作台外壳；内层是用户的成品，自带视觉语言。

> 依据：`spikes/aesthetic-ab/RESULT2.md` §3。上述四条各自对应一个实测到的失败：
> 无下限 → 13px 等宽正文 + 全大写标签 + 发丝线网格，用户反馈「看起来很累」；
> 只要求反常 → 无意义的巨大版本号；
> 未声明内容饱满度 → 对话栏基本空着；
> 未隔离双层 → 咖啡品牌落地页被做成了等宽校对表。

### 4.2.2 实现基底（用户可选）

艺术方向阶段**常开、不可选**；**实现基底可选**：

| 基底 | 做法 | 对应 `template_role` |
|---|---|---|
| `bespoke` | 手写 CSS，直接按方向实现 | 参考样例 / 起始脚手架 |
| `system` | 离线 vendor 的设计系统，把方向注册成主题后只用注册进去的 token | **设计系统**（§7） |
| `framework` | ADR-0005 固定的 React/MUI/native-esbuild profile；只提交六个角色 token，由 trusted theme factory 完成主题 | **设计系统**（§7） |

`system` 基底**必须**禁用所选设计系统的默认调色板与默认字号阶。这是实测的失败点：
不加这条时，产物的颜色全部来自框架默认调色板，外壳散到 13-23 色；加了之后收到 5-6 色。

原有**两条基底的 token 纪律实测一致**（三对配对比较，每对共用同一份艺术方向，外壳均为
5-6 色）。ADR-0005 的 `framework` profile 另由 E11 strict-theme 实验约束为六个声明 token；
该结论不外推到任意组件库或自由主题。

> 样本量诚实说明：三对配对比较，每格 n=1，不足以排除偶然。
> 依据：`spikes/aesthetic-ab/RESULT2.md` §4.1。

### 4.2.3 领地库与入库判据

领地**不是**一套色值，是**钉住模型会收敛的那几个变量**的一段约束；确切色值、字体配对、
版式比例、signature move 由 §4.2.1 的艺术指导在领地内自由决定。首批冻结两块：

| 领地 | 钉住的变量 | 参考方向（实测产出） |
|---|---|---|
| `graphite` 深色工作台 | 中性近黑到深灰底（**非深蓝/深紫**）；单一暖强调色，只押在最关键的一处动作；分层靠 1px 描边与底色差，禁发光/玻璃拟态/霓虹 | 灯箱校样台：bg `#141311`、ink `#EDEAE3`、accent `#E8602C`，Space Grotesk + IBM Plex Sans + Noto Sans SC |
| `paper` 暖纸编辑台 | 暖纸底色、衬线标题、红笔批注语言；秩序靠基线对齐、字重与留白，不用卡片切块 | 红笔校样台：bg `#F3EDE0`、ink `#231D13`、accent `#B93A22`，Fraunces + IBM Plex Sans + Noto Serif SC |

`daylight`（浅色中性）已生成但**未采纳**，产物保留在 `spikes/aesthetic-ab/runs2/` 作为标定数据。

**入库判据（阻断）：** 新领地与库中每一块既有领地的**分离度必须 ≥ 25**。分离度定义为
bg / ink / accent 三个角色成对 CIE76 ΔE 的**最大值**——问的是「有没有任何一个角色把这两块
领地明确分开」，取最大而非平均，因为平均会被两个相同角色稀释掉唯一那个不同的角色。
实现与标定：`spikes/aesthetic-ab/convergence.py`，判据随该脚本一并冻结。

阈值不是拍的，是从两组已知结论的数据里读出来的：agent 自选方向的三对分离度落在
6.7–12.2，外部供给领地的三对落在 87.1–95.0，中间是一条 7.2 倍宽的空隙。25 落在空隙内，
且 ΔE 25 本身已远超「明显不同色」。脚本在标定时断言这条空隙仍然成立，分不开就直接失败——
一把量不出已知差异的尺子必须当场暴露，不能悄悄放行。

**名称/隐喻重合是提示，不是阻断判据。** 已冻结的两块领地都叫「××校样台」，配色却相距
ΔE 88.2：模型的概念框架会独立于视觉种子收敛。因此重合时**应当**人工确认两者的
signature move 确实不同，但**不得**仅凭名称重合否决入库。

> 依据：`spikes/aesthetic-ab/RESULT2.md` §5；标定输出 `spikes/aesthetic-ab/convergence_report.json`。

### 4.3 Candidate Composer（创作负责人）

输入：`DesignStrategy` + 单个候选的差异轴 + `ContextPackage` + 预算。
输出：一个 `Candidate`（`domain.py:497`）。

**这不是一次模型调用，是一次 agent 会话。** 每个候选拿到一个独立工作区
（`agent-engine-spec.md` §3），一套工具，一份目标，然后自己写、自己跑、自己看渲染结果、
自己修，直到自验证通过或预算耗尽。引擎不规定它的工作步骤。

规则：

- **每个候选一个独立工作区，不共享上下文。** 共享会让后生成的候选向先生成的收敛，破坏「多个
  方向代表实质不同的产品选择」这条前提，也破坏不变量 4「候选责任统一」。
- 创作负责人**必须**能在阶段内部自由探索：建多个版本、推翻重来、重构、跑构建、造 mock 数据把
  交互跑通。这些都不需要逐步审批（`agent-engine-spec.md` §2）。
- 产出**必须**是一个可运行的 Web 项目而非单个静态文件（`system-spec.md` §13.1「必须拥有可运行
  项目或等价的可交付源码」）。允许含 JS 与 agent 自造的 mock 层。
- 产出**必须**在结构元素上带锚点属性：

  ```html
  <section data-oey-section="hero">
    <h1 data-oey-object="hero.title">…</h1>
    <p data-oey-object="hero.summary">…</p>
  </section>
  ```

  锚点是局部反馈定位的**唯一**依据。没有锚点的区域只能整体重做。
- 自造 mock **必须**如实声明（`agent-engine-spec.md` §10），声明随候选带到下游。
- `Candidate.creative_owner` 记录本次会话的能力实例标识。
- `Candidate.constraints` 记录生成时生效的约束快照，不是指针。约束变化后旧候选仍能被正确解释。
- `Candidate.preview_html` 承载 `out/` 中的入口页面，供 Product Shell 预览；完整项目留在工作区，
  由 Artifact Production 在方向批准后接手。
- 引擎强制的最低自验证门槛（可加载、无 console error、无未加载资源，见
  `agent-engine-spec.md` §6）不过即视为候选未完成，按 §8 处理。

有仓库输入时，创作负责人**可以**读 `repo/` 了解真实结构与 API 形状，但**不得**修改它。产出物中
陈述的事实必须与仓库一致——这条由 Quality 层检查。

### 4.4 Design Contract Extractor

在 `commit_direction` 时运行，产出 §3 定义的 `DesignContract`。确定性代码，不调模型。

抽取器同时负责一件事：把 `data-oey-*` 锚点清单交给 Artifact Production 作为 object registry 的
初始集合，使两个模块对「有哪些可寻址对象」有同一份认识。

### 4.5 Imagery Planner 与生图 Adapter

输入：内容大纲中标记为「需要视觉」的位置 + 候选的视觉方向。
输出：生成图资产 + 回填后的代码。

规则：

- Planner 决定**是否**需要图，而不是有位置就填图。空白留白是合法的设计选择。
- 生成的图**必须**先注册为 `SourceAsset`（`domain.py:247`，`kind=SourceKind.IMAGE`），再以
  `storage_ref` 被代码引用。**不得**以匿名 data URI 或外链直接内联。
- 生成来源、prompt 和模型版本写入 `EvidenceRecord`（`domain.py:268`，
  `layer=MACHINE_INTERPRETATION`），保证「这张图哪来的」可回溯。

### 4.5.1 生图能力：全暴露或不暴露，**不做占位**

用户决定（2026-07-28）：**不接受占位图这种中间态。** 生图能力只有两种合法形态：

| 形态 | 行为 |
|---|---|
| **不暴露** | 部署配置里关闭 `image.generate`，agent 的工具目录中**不出现**生图工具。设计以纯排版/CSS 完成，不留空位也不放占位图。 |
| **全暴露**（当前采用） | 工具直接可用，agent 自行决定何时生成，生成结果**直接嵌入产物并进入 Delivery Bundle**。 |

在「全暴露」形态下：

- 生成图的 `rights` 记为 `RightsStatus.CLEARED_FOR_DELIVERY`，**直接进入交付物**；
- **不设权利门禁**，不因生成素材阻断交付。理由：当前项目为非商用自用，
  权利责任通过 README 免责声明承担，见下；
- 产物 README 与 Delivery Bundle 清单**必须**包含一条免责声明，说明其中含 AI 生成图像、
  未做商用授权审查、使用者自行承担商用风险；
- Delivery Bundle **必须**列出所有生成图及其来源模型与 prompt 摘要（沿用 `EvidenceRecord`），
  使「哪些是 AI 生成的」在交付物层面可查。

> spike D5 的结论是「官方权利来源可确认，但客户交付权不够明确」，因此原 spec 采取
> `ANALYSIS_ONLY` + 交付硬错误的保守方案。用户已明确本项目不涉及商用、以 README 免责替代
> 权利门禁，故本节覆盖 D5 的保守默认。**若本项目转为商用，必须回退到 `ANALYSIS_ONLY`
> 并恢复交付门禁**——这条回退条件写在此处，不要在转商用时才重新发现。

### 4.6 Revision Loop

`DIRECTION` 反馈进入这里，同样是一次 agent 会话。规则：

- 目标是**换一个做法**，不是缝补。创作负责人可以推翻整个结构重来，这是方向反馈的语义。
- 会话拿到上一版工作区与反馈原文，让 agent 知道在拒绝什么；但**不得**要求它以上一版为基线微调。
- 新候选 `revision = 上一版 + 1`，`parent_revision` 指向上一版，历史保留（不变量 6）。
- 已有的 `COMMIT_DIRECTION` approval 在候选发生方向级变化后失效
  （`contract-skeleton.md` §2），由 Control Plane 执行，本模块只负责产出新 revision。

## 5. 模型能力平面

采用自建的、与供应商解耦的 capability harness。定义能力槽，而不是把供应商 ID 写进业务流程
（不变量 10）。

| slot | 用途 | 必要能力 | 首批绑定 | 本场景是否阻塞 |
|---|---|---|---|---|
| `design.compose` | 驱动创作 agent 会话 | 长上下文、**稳定工具调用**、长输出 | Kimi（K2/K3，OpenAI 兼容端点） | 是 |
| `code.understand` | 读仓库结构与 API 形状 | 长上下文代码理解 | 同上 | 是 |
| `design.critique` | 自验证中的视觉判断 | **图像输入**（读自己的截图） | 待定 | 是（见 D6） |
| `image.generate` | 配图 | 尺寸/风格可控 | Seedream | 否（本场景可无图） |
| `vision.understand` | 参考图理解 | 图像输入 | 待定 | 否（本场景无参考图） |

`design.compose` 的必要能力从「长输出」变为「长输出 + 稳定工具调用」——agent 循环要求模型能可靠
地发起工具调用并消化返回结果。这是能力平面选型的硬约束。

`design.critique` 在 v0.2 中**从非阻塞变为阻塞**：`agent-engine-spec.md` §6 的自验证闭环要求
agent 能看自己的渲染截图。没有图像输入能力，自验证退化为「看代码猜效果」，引擎的核心价值不成立。
若 Kimi 不具备该能力，此 slot 必须绑定到另一个具备图像输入的实例。

规则：

- 供应商 adapter 落在 adapter 层，**不得**进入 domain 或 Control Plane。供应商的 message、thread、
  tool schema 不出现在 `Candidate`、`DesignStrategy` 或任何项目状态中。
- 每次生成记录 `capability_version`（`Lineage`，`domain.py:308`），使「这个候选是哪个能力产出的」
  可追溯，也使能力更换后的行为差异可分析。
- 降级**不得**丢失该阶段的必要能力。`design.compose` 没有满足工具调用可靠性要求的实例时，报
  `CAPABILITY_UNAVAILABLE`，**不得**退化成无工具的单次生成——那是另一种产品，不是降级。
- **能力槽绑定与降级时，必须校验目标实例确实具备该槽声明的必要模态**，不具备即报
  `CAPABILITY_UNAVAILABLE`。这条来自实测：`kimi-for-coding` 在收到图像输入时**返回空内容而不是
  报错**——静默失败，不校验就会让自验证闭环悄悄退化成「看代码猜效果」。
- **adapter 必须把「空产出」当作失败抛出，不得向上返回空字符串。** 这是同一类静默失败的第二个
  实例：端点过载时会正常关闭流、只带一个 `finish_reason="engine_overloaded"`，
  `completion_tokens=0`，HTTP 200，不报任何错。实测中调用方据此写出了一个 0 字节的产物，
  一路走完渲染与截图，直到人看截图（全白）才发现。**空产出永远不是有效结果，
  要在最靠近事实的地方抛出来**，否则失败会伪装成成功穿过整条流水线。
- `vision.understand` 未绑定不影响本场景运行；它只在参考图场景成为阻塞项。

实测得出的绑定约束（spike D6）：

| slot | 可用实例 | 不可用 |
|---|---|---|
| `design.compose` | `k3`、`k3-256k` | — |
| `design.critique` | `k3`、`k3-256k` | **`kimi-for-coding`（无图像输入）** |
| `code.understand` | `kimi-for-coding`、`k3-256k` | — |

另外 `k3` 只接受 `temperature=1`，其他取值返回 HTTP 400。这类 provider 级硬约束**必须**由
adapter 层吸收，不得泄漏到 harness 或 domain。

### 5.1 测试确定性

agent 会话比单次调用更不可复现：同一目标两次运行的工具调用序列不同，产出也不同。因此：

- conformance 测试**必须**使用录制的会话 fixture（含工具调用与返回），不得在 CI 中真实调用 API；
- 端口测试断言的是**契约性质**而非具体产出：候选数量、锚点完整性、契约可抽取性、mock 声明存在
  与否——不断言生成了什么颜色或什么文案；
- `src/oeydesign/stubs.py` 的 `DeterministicDesignPort` 保留为参照实现，与真实实现共用同一套端口
  测试（`implementation-plan.md` §7.1）；
- 真实 API 调用只出现在显式标记的 spike 与人工验收中。

## 6. 端口映射

| 端口方法（`ports.py`） | 内部子模块 |
|---|---|
| `plan_design` (:255) | Brief Resolver → Strategy Planner（含领地与基底分配） |
| `create_candidates` (:266) | Art Direction × N → Candidate Composer × N + Imagery Planner |
| `revise_candidate` (:273) | Revision Loop |
| `commit_direction` (:281) | Design Contract Extractor |

四个方法的签名、参数与返回类型**不变**。本规范只填充实现，不动接缝。

## 7. 模板角色的可变范围

延续 `contract-skeleton.md` §7 的四角色语义，具体化到本模块：

| 角色 | Design Intelligence 的可变范围 |
|---|---|
| 参考样例 | 可完全重构结构与版式，只保留从参考中提取的风格证据 |
| 起始脚手架 | 可重组、替换、扩展区块，保留有用的对象关系与锚点命名 |
| 设计系统 | 只在 token 与组件规则内创造，不得引入系统外的颜色阶或字号阶。系统本身由离线 vendor 包提供（`artifact-production-spec.md` §3.1），**并且必须禁用其默认调色板与默认字号阶**——默认调色板太大，不构成约束（§4.2.2） |
| 交付合同 | 只在明确标记的开放区域创作，锁定结构原样保留 |

模板角色**必须**在 `Candidate.template_role` 中可见，不是装饰性设置。

运行安全规则与事实/权利要求**不能**被创作自由度覆盖，切换到「开放探索」preset 也不行
（`system-spec.md` §10）。

## 8. 失败、重试与降级

| 情况 | 错误类别 | 处理 |
|---|---|---|
| 模型超时或限流 | `RETRYABLE` | 有界重试（上限 2 次），退避 |
| **模型返回空内容但不报错** | `RETRYABLE` | adapter **必须**在这里就判失败并重试，不得把空产出当结果向上传 |
| 工具调用格式持续错误 | `RETRYABLE` → 耗尽转 `CAPABILITY_UNAVAILABLE` | 带错误返回给 agent 自纠 |
| agent 预算耗尽且自验证未过 | `CAPABILITY_UNAVAILABLE` | 如实返回未完成 + 剩余问题，不报成完成 |
| 沙箱违规（路径逃逸等） | `DETERMINISTIC_FAILURE` | 硬失败，不重试 |
| Brief 有实质缺口 | `NEEDS_INPUT` | 暂停等待用户，写入 `material_uncertainties` |
| 无满足必要能力的实例 | `CAPABILITY_UNAVAILABLE` | 进入 `BLOCKED`，向用户说明原因 |
| 生图被内容策略拒绝 | `POLICY_BLOCKED` | 该位置退化为无图设计，记录降级，不中止整个候选 |
| Contract 抽取失败 | `DETERMINISTIC_FAILURE` | 进入 `FAILED`，不产出空 contract |

工具返回的普通错误（命令失败、渲染报错、测试不过）**不是**上表中的任何一类。它们是给 agent 的
信息，agent 应该自己修（`agent-engine-spec.md` §4.3）。只有反复失败到耗尽预算才升级为错误。

部分候选失败时，**只要还有 ≥2 个成功候选就继续**，失败的候选记录原因；成功候选不足 2 个时整体
按上表处理。

成本边界：每个候选会话的 token、步数、时长与生图次数分别有上限
（`agent-engine-spec.md` §9）。超限按 `CAPABILITY_UNAVAILABLE` 处理并向用户说明，不静默截断。

## 9. 观测

每次运行记录：候选数、每候选的会话步数与 token 成本、自验证循环次数、生图次数与失败率、
预算超限率、降级项、`capability_version`。默认**不**记录 prompt、工具参数正文与生成正文
（`system-spec.md` §15.5、`runtime-recovery.md` §8），只记录摘要与哈希。

## 10. 首个场景的覆盖与未覆盖

选定场景「本仓库 → agent 前端页」含真实仓库输入，因此 Phase 3 的证据分层与来源定位路径
**会被真实验证**：仓库结构提取进入 `NATIVE_OBSERVATION`，模型对仓库语义的理解进入
`MACHINE_INTERPRETATION`，产出物中的事实能回溯到具体代码位置。

对照基准：仓库中已有一份人手写的 Phase 4 工作台前端（`product-client/`），可直接与 agent 产出物
比较，作为设计质量与事实准确性的评价参照。

本场景仍**未覆盖**：

- 参考图风格模仿（无参考图输入），`vision.understand` 留待第二个场景；
- 结构化文档解析（CSV/PDF/PPTX 等），Phase 3 的 CSV/PNG adapter 不在本路径上；
- 写用户仓库与启动真实后端（`agent-engine-spec.md` §12 明确本轮不实现）。

## 11. 待 spike 验证的技术假设

本规范的以下假设**必须**通过 spike 验证后才能进入 Phase 6，不得只凭文档决定
（`implementation-plan.md` Phase 5 退出条件）：

| # | 假设 | 状态 | 实测结论 |
|---|---|---|---|
| D1 | `k3` 的**工具调用**在长会话中稳定可靠 | ✅ **通过** | 120 次调用 **0 格式错误**；20/20 完成；注入故障后恢复率 100% |
| D2 | 候选之间能产生实质差异而非换色 | ⛔ **已证伪（agent 自选方向时）**，外部供给后成立 | 自选：分离度 6.7–12.2，5/5 收敛到同一隐喻。外部供给领地：分离度 87.1–95.0，**判据 6/6 分类正确、空隙 7.2×**（§4.2.3）。隐喻层仍收敛，按提示处理不阻断 |
| D8 | 处方性艺术方向能把外壳 token 收进阶梯 | ✅ **通过（n=6）** | 外壳 **6/6 为 5-6 色**，两条基底一致；对照组同口径为 13-23 色（`RESULT2.md` §4） |
| D3 | Design contract 抽取在 agent 自由产出的代码上稳定 | ✅ **通过（限计算样式路径）** | 计算样式 8/8 且 3× 确定；**源码正则 0/8 全失效** |
| D4 | Seedream 的尺寸/风格可控性满足配图需要 | ⛔ 阻塞 | 待凭据 |
| D5 | Seedream 输出的商用权利条款可确认 | ⛔ 阻塞 | 待凭据 |
| D6 | `design.critique` 的图像输入能力可绑定 | ✅ **通过** | `k3`/`k3-256k` 支持；**`kimi-for-coding` 不支持且静默返回空** |
| D7 | agent 能从只读仓库产出与仓库事实一致的内容 | ✅ **通过** | 0 矛盾；94.3% 严格可回溯（与 E3 共用） |

对应 ADR：**ADR-0003 能力平面与首批 provider 绑定**（已于 2026-08-03 接受）。

## 12. 验收条件

本规范被实现时，至少应能证明：

1. 从本仓库 + 一句需求，能产出 2–4 个可在浏览器中真实运行的候选前端项目；
2. 每个候选由一次 agent 会话产生，会话内可自由建文件、跑命令、渲染、自修，无需逐步审批；
3. 候选之间代表实质不同的产品选择，而不是同一版式换配色——且这个差异**可追溯到被分配的
   视觉领地**，不是指望模型自己想出来的；领地库中任意两块的分离度 ≥ 25（§4.2.3）；
3.1. 每个候选先产出一份可独立审核的 `ArtDirection`，用户能在写代码前否掉方向；
3.2. 用户可以选择实现基底（`bespoke` / `system` / 受限 `framework`）；前两条的外壳 token
阶梯相当，`framework` 必须满足 ADR-0005 的 strict six-token theme；
3.3. 产物声明 `data-oey-preview-root`，contract 分层抽取，外壳与内层的 token 不混算；
4. 每个候选带完整 `data-oey-*` 锚点，且锚点能被 Artifact Production 解析为 object registry；
5. agent 自造的 mock 层能把交互跑通，且 mock 声明如实随候选带到下游；
6. 产出物中陈述的仓库事实与 `repo/` 实际内容一致，且 `repo/` 未被修改；
7. `commit_direction` 产出确定性 design contract，同一份代码重复抽取结果一致；
8. `DIRECTION` 反馈开启新会话产出新 Candidate revision，历史保留，旧 approval 失效；
9. 生成图作为 `SourceAsset` 注册、带 `RightsStatus` 与 `EvidenceRecord`，无匿名内联资源；
10. Brief 只在实质缺口上触发 `NEEDS_INPUT`；能从仓库读出的事实不拿去追问用户；
11. 预算耗尽且自验证未过时，如实返回未完成状态，不把半成品报告为完成；
12. 四种模板角色影响可变范围，且在候选投影中可见；
13. 用真实实现替换 `DeterministicDesignPort` 后，Client 命令流程与 Project 状态机不变；
14. 项目状态与候选中不出现任何供应商 message、thread 或 tool schema。
