# Artifact Production 内部规范

> 状态：**v0.4，已于 2026-07-30 审核通过并冻结。**
> 依据：spike A3（n=20，锚点/契约/渲染健康 20/20）、A4/A5/Q6/A6 全部通过；
> v0.3 遗留的暂缓冻结原因（见下）已解除。冻结后的变更必须通过版本化 Spec 或 ADR。
> v0.3 暂缓冻结的原因是「若组件框架路线胜出，§3 与 §6 必须放开构建步骤与 CDN 依赖」。
> 审美实验第二轮证伪了这个前提（`spikes/aesthetic-ab/RESULT2.md` §2）：框架路线通过
> **离线 vendor 包**即可成立，6/6 产物在零网络下渲染结果与联网版逐项一致。
> 因此 §6 的「默认无网络」**不放开**，§3 只增加一类 `assets/` 内容。见 §3.1。
> 上位规范：`system-spec.md` §7.2/§13.1、`contract-skeleton.md` §6.2、
> `design-intelligence-spec.md`、`agent-engine-spec.md`。
> 范围：Artifact Production Port 的内部子模块、Web 工作表示、对象标识、真实渲染、导出与取舍语义。
> 首个垂直媒介：Web。PPT/DOCX 只声明扩展契约位。
> 规范化扩展：ADR-0005 已于 2026-08-03 接受受限 `framework` Artifact 树、固定构建 profile
> 以及源码 + 已验证 `dist/` 的交付口径；其他基底仍遵循本规范原文。

## 1. 目的与边界

本规范确定「把 Approved Design Direction 变成稳定产物」这件事在内部怎么做。它消费
`design-intelligence-spec.md` §3 定义的 design contract 与 baseline 代码，并驱动
`agent-engine-spec.md` 定义的引擎执行局部修改。

本规范不改变 `src/oeydesign/ports.py:289-321` 中 `ArtifactProductionPort` 的方法签名，不定义质量
阈值，不决定 PPT/DOCX 的内部 IR，不定义引擎内部机制。

本规范不覆盖：多页站点的路由与导航生成、CMS 式内容管理、真实域名部署、PPT/DOCX 生产者实现、
写用户仓库、启动用户真实后端（后两项见 `agent-engine-spec.md` §4.3，本轮不实现）。

### v0.2 变更

v0.1 把 Web 产物写成 `index.html + styles.css + assets/` 三个静态文件，违反了 `system-spec.md`
§13.1「必须拥有**可运行项目**或等价的可交付源码」。v0.2 修正：§3 改为可运行项目；§4.3 从「事前
限制模型只能看片段」改为「事后验证无关锚点未变」；新增 §4.7 mock 声明与 §6 预览隔离要求。

## 2. 核心边界：Production 不重新设计

Artifact Production **不得**重新推理设计。它的输入是一份已经批准的完整页面代码，它的工作是把这份
代码变成可交付、可定点修改、可真实验证的产物。

这是不变量 12 与 `system-spec.md` §12 的落点：Production 不得在未记录的情况下改变 Design
Direction。必要的媒介适配必须形成可审阅差异，并写入 §7 的取舍记录。

由此，本模块与 Design Intelligence 的分工是清晰的：

- 「整体换个做法」→ Design Intelligence 重出整份（新 Candidate revision）；
- 「这里改一下」→ Artifact Production 定点改写（新 Artifact revision）。

两者都会调用模型，但作用域完全不同。

## 3. Web 工作表示

Artifact 是一个**可运行项目**，不是一个字符串，也不限于三个静态文件
（`system-spec.md` §13.1）。

```text
artifact/
  index.html
  <agent 自行决定的结构：CSS、JS、组件、模块…>
  mock/          agent 自造的假后端层（如有）
  assets/        已注册 SourceAsset 的副本 + 离线 vendor 包（见 §3.1）
  MOCK.md        mock 声明清单（如有 mock）
```

**目录结构由 agent 决定，不由本规范规定。** 规定结构等于限制模型自由，而首个媒介的产物形态本来
就应该随任务变化。本规范只要求：有一个可加载的入口、锚点完整、mock 有声明、**零外链**（§3.1）。

`ArtifactRevision`（`src/oeydesign/domain.py:534`）新增一个可选字段承载文件集合：

```python
files: Mapping[str, str] | None = None    # 相对路径 -> 内容或 storage_ref
```

