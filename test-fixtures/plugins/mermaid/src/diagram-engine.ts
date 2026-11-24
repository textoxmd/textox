import { mermaidEngine } from './mermaid-engine';
import { peleEngine } from './pele-engine';

export type RendererId = 'mermaid' | 'pele';

export interface DiagramRenderOptions {
  fontFamily?: string;
}

export interface DiagramEngine {
  readonly id: RendererId;
  render(text: string, options?: DiagramRenderOptions): Promise<string>;
}

export const DEFAULT_RENDERER: RendererId = 'mermaid';

const engines: Record<RendererId, DiagramEngine> = {
  mermaid: mermaidEngine,
  pele: peleEngine,
};

type PreviewRefresh = () => void;

const previews = new Set<PreviewRefresh>();

let activeRenderer: RendererId = DEFAULT_RENDERER;

export function isRendererId(value: unknown): value is RendererId {
  return value === 'mermaid' || value === 'pele';
}

export function resolveRenderer(value: unknown): RendererId {
  return isRendererId(value) ? value : DEFAULT_RENDERER;
}

export function getActiveRenderer(): RendererId {
  return activeRenderer;
}

export function getActiveEngine(): DiagramEngine {
  return engines[activeRenderer];
}

export function setActiveRenderer(id: RendererId): void {
  if (id === activeRenderer) return;
  activeRenderer = id;
  for (const refresh of [...previews]) {
    try {
      refresh();
    } catch (error) {
      console.error('[mermaid] 切换渲染器时刷新预览失败', error);
    }
  }
}

/** 注册一个可见预览的刷新回调；返回注销函数。 */
export function registerPreview(refresh: PreviewRefresh): () => void {
  previews.add(refresh);
  return () => {
    previews.delete(refresh);
  };
}

/** 仅供测试：恢复默认渲染器并清空预览注册。 */
export function resetRendererStateForTests(): void {
  activeRenderer = DEFAULT_RENDERER;
  previews.clear();
}
