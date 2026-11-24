import type { EditorContextMenuItemMeta } from '@texto/markdown-editor-api';

/**
 * block 菜单项：复制 mermaid 代码块的源码。
 * 源码即 `code_block` 节点的文本（与渲染器同源），无需任何额外注入能力。
 */
export const mermaidContextMenuItem: EditorContextMenuItemMeta = {
  id: 'mermaid.copySource',
  labelKey: 'mermaid.copySource',
  requires: ['block'],
  order: 10,
  // 仅顶层块：ctx.block 即「目标顶层块」，嵌套于引用/列表内的 mermaid 代码块不匹配。
  when: (ctx) =>
    ctx.block?.node.type.name === 'code_block' && ctx.block.node.attrs.lang === 'mermaid',
  // 返回的 Promise 由编辑器侧统一 catch，这里不自行处理 rejection。
  run: (ctx) => {
    const node = ctx.block?.node;
    if (!node) return;
    return navigator.clipboard.writeText(node.textContent);
  },
};
