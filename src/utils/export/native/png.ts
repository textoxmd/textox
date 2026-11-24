import { invoke } from '@tauri-apps/api/core'
import { getBaseName, getCaptureRect, mountExportOverlay, runExclusiveExport } from '@texto/export-runtime'

/** 导出画布宽度（CSS px），2x 输出即 1800px。 */
export const PNG_CONTENT_WIDTH = 900
export const PNG_SCALE = 2

/**
 * 原生 macOS PNG 长图导出：挂载 overlay → 固定宽度 → 原生命令（WKPDFConfiguration 捕获 →
 * CoreGraphics 光栅化拼接）→ 写盘。与 PDF 导出共用单飞锁与捕获矩形；仅 macOS 可用
 * （命令未在其它平台注册）。返回落盘路径；用户取消返回 null；导出进行中（锁被占）也返回 null。
 * 原生命令失败（如文档过长）会抛出异常，由调用方映射错误提示。
 */
export async function exportPngToFile(currentFile: string | null): Promise<string | null> {
  const outcome = await runExclusiveExport(async () => {
    const base = getBaseName(currentFile)
    const defaultName = `${base ?? 'Untitled'}.png`
    const savePath = await invoke<string | null>('pick_export_save_path', {
      defaultName,
      extension: 'png',
    })
    if (!savePath) return null

    const { wrap, cleanup } = await mountExportOverlay()
    try {
      // 把画布收窄到内容列宽，使长图无多余留白（仍用编辑器的实时 CSS）。
      wrap.style.width = `${PNG_CONTENT_WIDTH}px`
      await new Promise((r) => requestAnimationFrame(r))
      await new Promise((r) => requestAnimationFrame(r))
      const rect = getCaptureRect(wrap)
      await invoke('export_png', { savePath, rect, scale: PNG_SCALE })
    } finally {
      cleanup()
    }
    return savePath
  })
  return outcome.ran ? outcome.value : null
}
