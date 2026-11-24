import type { Exporter, ExporterId } from './types'

// 模块级单例。Map 保留插入顺序（注册顺序），仅用于注册与按 id 查找。
// 前端 UI 入口（命令面板 `src/App.tsx`、编辑器工具栏 `src/components/EditorToolbar.tsx`）
// 已遍历 `listExporters()`，新增导出器无需改动这两处；原生菜单栏（Rust）的导出项
// 由菜单声明协议同步（`src/app/menu/exportMenu.ts` 经 `listExporters()` 生成子菜单声明，
// Rust `sync_submenu` 据此重建），新增格式时同样无需改动 Rust。
const exporters = new Map<ExporterId, Exporter>()

/** 原生导出菜单项 id（骨架拥有，插件不得占用）。 */
const NATIVE_EXPORT_MENU_ACTIONS = new Set(['export_png', 'export_pdf'])

/** 注册导出器。同名 id 后注册者覆盖先注册者（幂等重注册）。 */
export function registerExporter(exporter: Exporter): void {
  if (import.meta.env.DEV) {
    if (exporters.has(exporter.id)) {
      console.warn(`[plugins] exporter id 冲突，后者覆盖前者：${exporter.id}`)
    }
    if (exporter.menuAction) {
      if (NATIVE_EXPORT_MENU_ACTIONS.has(exporter.menuAction)) {
        console.warn(
          `[plugins] exporter "${exporter.id}" 的 menuAction "${exporter.menuAction}" 与原生导出项冲突，可能遮蔽原生行为`,
        )
      }
      for (const other of exporters.values()) {
        if (other.id !== exporter.id && other.menuAction === exporter.menuAction) {
          console.warn(
            `[plugins] exporter menuAction 冲突："${exporter.menuAction}" 同时由 ${other.id} 与 ${exporter.id} 声明`,
          )
        }
      }
    }
  }
  exporters.set(exporter.id, exporter)
}

export function getExporter(id: ExporterId): Exporter | undefined {
  return exporters.get(id)
}

/** 注销导出器；不存在时静默。 */
export function unregisterExporter(id: ExporterId): void {
  exporters.delete(id)
}

/** 返回注册表副本（按 order 升序，order 缺省 0；相等时保持注册序）。 */
export function listExporters(): Exporter[] {
  return [...exporters.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** 仅供测试：清空导出器注册表。 */
export function resetExportersForTests(): void {
  exporters.clear()
}

/** 按原生菜单 action 查找导出器（后注册优先）。 */
export function findExporterByMenuAction(action: string): Exporter | undefined {
  let found: Exporter | undefined
  for (const exporter of exporters.values()) {
    if (exporter.menuAction === action) found = exporter
  }
  return found
}
