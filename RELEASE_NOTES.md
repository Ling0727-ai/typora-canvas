Prebuilt Typora Canvas plugin and npm installer. No local compilation is required.

- **ZIP:** extract and copy `canvas_reader.js` and `canvas_reader/` into the existing framework's `plugin/` directory. Enable `[canvas_reader]` in its user configuration.
- **TGZ:** install with `npm install -g <downloaded-tgz-or-release-asset-URL>`, then run `typora-canvas --mode canvas-editor`. Use `--resources <directory>` for a custom path or Linux, and `--dry-run` to check first. Node.js is required; build tools and project dependencies are not.
- **SHA256SUMS.txt:** checksums for both archives.

The npm CLI provides help, version, backup, install/update and disable (`--uninstall`) commands. Installing the npm package only makes the CLI available; run it explicitly to deploy to Typora.

This release fixes unordered and ordered list rendering in the pure Canvas editor: semantic bullets and sequential numbering, mixed nesting, continuation lines, hanging indentation, theme typography and `::marker` colors/styles, and accurate editing/source hit testing. Ordinary list text input preserves the incremental edit path. New unit and browser regressions cover nesting, CRLF, inline math, wrapping, undo and theme changes.

Windows, macOS and Linux CI validate unit tests, builds, packaged npm installation and Chromium regressions before publication. The same JavaScript payload is used on all three systems; separate native binaries are not needed. Real Typora integration has primarily been tested on Windows 1.14. The upstream plugin framework documents Windows/Linux installation; macOS host installation remains unverified.

Requires an installed and enabled [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) framework. See the [English README](https://github.com/Ling0727-ai/typora-canvas/blob/main/README.md) or [简体中文说明](https://github.com/Ling0727-ai/typora-canvas/blob/main/README_CN_simplised.md) for configuration and platform details.

The package is not currently published to the npm registry by name; use the release `.tgz` URL or a downloaded `.tgz` file.
