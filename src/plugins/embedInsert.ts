import type { EmbedInsert, PluginHost } from './types';

/**
 * 骨架通用的"插入嵌入引用"流程：按贡献的扩展名弹框选文件 → 计算文档相对路径
 * → 在当前 IR 编辑器光标处插入 `![alt](src)`。
 *
 * 命令面板与 slash 菜单共用此实现；插件只声明编辑器扩展的 embed 元数据
 * （含 `insertLabelKey`），不承载插入逻辑。编辑器不可编辑时直接 no-op。
 */
export async function insertEmbedReference(
  host: PluginHost,
  embed: EmbedInsert,
): Promise<void> {
  if (!host.editor.canEdit()) return;

  const extensions = embed.extensions.map((e) => e.replace(/^\./, ''));
  const base = extensions[0] ?? 'file';
  const filterName = base.replace(/^\w/, (c) => c.toUpperCase());
  const selected = await host.dialogs.pickFile({
    filters: [{ name: filterName, extensions }],
    defaultPath: host.documents.getDocumentDir() ?? undefined,
  });
  if (!selected) return;

  const fileName = selected.split(/[/\\]/).pop() || '';
  const alt = fileName.replace(/\.[^.]+$/, '');
  const src = host.documents.toDocumentRelative(selected);
  host.editor.insertImageRef(src, alt);
}
