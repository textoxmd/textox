import { invoke } from '@tauri-apps/api/core'
import { getBaseName, mountExportOverlay, runExclusiveExport } from '@texto/export-runtime'

/**
 * 打印页边距（pt）：直接取克隆体内容区自身的内边距，让纸张留白与编辑器一致。
 *
 * 之前用固定 36pt 会和编辑器内边距叠加（编辑器左右 60px、上下 40px），
 * 结果左右比上下宽出一截、看起来不协调；打印路径下克隆体的内边距已被清零
 * （见 print.css 的 html.texto-printing），所以这里量到的值就是纸张边距。
 *
 * px→pt 按 1px = 0.75pt 换算，并夹到 [18, 72]pt：下限保证不会顶到打印机
 * 不可打印区（多页时第 2 页起没有内边距兜底），上限避免留白过大。
 */
function getPrintMargins(wrap: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  const content = wrap.querySelector('.ProseMirror')
  const style = content ? window.getComputedStyle(content) : null
  const toPt = (value: string | undefined, fallbackPt: number): number => {
    const px = Number.parseFloat(value ?? '')
    if (!Number.isFinite(px)) return fallbackPt
    return Math.min(72, Math.max(18, px * 0.75))
  }
  return {
    top: toPt(style?.paddingTop, 30),
    bottom: toPt(style?.paddingBottom, 30),
    left: toPt(style?.paddingLeft, 45),
    right: toPt(style?.paddingRight, 45),
  }
}

/**
 * 调起原生打印（macOS 系统打印面板；`print_webview` 未在其它平台注册）。
 *
 * 打印由 WKWebView 的 `printOperationWithPrintInfo:` 完成：WebKit 按系统纸张
 * 正常分页，文字保持原尺寸；面板内可选打印机、份数、页码范围，也可「存储为
 * PDF」。界面组件（侧边栏/顶栏）不会被隐藏——打印渲染走 `@media print`
 * 规则，只显示这里挂载的克隆体。
 *
 * 克隆体在打印结束（面板关闭）后才移除；期间屏幕上的界面保持原样。
 */
export async function printDocument(currentFile: string | null): Promise<boolean> {
  const outcome = await runExclusiveExport(async () => {
    const { wrap, cleanup } = await mountExportOverlay({ printing: true })
    try {
      await new Promise(r => requestAnimationFrame(r))
      await new Promise(r => requestAnimationFrame(r))
      await invoke('print_webview', {
        jobName: getBaseName(currentFile) ?? null,
        margins: getPrintMargins(wrap),
      })
    } finally {
      cleanup()
    }
    return true
  })
  return outcome.ran ? outcome.value : false
}
