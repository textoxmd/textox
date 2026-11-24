import type { ChangeMeta } from '@/components/TextoEditor/src/history/types';

export type EditorChangeMeta = ChangeMeta;

/**
 * 判断文档是否存在未保存修改。
 *
 * 双模式编辑器的 meta 由历史会话给出：它记录保存点代次，因此
 * 「输入后手动删回原样」仍算 dirty、「撤销到保存点」才回到 clean。
 * 没有 meta（纯 IR、非编辑器来源）时退回文本比较。
 */
export function resolveDirty(
  content: string,
  original: string,
  baseline: string,
  meta?: EditorChangeMeta,
): boolean {
  if (meta) return meta.dirty;
  return content !== original && content !== baseline;
}
