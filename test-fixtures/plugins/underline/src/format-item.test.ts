import { describe, expect, it } from 'vitest';

import { underlineFormatItem } from './format-item';

describe('underlineFormatItem', () => {
  it('targets the underline mark on both surfaces by default', () => {
    expect(underlineFormatItem.id).toBe('underline');
    expect(underlineFormatItem.markName).toBe('underline');
    expect(underlineFormatItem.delim).toBe('<u>');
    expect(underlineFormatItem.closeDelim).toBe('</u>');
    expect(underlineFormatItem.labelKey).toBe('underline.pluginName');
    expect(underlineFormatItem.order).toBe(4);
    expect(underlineFormatItem.surfaces).toBeUndefined();
  });

  it('reuses the lucide icon name instead of hand-drawing', () => {
    expect(underlineFormatItem.icon).toBe('underline');
  });
});
