import type { DiagramEngine } from './diagram-engine';

type MermaidTheme = 'dark' | 'default';

let mermaidMod: typeof import('mermaid')['default'] | null = null;
let initializedTheme: MermaidTheme | null = null;

const svgCache = new Map<string, string>();

function currentMermaidTheme(): MermaidTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

async function getMermaid(): Promise<typeof import('mermaid')['default']> {
  if (!mermaidMod) {
    const mod = await import('mermaid');
    mermaidMod = mod.default;
  }
  const theme = currentMermaidTheme();
  if (initializedTheme !== theme) {
    // suppressErrorRendering：失败时由编辑器自绘错误提示。否则 mermaid 会把
    // 错误图临时渲染进 document.body，且解析失败路径不清理，每次失败都在 body
    // 留下一个错误图节点（DOM 泄漏 + 页面出现游离图表）。
    mermaidMod.initialize({ startOnLoad: false, theme, suppressErrorRendering: true });
    initializedTheme = theme;
    // 缓存键已含主题前缀；这里清空只为释放另一主题的 SVG 内存，不承担正确性。
    svgCache.clear();
  }
  return mermaidMod;
}

async function renderMermaidSvg(text: string): Promise<string> {
  const mermaid = await getMermaid();
  const key = `${currentMermaidTheme()}::${text}`;
  const cached = svgCache.get(key);
  if (cached) return cached;

  const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { svg } = await mermaid.render(id, text);
  svgCache.set(key, svg);
  return svg;
}

// Mermaid 的字体由主题 / CSS 决定，故忽略 options.fontFamily；若未来支持，
// 必须同步并入 renderMermaidSvg 的缓存键，否则换字体会命中旧 SVG。
export const mermaidEngine: DiagramEngine = {
  id: 'mermaid',
  render: renderMermaidSvg,
};

/** 仅供测试：清空模块级缓存与初始化状态。 */
export function resetMermaidEngineForTests(): void {
  mermaidMod = null;
  initializedTheme = null;
  svgCache.clear();
}