现有的 `content` 字段保留为入口页面的内容，以免破坏 Phase 4 的持久化与 Product Shell 预览。
`files` 为 `None` 时按单文件产物解释，向后兼容 `DeterministicArtifactPort`。

大文件与二进制资产**不**入库，只存 `storage_ref` 并指向受控数据根（ADR-0001）。

### 3.1 离线 vendor 包：产物不得依赖外链

产物**不得**含任何外部 URL。需要设计系统（Tailwind 等）或 Web 字体时，走 vendor 包：

```text
assets/
  fonts/fonts.css + <族名>/*.woff2     字体供给表中被选用的族
  tailwind.js（或等价的设计系统文件）   固定版本的单文件产物
```

规则：

- vendor 包在**沙箱之外、生成期之前**预取，产物只引用相对路径。取包不是产物运行时的一部分，
  因此 §6 的「渲染环境默认无网络」**不需要为框架路线放开**。
- vendor 包**必须**固定版本并记录内容哈希。「取最新」会让同一份产物在不同时间渲染出不同结果，
  破坏 §4.1 「交付化不得改变渲染结果」的自检条件。
- vendor 包**必须**作为 `SourceAsset` 注册并随 `ExportCandidate.manifest` 进入交付物，
  与生成图同一通道——拿到产物的人要能知道里面打包了什么第三方资产及其版本。
- **字体供给表是一个封闭选项集**：创作阶段只能从已离线可用的族里选。这不只是离线要求，
  它防的是产出一个「必须联网才好看」的产物。
- 表中**必须**包含 CJK 族。缺 CJK 字形时浏览器静默回退到系统字体，
  设计方向在中文文本上完全失效，而这种失效在截图上不报错、只是变难看。

> 依据：`spikes/aesthetic-ab/RESULT2.md` §2。第一轮曾断言「Tailwind 必须走 CDN，
> 框架路线与零 capability 沙箱不可调和」。实测把 Play CDN 脚本预取为本地文件后，
> 6/6 产物在放行列表清空的渲染器下**外链阻断数为 0、指标与联网版逐项一致**。
> 同一轮还发现：非框架组的产物同样在拉 Google Fonts——离线资产供给是所有路线的
> 共同前提，不是框架路线的专属代价。

## 4. 内部子模块

### 4.1 Materializer

输入：`ApprovedDirection`（baseline 代码 + design contract）+ 候选工作区 + medium +
fidelity_mode + 约束。
输出：`ArtifactRevision`，`revision = 1`，`parent_revision = None`。

工作是**交付化**，不是再设计：

- 从已批准候选的工作区派生出 Artifact 工作区（`agent-engine-spec.md` §3）；
- 把代码中引用的生成图从 `SourceAsset` 复制进 `assets/`，改写为相对路径；
- 收敛开发期残留（未使用文件、调试代码、临时产物）；
- 保留全部 `data-oey-*` 锚点，一个不丢；
- 保留 agent 的 mock 层与其声明（见 §4.7）。

规则：

- 输入方向**必须**已获批准，或被显式标记为仅用于候选预览（`system-spec.md` §7.2）。
  未批准方向进入正式 `materialize` 报 `INVALID_TRANSITION`。
- 交付化**不得**改变渲染结果。处理前后的渲染截图必须一致——这是 Materializer 的自检条件。
- `direction_id` 记录派生关系，使 Artifact 能回溯到它的设计方向。

### 4.2 Object Registry

输入：Artifact 的 HTML。
输出：`ArtifactRevision.object_refs`（`domain.py:543`）。

扫描 `data-oey-section` 与 `data-oey-object` 生成 `逻辑名 -> CSS 选择器` 映射，取代
`stubs.py` 中的三条硬编码。

定位优先级与降级（`system-spec.md` §12、`contract-skeleton.md` §7）：

```text
稳定锚点  ->  页面区块  ->  整个 Artifact
```

规则：

- 锚点在 revision 之间**必须**尽可能稳定。定点编辑不得重命名或删除未涉及的锚点。
- 无法定位时**必须**显式降级并告知用户降级到了哪一级，**不得**猜测对象。
- 锚点集合与 design contract 中的 anchors 清单不一致时报告差异；这是 Quality 判定「结构偏离」的
  输入之一。

### 4.3 Local Editor

`ARTIFACT_LOCAL` 反馈进入这里，是一次**受声明作用域约束**的 agent 会话。

