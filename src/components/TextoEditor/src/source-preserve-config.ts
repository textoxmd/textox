// 源文本保真保存（Beta）开关。
//
// 该能力默认关闭。生效判定：设置里持久化的 localStorage 开关优先；用户未显式
// 选择时才回退到 VITE_SOURCE_PRESERVE 构建环境变量为 "true"（开发/预发布把
// 默认打开）。显式写入的 "false" 必须能压过 env，否则 Settings 里的开关在
// env 构建下永远关不掉。
// editor-api 的序列化选择与 App 的 dirty 基线判定必须共用这里，避免模式不一致。
//
// 注意：编辑器在挂载时一次性读取该开关（保真上下文在建 doc 时生成），
// 切换后需重启应用才生效——Settings 弹窗已向用户说明。

const STORAGE_KEY = "texto:source-preserve";

export function isSourcePreserveEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // localStorage 不可用时回退到构建环境变量
  }
  return import.meta.env.VITE_SOURCE_PRESERVE === "true";
}

export function setSourcePreserveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
