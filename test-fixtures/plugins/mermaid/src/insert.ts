import type { IconDef, InsertCommandMeta } from '@texto/markdown-editor-api';

const mermaidIcon: IconDef = [
  ['line', 6, 3, 6, 15],
  ['circle', 18, 6, 3],
  ['circle', 6, 18, 3],
  ['path', 'M18 9a9 9 0 0 1-9 9'],
];

export const mermaidInsert: InsertCommandMeta = {
  id: 'mermaid',
  keyword: 'mermaid',
  labelKey: 'mermaid.pluginName',
  descriptionKey: 'mermaid.mermaidDesc',
  icon: mermaidIcon,
  defaultShortcut: 'Cmd+Opt+M',
  category: 'paragraph',
  order: 4,
  insert(view) {
    const schema = view.state.schema;
    const codeBlock = schema.nodes.code_block;
    if (!codeBlock) return;
    const { $from } = view.state.selection;
    const tr = view.state.tr.replaceWith(
      $from.before(),
      $from.after(),
      codeBlock.create({ lang: 'mermaid' }),
    );
    view.dispatch(tr);
    view.focus();
  },
};