输入：`FeedbackRecord`（`domain.py:636`，含 `object_ref`）+ 完整 Artifact 工作区 +
design contract + 声明作用域。
输出：新的 `ArtifactRevision`，`revision + 1`，`parent_revision` 指向前一版。

**约束方式是事后验证，不是事前限制。** agent 拿到**整个工作区**——它需要看到上下文才能做出不
破坏整体的局部修改，例如共享的 CSS 变量、组件复用关系、mock 层的数据形状。告诉它作用域，让它
自己判断怎么改最合适，改完再验证。

会话结束后**必须**通过以下验证，任一不过即按 §8 重试：

| 验证项 | 判据 |
|---|---|
| 锚点保留 | 作用域外的 `data-oey-*` 锚点全部原样存在 |
| 契约保持 | design contract 的 token 未漂移 |
| 视觉隔离 | 见 §4.3.1 的分层判据 |
| 渲染健康 | 无新增 console error、无新增未加载资源 |

这样既满足「局部反馈不重新生成完整方向」（`system-spec.md` §11.3），又不用把模型的视野切碎。
同样的保证，更大的自由度。

**实测支持**（spike A3 最终数据，n=20，五类编辑各 4 轮，连续链式、失败不重置）：

| 检查 | 通过率 |
|---|---|
| 锚点保留 | **20/20** |
| 契约保持 | **20/20** |
| 渲染健康 | **20/20** |
| 视觉隔离 | 19/20（L3 已比较 18/19，另 1 次 `reflow_skipped`） |
| 四项 `all_pass` | **19/20** |

模型拿到完整工作区后，在改文案/改属性/改结构/删元素/加元素五类编辑下，
**从未**改动作用域外的锚点、**从未**引入新 token。「给整页会导致到处乱改」的担心
未被数据支持，本设计成立。

**但不能写成 20/20。** 第 1 轮的视觉隔离失败是**真实**的作用域外像素移动
（同尺寸比对、差异达阈值 23 倍），不是 harness 缺陷——独立视觉验证确有必要，
不能因为「源码只改了作用域内」就跳过。详见 §4.3.2。

### 4.3.1 视觉隔离的分层判据

**不能**用「整页逐像素比对」作为唯一判据。实测：编辑大段文本（标题、副标题）会改变换行 →
页面高度变化 → 整页截图尺寸不一致 → 逐像素比对**根本无法执行**。而改文案恰恰是最常见的
局部编辑。把这种情况判为失败是错的——**尺寸变化是合法编辑的正常结果，不是违规**。

按以下顺序判定：

| 层 | 判据 | 适用范围 |
|---|---|---|
| 1 | 作用域外锚点的**几何关系**未变（相对顺序与相对位置关系） | 总是适用，对回流免疫 |
| 2 | 固定视口截图中，**编辑元素之上**区域的像素差异在阈值内 | 回流只影响下方，上方应完全不变 |
| 3 | 整页逐像素比对 | **仅当**两次渲染尺寸一致时执行 |

规则：

- 第 3 层在尺寸不一致时**必须**标记为「因回流跳过」（`reflow_skipped`），**不得**判为失败；
  报告中「跳过」与「已比较通过」**必须分开计数**，不得合并成一个通过率；
- 阈值固定为 **0.002（千分之二）**，**不得为了让检查通过而放宽**。A3 最终数据（n=20）里
  第 1 轮 L2 差异达 0.0466（阈值的 23 倍），是真实的作用域外像素移动，放宽阈值只会掩盖它；
- 三层中任一层检出真实越界即判失败。

### 4.3.2 失败后自动扩大作用域，重试一次

**「回流只影响下方」是错的。** A3 最终数据推翻了这个假设：第 1 轮源码只改了作用域内的
`hero-subtitle` 文案，但它所在的 `.hero-grid` 用了 `align-items:center`，高度从 51.19px 降到
25.59px 后，**同栏中作用域上方的 kicker/title 下移了 12.80px，下方的 CTA/stats 上移了同样距离**。
L1 几何关系检查通过（关系未变），L2/L3 正确检出了真实的作用域外像素移动。

因此引入「渲染影响作用域」概念：**声明作用域是源码作用域，它的渲染影响可以外溢到最近的布局容器。**

失败后的处理**必须**是扩大作用域重试，**不是**放宽阈值：

