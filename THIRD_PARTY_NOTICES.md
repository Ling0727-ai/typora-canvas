# Third-party notices

The standalone Callout palette and embedded SVG icons in `src/callout-defaults.json`
are adapted from [Ling0727-ai/typora-obsidian-callouts](https://github.com/Ling0727-ai/typora-obsidian-callouts).
Copyright (c) 2026 Ling0727-ai. Licensed under MIT; the full notice is in
`licenses/typora-obsidian-callouts.MIT.txt`.

Runtime colors and icon masks are sampled from the installed user's Callout plugin
and active CSS. The optional native Callout bridge creates a scoped, unregistered
instance of the installed plugin to render temporary DOM into local Canvas caches.
This project does not modify that plugin or its repository. The test fixtures
`test/fixtures/callouts-plugin.cjs` and `callouts-native.css` are from the same MIT
project; the plugin patch is based on obgnail/typora_plugin 1.19.14 (MIT,
copyright 2023 obgnail).

The optional image adapter reuses the installed `obsidian_images` module from the
same project for syntax, vault attachment resolution and CSS decoration. The test
fixture `test/fixtures/obsidian-images-plugin.cjs` and standalone wiki image grammar
are adapted from its MIT-licensed patch, copyright (c) 2026 Ling0727-ai.

Code highlighting uses highlight.js 11.12.0 (BSD-3-Clause), copyright 2006 Ivan
Sagalaev and highlight.js contributors. The full notice is in
`licenses/highlight.js.BSD-3-Clause.txt`.

Other dependencies retain their licenses in their respective packages and bundled
license comments. The project source is MIT licensed as described in `LICENSE`.

`src/list-block.js` adapts markdown-it's MIT-licensed block list rule to support
parenthesized, alphabetic and Roman counters and retain exact source mappings.
Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin. The full license is included in
`licenses/markdown-it.MIT.txt` and in the prebuilt plugin payload.

The standalone release installer bundles smol-toml (MIT). Its full license is
included in `canvas_reader/licenses/smol-toml.MIT.txt` in the plugin payload.
