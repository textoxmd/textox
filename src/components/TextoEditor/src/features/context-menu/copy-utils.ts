import MarkdownIt from "markdown-it"

let md: MarkdownIt | null = null

function getRenderer(): MarkdownIt {
  if (!md) {
    md = new MarkdownIt({ html: true })
  }
  return md
}

export function markdownToHtml(mdSrc: string): string {
  return getRenderer().render(mdSrc)
}

export function copyAsHtml(html: string): Promise<void> {
  const blobHtml = new Blob([html], { type: "text/html" })
  const blobPlain = new Blob([html], { type: "text/plain" })
  const item = new ClipboardItem({
    "text/html": blobHtml,
    "text/plain": blobPlain,
  })
  return navigator.clipboard.write([item])
}
