# 云环境 Kimi 检查与离线验证

2026-10-13，基于 `feat/studio` 的 `6f754fe9b1cee72da616a71c14ae1ddf6d3c9477`。
本记录不替代 R2/R3 历史验收，也不代表 R4–R7 已完成。

## 已核对

- 当前是全 TypeScript / Pi SDK 路线；初始工作树干净。保存环境仅有旧 Python `origin/main` 远端跟踪引用；未联网刷新、未切回 main。
- 安装的 Pi 0.85.1 原生 provider 为 `kimi-coding`，模型 `k3`，协议 `anthropic-messages`，base URL 为 `https://api.kimi.com/coding`。SDK 实际请求路径为 `/coding/v1/messages?beta=true`。
- 只检查注入的 `KIMI_API_KEY` 是否存在，结果为存在；没有 `.env` 文件。未读取凭据文件或输出环境变量值。
- 网络配置的最新交接说明是仅包管理器预设、额外域名为零。因此本轮 **真实模型请求为 0**，没有 usage 或计费结果，未尝试绕过网络限制。

## 有限额的文本探针

`npm run check:kimi` 默认只做离线元数据和变量存在性检查，不加载项目、`.env`、磁盘凭据或工具。

在网络确已允许 `api.kimi.com` 且单次测试获得授权后，使用：

```sh
npm run check:kimi -- --live
```

该入口直接使用 Pi 公共 Anthropic messages adapter 和安装包内的原生 Kimi 模型定义；不经过 OEY 项目会话，不受 `BASE_URL` 或 `MODEL` 环境覆盖。只发送固定合成句子，要求回复 `OK`。传输层核对官方目标、模型和消息内容，最多一次请求、256 输出 tokens、30 秒总时限、零自动重试、禁止 HTTP 重定向。输出只有状态与 token usage，不回显响应正文、请求头或 SDK 错误详情。测试不证明工具、视觉、多轮或完整项目能力。

`npm run test:kimi` 用假凭据和本地模拟传输验证序列化、usage、错误不重试、不回显内容、30 秒取消、无密钥/无文件入口等 10 项行为；也纳入 `npm test`。

旧 `check-r3-native.ts` 增加了显式 `--live-tools` 误运行保护，缺少 `.env` 时不再无条件加载，并优先使用已注入的 `KIMI_API_KEY` 名称，保留 `baseUrl: ''`。**该旧工具/截图验收仍没有整轮 token 上限，不属于本轮授权，不应直接执行。** 扩大验收前仍需在 Pi 会话边界落实请求数、累计输入/输出预算、工具和整体截止保护，再约定预算；单纯打开该选项不能替代这些工作。

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

环境 Node 为 **24.19.0**，仓库要求 **`>=24.21.0 <25`**，实际版本比最低要求低两个 minor 版本；未修改安装。此次完整测试通过不等于满足声明的运行时版本要求。Linux 验证不覆盖 Windows Office、Desktop/AppContainer 或旧 Python Phase 6 全链路。

两张截图已目视检查，仅含合成测试内容和编辑器界面，未见密钥或个人资料。按用户请求尝试批量保存到 Library 时，当前环境返回网络失败，未获得任何 Library 文件 ID；停止该路线，未重试、换通道或改变网络配置。截图尚不能作为父会话可访问的 Library 附件交付。
