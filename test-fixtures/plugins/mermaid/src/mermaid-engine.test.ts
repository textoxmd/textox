import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, text: string) => ({
    svg: `<svg data-text="${text}"></svg>`,
  })),
}));

vi.mock('mermaid', () => ({ default: { initialize, render } }));

import { mermaidEngine, resetMermaidEngineForTests } from './mermaid-engine';

beforeEach(() => {
  vi.clearAllMocks();
  resetMermaidEngineForTests();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('mermaidEngine', () => {
  it('引擎 id 为 mermaid', () => {
    expect(mermaidEngine.id).toBe('mermaid');
  });

  it('使用默认主题渲染并缓存相同文本', async () => {
    const text = 'graph TD\nA-->B';

    const first = await mermaidEngine.render(text);
    const second = await mermaidEngine.render(text);

    expect(first).toContain('data-text="graph TD');
    expect(second).toBe(first);
    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: 'default',
      suppressErrorRendering: true,
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), text);
  });

  it('暗色主题重新初始化并按主题分键缓存', async () => {
    const text = 'graph LR\nA-->B';
    await mermaidEngine.render(text);
    const rendersBefore = render.mock.calls.length;

    document.documentElement.classList.add('dark');
    await mermaidEngine.render(text);

    expect(initialize).toHaveBeenLastCalledWith({
      startOnLoad: false,
      theme: 'dark',
      suppressErrorRendering: true,
    });
    expect(render.mock.calls.length).toBe(rendersBefore + 1);
  });

  it('渲染失败时抛出原始错误且不写缓存，可重试成功', async () => {
    render.mockRejectedValueOnce(new Error('boom'));

    await expect(mermaidEngine.render('graph X')).rejects.toThrow('boom');

    const svg = await mermaidEngine.render('graph X');

    expect(svg).toContain('data-text="graph X');
    expect(render).toHaveBeenCalledTimes(2);
  });
});
