import { beforeEach, describe, expect, test } from 'vitest';

import { registerExporter, resetExportersForTests } from '@/utils/export/registry';
import { IS_MAC } from '@/utils/windowManager';

import { buildExportSubmenuSpec } from './exportMenu';

/** 取出 spec.items 的判别键：item → id，其它 → kind。 */
function keys(): Array<string | undefined> {
  return buildExportSubmenuSpec().items.map((i) => (i.kind === 'item' ? i.id : i.kind));
}

describe('buildExportSubmenuSpec', () => {
  beforeEach(() => resetExportersForTests());

  test('lists plugin exporters with menuAction in order, then native png/pdf', () => {
    registerExporter({
      id: 'html', labelKey: 'menu.export_html', extension: 'html', kind: 'text',
      menuAction: 'export_html', order: 10, run: async () => ({ data: '', suggestedName: 'a.html' }),
    });
    registerExporter({
      id: 'epub', labelKey: 'menu.export_epub', extension: 'epub', kind: 'binary',
      menuAction: 'export_epub', order: 20, run: async () => ({ data: new Uint8Array(), suggestedName: 'a.epub' }),
    });

    const spec = buildExportSubmenuSpec();
    expect(spec.id).toBe('export_submenu');
    expect(spec.labelKey).toBe('menu.export');
    expect(keys()).toEqual(IS_MAC
      ? ['export_html', 'export_epub', 'export_png', 'export_pdf']
      : ['export_html', 'export_epub', 'export_pdf']);
  });

  test('omits exporters that declare no menuAction', () => {
    registerExporter({
      id: 'no-menu', labelKey: 'no-menu-label', extension: 'x', kind: 'text',
      run: async () => ({ data: '', suggestedName: 'x' }),
    });
    const spec = buildExportSubmenuSpec();
    // 若无跳过守卫，会推入 id=undefined 的 item——这里断言不含 undefined 且不含该导出器的 labelKey。
    expect(keys()).not.toContain(undefined);
    const labelKeys = spec.items.map((i) => (i.kind === 'item' ? i.labelKey : i.kind));
    expect(labelKeys).not.toContain('no-menu-label');
    expect(spec.items).toHaveLength(IS_MAC ? 2 : 1);
  });
});
