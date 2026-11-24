/**
 * Uint8Array → base64。分块处理：`String.fromCharCode(...bytes)` 在图片/zip
 * 这类几十万字节的输入上会因参数过多爆栈。
 *
 * 注意 `btoa` 只对整个二进制字符串调用一次（不是逐块编码再拼接）：逐块编码会在
 * 每块末尾产生补位字符，拼接后中间出现 `=`，得到的是非法 base64。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** `data:<mime>[;base64],<payload>` → 字节。非 base64 的 payload 按 URL 编码处理。 */
export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/)
  if (!match) throw new Error('Unsupported data url')
  const mime = match[1] || 'application/octet-stream'
  const payload = match[3] ?? ''
  if (!match[2]) {
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) }
  }
  return { mime, bytes: base64ToBytes(payload) }
}
