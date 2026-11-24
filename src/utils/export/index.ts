// src/utils/export/index.ts
import { runExclusiveExport, type ExclusiveOutcome } from '@texto/export-runtime'
import { getExporter } from './registry'
import type { ExportContext, ExportResult, ExporterId } from './types'

export * from './types'
export { getExporter, listExporters } from './registry'
export { runExclusiveExport } from '@texto/export-runtime'
export { saveExport } from './save'

/** 唯一的导出入口：取锁 → 执行导出器。忙时返回 { ran: false }。 */
export function runExport(id: ExporterId, ctx: ExportContext): Promise<ExclusiveOutcome<ExportResult>> {
  const exporter = getExporter(id)
  if (!exporter) return Promise.resolve({ ran: false })
  return runExclusiveExport(() => exporter.run(ctx))
}
