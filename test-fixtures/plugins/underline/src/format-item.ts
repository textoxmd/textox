import type { FormatToolbarItemMeta } from '@texto/markdown-editor-api';

export const underlineFormatItem: FormatToolbarItemMeta = {
  id: 'underline',
  markName: 'underline',
  delim: '<u>',
  closeDelim: '</u>',
  labelKey: 'underline.pluginName',
  icon: 'underline',
  order: 4,
};
