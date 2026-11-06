English | [简体中文](FEATURES_CN_simplised.md)

# Features, editing, and architecture

[Back to installation](../README.md)

## Edit in the pure Canvas editor

Follow [Installation and updates](../README.md#installation-and-updates) to prepare the plugin framework and install a prebuilt release or build from source. Pass `--mode canvas-editor` explicitly to install the editable pure Canvas experiment described here. A first installation without a mode uses hybrid mode.

- Markdown stays in an immutable source text structure. Unknown syntax and existing CRLF line endings survive without rich-text serialization; unsupported rendering does not remove source content.
- Unordered (`-`, `+`, `*`) and ordered (`1.`, `1)`, `(1)`, `a.`, `A.`, `i.`, `I.`, and parenthesized letters) lists render markers, sequential numbers, mixed nesting, continuation lines, and hanging indents. Empty bullet items render dots, including the active empty item. Colors, typography, indentation and margins come from theme CSS, including `::marker`. Explicit alphabetic/Roman formats and parentheses retain their notation. A list beginning with `a.` stays alphabetic through `i.`; one beginning with `i.` uses Roman counters.
- Enter splits/continues a nonempty list item and creates the next marker. Enter on an empty item removes its marker without inserting another line. Inserting or removing an ordered item renumbers only subsequent siblings in that list, preserving parent/child counters and other lists. Each operation undoes in one step and preserves CRLF; changes such as `9.` to `10.` adjust continuation/block indentation too.
- Quotes and Callouts can contain multiple levels of ordered/unordered lists, and list items can contain fenced code, quotes and Callouts. Indentation determines nesting; automatic numbering follows the current list's level and container. Code highlighting/language controls and installed Callout-plugin previews remain available in nested blocks. Source editing exposes prefixes; ordinary list body input keeps the incremental edit path.
- Canvas draws text, table cells and borders, the caret, and selections. Only lines near the viewport are laid out. A hidden textarea receives keyboard and IME input for the active editing range; it does not render the document.
- Supports input, selections across lines, clipboard operations, undo/redo, arrow keys, and regular-expression search. IME events and composition undo have regression coverage; individual input methods still need real-world testing.
- A dedicated scrollbar remains visible on the right. The native outline uses Canvas heading data, supports click/Enter navigation, updates after heading edits, and highlights the visible section. Native outline hooks are restored on exit.
- `Ctrl+click` opens Markdown links (`Command+click` on macOS); ordinary clicks edit. Web and relative file links go through Typora. Heading fragments navigate within the Canvas document, including links inside Callout snapshots. Reference-style links are not yet supported.
- Basic headings, bold, italics, links, quotes, and code read heading colors, font sizes, weights, line heights, and paragraph spacing from the current theme. Single and repeated body blank lines remain visible. Blank runs adjacent to headings collapse, leaving heading spacing to the theme. Empty paragraph geometry is sampled from theme CSS. Internal Callout blanks remain; only trailing blanks in each Callout scope collapse. The native plugin preview follows the same rule and supports explicit `<br>` breaks. Source blank lines are never deleted.
- Editing Callouts and ordinary quotes exposes the complete `> ` prefix, including titles, body lines, empty quote lines, and nested quotes. The caret can move before `>`; `Home` followed by `Enter` inserts a line before that quote line. Preview hides the markers.
- Enter continues a nonempty quote with its prefix; splitting a line keeps the prefix on both lines. On a line containing only `>` or `> `, Enter removes the prefix without inserting a newline. Empty nested quotes exit one level. Fenced code retains code input behavior. Each operation is one undo step and preserves CRLF.
- Table arrows navigate cells: up/down move to the same column in an adjacent row, skipping the Markdown separator. Left/right move through text and cross into adjacent cells at cell boundaries. At the outer table boundaries they move into surrounding text. At document boundaries an undoable empty paragraph is created. This also works for tables inside Callouts; `Alt+arrow` still moves entire rows/columns.
- Inline syntax supports formulas inside emphasis, including `**$a$**`, `*$a$*`, `***$a$***`, and formulas within bold prose. Formula source ranges remain clickable. Colors, fonts, weights, and size ratios for emphasis, inline code, and links are sampled separately in paragraphs, headings, and table cells. Formulas use the size and color of their context.
- Supports `---`, `___`, and `***` rules, plus fenced code with language metadata. A separate Worker highlights code using colors sampled from the theme's CodeMirror styles. The language control and fence completion support keyboard selection.
- Inline formulas preview after the closing `$`. Moving inside a formula exposes its source; leaving that range restores preview without leaving the line. Display math supports attached delimiters, multiline `$$…$$`, and `\[…\]`; editing inside expands the source.
- A separate MathJax Worker produces self-contained SVG paths for Canvas. It does not reuse or modify Typora's MathJax globals. Worker startup and queue time do not count toward the 5-second per-formula layout timeout. A failure falls back only for that formula. Timeouts restart the Worker and continue other jobs, retaining completed results without automatic retry loops. Failed multiline formulas retain their complete source; Callout failures are isolated too.
- Display equations occupy their actual SVG height, scaled proportionally when too wide, plus `ceil(font size × 0.65)` above and below. Canvas and Callout previews share this calculation. Fractions, matrices, and multiline environments are not constrained to body line height; display math does not use the inline baseline offset.
- Formula completion invalidates only dependent line layouts; multiple completions coalesce into the next frame. Image/formula caches allow up to 256 entries and 32 MiB of decoded pixels, protecting visible assets. An exhausted budget falls back to source rather than triggering eviction/render loops. Eviction cancels queued work and ignores stale decoding results.
- Basic GFM tables have equal-width columns, borders, headers, alignment, line breaks, and inline math. Editing retains the table structure. Merged cells, HTML tables, and Typora's complete column-width algorithm are not yet supported.
- A table toolbar supports resizing, column alignment, inserting/deleting/moving rows and columns, and deleting a table. Each command edits that table's Markdown in one undo step, preserving surrounding text, Callout prefixes, and formula source. Shrinking removes excess cells; undo restores them.
- `Tab` / `Shift+Tab` switch cells; Tab from the final cell adds a row. Enter moves down in the same column; `Shift+Enter` inserts a rendered `<br>`. `Ctrl+Enter` inserts a row below and `Ctrl+Shift+Enter` leaves the table. `Alt+↑/↓` moves a row and `Alt+←/→` moves a column. The menu can copy the table or format its source. Data rows cannot be inserted above the header or moved into its position. Application shortcuts in the editor also accept Command on macOS.
- Callouts support default/custom titles, nesting, `+`/`-` folding markers, hover previews, formulas, and tables. Types, CSS colors, icons, borders, and spacing come from the installed Callouts module. Titles and body text are styled separately. Legacy aliases `notes`, `importent`, and `definitiion` are recognized. Disabling custom Callouts leaves only the five native alert types.
- Exposed Callout markers support character-based left/right and visual-row up/down navigation. Clicking the icon in a native plugin preview opens the `[!type]` source.
- When Callouts is installed, a separate instance with no registered lifecycle handles a temporary offscreen DOM for a visible Callout. Its title decoration and current CSS pseudo-elements, icons, borders, backgrounds, and spacing are rasterized locally and drawn into Canvas. Editing uses the Canvas source model; leaving the block restores the preview. The original plugin instance, note DOM, and companion repository are not modified.
- Callout snapshots are limited to 8 entries and 32 MiB, with one offscreen capture at a time. Blocks over 300 lines, 60,000 characters, or a 24 MiB pixel budget fall back to basic Canvas Callouts, as do incompatible plugins. Capture does not execute arbitrary other plugins or reproduce Typora's entire block parser. Complex HTML and external icon fonts may differ.
- Theme switches, stylesheet loads, and font loads resample backgrounds, text typography, table header/stripe/border colors, and code styles after transitions settle. Formula, icon, and Callout caches are rebuilt. Inline math shares the text baseline; display math is centered.
- Markdown images decode on demand. Relative paths use the current document's Typora resource root. Image and formula caches have entry and byte limits.
- With the latest `obsidian_images` module installed and enabled, Canvas reuses its parsing, CSS decoration, and attachment lookup for forms such as `![[image.png|C|500]]` and `![[image.svg|500|R]]`, including `C/R/L` alignment and pixel widths. Decoding waits for the asynchronous attachment index without refreshing the native document. Ordinary body images currently require their own source line; Callout snapshots also support images mixed with text. Disabled modules leave wiki-image source intact.
- Theme and image-plugin layout are sampled in a temporary local DOM before drawing, including dimensions, position, and paragraph spacing. Layout responds to theme and width changes. Plugin/Typora resolution precedes generic relative-path handling. General CSS filters, shadows, and borders are not fully reproduced.
- `Ctrl+S` or the save button writes current Markdown through Typora's save API. Input does not reparse a hidden native document; exiting synchronizes source back to Typora. The save bridge was adapted to Windows Typora 1.14; other host versions need verification.
- Recovery source copies are stored under `~/.config/typora-canvas/recovery/`. External/native changes pause write-back and retain recovery copies rather than silently overwriting content.
- Escape returns to native editing. `Ctrl+Alt+Shift+F8` toggles the plugin. Saving in the browser demo downloads Markdown; it does not overwrite the originally selected file.

**Compatibility limits:** arbitrary theme CSS, footnotes, HTML, custom macros, complex tables, and all native plugin syntax are not fully reproduced. Unsupported syntax remains in the source. Callouts require explicit `>` prefixes; Markdown lazy continuation is not fully implemented. Canvas samples common semantic styles and uses browser layout locally for Callouts; it is not a general CSS engine. The first click in a Callout snapshot uses approximate line positioning; subsequent editing uses precise text hit testing. Existing backgrounds inside image files are not recolored by the theme. Other plugins depending on the old DOM need individual adapters. Virtualization currently works by logical source line, so very long lines, structural edits, and large selections may still be expensive.

The pure Canvas editor is an editable prototype, not a complete Typora replacement. Set `RENDER_MODE = "hybrid"` and restart to use hybrid mode as a comparison.

### Continue and nest lists

Press Enter after `2. Beta` to insert the next item and renumber the following sibling:

```markdown
1. Alpha
2. Beta
3.
4. Gamma
```

Press Enter again on the empty `3.` item to remove its marker. Children keep their own numbering. Indent content beneath its parent item; use explicit `>` prefixes inside quotes and Callouts:

```markdown
1. Parent
   - Child bullet
     1. Nested ordered item
   > [!note] Nested Callout
   > a. First
   > b. Second

> [!proof] Lists inside a Callout
> 1. First step
>    - Supporting detail
> 2. Second step
```

Alphabetic and Roman counters are Canvas extensions; other Markdown renderers may display their source as plain text.

## Hybrid mode behavior

- Starts automatically when a document opens; empty notes remain editable.
- A small status indicator reports preparation, caching, native rendering, editing, or input. It does not mean every block is drawn by Canvas.
- Clicking, selecting, typing, IME input, and undo use the native editor without a mode-switch shortcut.
- Images, formulas, SVGs, diagrams, code editors, and some complex styles stay native.
- Typora applies the theme and custom CSS. Cacheable content uses its actual DOM geometry and computed styles. Content unsuitable for snapshots, such as external fonts, filters, shadows, or animation, stays native.
- `Ctrl+F` / `Ctrl+H` go directly to Typora, including its regular-expression search option.
- `Ctrl+Alt+Shift+F8` toggles the layer. Disabling it prevents immediate reopening on the same document; navigating to another document resumes the configured default.
- Source-code mode unmounts the layer; returning to rendered mode restores it.

Startup checks host readiness immediately and periodically rather than relying on a single file-loaded event. Initial MathJax/layout `fileEdited` events refresh caches instead of disabling the plugin.

## Architecture and practical limits

The pure Canvas editor keeps source and interaction state independently of the native document DOM:

```text
Markdown source → block/list scopes → viewport layout and hit testing → Canvas
Keyboard / IME → source edits and undo → affected layout updates
Theme CSS / image plugin → sampled styles and image resolution
MathJax Worker → SVG paths; Callouts plugin → bounded local snapshots
```

Hybrid mode uses the native document as its layout and editing authority:

```text
Typora parsing, math and CSS → editable DOM (document and layout authority)
                              ├─ complex content / interaction → native display
                              └─ static ordinary content → local snapshots → viewport Canvas
Offscreen content → browser content-visibility optimization
```

The hybrid bitmap cache defaults to 24 MiB and at most 128 entries. The Canvas backing store follows the viewport. Content, theme, and size changes invalidate caches; interaction synchronously restores native content. The layer does not rewrite Markdown or replace the editable subtree.

**Hybrid mode is not a fully virtualized editor.** It retains the full DOM and host layout work, and snapshot creation has a cost. It does not accelerate initial parsing or eliminate equation computation; editing restores native rendering. Offscreen size estimates can change unvisited content heights. Performance improvements need measurement in real notes.

Hybrid mode provides a compatibility baseline. The pure Canvas direction is a separate document/selection model, incremental layout, viewport drawing, and hit testing, reusing Markdown and math libraries where appropriate.

