// Based on obgnail/typora_plugin 1.19.14 (MIT, copyright 2023 obgnail).
// Local patch: preserve custom titles without rewriting editor text nodes.
class CalloutsPlugin extends BasePlugin {
  decorateTitle = (paragraph, type) => {
    // Typora may nest inline spans, or represent soft breaks with either <br>
    // or .md-softbreak. Read only the first visual line, not an arbitrary span.
    const doc = paragraph.ownerDocument
    const range = doc.createRange()
    range.selectNodeContents(paragraph)
    const lineBreak = paragraph.querySelector("br, .md-softbreak")
    if (lineBreak) range.setEndBefore(lineBreak)
    const firstLine = range.toString().split(/\r?\n/, 1)[0]
    const match = firstLine.match(/^\[!\w+\][+-]?[\t ]*(.*)$/)
    const title = match?.[1]?.trim() || type
    // This is exactly the direct child targeted by the upstream display rule.
    const span = paragraph.firstElementChild
    if (span?.tagName !== "SPAN") return
    // Reuse the upstream attribute: its CSS and HTML export already consume it.
    const ownMatch = span.textContent.split(/\r?\n/, 1)[0].match(/^\[!\w+\][+-]?[\t ]*(.*)$/)
    // If only the marker is inside the first span, keep its following title
    // text in place instead of duplicating it in the pseudo element.
    const displayed = ownMatch && firstLine !== span.textContent.split(/\r?\n/, 1)[0]
      ? ownMatch[1].trim()
      : title
    span.setAttribute("data-type", displayed)
  }

  style = () => {
    const callouts = this.config.CALLOUTS
      .map(c => `.plugin-callout[callout-type="${c.type}"] { --callout-bg-color: ${c.background_color}; --callout-left-line-color: ${c.left_line_color}; --callout-icon: "${c.icon}"; }`)
      .join("\n")
    const hoverCss = `.callout-folded:hover :not(:first-child):not(.md-softbreak) { display: inherit !important; }`
    const colorCss = `.plugin-callout > p:first-child span:first-child { color: var(--callout-left-line-color); } .plugin-callout > p:first-child::before { color: var(--callout-left-line-color); }`
    const hover = this.config.HOVER_TO_SHOW_FOLD_CALLOUT ? hoverCss : ""
    const color = this.config.SET_TITLE_COLOR ? colorCss : ""
    return { callouts, hover, color }
  }

  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  process = () => {
    this.utils.eventHub.on(this.utils.eventHub.eventType.allPluginsHadInjected, () => setTimeout(this.setCallouts, 100))
    this.utils.eventHub.on(this.utils.eventHub.eventType.fileEdited, this.setCallouts)
    // A file can finish loading after the startup scan. Native GitHub alert
    // containers are also created at this point, before the first edit.
    const schedule = () => {
      clearTimeout(this.fileLoadTimer)
      this.fileLoadTimer = setTimeout(this.setCallouts, 0)
    }
    this.utils.eventHub.on(this.utils.eventHub.eventType.fileOpened, schedule)
    this.utils.eventHub.on(this.utils.eventHub.eventType.fileContentLoaded, schedule)
    this.utils.exportHelper.register(this.fixedName, this.beforeExport, this.afterExport)
  }

  setCallouts = () => {
    // Typora's block parser accepts [!note] Title as a native alert, while its
    // inline alert parser only accepts a standalone [!note] line. Such custom
    // titles remain raw inside div.md-alert rather than inside blockquote.
    this.utils.entities.querySelectorAllInWrite("blockquote > p:first-child, .md-alert > p:first-child").forEach(p => {
      const blockquote = p.parentElement
      const result = p.textContent.match(/^\[!(?<type>\w+)\](?<fold>[+-]?)/)
      const ok = !!(result?.groups) && !p.querySelector('[md-inline="alert_text"], .md-alert-text')
      blockquote.classList.toggle("plugin-callout", ok)
      if (ok) {
        const { type, fold } = result.groups
        this.decorateTitle(p, type)
        blockquote.setAttribute("callout-type", type.toLowerCase())
        blockquote.classList.toggle("callout-folded", fold === "-")
      }
    })
  }

  call = () => this.utils.insertText(null, this.config.TEMPLATE)

  check = args => {
    const isIgnoredExportType = args?.[0]?.type === "html-plain"
    const hasCallouts = this.utils.entities.querySelectorInWrite(".plugin-callout")
    return !isIgnoredExportType && hasCallouts
  }

  beforeExport = (...args) => {
    if (!this.check(args)) return

    const extra = `@font-face { font-family: "${this.config.FONT_FAMILY}"; src: url("${this.config.NETWORK_ICON_URL}"); font-weight: normal; font-style: normal; }`
    const css = this.utils.getStyleText(this.fixedName)
    return this.config.USE_NETWORK_ICON_WHEN_EXPORTING
      ? extra + css
      : css.replace(/--callout-icon: ".*?";/g, "")
  }

  afterExport = (html, ...args) => {
    if (!this.check(args)) return

    const quotesInPage = [...this.utils.entities.querySelectorAllInWrite("blockquote, .md-alert")]
    if (quotesInPage.length === 0) return

    const doc = new DOMParser().parseFromString(html, "text/html")
    const quotesInHTML = [...doc.querySelectorAll("blockquote, .md-alert")]
    if (quotesInHTML.length !== quotesInPage.length) return

    const zipArray = this.utils.zip(quotesInPage, quotesInHTML)
    for (const [quoteInPage, quoteInHTML] of zipArray) {
      if (quoteInPage.classList.contains("plugin-callout")) {
        quoteInHTML.classList.add("plugin-callout")

        const calloutType = quoteInPage.getAttribute("callout-type")
        quoteInHTML.setAttribute("callout-type", calloutType)

        const span = quoteInHTML.querySelector(":scope > p:first-child > span:first-child")
        if (span) this.decorateTitle(span.parentElement, calloutType)
      }
    }
    return `<!DOCTYPE HTML>\n${doc.documentElement.outerHTML}`
  }
}

module.exports = {
  plugin: CalloutsPlugin,
}
