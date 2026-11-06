Prebuilt Typora Canvas plugin and npm installer. No local compilation is required.

- **ZIP:** extract and copy `canvas_reader.js` and `canvas_reader/` into the existing framework's `plugin/` directory. Enable `[canvas_reader]` in its user configuration.
- **npm:** run `npm install -g @ling0727-ai/typora-canvas@latest`, then `typora-canvas --mode canvas-editor`. The release `.tgz` file can also be installed directly. Use `--resources <directory>` for a custom path or Linux, and `--dry-run` to check first. Node.js is required; build tools and project dependencies are not.
- **SHA256SUMS.txt:** checksums for both archives.

The npm CLI provides help, version, backup, install/update and disable (`--uninstall`) commands. Installing the npm package only makes the CLI available; run it explicitly to deploy to Typora.

This release fixes unordered and ordered list rendering in the pure Canvas editor: semantic bullets and sequential numbering, mixed nesting, continuation lines, hanging indentation, theme typography and `::marker` colors/styles, and accurate editing/source hit testing. Ordinary list text input preserves the incremental edit path. New unit and browser regressions cover nesting, CRLF, inline math, wrapping, undo and theme changes.

Windows, macOS and Linux CI validate unit tests, builds, packaged npm installation and Chromium regressions before publication. The same JavaScript payload is used on all three systems; separate native binaries are not needed. Real Typora integration has primarily been tested on Windows 1.14. The upstream plugin framework documents Windows/Linux installation; macOS host installation remains unverified.

Requires an installed and enabled [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) framework. See the [English README](https://github.com/Ling0727-ai/typora-canvas/blob/main/README.md) or [简体中文说明](https://github.com/Ling0727-ai/typora-canvas/blob/main/README_CN_simplised.md) for configuration and platform details.

The public npm package is [@ling0727-ai/typora-canvas](https://www.npmjs.com/package/@ling0727-ai/typora-canvas). The installer command remains `typora-canvas`. After three-platform validation and GitHub Release creation, the workflow publishes the same prebuilt tarball to npm using OIDC trusted publishing with provenance.
