// 导出/打印共用的克隆层与单飞锁（原生命令见 export/native/）。
// 与 PDF 导出共用同一把锁——两者都依赖同一个 overlay，不能并发。

/**
 * 互斥执行的结果。用判别联合而非 `T | null`：后者会与「回调自身返回 null」
 * （例如用户取消保存面板）混淆，而导出/打印的多条路径都要用到它。
 */
export type ExclusiveOutcome<T> = { ran: true; value: T } | { ran: false }

// 防止并发导出/打印：两次操作同时进行会互相移除对方的 overlay，
// 导致其中一次捕获到空内容。菜单/快捷键同时触发时只执行一次。
let exportInProgress = false

/**
 * 互斥执行导出任务。已有任务在跑时返回 `{ ran: false }`，且**完全不调用 fn**
 * （不排队、不报错），与既有行为一致。
 *
 * 任何会挂载 `#texto-print-overlay` 的操作都必须经由本函数，
 * 否则两次导出会互相移除对方的 overlay，导致其中一次捕获到空内容。
 */
export function runExclusiveExport<T>(fn: () => Promise<T>): Promise<ExclusiveOutcome<T>> {
  if (exportInProgress) return Promise.resolve({ ran: false })
  exportInProgress = true
  return (async () => {
    try {
      return { ran: true, value: await fn() }
    } finally {
      exportInProgress = false
    }
  })()
}

/**
 * 取当前文档的文件名主体（不含目录与扩展名），用于打印作业名等信息。
 */
