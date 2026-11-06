[English](DEVELOPMENT.md) | 简体中文

# 源码构建与验证

[返回 README](../README_CN_simplised.md)。以下命令在源码仓库根目录执行，需要 Git 和 Node.js。

## 从源码构建

在准备存放源码的目录打开终端：

```bash
git clone https://github.com/Ling0727-ai/typora-canvas.git
cd typora-canvas
npm ci
npm run build
```

从源码构建适合修改插件或测试未发布的提交。直接安装已发布版本见 [README](../README_CN_simplised.md#安装与更新)。

### Windows 安装

在仓库目录执行；写入 `Program Files` 时使用有权限的终端（例如管理员 PowerShell）：

```powershell
npm run install:typora -- --mode canvas-editor --dry-run
npm run install:typora -- --mode canvas-editor
```

自定义路径时，检查和安装两次命令必须使用同一目录：

```powershell
npm run install:typora -- --resources "D:\Typora\resources" --mode canvas-editor --dry-run
npm run install:typora -- --resources "D:\Typora\resources" --mode canvas-editor
```

PowerShell 若拦截 `npm.ps1`，可把命令中的 `npm` 替换为 `npm.cmd`。

### Linux 安装

将示例路径替换为已经安装插件框架的实际目录。这里的 `/usr/share/typora/resources` 只是示例，不是自动探测结果：

```bash
TYPORA_RESOURCES="/usr/share/typora/resources"
test -f "$TYPORA_RESOURCES/plugin/global/core/index.js"
npm run install:typora -- --resources "$TYPORA_RESOURCES" --mode canvas-editor --dry-run
npm run install:typora -- --resources "$TYPORA_RESOURCES" --mode canvas-editor
```

若资源目录需要管理员权限，完成普通用户下的依赖安装、构建和 `--dry-run` 检查后，仅将最后的安装命令改为：

```bash
sudo env "HOME=$HOME" "$(command -v node)" scripts/install.mjs --resources "$TYPORA_RESOURCES" --mode canvas-editor
```

这里保留当前用户的 `HOME`，使配置和备份仍写入当前用户目录。安装器不会自动提权。

### 更新源码安装

在仓库根目录执行：

```bash
git pull --ff-only
npm ci
npm run build
```

随后使用相同的资源目录和模式重新执行安装命令，再完全重启 Typora。只拉取源码不会更新已部署的运行时。


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
- 纯 Canvas 编辑器原文保留、组合输入、撤销、保存桥接、外部变化冲突检测。
- 可见滚动条点击翻页、大纲点击/回车跳转与编辑同步/高亮、退出恢复宿主接口，以及网页/相对文件/标题锚点和 Callout 内链接的点击命中。
- 粗体/斜体内公式的源码映射、主题字号与颜色传入排版线程；Obsidian 图片的实际插件解析/异步附件查找、正文与 Callout 图片宽度/对齐像素；Callout 标记两侧与内部的四方向键和首次点击。
- `\\alpha` 的即时公式预览、光标源码映射、独立 MathJax Worker 与宿主版本隔离。
- 材料疲劳推导原文中的行内/多行公式、注入单条公式超时后的结果隔离与像素稳定性，以及同屏 100 条公式缓存稳定性。
- 块公式实际高度与上下间隔、连续公式和后续正文不重叠；分式、矩阵、多行推导在 18/28px 字号、420/900px 宽度下的 Callout 几何验证。
- Canvas 表格、对齐和单元格公式，以及 10000 行编辑/滚动时有限的正文绘制量与 DOM 节点数。
- 表格操作栏、调整行列、增删移动、源文本/CRLF/引用保留、一次撤销和单元格键盘导航。
- Callout 标题/正文源位置映射、嵌套、别名、折叠悬停、插件关闭，以及浅色/深色/纯黑主题的实际画布像素与原文保留。
- 原 Callouts 插件代码的屏外执行、位图实际文字像素、点击编辑/撤销、主题缓存重建、临时 DOM 回收，以及不修改原插件工具对象和原文档。
- 空列表圆点、主题项目符号与缩进、数字/字母/罗马数字编号、Enter 续写/退出、同层补号、CRLF 和撤销保留、混合嵌套，以及代码块/引用/Callout 容器。
- 编辑导致行号变化后的 Callout 缓存回收：先等待新位置截图完成，再连续五轮重做/撤销，检查缓存数量、绘制切片、原文恢复及截图错误。
- 多行块公式、分隔线、空行折叠、标题样式、代码高亮及语言选择、表格原生快捷键/复制/格式化；深浅主题只切换一次后的实际表格背景像素。

浏览器演示不依赖另一仓库的本地路径；内置了从 `typora-obsidian-callouts` 同步的默认类型、配色与 SVG 图标。Typora 内优先采用已安装插件和主题 CSS。需要刷新独立演示默认值时执行：

```bash
node scripts/sync-callouts.mjs --source ../typora-obsidian-callouts
```

GitHub Actions 在 Windows、macOS、Linux 三个 runner 上分别运行 Node.js 22 单元测试、构建、打包安装测试及 Chromium 浏览器回归。macOS 使用 Command 快捷键，Windows/Linux 使用 Ctrl；任务独立执行，一个系统失败不会取消其他系统。支持 push、pull request 和手动触发。每个平台分别上传 `browser-results-<os>`（截图、指标、平台信息及失败诊断）、`typora-canvas-<os>`（构建的插件文件）和 `release-files-<os>`（ZIP、npm tarball 与校验和），保留 7 天。浏览器回归失败时会记录 `failure.txt`、`failure.png`；页面仍可访问时另存 `failure-stats.json`。

截图与测试数据在被 Git 忽略的 `test-output/`。这些是浏览器集成测试和模拟宿主接口测试，**不等于真实 Typora 中所有编辑、公式和主题都已完成验证，也没有混合模式的性能提升结论**。跨系统 CI 也不等于已在三系统真实 Typora 中验证安装与宿主接口；安装时仍需使用对应平台的插件框架资源路径。旧版 9001 块合成文档的 Canvas 绘制采样不能作为混合模式的性能数据。


发布维护见 [npm 可信发布与 Release 工作流](../.github/PUBLISHING.md)。
