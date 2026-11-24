import { beforeEach, describe, expect, it, vi } from 'vitest';

const { render } = vi.hoisted(() => ({
  render: vi.fn(
    (text: string, options?: { fontFamily?: string; links?: boolean }) => ({
      svg: `<svg data-text="${text}" data-font="${options?.fontFamily ?? ''}" data-links="${options?.links ?? ''}"></svg>`,
    }),
  ),
}));

vi.mock('pele', () => ({ render }));

import { peleEngine, resetPeleEngineForTests } from './pele-engine';

beforeEach(() => {
  vi.clearAllMocks();
  resetPeleEngineForTests();
});

describe('peleEngine', () => {
  it('引擎 id 为 pele', () => {
    expect(peleEngine.id).toBe('pele');
  });

  it('使用响应式与字体选项渲染并缓存相同文本', async () => {
    const text = 'flowchart LR\nA-->B';

    const first = await peleEngine.render(text, { fontFamily: 'Inter' });
    const second = await peleEngine.render(text, { fontFamily: 'Inter' });

    expect(first).toContain('data-text="flowchart LR');
    expect(second).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(text, {
      responsive: true,
      fontFamily: 'Inter',
      links: false,
    });
  });

  it('显式禁用链接输出，避免预览里出现可点击的 <a href>', async () => {
    const text =
      'flowchart LR\nA-->B\nclick A href "https://example.com"\nclick B "https://example.com"';

    await peleEngine.render(text);

    expect(render).toHaveBeenCalledTimes(1);
    const options = render.mock.calls[0]?.[1];
    expect(options?.links).toBe(false);
  });

  it('字体不同不共享缓存', async () => {
    const text = 'flowchart LR\nA-->B';

    const first = await peleEngine.render(text, { fontFamily: 'Inter' });
    const second = await peleEngine.render(text, { fontFamily: 'serif' });

    expect(first).not.toBe(second);
    expect(first).toContain('data-font="Inter"');
    expect(second).toContain('data-font="serif"');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('把 PeleError 的行列信息补进错误消息并保留 cause', async () => {
    const original = Object.assign(new Error('Unexpected token'), { line: 3, column: 7 });
    render.mockImplementationOnce(() => {
      throw original;
    });

    const error = await peleEngine.render('flowchart LR\n  A-->').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Unexpected token (line 3, column 7)');
    expect((error as Error & { cause?: unknown }).cause).toBe(original);
  });

  it('消息已含行号时不重复拼接行号', async () => {
    render.mockImplementationOnce(() => {
      throw Object.assign(new Error('Parse error on line 3: boom'), { line: 3, column: 1 });
    });

    const error = await peleEngine.render('flowchart LR\n  A-->').catch((e: unknown) => e);
    const message = (error as Error).message;

    expect(message).toBe('Parse error on line 3: boom (column 1)');
    expect(message).not.toContain('(line 3');
  });

  it('消息已含行列时不追加任何后缀', async () => {
    render.mockImplementationOnce(() => {
      throw Object.assign(new Error('Parse error on line 3, column 1: boom'), {
        line: 3,
        column: 1,
      });
    });

    const error = await peleEngine.render('flowchart LR\n  A-->').catch((e: unknown) => e);
    const message = (error as Error).message;

    expect(message).toBe('Parse error on line 3, column 1: boom');
    expect(message).not.toContain('(line 3');
    expect(message).not.toContain('(column 1)');
  });

  it('消息含列号但缺行号时只补行号', async () => {
    render.mockImplementationOnce(() => {
      throw Object.assign(new Error('boom at column 7'), { line: 3, column: 7 });
    });

    const error = await peleEngine.render('flowchart LR\n  A-->').catch((e: unknown) => e);

    expect((error as Error).message).toBe('boom at column 7 (line 3)');
    expect((error as Error).message).not.toContain('column 7)');
  });

  it('空消息回退为 Pele render failed', async () => {
    render.mockImplementationOnce(() => {
      throw new Error('');
    });

    await expect(peleEngine.render('unknown')).rejects.toThrow('Pele render failed');
  });

  it('无消息字段的对象回退为 Pele render failed', async () => {
    render.mockImplementationOnce(() => {
      throw {};
    });

    await expect(peleEngine.render('unknown')).rejects.toThrow('Pele render failed');
  });

  it('抛出 null 时回退为 Pele render failed', async () => {
    render.mockImplementationOnce(() => {
      throw null;
    });

    await expect(peleEngine.render('unknown')).rejects.toThrow('Pele render failed');
  });

  it('抛出原始值时保留其字符串形式', async () => {
    render.mockImplementationOnce(() => {
      throw 42;
    });

    await expect(peleEngine.render('unknown')).rejects.toThrow('42');
  });

  it('缺少行列时只保留原始消息', async () => {
    render.mockImplementationOnce(() => {
      throw new Error('Unsupported diagram');
    });

    await expect(peleEngine.render('unknown')).rejects.toThrow('Unsupported diagram');
  });

  it('失败不写缓存，下一次调用会重试', async () => {
    render.mockImplementationOnce(() => {
      throw new Error('first failure');
    });

    await expect(peleEngine.render('flowchart LR\nA-->B')).rejects.toThrow('first failure');
    const svg = await peleEngine.render('flowchart LR\nA-->B');

    expect(svg).toContain('data-text="flowchart LR');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('reset 清空缓存后同一文本会重新渲染', async () => {
    const text = 'flowchart LR\nA-->B';

    await peleEngine.render(text);
    resetPeleEngineForTests();
    await peleEngine.render(text);

    expect(render).toHaveBeenCalledTimes(2);
  });
});