```text
视觉隔离失败
  ↓
把声明作用域扩大到目标元素**最近的布局容器**
（最近的 flex / grid / 有 position 上下文的祖先）
  ↓
以扩大后的作用域重新执行四项验证（重试 1 次）
  ↓
仍失败 → 按 §8 报 RETRYABLE 交回 agent；
        再失败 → 提示这是方向级变化，应走 DIRECTION 路径
```

规则：

- 自动扩大**最多一次**，不得逐级向上扩到整页——那等于取消作用域约束；
- 扩大后的作用域**必须**记录在 `ArtifactRevision.tradeoffs` 中，让用户知道「这次局部修改实际
  影响了整个 hero 区块」，不得静默扩大；
- 扩大作用域**不改变**锚点保留与契约保持两项的判据——那两项在 A3 中 20/20 通过，
  不需要放松。

补充规则：

- 编辑**不得**改动 design contract 中的 token。需要改 token 的诉求本质是方向变化，报
  `INVALID_TRANSITION` 并提示用户走 `DIRECTION` 路径。
- `object_ref` 为 `None` 时按 §4.2 的降级链确定作用域，作用域相应放大，但验证规则不变。
- agent 可以在会话中反复渲染自查（`agent-engine-spec.md` §6），上表的验证是**引擎之外**的
  独立复核，不依赖 agent 自觉。

### 4.4 Renderer

输入：`ArtifactRevision` + render profile。
输出：`RenderBundle`（`domain.py:548`）。

在隔离执行边界内用 headless 浏览器真实加载产物，采集：

- 代表性视口的截图（至少桌面宽屏与窄屏两档，对应 Phase 4 已有的窄屏折叠要求）；
- console 错误与警告；
- 网络请求失败与未加载资源；
- 布局溢出与元素重叠信息；
- 字体加载结果；
- **交互可用性**：产物含 JS 与 mock 层时，按声明的交互路径实际点击并采集结果。

规则（不变量 7）：

- 渲染**必须**是真实浏览器结果，**不得**以编辑器预览、DOM 静态分析或模型自述替代。
- 渲染环境默认**无网络**，只能访问 `assets/` 中已注册的资产与本地 mock 层。外链资源加载失败是
  需要报告的事实，不是需要绕过的障碍。
- 渲染器**不得**为任何域名设放行例外。产物需要第三方资产时走 §3.1 的 vendor 包。
  设了例外，「离线可渲染」这条性质就只在渲染器里成立、在真实交付环境里不成立——
  第一轮实验正是因为放行了 CDN 与 Google Fonts，才没能发现四个产物其实都依赖网络。
- 产物需要 dev server 才能运行时，在沙箱内起服务、仅回环可达（`agent-engine-spec.md` §4.2），
  渲染结束即回收。
- 渲染有时间与内存上限；超限报 `RETRYABLE`，重试耗尽转 `DETERMINISTIC_FAILURE`。
- 截图与采集结果是 Quality 审美轨的**唯一**输入依据（见 `quality-governance-spec.md`），
  同时也是引擎自验证闭环的输入（`agent-engine-spec.md` §6）。两者用同一个渲染器。

### 4.5 Exporter

输入：`ArtifactRevision` + delivery profile。
输出：`ExportCandidate`（`domain.py:559`）。

打包为可交付的静态站点（目录或压缩包），写入受控数据根，`manifest` 记录 medium、fidelity_mode、
格式与文件清单。

规则：

- `render` 与 `export` 是**不同**操作，不得互相替代（`system-spec.md` §7.2）。
- 导出物**必须**能重新进入验证：导出后的产物要能被 Renderer 再次真实加载，而不是只做一次哈希校验。
  最终交付门依据的是这次重新渲染的结果。
- 写文件是外部副作用，**必须**使用稳定幂等键（`contract-skeleton.md` §7）。同一 Artifact revision
  与同一 delivery profile 的重复导出不得产生第二份交付。

### 4.6 Tradeoff Reporter

无法同时满足可编辑与保真时，**必须**返回显式取舍，写入已存在的 `ArtifactRevision.tradeoffs`
（`domain.py:544`），**不得**静默降级（`system-spec.md` §7.2）。

Web 场景下的典型取舍：字体无商用授权而替换为系统字体栈、动效在 `prefers-reduced-motion` 下的
退化形式、生成图分辨率不足而缩放。每一项都要说明「放弃了什么、换来了什么」。

### 4.7 Mock 声明

agent 自造的 mock 后端（`agent-engine-spec.md` §10）让交互在没有真实后端时也能跑通。这是引擎
能力的正常产物，**不是缺陷**——但它是一个**保真声明**，必须可见。

