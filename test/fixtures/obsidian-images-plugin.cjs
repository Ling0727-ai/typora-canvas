// Copyright (c) 2026 Ling0727-ai. MIT license.
// Keep the original wikilink in Typora's native image source component.
class ObsidianImagesPlugin extends BasePlugin {
  marker = "typora-obsidian-image:"
  roots = new Map()
  pending = new Set()

  parse = text => {
    const match = /^!\[\[([^\]\r\n]+)\]\]/.exec(text)
    if (!match) return null
    const [file, ...options] = match[1].split("|").map(s => s.trim())
    if (!/\.(png|svg|jpe?g|gif|webp|bmp|avif)$/i.test(file)) return null
    let align = "C", width = null, hasAlign = false
    for (const option of options) {
      if (/^[CLR]$/i.test(option) && !hasAlign) {
        align = option.toUpperCase(); hasAlign = true
      } else if (/^\d+$/.test(option) && width === null && Number(option) > 0 && Number.isSafeInteger(Number(option))) {
        width = Number(option)
      } else return null
    }
    return { raw: match[0], inner: match[1], file, align, width }
  }

  style = () => `
#write .md-image:has(> img.obsidian-image):not(.md-expand) { display: block; width: auto; max-width: 100%; }
img.obsidian-image { display: block; height: auto; max-width: 100%; object-fit: contain; }
`

  prepare = async () => {
    this.fs = require("fs")
    this.path = require("path")
    await this.utils.waitUntil(() => File?.editor?.brush?.inline)
    const lexer = File.editor.brush.inline.constructor
    if (!lexer.rules?.normal?.image || !File.editor.brush.inline.rules?.image) {
      throw new Error("Obsidian Images: unsupported Typora inline image parser")
    }
    const plugin = this
    const tables = new Set([File.editor.brush.inline.rules, ...Object.values(lexer.rules || {}).filter(v => v && typeof v === "object" && v.image)])
    for (const table of tables) {
      const normal = table.image
      const smart = table.image_ext
      table.image = { exec(text) {
        const image = plugin.parse(text)
        if (!image) return normal.exec(text)
        const result = [image.raw, "![[", image.file, image.inner, plugin.resolve(image.file), undefined, undefined,
          plugin.marker + encodeURIComponent(JSON.stringify({ align: image.align, width: image.width })), "]]" ]
        result.index = 0; result.input = text
        return result
      } }
      if (smart) table.image_ext = { exec(text) {
        const image = plugin.parse(text)
        return image ? [image.raw, image.raw, undefined, "", undefined, ""] : smart.exec(text)
      } }
    }
    // Hook the common inline output, including the native export lexer. Parsing
    // still handles escapes, code spans and ordinary Markdown images itself.
    await this.utils.decorator.decorate(lexer.prototype, "output", {
      after(html) { return plugin.decorateImages(html) }, modifyResult: true,
    })
  }

  decorateImages = html => {
    if (typeof html !== "string" || !html.includes(this.marker)) return html
    return html.replace(/<img\b[^>]*>/gi, tag => {
      if (!tag.includes(this.marker)) return tag
      const template = document.createElement("template")
      template.innerHTML = tag
      const img = template.content.querySelector("img")
      const title = img?.getAttribute("title") || ""
      if (!title.startsWith(this.marker)) return tag
      let options
      try { options = JSON.parse(decodeURIComponent(title.slice(this.marker.length))) } catch { return tag }
      img.removeAttribute("title")
      img.classList.add("obsidian-image")
      Object.assign(img.style, { display: "block", height: "auto", maxWidth: "100%",
        marginLeft: options.align === "L" ? "0px" : "auto",
        marginRight: options.align === "R" ? "0px" : "auto" })
      if (options.width) { img.style.width = options.width + "px"; img.setAttribute("width", options.width) }
      return img.outerHTML
    })
  }

  getRoot = () => {
    const current = this.utils.getFilePath()
    if (!current) return this.utils.getMountFolder() || ""
    let dir = this.path.dirname(current)
    for (let candidate = dir; ; candidate = this.path.dirname(candidate)) {
      if (this.fs.existsSync(this.path.join(candidate, ".obsidian"))) return candidate
      if (this.path.dirname(candidate) === candidate) break
    }
    return this.utils.getMountFolder() || dir
  }

  resolve = file => {
    const root = this.getRoot()
    const current = this.utils.getFilePath()
    const dir = current ? this.path.dirname(current) : root
    // Typora protects underscores and escaped characters before image parsing.
    let decoded = file.replace(/\uE006/g, "_").replace(/\uE020/g, "\\").replace(/\uE021/g, "|").replace(/\uE022/g, " ")
    try { decoded = decodeURIComponent(decoded) } catch { /* Literal % in a filename. */ }
    const candidates = [this.path.resolve(dir || ".", decoded)]
    if (root) candidates.push(this.path.resolve(root, decoded.replace(/^[\\/]+/, "")))
    // Use the native image root (including typora-root-url) when it is set.
    const native = File.editor.imgEdit?.getAbsolutePath?.(file)
    if (native && this.path.isAbsolute(native)) candidates.push(native)
    for (const candidate of candidates) {
      try { if (this.fs.statSync(candidate).isFile()) return candidate.replace(/\\/g, "/") } catch { /* Try the next location. */ }
    }
    if (!root) return file
    let entry = this.roots.get(root)
    if (entry?.done && Date.now() - entry.created > 30000) { this.roots.delete(root); entry = null }
    if (!entry) {
      entry = { files: [], done: false, created: Date.now() }
      this.roots.set(root, entry)
      this.index(root, entry)
    }
    const suffix = decoded.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
    const hits = entry.files.filter(p => p.toLowerCase() === suffix || p.toLowerCase().endsWith("/" + suffix))
    // An ambiguous filename stays unresolved; give the link a relative path.
    if (entry.done && hits.length === 1) return this.path.join(root, hits[0]).replace(/\\/g, "/")
    if (!entry.done) this.pending.add(root)
    return file
  }

  index = async (root, entry) => {
    const visit = async dir => {
      let children
      try { children = await this.fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const child of children) {
        const target = this.path.join(dir, child.name)
        if (child.isDirectory() && !child.name.startsWith(".") && !["node_modules", "$RECYCLE.BIN"].includes(child.name)) await visit(target)
        else if (child.isFile() && /\.(png|svg|jpe?g|gif|webp|bmp|avif)$/i.test(child.name)) entry.files.push(this.path.relative(root, target).replace(/\\/g, "/"))
      }
    }
    await visit(root)
    entry.done = true
    if (this.pending.delete(root) && this.getRoot() === root) this.refresh(true)
  }

  refresh = (retry = false) => {
    const write = this.utils.entities.eWrite
    const cids = new Set()
    for (const block of write.querySelectorAll("p[cid], h1[cid], h2[cid], h3[cid], h4[cid], h5[cid], h6[cid], td, th")) {
      if (!block.textContent.includes("![[") || block.closest("pre, .md-fences, .md-htmlblock, .md-mathblock")) continue
      if (!retry && block.querySelector("img.obsidian-image")) continue
      const cid = block.closest("[cid]")?.getAttribute("cid")
      if (cid) cids.add(cid)
    }
    for (const cid of cids) File.editor.brush.addToQueue(cid, true)
  }

  process = () => {
    const events = this.utils.eventHub
    const schedule = () => {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.refresh(), 100)
    }
    for (const type of [events.eventType.allPluginsHadInjected, events.eventType.fileOpened, events.eventType.fileContentLoaded]) events.on(type, schedule)
    this.utils.exportHelper.register(this.fixedName, this.style)
    schedule()
  }
}

module.exports = { plugin: ObsidianImagesPlugin }