export function getBaseName(currentFile: string | null): string | undefined {
  if (!currentFile) return undefined
  let path = currentFile
  if (path.startsWith('file://')) {
    path = path.slice('file://'.length)
    try {
      path = decodeURIComponent(path)
    } catch {
      // 路径含非法编码时保持原样
    }
  }
  const base = path.split(/[/\\]/).filter(Boolean).pop() || ''
  if (!base) return undefined
  // 按「最后一个点」剥离扩展名（.txt/.markdown 等同样适用），
  // 点位于首位（如 .hidden）时视为文件名的一部分，不做剥离。
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * 等待克隆体内的所有图片加载完成。
 *
 * 编辑器里的图片是 `loading="lazy"`（配合 IntersectionObserver 按滚动渐进
 * 加载），文档视口外的图片（尤其是远程 URL 图片）可能根本没发起请求，PDF
 * 里就会显示空白/破图。这里把图片强制改为 eager 并等待 load/error 结束，
 * 最后再等解码完成，确保 PDF 捕获到完整图像。带超时兜底：个别坏图/超时
 * 图片不阻塞导出。
 *
 * 该阶段在克隆体未挂载到 DOM 时执行（图片同样会正常加载），因此整个等待
 * 过程界面完全不受影响，不会出现导出时界面被隐藏/切换布局的情况。
 */
export async function waitForImagesToLoad(container: HTMLElement, timeoutMs = 6000): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'))
  if (imgs.length === 0) return

  const pending: Promise<void>[] = []
  for (const img of imgs) {
    img.loading = 'eager'
    img.decoding = 'async'
    if (img.complete) continue
    pending.push(
      new Promise<void>((resolve) => {
        const done = () => resolve()
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
      }),
    )
  }

  if (pending.length > 0) {
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }

  // 确保图像已解码，避免 PDF 截到解码中的空白区域；
  // 只处理已加载完成的图（超时后仍挂起的远程图不再等待，防止导出卡死）。
  // decode() 对个别损坏/动画格式可能永不返回，同样用超时兜底，避免挂起导出。
  const toDecode = imgs.filter((img) => img.complete && img.naturalWidth > 0)
  if (toDecode.length > 0) {
    await Promise.race([
      Promise.allSettled(toDecode.map((img) => img.decode())),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }
}

/** 挂载后的导出克隆体及其清理函数（cleanup 必须成对调用） */
export interface MountedOverlay {
  wrap: HTMLElement
  cleanup: () => void
}

/**
 * 挂载导出/打印用的克隆体（#texto-print-overlay）。
 *
 * 克隆体挂在 body 末尾（应用界面之后），整体位于视口下方，屏幕上完全看不到，
 * 因此无需隐藏侧边栏/顶栏（或任何其他界面组件）。导出时由 WKWebView 按 rect
 * 捕获这段区域；打印时由 `@media print` 规则（print.css）只显示这段区域。
 *
 * `printing` 会额外加上 `html.texto-printing`：打印专用样式（清零克隆体内边距，
 * 因为打印页边距由 NSPrintInfo 统一提供）只在该类存在时生效，导出 PDF 不受影响。
 *
 * 返回的 cleanup 必须在结束后调用（放在 finally 里），恢复 html/body 的
 * overflow 并移除克隆体。
 */
export async function mountExportOverlay(options: { printing?: boolean } = {}): Promise<MountedOverlay> {
  const el = document.querySelector('.prosemirror-editor-container.texto-editor')
  if (!el) throw new Error('Editor not found')

  document.getElementById('texto-print-overlay')?.remove()

  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelector('.texto-web-source')?.remove()
  clone.querySelectorAll('.cb-chrome, .code-block-header, .mermaid-action-buttons').forEach(el => el.remove())
  // 通用导出契约（与插件解耦）：贡献 NodeView 的插件在 DOM 上标注
  // `data-export="html"` 表示「该段需按真实 HTML 渲染导出」，
  // `data-export-source` 指向承载源码的元素。共享运行时只认这两个属性、
  // 不认识任何插件的私有标签/类名；取源码注入为真实 HTML，让 PDF 打印出
  // 渲染结果（直接取 textContent 会把源码与渲染容器文本拼接）。
  clone.querySelectorAll('[data-export="html"]').forEach((el) => {
    const div = document.createElement('div')
    div.innerHTML = el.querySelector('[data-export-source]')?.textContent ?? el.textContent ?? ''
    el.replaceWith(div)
  })

  // 图片预加载阶段：克隆体尚未挂载到 DOM，界面保持原样（侧边栏、布局
  // 都不会变化）。图片加载完、布局稳定后，才进入真正的捕获阶段。
  await waitForImagesToLoad(clone)

  // 关键：内容挂在 body 末尾（应用界面之后），整体位于视口下方，
  // 屏幕上完全看不到它。
  const wrap = document.createElement('div')
  wrap.id = 'texto-print-overlay'
  // display:flow-root 让克隆体内部的上下外边距不溢出容器，
  // 保证 getBoundingClientRect() 覆盖完整内容高度。
  wrap.style.cssText = 'width:100%;display:flow-root'
  wrap.append(clone)
  document.body.append(wrap)

  const html = document.documentElement
  const origHtmlOverflow = html.style.overflow
  const origBodyOverflow = document.body.style.overflow
  // 导出/打印期间页面画布使用主题背景色（见 print.css 的 html.texto-exporting），
  // 避免内容不足一屏时 PDF 底部露出与主题不一致的背景
  html.classList.add('texto-exporting')
  if (options.printing) html.classList.add('texto-printing')
  // 内容位于视口之外，必须让文档溢出区域参与绘制，WKWebView 才能捕获到
  // 完整内容（overflow:hidden 会把这段内容裁掉，导出空白页）。
  // 这两个属性只作用于 html/body，不触碰任何界面组件。
  html.style.overflow = 'visible'
  document.body.style.overflow = 'visible'

  return {
    wrap,
    cleanup: () => {
      wrap.remove()
      html.classList.remove('texto-exporting')
      html.classList.remove('texto-printing')
      html.style.overflow = origHtmlOverflow
      document.body.style.overflow = origBodyOverflow
    },
  }
}

/**
 * 计算导出内容的捕获区域（web page 坐标，CSS 像素）。
 *
 * 导出内容被挂在文档流末尾（应用界面下方），起点即容器位置；
 * 高度取到文档内容末尾，避免最后一个元素的外边距/溢出内容被裁掉。
 */
export function getCaptureRect(
  wrap: HTMLElement,
): { x: number; y: number; width: number; height: number } {
  const box = wrap.getBoundingClientRect()
  const x = box.left + window.scrollX
  const y = box.top + window.scrollY
  return {
    x,
    y,
    width: box.width || document.documentElement.clientWidth,
    height: Math.max(box.height, document.documentElement.scrollHeight - y),
  }
}
