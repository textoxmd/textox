export type ExporterId = string

export interface ExportContext {
  currentFile: string | null
  documentDir: string | null
}

export interface ExportResult {
  data: string | Uint8Array
  /** 导出文件名（含扩展名）。命名权归导出器，save.ts 直接用它作保存面板默认名。 */
  suggestedName: string
}

export interface Exporter {
  id: ExporterId
  labelKey: string
  extension: string
  kind: 'text' | 'binary'
  /** 原生菜单项 id；由插件清单透传，用于菜单声明同步与菜单事件分派。 */
  menuAction?: string
  /** UI 排序权重（升序）；缺省 0。 */
  order?: number
  run(ctx: ExportContext): Promise<ExportResult>
}
