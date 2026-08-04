# ADR-0002：Web 渲染与验证技术

> 状态：**已接受**。
> 日期：2026-08-03。
> 决策范围：Web 预览、截图、交互检查、局部编辑验证与导出物重渲染。

## 上下文

Phase 6 要把 stub Artifact 替换为真实可运行 Web 项目。候选、Artifact、局部修改和最终导出都必须
经过同一套真实浏览器语义，否则 Design、Quality 与 Delivery 会看到彼此不一致的页面。A1–A8、
Q1/Q4/Q6 已证明系统 Chrome 可用、零网络路由拦截可行、计算样式和渲染后 DOM 可稳定抽取，导出物
重渲染能够逐文件及逐像素复验。

## 决策

- 采用 **Playwright + 系统 Chrome**（`channel="chrome"`）作为首个 Web renderer；不依赖运行时
  下载 bundled Chromium。
- renderer 是 trusted host service。生成代码不在 renderer 宿主权限下执行任意命令；页面脚本仍由
  Chromium renderer sandbox 承担第一层隔离。
- 默认拦截所有非本地请求。允许的本地 origin 由引擎创建并按 session 限定；产物不得依赖外链。
- 固定 render profile 至少包含浏览器版本、viewport、device scale、字体/vendor 包版本和 motion
  策略。结果记录 `capability_version`、console、page error、failed request、DOM/样式摘要与哈希。
- 锚点、颜色、字号、间距和可见性从**渲染后 DOM 与 computed style**抽取，不以源码正则替代。
- `render` 与 `export` 是两个独立操作。最终导出物必须从解包后的真实交付内容重新渲染并再次进入
  Quality，不复用 Artifact 阶段截图冒充交付验证。
- 局部修改视觉隔离阈值冻结为 `0.002`；不得为了让失败样本通过而放宽。
- 导出一致性同时验证 archive CRC、manifest、逐文件 SHA-256、资源请求和重渲染差异。

## 备选方案

### bundled Chromium

版本控制更直接，但当前环境没有下载，且会增加供给与缓存问题。系统 Chrome 已通过 spike，首版不
承担额外浏览器分发。

### 浏览器截图服务或云 renderer

便于集中运行，但引入网络、数据出境和外部可用性依赖。首个本地垂直切片没有必要。

### jsdom 或源码分析

不能证明布局、字体、实际交互、computed style 与浏览器错误，不满足真实渲染要求。

## 影响

正面影响是 Design 自验证、Artifact 验收、Quality 与 Delivery 共用一套浏览器事实；代价是 P6 必须
提供系统 Chrome、字体/vendor 固定和 host renderer 生命周期管理。截图原图默认不进入长期观测，
只保存受控实验物料或用户批准的诊断资产。

## 替换条件

只有在目标部署环境无法稳定提供系统 Chrome、需要多浏览器兼容门，或 renderer 吞吐成为实测瓶颈时
才重新评估。替换方案必须先通过 A1–A8/Q1/Q4/Q6 conformance，并保持 computed-style、零外链、
导出重渲染和 `0.002` 阈值语义。
