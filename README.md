# Typora Canvas

基于 Canvas 渲染的 **Typora 阅读插件**，探索大型 Markdown 文档的流畅滚动。

> A Canvas-based rendering plugin for Typora, built for smooth scrolling through large Markdown documents.

**状态：0.1.0 原型。** 阅读模式使用独立的文档模型与 Canvas 2D 绘制；按 Escape 返回 Typora 编辑。它不是完整编辑器，也不承诺与 Typora 原生排版一致。目前没有真实文档上的性能对照结果。

## 工作方式

```text
当前 Markdown 快照 → Markdown tokens → 内容块 → 高度索引
                                               ↓
滚动位置 → 定位视口附近块 → 按需排版 → 视口大小的 Canvas
                              ↓
                         有限 LRU 缓存
```

- 全文解析为轻量数据块；屏外块不生成正文 DOM，也不立即排版。
- Fenwick tree 维护估计高度和已测高度，按滚动位置定位块。
- 仅排版视口附近及约 400px 缓冲区域，布局工作超过约 8ms 后让出当前帧。
- Canvas 背板只覆盖视口，像素比上限为 2，不生成全文长图。
- 布局缓存上限 256 块，文字宽度缓存上限 8192 项。
- 实测高度替换估计高度时，尽量保持当前块及块内滚动位置。
- 插件读取当前编辑器内容，包含未保存的修改，不写入文件。阅读时隐藏宿主正文；退出时恢复。

它与手动 `display:none` 截断插件不同：可以连续滚动，接近的块自动排版和绘制。

## 本地运行

需要 Node.js 20 或更新版本。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址。选择本地 Markdown，或生成 1000 节压力测试内容。文件在本机读取，不上传服务器。

## 安装到 Typora

第一版通过 [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) 加载，需要先安装并启用该框架。适配代码参考其 1.19.14 版本接口；尚未完成 Typora 内的实际验证。当前安装脚本面向 Windows。

```bash
npm run build
npm run install:typora -- --dry-run
npm run install:typora
```

默认安装路径为 `C:\Program Files\Typora\resources`。自定义路径：

```bash
npm run install:typora -- --resources "D:\Typora\resources"
```

安装器将插件文件复制到框架目录，并在用户设置中添加 `[canvas_reader]`。如果存在 `~/.config/typora_plugin/settings.user.toml`，优先修改它，否则使用框架安装目录里的用户设置。安装前备份到 `~/.config/typora-canvas/backups/`。不会改写 Typora 的 `window.html`。

写入 `Program Files` 需要相应的文件权限。如提示拒绝访问，在有权限的终端执行安装命令。安装器不会关闭 Typora，也不会自动提升权限。

保存文档、完全退出并重启 Typora，然后使用：

| 操作 | 快捷键 |
| --- | --- |
| 进入 Canvas 阅读 | `Ctrl+Alt+C` |
| 返回 Typora 编辑 | `Escape` 或工具栏返回按钮 |
| 搜索全文 | `Ctrl+F` |
| 下一个 / 上一个匹配块 | 搜索框内 `Enter` / `Shift+Enter` |

搜索按内容块匹配，工具栏计数也是块数。进入阅读模式从正文开头开始，退出保留进入前的 Typora 位置。文档切换、源代码模式切换或宿主报告内容变更时退出，避免继续显示旧快照。阅读模式期间不要同时开启其他内容截断插件。

禁用插件：

```bash
npm run uninstall:typora
```

该命令将 `ENABLE` 设为 `false`，重启 Typora 生效。文件和备份保留，便于恢复。Typora 或插件框架更新后可能需要重新安装。

## 支持范围与限制

| 内容 / 功能 | 第一版行为 |
| --- | --- |
| 中文、英文、标题、粗体、斜体、删除线 | Canvas 文字排版 |
| 列表、引用 | 基础缩进、前缀与引用线 |
| 代码块 | 等宽字体与背景，不做语法高亮 |
| Markdown 表格 | 等宽列、单元格换行，不复刻原生列宽算法 |
| 图片 | 占位文字，不加载图片 |
| 数学公式、Mermaid、其他图表 | 原始文本或代码，不渲染为图形 |
| HTML | 当作文字，不执行脚本 |
| 链接 | 文字着色，暂不能点击 |
| 文本选择、复制、输入法、编辑、打印 | 返回 Typora 进行 |
| 屏幕阅读器 | Canvas 正文暂不提供完整可访问文本，请返回 Typora |
| Typora 主题、Callouts、脚注等扩展语法 | 不保证原生兼容 |

全文解析和搜索仍是 O(n)，内存仍包含全文块模型。高度尚未测量时滚动条长度是估计值，快速远跳可能出现位置修正。浏览器的最大滚动高度仍构成上限。Canvas 不会消除 Typora 已有 DOM 和文档模型的内存占用，也不能加速 Typora 在插件启动前的首次打开过程。

## 验证

```bash
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

浏览器测试默认使用 Playwright Chromium。也可通过 `PLAYWRIGHT_CHANNEL` 选择本机已安装的通道，例如 `msedge` 或 `chrome`，此时不需要下载 Chromium。测试覆盖高度索引、Unicode 分块、Markdown 解析、配置保留，以及约 9000 块文档的滚动、缓存上限、搜索、窗口变化和退出清理。结果保存在忽略提交的 `test-output/` 中。

也可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定测试浏览器的可执行文件。

2026-11-05 的本机 Chromium 无头测试：1000 节生成文档共 9001 块，初始视口绘制 11 块，阅读器内 DOM 为 16 个节点，解析耗时约 102ms；初始、搜索后与缩放后三次采样绘制耗时约 3.3ms、0.8ms、0.6ms。这是合成文档的功能验证采样，不是持续滚动帧率基准，也不是 Typora 内的对照测试。用户已反馈实际使用流畅，仍需补充可复现的真实文档测量。

## 后续方向

- 用真实课程笔记对比 Typora 原生滚动，记录帧耗时与长任务。
- 进入与退出时按源位置同步阅读位置。
- 图片按需解码、公式缓存与复杂表格布局。
- 文本命中测试、选区与可访问性方案。
- 根据验证结果决定是否扩展到编辑模式。

Typora Canvas 是社区实验插件，与 Typora 官方无隶属关系。
