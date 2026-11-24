import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ mermaidImports: 0 }));

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, text: string) => ({
    svg: `<svg data-text="${text}"></svg>`,
  })),
}));

vi.mock('mermaid', () => {
  state.mermaidImports += 1;
  return { default: { initialize, render } };
});

// 本文件刻意不静态 import './mermaid-engine'：只有动态导入后 mermaid 才该被加载，
// 这样计数器的断言不会被其它用例的渲染提前污染，也不依赖文件内执行顺序。
describe('mermaidEngine 懒加载', () => {
  it('首次渲染前不加载 mermaid 模块', async () => {
    expect(state.mermaidImports).toBe(0);
    const engine = await import('./mermaid-engine');
    expect(state.mermaidImports).toBe(0);
    await engine.mermaidEngine.render('graph TD\nA-->B');
    expect(state.mermaidImports).toBe(1);
  });
});
