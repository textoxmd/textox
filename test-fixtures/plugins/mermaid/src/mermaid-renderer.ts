import type { Node as PMNode } from 'prosemirror-model';
import type { PreviewContext, PreviewRegion } from '@texto/markdown-editor-api';

import { getActiveEngine, registerPreview } from './diagram-engine';

// 字体必须从文档根读取：预览元素构造时（CodeBlockView 先 enterRenderMode() 再挂载）
// 仍是 detached，读自身 computed style 拿不到编辑器继承的字体，会让 Pele 用默认
// sans-serif 测宽并把错误字体写进 SVG/缓存。
// 不回退 document.body：CSS 侧写的是 var(--editor-font-family-base, sans-serif)，
// 用 body 字体测宽会与最终显示字体不一致。
function previewFontFamily(): string | undefined {
  const root = document.documentElement;
  const inline = root.style.getPropertyValue('--editor-font-family-base').trim();
  if (inline) return inline;
  const computed = getComputedStyle(root).getPropertyValue('--editor-font-family-base').trim();
  return computed || undefined;
}

function isPreviewVisible(el: HTMLElement): boolean {
  return el.isConnected && el.offsetParent !== null;
}

export function createMermaidPreview(_node: PMNode): PreviewRegion {
  const dom = document.createElement('div');
  dom.className = 'mermaid-preview';

  let token = 0;
  let lastText = '';
  let lastCtx: PreviewContext | null = null;

  const render = (text: string, ctx: PreviewContext): void => {
    const my = ++token;
    dom.innerHTML = '<div class="cb-render-loading">Rendering...</div>';
    getActiveEngine()
      .render(text, { fontFamily: previewFontFamily() })
      .then((svg) => {
        if (my !== token) return;
        dom.innerHTML = `<div class="mermaid-svg-container">${svg}</div>`;
        try {
          ctx.onSuccess?.();
        } catch (error) {
          console.error("[mermaid] 预览 onSuccess 回调失败", error);
        }
      })
      .catch((err) => {
        if (my !== token) return;
        // 清掉 "Rendering..." 占位，避免错误提示与残留占位叠加
        dom.innerHTML = '';
        ctx.onError((err as Error)?.message ?? String(err));
      });
  };

  const refresh = (): void => {
    const text = lastText;
    const ctx = lastCtx;
    if (token === 0 || !ctx || !text.trim()) return;
    // 源码态容器 display:none，此时不重绘，避免把错误面板顶出来；
    // 下次进入渲染态时 update() 会读取新引擎。
    if (!isPreviewVisible(dom)) return;
    render(text, ctx);
  };

  const unregister = registerPreview(refresh);

  return {
    dom,
    update(node, ctx) {
      lastText = node.textContent;
      lastCtx = ctx;
      if (!lastText.trim()) {
        token += 1;
        dom.innerHTML = '<div class="cb-render-empty">Empty diagram</div>';
        return;
      }
      render(lastText, ctx);
    },
    destroy() {
      token += 1;
      unregister();
    },
  };
}
