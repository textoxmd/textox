import type { Schema, Node as PMNode } from 'prosemirror-model';
import type { IconDef, InsertCommandMeta } from '@texto/markdown-editor-api';

function buildTable(schema: Schema, rows: number, cols: number): PMNode {
  const emptyCell = () => schema.nodes.table_cell!.create({ header: false, align: null }, []);
  const headerCells = Array.from({ length: cols }, () =>
    schema.nodes.table_cell!.create({ header: true, align: null }, []),
  );
  const headerRow = schema.nodes.table_row!.create(null, headerCells);
  const bodyRows = Array.from({ length: Math.max(0, rows - 1) }, () =>
    schema.nodes.table_row!.create(null, Array.from({ length: cols }, emptyCell)),
  );
  return schema.nodes.table!.create(null, [headerRow, ...bodyRows]);
}

const tableIcon: IconDef = [
  ['path', 'M3 3h18v18H3z'],
  ['line', 3, 9, 21, 9],
  ['line', 3, 15, 21, 15],
  ['line', 9, 3, 9, 21],
  ['line', 15, 3, 15, 21],
];

export const tableInsert: InsertCommandMeta = {
  id: 'table',
  keyword: 'table',
  labelKey: 'table.label',
  descriptionKey: 'table.tableDesc',
  icon: tableIcon,
  defaultShortcut: 'Cmd+Opt+T',
  category: 'paragraph',
  order: 0,
  insert(view) {
    const schema = view.state.schema;
    if (!schema.nodes.table || !schema.nodes.table_row || !schema.nodes.table_cell) return;
    const { $from } = view.state.selection;
    const tr = view.state.tr.replaceWith($from.before(), $from.after(), buildTable(schema, 3, 3));
    view.dispatch(tr);
    view.focus();
  },
};
