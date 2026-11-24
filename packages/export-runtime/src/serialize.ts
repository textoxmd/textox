import { filterCss } from './css-filter'
import { buildStandaloneHtml } from './html-doc'
import { embedImages } from './image-embed'
import { getBaseName, mountExportOverlay, type MountedOverlay } from './overlay'

/** 序列化只关心这两个字段；与骨架的 ExportContext 结构兼容。 */
export interface ExportLocation {
  currentFile: string | null
  documentDir: string | null
}

export interface ClonedContent {
  title: string
  /** 编辑器容器根节点（带 `.texto-editor` 类，CSS 过滤需要它） */
  root: HTMLElement
  /** 真正的内容层（`.ProseMirror`），EPUB 切章必须用它 */
  contentRoot: HTMLElement
  background: string
  foreground: string
  cleanup: () => void
}

export interface SerializedDocument extends ClonedContent {
  html: string
}

/**
 * 只做克隆与基础度量：**不内嵌图片、不收集 CSS**。
 * 供不需要「自包含 HTML」的导出器使用——EPUB 会把本地图片抽成独立文件
 * （`OEBPS/images/*`），若先内嵌成 data URL，抽取阶段就会把它们当内联图片跳过。
 *
 * 调用方必须在使用完 root 后调用 cleanup()。
 */
export async function cloneEditorContent(
  ctx: Pick<ExportLocation, 'currentFile'>,
): Promise<ClonedContent> {
  const mounted: MountedOverlay = await mountExportOverlay()
  const root = mounted.wrap.firstElementChild as HTMLElement | null
  if (!root) {
    mounted.cleanup()
    throw new Error('Export overlay has no content root')
  }
  const styles = getComputedStyle(document.documentElement)
  const contentRoot = root.querySelector<HTMLElement>('.ProseMirror') ?? root
  return {
    title: getBaseName(ctx.currentFile) ?? 'Untitled',
    root,
    contentRoot,
    background: styles.getPropertyValue('--background').trim() || '#ffffff',
    foreground: styles.getPropertyValue('--foreground').trim() || '#1a1a1a',
    cleanup: mounted.cleanup,
  }
}

/**
 * 克隆编辑器 DOM 并生成自包含 HTML。调用方必须在使用完 root 后调用 cleanup()。
 *
 * 注意：本函数**不取单飞锁**。一次导出里 overlay 需要跨「序列化 → HTML/EPUB
 * 产物生成」全程存活，锁必须在更外层（调用方用 runExclusiveExport 包住
 * exporter.run）。见 overlay.ts 的注释。
 */
export async function serializeToStandaloneHtml(
  ctx: Pick<ExportLocation, 'currentFile' | 'documentDir'>,
): Promise<SerializedDocument> {
  const cloned = await cloneEditorContent(ctx)
  try {
    await embedImages(cloned.root, ctx.documentDir)
    const css = await collectAppCss(cloned.root)
    const html = buildStandaloneHtml({
      title: cloned.title,
      css,
      bodyHtml: cloned.root.outerHTML,
      background: cloned.background,
      foreground: cloned.foreground,
      // 固定为导出时的外观：应用暗色 -> 导出文档也带 dark 类，使 .dark 变量块生效。
      isDark: document.documentElement.classList.contains('dark'),
    })
    return { ...cloned, html }
  } catch (error) {
    cloned.cleanup()
    throw error
  }
}

/** 收集当前页面已加载样式表中、能匹配到 root 子树的规则。 */
async function collectAppCss(root: HTMLElement): Promise<string> {
  const parts: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let text: string
    try {
      // 跨域样式表不可读取；个别规则的 cssText getter 也可能抛错。
      // 按表降级：读失败就跳过这张表，不要因此让整次导出失败。
      text = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n')
    } catch {
      continue
    }
    // filterCss 内部按需动态加载 css-tree（首次调用一次），故这里必须 await。
    parts.push(await filterCss(text, root))
  }
  return parts.filter(Boolean).join('\n')
}
