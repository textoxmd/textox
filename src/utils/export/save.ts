import { invoke } from '@tauri-apps/api/core'
import { IS_MAC } from '@/utils/windowManager'
import { bytesToBase64 } from '@texto/export-runtime'
import type { ExportResult, Exporter } from './types'

export interface SaveFilter {
  name: string
  extensions: string[]
}

export function buildSaveFilters(filterName: string, extension: string): SaveFilter[] {
  return [{ name: filterName, extensions: [extension] }]
}

async function pickPath(defaultName: string, filterName: string, extension: string): Promise<string | null> {
  if (IS_MAC) {
    // macOS 沙盒：必须走原生面板并持有 security-scoped 访问，
    // 否则写入非当前打开目录会失败（与 PDF 导出同因）。
    return invoke<string | null>('pick_export_save_path', { defaultName, extension })
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ filters: buildSaveFilters(filterName, extension), defaultPath: defaultName })
}

/**
 * 统一保存：弹面板 → 按 kind 走文本或二进制（base64）写盘。
 * 文件名的唯一来源是 `result.suggestedName`（由导出器决定），这里不重新推导，
 * 避免同一个文件名有两套算法。
 * 返回落盘路径；用户取消返回 null。
 */
export async function saveExport(exporter: Exporter, result: ExportResult): Promise<string | null> {
  const path = await pickPath(result.suggestedName, exporter.extension.toUpperCase(), exporter.extension)
  if (!path) return null

  if (exporter.kind === 'text') {
    await invoke('write_file', { path, content: result.data as string })
  } else {
    await invoke('save_binary_file', { path, base64Data: bytesToBase64(result.data as Uint8Array) })
  }
  return path
}