规则：

- Materializer **必须**保留 agent 的 mock 声明清单（mock 了哪些接口、数据是假的还是从仓库推导的）；
- 声明**必须**写入 `ArtifactRevision.tradeoffs`，与其他取舍同一通道；
- 声明**必须**随 `ExportCandidate.manifest` 进入交付物，使拿到产物的人知道哪些是假的；
- Quality 层据此判定：`demo` delivery profile 下是提示，`production` delivery profile 下是硬错误
  （`quality-governance-spec.md` §3.1）。

这条防的是把假后端当真后端交付出去。它不限制 agent 造 mock 的自由，只要求说实话。

## 5. 端口映射

| 端口方法（`ports.py`） | 内部子模块 |
|---|---|
| `materialize` (:292) | Materializer + Object Registry |
| `apply_artifact_change` (:302) | Local Editor + Object Registry |
| `render_artifact` (:309) | Renderer |
| `export_artifact` (:316) | Exporter |

四个方法的签名、参数与返回类型**不变**。

## 6. 隔离、安全与预览

渲染、打包、构建和 agent 会话**必须**走同一个隔离执行边界（`system-spec.md` §6.6，
细则见 `agent-engine-spec.md` §8）：

- 生成的代码视为不可信输入；
- 默认无网络、无凭据、无项目范围外的文件系统访问；
- 有时间、内存与输出大小上限；
- 隔离边界**不得**被用来绕过 Control Plane 的审批与审计。

Windows 是当前主要开发平台，隔离方案必须在 Windows 上可用——这是 §9 与
`agent-engine-spec.md` E1 的共用 spike 项。

**预览隔离**：产物现在含 JS 与 mock 层，Product Shell 不能再用简单的 `srcdoc` iframe 直接渲染。
`system-spec.md` §6.7 已要求 Preview & Delivery 提供**隔离预览**。Phase 6 需要：

- 产物在受限来源下提供（独立 origin 或严格 CSP 沙箱 iframe），不与工作台共享同源；
- 产物中的脚本**不得**访问工作台的 API、存储或事件流；
- 需要 dev server 的产物由预览层在沙箱内起停，Client 只拿到预览地址。

这项改造属于 Phase 6 范围，不修改 Phase 4 的验收记录。

## 7. 模板角色的结构保留

延续 `contract-skeleton.md` §7，具体化到 Web 生产：

| 角色 | Artifact Production 的保留义务 |
|---|---|
| 参考样例 | 不要求保留结构，只保留锚点可寻址性 |
| 起始脚手架 | 保留有用的对象关系与锚点命名 |
| 设计系统 | 保留系统语义：token 引用不得被内联为字面值 |
| 交付合同 | 保留锁定结构：锁定区域的 DOM 与样式原样不动 |

## 8. 失败与重试

| 情况 | 错误类别 | 处理 |
|---|---|---|
| 未批准方向进入正式 materialize | `INVALID_TRANSITION` | 不执行 |
| 交付化前后渲染不一致 | `DETERMINISTIC_FAILURE` | 进入 `FAILED`，不产出 Artifact |
| 局部编辑的事后验证不过（§4.3 表） | `RETRYABLE` | 带具体失败项返回给 agent 重做，上限 2 次 |
| 局部编辑试图改动 contract token | `INVALID_TRANSITION` | 提示改走 `DIRECTION` 路径 |
| agent 预算耗尽且验证未过 | `CAPABILITY_UNAVAILABLE` | 如实返回未完成，保留工作区可诊断 |
| 沙箱违规 | `DETERMINISTIC_FAILURE` | 硬失败，不重试 |
| 渲染超时或超内存 | `RETRYABLE` → `DETERMINISTIC_FAILURE` | 有界重试 |
| 导出目标已存在同一幂等键 | 幂等返回 | 返回既有 `ExportCandidate`，不重复写 |

## 9. PPT / DOCX 扩展契约位

本规范不定义 PPT/DOCX 的内部 IR、编辑器与 exporter。它只声明一条扩展契约：

**同一个 `ApprovedDirection`（baseline 代码 + design contract）可以被独立的媒介生产者消费，各媒介
不复制项目、反馈与质量逻辑。**

具体地：

