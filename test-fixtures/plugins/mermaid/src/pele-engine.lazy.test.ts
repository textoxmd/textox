import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ peleImports: 0 }));

const { render } = vi.hoisted(() => ({
  render: vi.fn((text: string) => ({ svg: `<svg data-text="${text}"></svg>` })),
}));

vi.mock('pele', () => {
  state.peleImports += 1;
  return { render };
});

// 本文件刻意不静态 import './pele-engine'：只有动态导入后 pele 才该被加载，
// 这样计数器的断言不会被其它用例的渲染提前污染，也不依赖文件内执行顺序。
describe('peleEngine 懒加载', () => {
  it('首次渲染前不加载 pele 模块', async () => {
    expect(state.peleImports).toBe(0);
    const engine = await import('./pele-engine');
    expect(state.peleImports).toBe(0);
    await engine.peleEngine.render('flowchart TD\nA-->B');
    expect(state.peleImports).toBe(1);
  });
});
