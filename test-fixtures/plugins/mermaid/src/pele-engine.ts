import type { DiagramEngine, DiagramRenderOptions } from './diagram-engine';

type PeleModule = typeof import('pele');

let peleMod: PeleModule | null = null;

const svgCache = new Map<string, string>();

async function getPele(): Promise<PeleModule> {
  if (!peleMod) peleMod = await import('pele');
  return peleMod;
}

function formatPeleError(error: unknown): string {
  if (error === null || error === undefined) return 'Pele render failed';
  if (typeof error !== 'object') return String(error) || 'Pele render failed';
  const { message, line, column } = error as {
    message?: unknown;
    line?: unknown;
    column?: unknown;
  };
  // 空消息 / 非字符串消息不能回退到 String(error)——那会得到 "[object Object]"。
  const text = typeof message === 'string' && message ? message : 'Pele render failed';
  if (typeof line !== 'number' || line <= 0) return text;

  // 真实 Pele 的 message 常自带 "line N" / "line N, column M"；已含行号时
  // 不再追加，缺列号才补，避免出现 "(line 3) (line 3, column 1)" 的重复定位。
  const hasLine = /\bline\s+\d+/i.test(text);
  const hasColumn = /\bcolumn\s+\d+/i.test(text);
  const columnSuffix =
    typeof column === 'number' && column > 0 ? column : null;
  if (hasLine) {
    return columnSuffix && !hasColumn ? `${text} (column ${columnSuffix})` : text;
  }
  // 消息已含列号但缺行号时只补行号；否则会出现两个 column。
  if (columnSuffix === null || hasColumn) return `${text} (line ${line})`;
  return `${text} (line ${line}, column ${columnSuffix})`;
}

async function renderPeleSvg(
  text: string,
  options: DiagramRenderOptions = {},
): Promise<string> {
  // fontFamily 参与测宽并写进 SVG 几何与内联字体，必须并入缓存键，否则换字体会命中旧 SVG。
  const key = `${options.fontFamily ?? ''}::${text}`;
  const cached = svgCache.get(key);
  if (cached) return cached;

  const pele = await getPele();
  try {
    const { svg } = pele.render(text, {
      responsive: true,
      fontFamily: options.fontFamily,
      // 可编辑态下预览里的 <a href> 可能让 WKWebView 导航到外部 URL；
      // 与 Mermaid strict 行为一致：只画节点，不输出可点击链接。
      links: false,
    });
    svgCache.set(key, svg);
    return svg;
  } catch (error) {
    // ES2020 lib 无 ErrorOptions.cause 类型，用 Object.assign 保留原始诊断。
    throw Object.assign(new Error(formatPeleError(error)), { cause: error });
  }
}

export const peleEngine: DiagramEngine = {
  id: 'pele',
  render: renderPeleSvg,
};

/** 仅供测试：清空模块级缓存与加载状态。 */
export function resetPeleEngineForTests(): void {
  peleMod = null;
  svgCache.clear();
}
