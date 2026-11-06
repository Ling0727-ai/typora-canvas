English | [简体中文](DEVELOPMENT_CN_simplised.md)

# Build and validate from source

[Back to README](../README.md). Run these commands from the source repository root with Git and Node.js installed.

## Build from source

Open a terminal where you want to keep the source:

```bash
git clone https://github.com/Ling0727-ai/typora-canvas.git
cd typora-canvas
npm ci
npm run build
```

Build from source to change the plugin or test unreleased commits. For published versions, use the [README installation guide](../README.md#installation-and-updates). To test a successful CI build without building locally, download its `typora-canvas-<os>` artifact from [Actions](https://github.com/Ling0727-ai/typora-canvas/actions/workflows/ci.yml). `release-files-<os>` contains the ZIP, npm tarball, and checksums.

### Windows

Run from the repository directory. Use a terminal with write permission, such as administrator PowerShell, when installing under Program Files:

```powershell
npm run install:typora -- --mode canvas-editor --dry-run
npm run install:typora -- --mode canvas-editor
```

For a custom location, use the same directory in both commands:

```powershell
npm run install:typora -- --resources "D:\Typora\resources" --mode canvas-editor --dry-run
npm run install:typora -- --resources "D:\Typora\resources" --mode canvas-editor
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm`.

### Linux

Replace the example directory with the actual location of your installed plugin framework. `/usr/share/typora/resources` is an example, not an automatically detected path:

```bash
TYPORA_RESOURCES="/usr/share/typora/resources"
test -f "$TYPORA_RESOURCES/plugin/global/core/index.js"
npm run install:typora -- --resources "$TYPORA_RESOURCES" --mode canvas-editor --dry-run
npm run install:typora -- --resources "$TYPORA_RESOURCES" --mode canvas-editor
```

If writing the resource directory requires administrator privileges, install dependencies, build, and check `--dry-run` as your regular user first. Replace only the final installation command with:

```bash
sudo env "HOME=$HOME" "$(command -v node)" scripts/install.mjs --resources "$TYPORA_RESOURCES" --mode canvas-editor
```

Keeping the current user's `HOME` ensures configuration and backups still go to that user's directory. The installer does not elevate itself.

### Update a source installation

Run from the repository root:

```bash
git pull --ff-only
npm ci
npm run build
```

Repeat the installation command with the same resource path and mode, then fully restart Typora. Pulling source alone does not update the deployed runtime.


## Browser demo and validation

```bash
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The local demo retains the standalone Canvas viewer and can open Markdown or generate a stress-test document. Files are read locally and are not uploaded.

Browser tests use Playwright Chromium by default. `PLAYWRIGHT_CHANNEL` (such as `msedge`) or `PLAYWRIGHT_EXECUTABLE_PATH` can select an existing browser.

Regression coverage includes:

- Height indexing, Unicode splitting, Markdown parsing, configuration preservation, auto-start, initial rendering events, and returning from source mode.
- Large-document scrolling, search, regex errors and catastrophic-backtracking timeouts, resizing, and cleanup.
- In-place Chinese input, native undo, IME composition, theme changes, preserved SVG/math/extension DOM, and cache cleanup in a simulated host.
- Pure Canvas source preservation, composition undo, save bridging, external-change conflicts, scrollbars, native outline navigation/editing/highlighting, and restored host hooks.
- Link hit testing for web, relative-file, heading-fragment, and Callout links; formula source mappings within emphasis; sampled theme sizes and colors.
- Actual Obsidian image plugin parsing, asynchronous attachment lookup, body/Callout image dimensions and alignment pixels, and Callout marker navigation/clicking.
- Immediate `\alpha` preview, caret mapping, independent MathJax Worker behavior, multiline fatigue-derivation source, single-formula failure isolation, and stable caches with 100 visible formulas.
- Display equation heights and gaps, no overlap with following content, and fraction/matrix/multiline Callout geometry at 18/28px fonts and 420/900px widths.
- Table rendering, alignment, formulas, toolbar operations, source/CRLF/quote preservation, single-step undo, arrow-key cell navigation, and quote continuation/exit on Enter.
- Bounded drawing and DOM size during 10,000-line editing/scrolling; Callout scopes, aliases, folding, hover previews, plugin opt-out, and light/dark/black-theme pixels.
- Offscreen execution of the real Callouts plugin, visible text pixels, editing/undo, theme invalidation, temporary-DOM cleanup, and unchanged original plugin utilities/document content.
- Empty bullets, theme-derived list markers and indents, decimal/alphabetic/Roman counters, Enter continuation/exit, sibling renumbering, CRLF and undo preservation, mixed nesting, and code/quote/Callout containers.
- Callout cache cleanup after line positions shift: captures finish before undo, then five redo/undo cycles check the cache count, rendered slices, source restoration, and absence of capture errors.
- Code highlighting, language controls, rules, heading styles, blank-line policies, and actual table-background pixels after a single light/dark theme switch.

The demo does not depend on another repository's local path. Default Callout types, colors, and SVG icons are included from `typora-obsidian-callouts`. Inside Typora, installed plugins and theme CSS take priority. To refresh the standalone defaults:

```bash
node scripts/sync-callouts.mjs --source ../typora-obsidian-callouts
```

GitHub Actions runs Node.js 22 unit tests, builds, packaged-installation tests, and Chromium regression tests on Windows, macOS, and Linux. macOS uses Command shortcuts; Windows/Linux use Ctrl. Jobs run independently, so a failure does not cancel other platforms. Push, pull request, and manual triggers are supported. Each platform uploads `browser-results-<os>` (screenshots, metrics, platform information, and failure diagnostics), `typora-canvas-<os>` (built plugin files), and `release-files-<os>` (ZIP, npm tarball, and checksums), retained for 7 days. Browser failures include `failure.txt`, `failure.png`, and `failure-stats.json` when the page is available.

Screenshots and metrics are stored in the ignored `test-output/` directory. These are browser integration and simulated-host tests, **not verification of every editing, math, or theme feature inside real Typora, and not evidence of a hybrid-mode performance gain**. Cross-platform CI does not verify installation and host APIs in Typora on all three systems. Installation still requires the platform's actual framework resource directory. Old drawing samples from a 9,001-block synthetic document are not hybrid-mode performance results.


For releases, see [npm trusted publishing and the release workflow](../.github/PUBLISHING.md).
