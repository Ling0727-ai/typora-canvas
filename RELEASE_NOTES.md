Prebuilt Typora Canvas plugin and npm installer. No local compilation is required.

- **ZIP:** extract and copy `canvas_reader.js` and `canvas_reader/` into the existing framework's `plugin/` directory. Enable `[canvas_reader]` in its user configuration.
- **npm:** run `npm install -g @ling0727-ai/typora-canvas@latest`, then `typora-canvas --mode canvas-editor`. The release `.tgz` file can also be installed directly. Use `--resources <directory>` for a custom path or Linux, and `--dry-run` to check first. Node.js is required; build tools and project dependencies are not.
- **SHA256SUMS.txt:** checksums for both archives.

The npm CLI provides help, version, backup, install/update and disable (`--uninstall`) commands. Installing the npm package only makes the CLI available; run it explicitly to deploy to Typora.

Version 0.6.16 fixes quote and Callout decoration when the block starts on the document's first line. Quote borders, Callout backgrounds and borders now start below the document's top padding. Callout title icons move with the title text.

Browser regressions check that the top padding remains clear for empty quotes, ordinary quotes, nested Callouts, and native Callout previews, including active source editing and undo. They also check that the block remains visible below the padding and that the source is preserved.

Mixed lists accept two-space child indentation across numeric, alphabetic, Roman, parenthesized and unordered markers. Child counters start independently and both the marker and text follow the nesting depth. Sibling text columns stay aligned when marker widths change. Quote borders follow the container order, including lists inside quotes and quotes inside list items, with spacing sampled from the theme. Active list lines, including empty items, retain their original source for editing.

Unit regressions cover 576 combinations of marker families and body, quote, nested-quote and Callout containers. Browser regressions reproduce the reported mixed-list examples and verify marker placement, active source, editing and undo.

Windows, macOS and Linux CI validate unit tests, builds, packaged npm installation and Chromium regressions before publication. The same JavaScript payload is used on all three systems; separate native binaries are not needed. Real Typora integration has primarily been tested on Windows 1.14. The upstream plugin framework documents Windows/Linux installation; macOS host installation remains unverified.

Requires an installed and enabled [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) framework. See the [English README](https://github.com/Ling0727-ai/typora-canvas/blob/main/README.md) or [简体中文说明](https://github.com/Ling0727-ai/typora-canvas/blob/main/README_CN_simplised.md) for configuration and platform details.

The public npm package is [@ling0727-ai/typora-canvas](https://www.npmjs.com/package/@ling0727-ai/typora-canvas). The installer command remains `typora-canvas`. After three-platform validation and GitHub Release creation, the workflow publishes the same prebuilt tarball to npm using OIDC trusted publishing with provenance.
