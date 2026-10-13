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

本轮测试子进程只继承 PATH/HOME/TMPDIR/LANG 等启动必需项，没有模型凭据；没有新建密钥文件或安装软件。系统浏览器验证命令：

```sh
OEY_BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:web -- --grep 'text and geometry edits|canvas drag, resize|Web document can be created|Web DOM drag'
```

59 项核心检查的等价文件选择：

```sh
node --import tsx --test packages/document/test/*.test.ts packages/editor/test/*.test.ts packages/runtime/test/*.test.ts apps/cli/test/*.test.ts apps/web/test/*.test.ts packages/media/test/preview.test.ts packages/media/test/pptx.test.ts
```

实际截图保存为 `.tmp/deck-editor-verified.png`、`.tmp/web-editor-review.png`。它们是测试操作后的真实界面，供用户审核，不是最终审美验收或模型生成作品。核心测试记录在 `.tmp/offline-core-tests.log`。

环境 Node 为 24.19.0，低于仓库声明的 `>=24.21.0 <25`；未修改安装。媒体层部分代码/测试仍固定 Chrome 或 Playwright 下载浏览器，此轮只补 Web E2E 可执行路径入口。Linux 验证不覆盖 Windows Office、Desktop/AppContainer 或旧 Python Phase 6 全链路。