- 媒介生产者从 design contract 取 token 与内容结构，**不**从 Web 的 HTML 直接转换；
- 每个 Artifact 属于**单一**目标媒介（`system-spec.md` §7.2），不存在跨媒介的同一 Artifact；
- 一个 Project 可以有多个媒介 Artifact，各自维护生产状态，共享上层方向与上下文
  （`system-spec.md` §9）；
- 新增媒介**必须**通过同一个 `ArtifactProductionPort`，不得复制一套独立的项目与聊天架构
  （`implementation-plan.md` Phase 7）。

Web 的流式布局与 PPT 的绝对定位不可调和，这正是不使用统一视觉 IR 的原因
（`system-spec.md` §2.2）。各媒介从同一份语义契约独立物化，是「语义共享、媒介分流」（不变量 5）
在本模块的实现形式。

## 10. 观测

每次运行记录：Artifact revision 链、锚点数量与稳定性（跨 revision 的保留率）、局部编辑的作用域
大小与事后验证通过率、渲染耗时与失败原因分布、交互检查结果、导出大小、取舍项与 mock 声明、
`capability_version`。默认不记录页面正文与截图原图。

## 11. 待 spike 验证的技术假设

| # | 假设 | 状态 | 实测结论 |
|---|---|---|---|
| A1 | headless 浏览器可引入 | ✅ **通过** | Playwright 可用，但 **bundled chromium 未下载**，必须用 `channel="chrome"` 走系统 Chrome |
| A2 | 隔离渲染与沙箱在 Windows 上可行 | ✅ **通过** | 外链经 `route.abort` 阻断且可采集；1GB 内存够、150MB 不够 |
| A3 | 声明作用域的局部编辑不破坏整页 | ✅ **通过（n=10）** | 锚点/契约/渲染 **10/10**；「视觉隔离」判据本身需改写，见 §4.3.1 |
| A4 | 交付化处理不改变渲染结果 | ⬜ **未跑** | harness 就绪 |
| A5 | 导出物重渲染与 Artifact 渲染一致 | ⬜ **未跑** | harness 就绪 |
| A6 | 交互可用性可自动检查 | ⬜ **未跑** | harness 就绪，已实现 `INTERACTIONS.json` 机器可读交互清单 |
| A7 | 隔离预览满足「可运行」且「不触碰工作台」 | ⬜ **未跑** | — |
| A8 | 依赖设计系统/Web 字体的产物能在零网络下渲染 | ✅ **通过（n=6）** | 离线 vendor 包后 **6/6 外链阻断数 0**，颜色数/字号阶/console error 与联网版逐项一致（`RESULT2.md` §2） |

A3 的样本量是计划的一半（10/20），且编辑类型单一（全是改文案）。**未测**改结构、改属性、
删/加元素等更激进的局部编辑——这些更可能触发越界，补测时应优先覆盖。

对应 ADR：**ADR-0002 Web 渲染与验证技术**、**ADR-0004 Agent 工作区与沙箱边界**
（均已于 2026-08-03 接受）。

## 12. 验收条件

本规范被实现时，至少应能证明：

1. 已批准方向能物化为可在浏览器中真实运行的 Web 项目（含 JS 与 mock 层），且交付化处理不改变
   渲染结果；
2. `object_refs` 由锚点扫描生成，覆盖产物全部可寻址区块，无硬编码；
3. 局部编辑的 agent 会话拿到完整工作区，完成后四项事后验证（锚点保留、契约保持、视觉隔离、
   渲染健康）全部通过；
4. 局部编辑试图改动 design contract token 时被拒绝并提示改走方向路径；
5. 渲染产出真实截图、console 错误、视口信息与交互检查结果，且在无网络环境下完成；
   使用设计系统或 Web 字体的产物同样如此，渲染器无任何域名放行例外；
6. mock 声明进入 `tradeoffs` 与 `ExportCandidate.manifest`，拿到产物的人能知道哪些是假的；
7. `render` 与 `export` 是不同产物，导出物能被重新渲染并再次进入 Quality；
8. 同一 Artifact revision 与 delivery profile 的重复导出幂等，不产生第二份交付；
9. 可编辑与保真的冲突写入 `tradeoffs` 并在界面可见，无静默降级；
10. 四种模板角色的结构保留义务可观察，交付合同的锁定区域不被改动；
11. 隔离预览下，产物脚本无法访问工作台 API、存储或事件流；
12. 用真实实现替换 `DeterministicArtifactPort` 后，Client 命令流程与 Project 状态机不变。
