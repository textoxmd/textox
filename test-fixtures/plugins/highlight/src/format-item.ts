import type { FormatToolbarItemMeta } from '@texto/markdown-editor-api';

export const highlightFormatItem: FormatToolbarItemMeta = {
  id: 'highlight',
  markName: 'highlight',
  delim: '==',
  labelKey: 'highlight.label',
  icon: 'highlighter',
  order: 3,
};
