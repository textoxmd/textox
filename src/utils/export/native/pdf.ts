import { invoke } from '@tauri-apps/api/core'
import { getBaseName, getCaptureRect, mountExportOverlay, runExclusiveExport } from '@texto/export-runtime'

/**
 * 由当前 markdown 路径推导 PDF 导出面板的默认文件名（不含目录）。
 *
 * 中文文件名场景：Finder/Dock 打开文件时路径可能以 file:// URL 或百分号编码形式进入前端
 * （如 %E6%B5%8B...），直接取 basename 会得到乱码而不是原文件名。这里统一做防御性处理
 * （见 getBaseName），再用 .pdf 替换原有扩展名，得到与当前文档同名、仅后缀不同的文件名。
 *
 * 只返回文件名、不携带目录，让保存面板落在系统默认位置（下载目录）。
 */
function getPdfDefaultName(currentFile: string | null): string | undefined {
  const base = getBaseName(currentFile)
  return base ? base + '.pdf' : undefined
}

/**
 * 原生 macOS PDF 导出：挂载 overlay → 计算捕获区域（页面坐标）→ WKWebView
 * `WKPDFConfiguration` 生成 PDF 写盘。仅 macOS 可用（`export_pdf` 命令未在其它平台注册）。
 * 返回落盘路径；用户取消返回 null；导出进行中（锁被占）也返回 null。
 */
export async function exportPdfToFile(currentFile: string | null): Promise<string | null> {
  const outcome = await runExclusiveExport(async () => {
    // 使用原生保存面板（macOS 上持有 security-scoped 访问权限，
    // 避免沙盒下导出到非当前打开目录时写入失败）。只预填文件名，
    // 目录交给系统默认（通常为下载目录）。
    const defaultName = getPdfDefaultName(currentFile)
    const savePath = await invoke<string | null>('pick_pdf_save_path', { defaultName })
    if (!savePath) return null

    const { wrap, cleanup } = await mountExportOverlay()
    try {
      // 克隆体挂载后等两帧，让图片解码后的布局稳定，再计算捕获区域并导出。
      await new Promise(r => requestAnimationFrame(r))
      await new Promise(r => requestAnimationFrame(r))

      await invoke('export_pdf', { savePath, rect: getCaptureRect(wrap) })
    } finally {
      cleanup()
    }
    return savePath
  })
  // 忙时（outcome.ran === false）与原实现的 `if (exportInProgress) return null` 等价
  return outcome.ran ? outcome.value : null
}
