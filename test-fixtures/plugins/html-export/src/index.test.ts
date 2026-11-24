import { APP_EXPORTER } from '@texto/app-api';
import { describe, expect, it } from 'vitest';

import plugin from './index';

describe('html-export plugin manifest', () => {
  it('contributes the html exporter with its native menu action', () => {
    const exporters = plugin.contributes?.[APP_EXPORTER];
    expect(plugin.id).toBe('html-export');
    expect(exporters?.map((e) => e.id)).toEqual(['html']);
    expect(exporters?.[0]?.menuAction).toBe('export_html');
    expect(exporters?.[0]?.order).toBe(10);
  });
});
