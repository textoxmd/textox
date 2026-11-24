import { invoke } from '@tauri-apps/api/core'
import { dataUrlToBytes } from './binary'

/**
 * Tauri asset 协议 URL → 文件系统路径。
 * macOS: `asset://localhost/<urlencoded>`；Windows: `http://asset.localhost/<urlencoded>`。
 * 非 asset URL（data:/http(s):/blob:）返回 null，表示「保留原样，不内嵌」。
 */
export function assetUrlToFsPath(url: string): string | null {
  const match = url.match(/^(?:asset:\/\/localhost|https?:\/\/asset\.localhost)\/(.*)$/i)
  if (!match) return null
  let path = match[1]
  try {
    path = decodeURIComponent(path)
  } catch {
    // 非法编码时保持原样
  }
  // Windows 上路径形如 /C:/Users/...，去掉前导斜杠
  if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1)
  return path
}

function isRemoteOrInline(src: string): boolean {
  if (/^(data:|blob:)/i.test(src)) return true
  if (/^https?:\/\//i.test(src) && !/^https?:\/\/asset\.localhost\//i.test(src)) return true
  return false
}

async function toFsPath(src: string, documentDir: string | null): Promise<string | null> {
  const fromAsset = assetUrlToFsPath(src)
  if (fromAsset) return fromAsset
  if (/^[a-z]+:/i.test(src) || src.startsWith('//')) return null
  if (!documentDir) return null
  return src.startsWith('/') ? src : `${documentDir}/${src}`
}

/**
 * 把子树里可解析的图片内嵌为 data URL，让产物真正自包含。
 * 远程 URL 与已是 data/blob 的图片保持原样；解析失败的保留原 src 并告警，
 * 不中断导出（与 waitForImagesToLoad 的超时兜底思路一致）。
 */
export async function embedImages(root: HTMLElement, documentDir: string | null): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src')
      if (!src || isRemoteOrInline(src)) return
      const path = await toFsPath(src, documentDir)
      if (!path) return
      try {
        img.setAttribute('src', await invoke<string>('read_image_as_data_url', { path }))
      } catch (error) {
        console.warn('[export] failed to embed image', path, error)
      }
    }),
  )
}

export interface ExtractedImage {
  name: string   // 相对 OEBPS，如 images/img-1.png
  data: Uint8Array
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/svg+xml') return 'svg'
  const sub = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? ''
  return sub || 'bin'
}

/**
 * 把本地图片抽取为独立文件（EPUB 用），并把 DOM 里的 src 改写为相对路径。
 * 远程 / inline 图片保持原样、不进文件列表；失败时保留原 src 并告警。
 */
export async function extractImagesAsFiles(
  root: HTMLElement,
  documentDir: string | null,
): Promise<ExtractedImage[]> {
  const extracted: ExtractedImage[] = []
  let index = 0

  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    if (!src || isRemoteOrInline(src)) continue
    const path = await toFsPath(src, documentDir)
    if (!path) continue
    try {
      const { mime, bytes } = dataUrlToBytes(await invoke<string>('read_image_as_data_url', { path }))
      index += 1
      const name = `images/img-${index}.${extensionForMime(mime)}`
      extracted.push({ name, data: bytes })
      img.setAttribute('src', name)
    } catch (error) {
      console.warn('[export] failed to extract image', path, error)
    }
  }
  return extracted
}
