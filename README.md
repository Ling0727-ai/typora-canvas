# Typora Canvas

基于 Canvas 的 Typora 渲染实验，目标是让大型 Markdown 文档滚动流畅，同时逐步补齐编辑与兼容能力。

> A Canvas rendering plugin for Typora, exploring smooth large-document rendering and native editing compatibility.

**当前源码：0.2.0 混合渲染原型。** 默认复用 Typora 原生文档、公式、CSS、扩展语法和编辑器；静止的普通内容块可以缓存到 Canvas。复杂内容和编辑交互继续由原生 DOM 处理。不添加窗口或独立阅读界面。

已发布的 v0.1.0 是独立、只读的 Canvas 阅读器，功能与本说明不同。

## 默认行为

- 打开文档后自动启动，空白文档也保留正常编辑。
- 右下角显示小型状态标识：准备、缓存、原生、编辑或输入。它说明实际运行状态，并不保证当前每一块内容都由 Canvas 绘制。
- 点击正文、选区、输入、中文输入法、撤销都使用原生编辑器，不需要按快捷键切换。
- 图片、数学公式、SVG、图表、代码编辑组件和部分复杂样式保留原生显示，不替换成源码或占位。
- 主题与自定义 CSS 继续由 Typora 应用；可缓存内容使用其实际 DOM 尺寸与计算样式生成位图。外部字体、滤镜、阴影、动画等不适合位图的内容会保留原生显示。
- `Ctrl+F` / `Ctrl+H` 直接交给 Typora，使用其原生查找替换及正则选项。
- `Ctrl+Alt+Shift+F8` 开关加速层；关闭后当前文档不会立即自动重开，切换文档后恢复默认设置。
- 源代码模式不挂载加速层，返回渲染模式后自动恢复。

启动兼容处理不只依赖单个文件加载事件：插件启动时主动检查，并周期性检查宿主就绪状态。MathJax 或初始布局引发的 `fileEdited` 只刷新缓存，不再关闭插件。

## 架构与实际限制

```text
Typora 原生解析、公式与 CSS → 可编辑 DOM（文档与布局的唯一来源）
                                     ├─ 复杂内容 / 交互 → 原生显示
                                     └─ 静止普通内容 → 局部位图缓存 → 视口 Canvas
屏外内容 → 浏览器 content-visibility 优化
```

Canvas 位图缓存默认上限 24 MiB、最多 128 项；Canvas 背板围绕视口设置。内容、主题与尺寸变化会让缓存失效，任何交互开始前同步恢复原生正文。组件不会重写 Markdown 或替换原生可编辑子树。

**混合方案不是完整的虚拟化编辑器。** 它仍保留全文 DOM、宿主文档模型和布局处理；生成位图也有成本。它不能加速首次解析、消除复杂公式本身的计算，编辑时会恢复原生渲染。使用屏外尺寸估计可能改变未访问内容的滚动高度。是否比原生更快，需要在真实笔记中测量。

混合模式是兼容性基线和过渡方案。纯 Canvas 的长期方向是独立文档模型、增量布局、视口绘制与命中测试；可以复用 Markdown 和数学排版库，不必重写每个基础库。

## 安装与更新

需要 Node.js 20+，并已安装启用 [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) 框架。

```bash
npm ci
npm run build
npm run install:typora -- --dry-run
npm run install:typora
```

Windows 默认安装位置：`C:\Program Files\Typora\resources`。自定义路径：

```bash
npm run install:typora -- --resources "D:\Typora\resources"
```

写入 Program Files 需要相应权限。在管理员终端安装后，保存笔记、完全退出并重启 Typora。安装器不关闭程序或自动提升权限。仅改用户配置不会更新程序目录里的旧运行时。

安装前备份在 `~/.config/typora-canvas/backups/`。如存在 `~/.config/typora_plugin/settings.user.toml`，优先修改它，否则修改框架目录的用户设置。不改写 Typora 的 `window.html`。

默认配置如下；修改已有节，不要重复添加：

```toml
[canvas_reader]
ENABLE = true
NAME = "Typora Canvas"
HOTKEY = "ctrl+alt+shift+f8"
AUTO_OPEN = true
RENDER_MODE = "hybrid"
CACHE_MB = 24
```

设置 `AUTO_OPEN = false` 可以改成手动启动。设置 `RENDER_MODE = "canvas"` 可切回独立的实验性纯 Canvas 阅读器；这个模式还不能编辑、不兼容完整主题、公式与扩展语法，不应与默认混合模式混淆。

禁用：`npm run uninstall:typora`，重启后生效，插件文件与备份保留。不要同时启用其他内容截断插件。

## 搜索

默认混合模式使用 Typora 自带搜索，包括其正则开关。

独立 Canvas 阅读器也支持 `.*` 正则开关，默认忽略大小写，逐内容块按 JavaScript 多行 Unicode 正则匹配。匹配计数是块数，不是出现次数；跨块表达式暂不支持。搜索放在可终止的 Worker 中，超过 1 秒会取消，非法正则显示错误而不阻塞编辑界面。最多返回 5000 个匹配块。

## 浏览器演示与验证

```bash
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

本地演示保留独立 Canvas 阅读器，可打开 Markdown 或生成压力测试文件。文件只在本机读取，不上传。

浏览器测试默认使用 Playwright Chromium；也支持 `PLAYWRIGHT_CHANNEL`（如 msedge）或 `PLAYWRIGHT_EXECUTABLE_PATH` 指定现有浏览器。

验证覆盖：

- 高度索引、Unicode 分块、Markdown 解析和配置保留。
- 自动启动、初始渲染变更不关闭插件、源代码模式返回后恢复。
- 独立阅读器长文档滚动、搜索、正则错误与灾难性回溯超时、窗口变化和退出。
- 模拟宿主页面中的原位中文输入、原生撤销、输入法事件、主题切换。
- 既有 SVG 公式、扩展语法 DOM、主题伪元素的保留与缓存清理。

截图与测试数据在被 Git 忽略的 `test-output/`。这些是浏览器集成测试和模拟宿主接口测试，**不等于真实 Typora 中所有编辑、公式和主题都已完成验证，也没有混合模式的性能提升结论**。旧版 9001 块合成文档的 Canvas 绘制采样不能作为混合模式的性能数据。

## 后续方向

先在真实课程笔记上比较原生、混合和纯 Canvas 的滚动帧耗时、布局成本、长任务和内存。根据瓶颈决定向纯 Canvas 迁移的优先级：独立文档与选区模型、增量布局、中文输入、数学排版、复杂表格，以及主题兼容边界。

这是社区实验插件，与 Typora 官方无隶属关系。
