import { serializeToStandaloneHtml } from '@texto/export-runtime'
import type { ExporterContribution } from '@texto/plugin-sdk'

export const htmlExporter: ExporterContribution = {
  id: 'html',
  labelKey: 'menu.export_html',
  extension: 'html',
  kind: 'text',
  menuAction: 'export_html',
  order: 10,
  async run(ctx) {
    const doc = await serializeToStandaloneHtml(ctx)
    try {
      return { data: doc.html, suggestedName: `${doc.title}.html` }
    } finally {
      doc.cleanup()
    }
  },
}
