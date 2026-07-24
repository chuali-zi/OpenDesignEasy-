# Phase 3：Context & Evidence 最小基线

> 状态：v0.1，2026-07-24 采用。
> 上位规范：system-spec、implementation-plan、contract-skeleton、runtime-recovery。
> 范围：原件接入、最小解析、证据分层、来源、权利、Brief/Constraint 确认与 Context Package。

## 1. 目标与非目标

Phase 3 让真实输入先成为可追踪的项目证据，再进入 Design、Artifact 和
Quality 端口。本阶段必须保留原件、项目归属和来源定位，并严格区分原生观察、
机器解释与人工确认。

本阶段只用一种结构化文件和一种图片格式证明边界，不实现通用 OCR、PDF、
PPTX、DOCX、仓库语义、向量检索或真实模型解释，也不选择这些能力的最终技术。

## 2. 最小领域对象

| 对象 | 最小语义 |
|---|---|
| Source Asset | Project 内版本化原件身份、摘要、媒体类型、受控存储引用和权利状态 |
| Source Locator | 指向 Source 内稳定区域，如 CSV row/column 或图片整体/区域 |
| Evidence Record | 一条带 layer、locator、confidence、rights 和 lineage 的观察或结论 |
| Context Package | 已确认事实、可追踪来源、允许用途的资产、实质不确定性和版本 |
| Brief Record | Design Brief 草案及人工确认状态 |

上述对象不得退化为聊天消息、供应商文件 ID 或解析器私有 row。Source、Evidence
与 Context Package 的 revision 只追加；确认或纠正会创建新记录，不覆盖原始观察。

## 3. 三层证据

证据层固定为：

1. `NATIVE_OBSERVATION`：直接解析或测量出的内容，例如 CSV 单元格、PNG 尺寸；
2. `MACHINE_INTERPRETATION`：OCR、视觉或语言能力的解释，必须有 confidence 和
   derived-from 引用；
3. `HUMAN_CONFIRMATION`：用户确认或纠正的事实/要求，指向被确认记录并保留原值。

机器解释永远不能因 confidence 较高而自动改写为人工确认。Context Package 的
confirmed facts 默认只来自人工确认；确定性结构元数据可作为观察进入 metadata，
但不能伪装成用户事实。

## 4. 原件接入与安全初检

- Client/API 提交 bytes 与声明元数据；解析器不得读取调用方给出的任意本地路径；
- Source 必须绑定一个 Project，并以内容摘要形成稳定身份；
- 原件写入显式 application data root 内的哈希路径，原始文件名只作为清洗后的元数据；
- 接入前检查大小、声明媒体类型、magic/header、可解码性和结构上限；
- 拒绝 NUL/控制路径、类型伪装、越界引用、超限输入和畸形图片头；
- 原始正文不进入默认 Project event、workflow event 或 audit metadata。

reference adapter 支持 UTF-8 CSV 与 PNG header。adapter 输出统一领域对象；未来
替换解析库时，不得要求 Control Plane 或三个核心端口改变流程。

## 5. 来源定位与权利

每条可用事实或图片必须能解析回 `Source Asset + revision + locator`。CSV locator
至少包含 row 与 column；图片 locator 至少能表示整图，未来可增加 page、frame、
object 或 region 而不改变 Context Package 接口。

权利状态固定为：

- `UNKNOWN`：可按安全策略分析，默认不得进入交付；
- `ANALYSIS_ONLY`：只用于理解与风格参考；
- `CLEARED_FOR_DELIVERY`：可进入候选或交付资产；
- `PROHIBITED`：不得用于分析之外的任何生产路径，策略也可以完全拒绝。

人工确认事实不等于确认资产权利。只有 `CLEARED_FOR_DELIVERY` 的 Source 才能进入
Context Package 的 delivery asset refs；其他 Source 仍保留来源和分析用途记录。

## 6. Brief、Constraint 与 NEEDS_INPUT

Context assembler 接收所需事实键、所需交付资产、Brief 草案与有效 Constraint
Profile。只有以下实质问题进入 `material_uncertainties`，并由现有 Control Plane
转为 `NEEDS_INPUT`：

- 缺少会改变事实、品牌、权利或结构的必需确认；
- 必需解释低于阈值且尚未人工确认；
- 必需交付资产权利未知、仅分析或禁止使用；
- 输入被安全策略拒绝，或所需结构无法由当前 capability 可靠读取。

普通视觉偏好、可由候选探索的风格差异和非关键低置信观察不触发强制追问。
Design Brief 与 Constraint Profile 必须显式确认后才随 Context Package 进入
`READY_FOR_DESIGN`。

## 7. 端口与持久化边界

最小 replaceable ports 为：

~~~text
ingest(project, bytes, media_type, rights) -> Source Asset
parse(source) -> Native Observations
interpret(observation, capability) -> Machine Interpretations
confirm(evidence, corrected_value?) -> Human Confirmation
assemble(project, requirements, brief, constraints) -> Context Package
resolve(project, source_ref) -> Source + Locator
~~~

Source metadata、Evidence 和 Context Package 可持久恢复；原件正文保存在受控文件
存储。数据库只保存相对 storage ref、摘要和结构化记录。adapter 不拥有 Project
状态，也不能绕开 Control Plane 将未确认事实发布为当前 Context Package。resolver
必须校验调用方 Project scope，不能仅凭其他项目的 locator 读取原件。

## 8. Phase 3 验收

自动化验收至少证明：

1. CSV 事实与 PNG 观察可以回到原件和稳定 locator；
2. 原生观察、机器解释和人工确认互不覆盖且 lineage 完整；
3. 低 confidence 解释不进入 confirmed facts；
4. 权利未知或 analysis-only 图片不进入 delivery asset refs；
5. 只有实质缺口产生 `material_uncertainties` 与 `NEEDS_INPUT`；
6. Brief 与 Constraint 确认后可进入现有 Design stub 流程；
7. 关闭并重新打开 evidence repository 后 Source、Evidence 和 Context Package 可恢复；
8. 越界路径、超限、媒体类型伪装与畸形输入被拒绝；
9. 替换结构化 adapter 后，下游接收相同 Context Package 契约；
10. 核心对象与事件不含供应商响应或 parser 私有 schema。
