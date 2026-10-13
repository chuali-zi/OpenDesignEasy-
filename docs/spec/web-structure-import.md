# 有限 Web 结构导入、中文输入与旋转缩放

2026-10-13。Web/CLI 使用同一静态导入器，创建新文档，保留原始 UTF-8 源码；原文档不被覆盖。source.zip 包含 original/source.html 或 source.tsx，快照往返时校验原文一致。产品源码 ZIP 保留。

支持单文件原生 HTML 和静态 JSX/TSX 默认函数/无参箭头组件；原生标签、标量属性、inline style、已验证的静态标量/记录常量，简单段落/标题及行内格式转为 ProseMirror。HTML 通过禁用 JS/所有网络的独立浏览器上下文内 DOMParser 惰性解析；JSX 通过 TS AST 读取，不 eval、编译或执行输入。React import 只识别语法，不加载包。

拒绝脚本/事件处理、外部资源、样式表、CSS URL、iframe/embed、动态调用/组件/展开及无效表达式。暂不导入图片资源、任意依赖工程或外部 CSS；受管 OEY 组件继续通过既有 source.zip 边界处理。最大 UTF-8 1 MiB、256 节点、32 层；异常/损坏输入不创建文档、不切换当前选区；同一 commandId 相同请求幂等，异载荷冲突，并发重复只创建一次。拒绝时用户原文件仍保留；不宣称任意工程无损恢复。

实际 Chromium CDP 以原生 Input.imeSetComposition 更新中→中文输入，组合持续超过自动保存窗口仍无修订；Input.insertText 提交后保存一次。验证撤销重做、刷新重开、HTML/React 导入、源码 ZIP 再导入、原始源码精确保留、异常 TSX 拒绝，以及本地导航/表单演示。此验证不是各操作系统真实 IME 兼容性通过声明。

二维 rotate 缩放以 CSS 逻辑尺寸与逆旋转指针差计算，在默认中心 transform-origin 下保留相对角；画布与提交同一结果。复杂/祖先 transform 和自定义 origin 明确拒绝。实际 30° 的 120×80 对象变为 160×100，对角误差 <0.1px，撤销重做与重开通过。

最终 Node 129/129、Chromium 23/23、npm run build 与 build:web 均通过。首次惰性 HTML 回调受 tsx keepNames 的 __name 注入影响；补固定可信 helper 后通过。保留失败及最终运行日志在独立证据目录；无真实用户项目/图片上传，无新增 live 模型请求。审美仍等待用户反馈。
