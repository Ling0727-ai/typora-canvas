[English](README.md) | 简体中文

# Typora Canvas

基于 Canvas 的 Typora 渲染插件，目标是让大型 Markdown 文档滚动流畅，同时逐步补齐编辑与兼容能力。

> A Canvas rendering plugin for Typora, exploring smooth large-document rendering and native editing compatibility.

**当前版本：[v0.6.14](https://github.com/Ling0727-ai/typora-canvas/releases/tag/v0.6.14)。** 已提供预编译 ZIP 和 npm 安装包，无需本地编译。包含混合模式与纯 Canvas 编辑实验；纯 Canvas 模式使用独立的 Markdown 原文模型、布局、光标和选区，正文通过视口 Canvas 显示；Callout 可复用原插件生成的局部图像缓存，显示在现有编辑区域中。

## 快速开始

先安装并启用 [Typora 插件框架](https://github.com/obgnail/typora_plugin/blob/master/README-cn.md#如何使用windowslinux-平台)。安装 Node.js 后执行：

```bash
npm install -g @ling0727-ai/typora-canvas@latest
typora-canvas --mode canvas-editor --dry-run
typora-canvas --mode canvas-editor
```

保存笔记，完全退出并重新打开 Typora。npm 安装的是 CLI；检查路径后，执行不带 `--dry-run` 的命令才会把预编译插件部署到 Typora。默认资源目录为 `C:\Program Files\Typora\resources`；Linux 或自定义位置需在两条 CLI 命令中都加上 `--resources "实际的资源目录"`。写入受保护目录时使用有相应权限的终端。无需 Node.js 的 ZIP 安装方法和平台范围见[安装与更新](#安装与更新)。

`--mode canvas-editor` 启用可编辑的纯 Canvas 模式；首次安装不指定 `--mode` 时使用混合模式，保留原生编辑并缓存静态内容。`Ctrl+Alt+Shift+F8` 开关插件，`Esc` 退出纯 Canvas 编辑器。自动开启和模式切换见[启用与模式选择](#启用与模式选择)。

## 最近更新

- **0.6.14：** 结构编辑改变行号后，清理旧位置的 Callout 缓存及待完成截图。插入列表项、撤销和重做不再累积失效缓存，仍有效的预览继续保留。浏览器回归增加五轮重做/撤销检查，失败时记录编辑器统计信息。
- **0.6.13：** 空无序列表项显示圆点；Enter 支持续写、拆分与退出列表；自动补号只影响当前列表层级和容器内的后续兄弟项。支持数字、字母、罗马数字及括号标记，以及有序/无序列表混合嵌套、内嵌代码块、引用和 Callout。
- 0.6.14 的主分支与 Release 工作流均已通过 Windows、macOS、Linux 的单元测试、打包安装及 Chromium 回归。Release 工作流将 ZIP/npm 安装包上传到 GitHub Releases，并通过 OIDC 可信发布将同一份预编译 tarball 发布到 npm。真实 Typora 的安装与宿主兼容范围见[平台说明](#前置条件与平台范围)。

## 选择模式与查看功能

| 模式 | 编辑与渲染 | 适用场景 |
| --- | --- | --- |
| `canvas-editor` | 独立原文、光标与选区模型；按视口绘制 Canvas | 体验长文档编辑，接受下方功能兼容边界 |
| `hybrid` | Typora 原生编辑；静态内容使用 Canvas 缓存 | 保留原生操作与复杂插件，作为兼容性对照 |
| `canvas` | 早期独立只读阅读器 | 阅读，不提供编辑 |

纯 Canvas 支持多层混合列表、公式、基础表格及键盘操作、Callout、主题样式采样、Obsidian 图片、大纲导航和正则搜索。完整行为、快捷键与限制见[功能与架构](docs/FEATURES_CN_simplised.md)。

任意主题 CSS、脚注、HTML、自定义宏、复杂表格及依赖原生 DOM 的其他插件仍需逐项适配。未支持的语法保留原文；`Esc` 可返回原生编辑。保存桥接主要在 Windows Typora 1.14 验证。混合模式的实际性能收益需要在真实笔记中测量。

## 安装与更新

### 前置条件与平台范围

- ZIP 安装不需要 Git 或 Node.js；npm CLI 需要 Node.js，建议使用 CI 验证的 22（最低声明为 20）；Git 仅用于源码构建。
- 先按 [obgnail/typora_plugin 安装教程](https://github.com/obgnail/typora_plugin/blob/master/README-cn.md#如何使用windowslinux-平台)安装并启用插件框架，确认重启 Typora 后可以使用框架插件。本项目安装器只安装 Canvas 扩展，不负责注入框架。
- 安装目标是**已经包含 `plugin/global/core/index.js` 的资源目录**，不是主题目录，也不是 `plugin` 目录本身。通常是包含 `window.html` 的目录；旧版可能是 `resources/app`。安装器还会检查框架配置中的 `[global].ENABLE` 是否启用。

| 平台 | 安装说明 | 验证范围 |
| --- | --- | --- |
| Windows | 默认 `C:\Program Files\Typora\resources`，自定义位置通过 `--resources` 指定 | 三端 CI 通过，真实宿主主要在 Windows Typora 1.14 验证 |
| Linux | 必须用 `--resources` 指定现有框架资源目录；路径取决于安装包 | CI 的构建、单元测试及 Chromium 回归通过；真实 Typora 待实机验证 |
| macOS | 上游目前提供的是 Windows/Linux 安装教程；本项目尚无经过验证的 macOS Typora 安装流程 | CI 的构建、单元测试及 Chromium 回归通过，可运行浏览器演示 |

**三端 CI 通过不等于三端 Typora 安装都受支持。** macOS 不应直接套用 Windows 默认路径，也不能只把文件放进应用包就认为框架已加载。

### 直接安装 Release（无需本地编译）

**ZIP 安装，无需 Node.js：** 从 [Releases](https://github.com/Ling0727-ai/typora-canvas/releases/latest) 下载 `typora-canvas-v0.6.14.zip`，解压后将 **`canvas_reader.js` 和完整的 `canvas_reader/` 文件夹**复制到现有框架的 `plugin/` 目录；更新时一起替换，不要再套一层 `plugin`。手动复制不会执行安装器的自动备份，请先保留旧文件和配置。参照[配置示例](#启用与模式选择)启用 `[canvas_reader]`，保留配置文件中的其他插件设置，最后完全重启 Typora。

**npm 安装，需要 Node.js，但不需要编译：**

```bash
npm install -g @ling0727-ai/typora-canvas@latest
typora-canvas --mode canvas-editor --dry-run
typora-canvas --mode canvas-editor
```

CLI 默认使用 Windows 资源路径。Linux 或自定义安装位置必须指定已有框架目录：

```bash
typora-canvas --resources "实际的资源目录" --mode canvas-editor --dry-run
typora-canvas --resources "实际的资源目录" --mode canvas-editor
```

下载 `.tgz` 后也可执行 `npm install -g ./ling0727-ai-typora-canvas-0.6.14.tgz`。包内包含编译好的插件和已打包的安装器，无运行时 npm 依赖，也没有构建或安装生命周期脚本。npm 只安装命令，**需要显式运行 `typora-canvas` 才会部署到 Typora**，再完全重启 Typora。仍需已有插件框架及目标目录写权限。支持 `--help`、`--version`、`--uninstall`；禁用时使用相同的 `--resources`。更新时执行 `npm install -g @ling0727-ai/typora-canvas@latest`，再运行 CLI 更新 Typora 中的副本。`npm uninstall -g @ling0727-ai/typora-canvas` 只删除 CLI，如需关闭已经部署的插件，应先执行 CLI 的 `--uninstall`。

公开 npm 包名为 [`@ling0727-ai/typora-canvas`](https://www.npmjs.com/package/@ling0727-ai/typora-canvas)，请使用带作用域的名称；不带作用域的 `typora-canvas` 不是本项目的发行包。可用 `@ling0727-ai/typora-canvas@0.6.14` 固定版本，也可从 Release 地址安装：`https://github.com/Ling0727-ai/typora-canvas/releases/download/v0.6.14/ling0727-ai-typora-canvas-0.6.14.tgz`。macOS 的宿主安装范围见上表。Git 和开发依赖仅在下方源码构建路线中需要；ZIP 安装不需要 Git 或 Node.js。

### 从源码构建（可选）

修改插件或测试未发布提交时，参照[源码构建与验证](docs/DEVELOPMENT_CN_simplised.md)。ZIP/npm 用户无需安装 Git、克隆仓库或运行构建。

### 启用与模式选择

`--dry-run` 会检查框架、配置和构建文件，并输出将使用的路径，不写入安装文件。确认无误后执行不带 `--dry-run` 的命令，保存笔记，**完全退出并重新打开 Typora**。安装器不会自动关闭 Typora。

| `--mode` / `RENDER_MODE` | 行为 |
| --- | --- |
| `canvas-editor` | 本文介绍的可编辑纯 Canvas 实验模式 |
| `hybrid` | 原生编辑与静态 Canvas 缓存；首次安装不指定模式时使用 |
| `canvas` | 早期独立只读阅读器，不能编辑 |

更新时不传 `--mode` 会保留已有的 `canvas-editor` 或 `canvas`，其他情况使用 `hybrid`。如需固定模式，请在每次安装时显式指定。安装器保留已有的 `AUTO_OPEN = false`。

安装前备份在 `~/.config/typora-canvas/backups/`。如存在 `~/.config/typora_plugin/settings.user.toml`，优先修改它，否则修改框架目录的用户设置。不改写 Typora 的 `window.html`。

安装器会自动维护 `[canvas_reader]` 节。如需手动调整，修改安装器输出的配置文件中的已有节，不要重复添加。以下示例启用纯 Canvas 编辑模式：

```toml
[canvas_reader]
ENABLE = true
NAME = "Typora Canvas"
HOTKEY = "ctrl+alt+shift+f8"
AUTO_OPEN = true
RENDER_MODE = "canvas-editor"
CACHE_MB = 24
```

设置 `AUTO_OPEN = false` 可以改成手动启动。`Ctrl+Alt+Shift+F8` 开关插件，纯 Canvas 模式下按 `Esc` 返回原生编辑。`CACHE_MB` 控制混合模式缓存上限，不是纯 Canvas 资源缓存的统一开关。

### 更新与禁用

npm 安装的更新方法：

```bash
npm install -g @ling0727-ai/typora-canvas@latest
typora-canvas --mode canvas-editor --dry-run
typora-canvas --mode canvas-editor
```

需要时使用与原安装相同的 `--resources`，完成后完全重启 Typora。`typora-canvas --version` 可查看 CLI 版本。禁用已部署的插件时，用相同资源路径执行 `typora-canvas --uninstall` 并重启；只卸载全局 npm 包不会关闭已部署的副本。

ZIP 安装的更新方法：使用新版本文件一起替换 `canvas_reader.js` 和 `canvas_reader/`，保留原配置，再重启 Typora。

源码安装时，更新代码、重建后重新执行对应安装命令，见[开发说明](docs/DEVELOPMENT_CN_simplised.md)。只拉取源码或重启不会更新已部署的运行时。Typora 或插件框架更新后，检查扩展是否仍在目标目录中。

禁用时使用安装时相同的资源目录；Windows 默认路径可省略 `--resources`：

```bash
typora-canvas --uninstall
```

自定义资源目录需追加原安装路径的 `--resources`；源码用户可用 `npm run uninstall:typora --` 代替 CLI。该命令将配置设为禁用，重启后生效，插件文件与备份保留；需要目录写权限时，使用与安装相同的权限方式。不要同时启用其他内容截断插件。

## 搜索

默认混合模式使用 Typora 自带搜索，包括其正则开关。

纯 Canvas 编辑器和独立阅读器支持 `.*` 正则开关，默认忽略大小写，分别逐源码行、逐内容块匹配。计数是匹配行/块数，不是出现次数；跨行/块表达式暂不支持。搜索放在可终止的 Worker 中，超过 1 秒会取消，非法正则显示错误而不阻塞界面。最多返回 5000 个匹配行/块。

## 排查安装与使用问题

| 现象 | 检查与处理 |
| --- | --- |
| 安装器提示缺少框架或框架未启用 | 确认资源目录中存在 `plugin/global/core/index.js`，并启用框架的 `[global].ENABLE` |
| 已更新 npm，但 Typora 中没有变化 | 重新执行 `typora-canvas --mode canvas-editor` 部署，然后完全重启 Typora |
| 写入 `Program Files` 被拒绝 | 在有写权限的终端运行部署命令；先用 `--dry-run` 确认路径 |
| PowerShell 拦截 `npm.ps1` | 改用 `npm.cmd`；可用 `node scripts/install.mjs` 调用源码安装器 |
| 打开后仍是混合模式，或没有自动开启 | 检查安装器输出的配置文件，确认 `RENDER_MODE = "canvas-editor"` 和 `AUTO_OPEN = true`，保存并重启 |
| 遇到不兼容的渲染或保存冲突 | 按 `Esc` 返回原生模式；检查 `~/.config/typora-canvas/recovery/` 中的原文恢复副本 |

## 开发与验证

- [功能、编辑行为与架构](docs/FEATURES_CN_simplised.md)
- [源码构建、浏览器演示与验证范围](docs/DEVELOPMENT_CN_simplised.md)
- [npm 可信发布与 Release 工作流](.github/PUBLISHING.md)
- [版本说明](RELEASE_NOTES.md)

三端 CI 包含单元测试、构建、预编译安装包测试和 Chromium 回归；具体覆盖与失败诊断产物见开发说明。浏览器与模拟宿主测试不等于已验证三端真实 Typora 的全部行为。

这是社区实验插件，与 Typora 官方无隶属关系。
