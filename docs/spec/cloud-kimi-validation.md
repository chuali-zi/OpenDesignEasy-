# 云环境 Kimi 检查与离线验证

2026-10-13，基于 `feat/studio` 的 `6f754fe9b1cee72da616a71c14ae1ddf6d3c9477`。
本记录不替代 R2/R3 历史验收，也不代表 R4–R7 已完成。

## 已核对

- 当前是全 TypeScript / Pi SDK 路线；初始工作树干净。保存环境仅有旧 Python `origin/main` 远端跟踪引用；未联网刷新、未切回 main。
- 安装的 Pi 0.85.1 原生 provider 为 `kimi-coding`，模型 `k3`，协议 `anthropic-messages`，base URL 为 `https://api.kimi.com/coding`。SDK 实际请求路径为 `/coding/v1/messages?beta=true`。
- 只检查注入的 `KIMI_API_KEY` 是否存在，结果为存在；没有 `.env` 文件。未读取凭据文件或输出环境变量值。
- 初轮网络配置为仅包管理器预设、额外域名为零，所以初轮没有真实模型请求。后续父会话发布 `api.kimi.com` 放行后进行的一次尝试，见下文；未绕过网络限制。

## 有限额的文本探针

### 当前用户指定：K2.8 Preview

用户随后明确指定 K2.8，替代此前 K3 计划。2026-10-13 核对 [Kimi 官方模型配置](https://www.kimi.com/code/docs/en/kimi-code/models.html) 和 [2026-09-11 发布记录](https://www.kimi.com/code/docs/en/kimi-code/whats-new.html)：K2.8 Preview 的 Kimi Code API ID 是 **`kimi-for-coding`**，属于原 ID 的服务端升级；不是猜测的 `kimi-k2.8`。官方支持 Anthropic compatible base URL `https://api.kimi.com/coding/`。

已安装 Pi 0.85.1 包含该 ID，协议为 `anthropic-messages`、base URL 相同，但显示名仍为 `Kimi K2.7 Code`，contextWindow 仍为 262144；这是安装包的旧元数据，不能据显示名否定官方服务端映射，也不能声称已经在线确认账户返回版本。本探针不依赖升级后的大上下文，不修改依赖或凭据。

探针和旧 native 验收脚本已改用准确的 `kimi-for-coding`。探针显式发送 `thinking: { type: 'disabled' }`，避免 Pi 的 `thinkingEnabled: false` 仅省略字段后触发服务端默认 thinking。响应 model 若与请求 ID 不同则返回 `model_mismatch` 并停止，不自动接受或改发 K3。新增错模型响应与传输失败诊断回归检查，探针离线测试 **12/12 通过**，随后类型检查再次通过。

父会话已确认发布仅新增 `api.kimi.com` 的网络设置，版本 `4100c903-5d17-4e2a-ad83-a6af45bef9fb~cecfgver_6acd9e54a560819582a0af95c24ece42`。在该确认后使用现有注入凭据、Node 24.21.0 执行 **唯一一次**有界合成文本探针：本地传输尝试计数 1，结果 `transport_error`，未取得 HTTP 状态或模型响应。没有重试，没有切换模型，没有运行工具验收。

此次 SDK 初始 usage 为零，不能解释为服务端用量或计费确认；实际服务端 usage **不可用**。失败时未保存原始错误细节，所以不能凭结果区分 DNS、TLS、代理或策略问题。随后补充了离线验证的诊断保护：仅输出白名单错误代码；无模型响应时 usage 为 null、响应 model 不输出，避免把初始化数据当作响应。这项补充没有再发真实请求。

当前工具未提供运行中容器的网络刷新接口，也没有证据证明一定需要重建。需要平台确认新策略是否适用于现有进程；若本容器仍受旧策略约束，应通过平台刷新或启动使用新配置的任务。下一次真实请求须另行确认，不自行绕过或重试。

`npm run check:kimi` 默认只做离线元数据和变量存在性检查，不加载项目、`.env`、磁盘凭据或工具。

在网络确已允许 `api.kimi.com` 且单次测试获得授权后，使用：

```sh
npm run check:kimi -- --live
```

该入口直接使用 Pi 公共 Anthropic messages adapter 和安装包内的原生 Kimi 模型定义；不经过 OEY 项目会话，不受 `BASE_URL` 或 `MODEL` 环境覆盖。只发送固定合成句子，要求回复 `OK`。传输层核对官方目标、模型和消息内容，最多一次请求、256 输出 tokens、30 秒总时限、零自动重试、禁止 HTTP 重定向。输出只有状态与 token usage，不回显响应正文、请求头或 SDK 错误详情。测试不证明工具、视觉、多轮或完整项目能力。

`npm run test:kimi` 用假凭据和本地模拟传输验证序列化、usage、错误不重试、不回显内容、30 秒取消、无密钥/无文件入口、错模型响应与受限错误代码等 12 项行为；也纳入 `npm test`。

初轮仅给旧 `check-r3-native.ts` 增加误运行保护时，整轮预算尚未实现，因此没有执行。后续该入口已替换为两次模型请求、一次只读工具的合成验收，并在 Pi 会话边界实现整轮预算/超时/失败清理；详细限制、离线证据与下一轮授权范围见[整轮 Agent 有界验收](agent-budget-validation.md)。新入口也未在本容器执行。

### 父会话补充的新任务结果

父会话随后明确报告：使用新配置启动的独立任务已完成 K2.8 `kimi-for-coding` 文本探针，HTTP 200、回复 OK、input 22/output 11/total 33、2.15 秒、Pi 0.85.1、Node 24.21.0、单次请求零重试。这是父会话提供的独立任务证据，不是本容器复测；本容器没有重复探针。它确认该新任务的文本通路，不证明本容器网络刷新，也不证明整轮工具或图像验收通过。

## 本轮 Linux 检查

- `npm run typecheck`：通过。
- `npm run test:kimi`：10/10 通过，全部本地模拟传输。
- 核心离线测试：59/59 通过，覆盖 document/editor/runtime/CLI/Web host 与 SVG/PPTX；未包含 media 下的 `raster.test.ts`、`web.test.ts`、`web-browser.test.ts`、`web-build.test.ts`。这些文件含独立浏览器依赖，不能把此结果称为完整测试套件通过。
- `npm run build:web`：通过；仍有已有的 bundle 大于 500 kB 提示。
- 完整 `npm test` 基线：浏览器缺失导致多项失败，且 180 秒整体截止前没有结束。终止了该轮残留测试进程，未将其记为通过。
- 发现系统已有 `/usr/bin/chromium`。新增 `OEY_BROWSER_EXECUTABLE` Playwright 配置入口后，4 项真实浏览器测试通过，覆盖 Deck 改字/几何/撤销/重开/PPTX 下载、拖拽/缩放/旋转，以及 Web 文档创建、响应式、撤销/重开、DOM 拖拽/缩放/旋转/图片插入。

### 后续修复：完整离线套件 80/80

已将 `OEY_BROWSER_EXECUTABLE` / `OEY_BROWSER_CHANNEL` 统一到媒体层和浏览器测试，指定路径优先；Windows 继续默认使用 Chrome，其他平台默认使用 Playwright Chromium。复用系统 `/usr/bin/chromium`，未安装软件。现在 PNG/PDF 实际导出和测试均可使用现有浏览器，而不只是 Web E2E。

修复前独立重现了 5 项失败（媒体子集 11 项中 6 通过、5 失败）：

| 文件/检查 | 原因 |
|---|---|
| `raster.test.ts`：精确尺寸 PNG 与多页 PDF | 固定 `channel: chrome`，系统无 `/opt/google/chrome/chrome` |
| `raster.test.ts`：中英文字实际换行 | 同上 |
| `web-browser.test.ts`：源码构建后的路由/资源/交互/响应式 | 同上 |
| `web-build.test.ts`：生产构建与组件交互 | Playwright 下载浏览器不存在 |
| `web.test.ts`：Web 图片栅格化与多页 PDF | 同上 |

此外，`web-build.test.ts` 在启动浏览器后才注册 HTTP 服务清理；浏览器启动失败就遗留服务，解释了初轮整套 180 秒超时。该代码和浏览器选择问题均可在基准提交 `6f754fe` 查到，早于本次改动。清理现在于启动浏览器之前注册，并在关闭浏览器异常时也关闭 HTTP 连接。

修复后，使用不包含模型凭据的子进程和系统浏览器运行全部 `npm test` 文件（未排除文件、未跳过测试、未用强制退出），**80/80 通过，46.6 秒正常结束**。日志：`.tmp/full-offline-tests.log`。故意指定不存在的浏览器运行构建用例时，预期失败状态 1，12.7 秒正常退出、未超时，日志：`.tmp/missing-browser-cleanup.log`。类型检查再次通过。

随后完整 Web E2E **11/11 通过，24.0 秒**，含并发文本/源码冲突恢复、生产应用导出和全部 Deck/Web 编辑用例；日志：`.tmp/full-web-e2e.log`。两张界面截图也随该轮测试重新生成。

```sh
OEY_BROWSER_EXECUTABLE=/usr/bin/chromium npm test
OEY_BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:web
```

本轮测试子进程只继承 PATH/HOME/TMPDIR/LANG 等启动必需项，没有模型凭据；没有新建密钥文件或安装软件。系统浏览器验证命令：

```sh
OEY_BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:web -- --grep 'text and geometry edits|canvas drag, resize|Web document can be created|Web DOM drag'
```

59 项核心检查的等价文件选择：

```sh
node --import tsx --test packages/document/test/*.test.ts packages/editor/test/*.test.ts packages/runtime/test/*.test.ts apps/cli/test/*.test.ts apps/web/test/*.test.ts packages/media/test/preview.test.ts packages/media/test/pptx.test.ts
```

实际截图保存为 `.tmp/deck-editor-verified.png`、`.tmp/web-editor-review.png`。它们是测试操作后的真实界面，供用户审核，不是最终审美验收或模型生成作品。核心测试记录在 `.tmp/offline-core-tests.log`。

环境默认 Node 为 **24.19.0**，仓库要求 **`>=24.21.0 <25`**。进一步检查发现预置的 `/workspace/.tools/node-v24.21.0-linux-x64/bin/node`，直接运行确认 **v24.21.0**，无需下载安装或修改默认 Node。用该二进制及子进程 PATH 重新验证：类型检查通过、完整套件 **81/81（32.6 秒）**、Web E2E **11/11（23.9 秒）**。该套件含新增错模型测试；之后的传输错误诊断新增测试单独执行。日志为 `.tmp/node2421-typecheck.log`、`.tmp/node2421-tests.log`、`.tmp/node2421-web-e2e.log`。这是指定 Linux 运行时上的结果，不覆盖 Windows Office、Desktop/AppContainer、旧 Python Phase 6 或完整跨平台兼容矩阵。

两张截图已目视检查，仅含合成测试内容和编辑器界面，未见密钥或个人资料。按用户请求尝试批量保存到 Library 时，当前环境返回网络失败，原始 PNG 批次未获得 Library 文件 ID；停止该路线，未重试、拆分该批次或改变网络配置。

对已失败记录的进一步诊断：唯一错误为 `library upload failed: hosted apps tools/list request failed: network`。它发生在服务工具发现阶段，早于准备上传和字节传输；记录未包含主机名、上传 URL 或 HTTP 状态。因而不能凭此编造被拒绝域名或建议放行通配符。需要平台提供该服务调用的目标主机/拒绝原因，恢复官方服务发现通路；图片存储传输需要哪些域名目前尚未产生证据，且 `api.kimi.com` 的单独放行不能视为 Library 通路已恢复。

后续父会话明确允许考虑新的单文件审阅交付，因此制作了两页 `OEYdesign-ui-review.pdf`：按 Web、Deck 顺序原样嵌入截图，附上“合成测试内容、供用户审核、非最终审美验收”的说明。PDF 为 262531 字节、2 页；官方单文件创建入口保存成功，Library ID 为 `libfile_eb6cc6ad467081919d8c7fa58e0e8cb3`，本地身份元数据写入成功。此次没有重试或拆分原始 PNG 批次，没有绕过访问禁止，也没有更改网络。对于这份审阅 PDF，已不需要额外网络权限；若仍需两个原始 PNG 附件，prepared 服务发现的主机诊断仍未解决。
