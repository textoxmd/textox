import { describe, expect, it, vi } from 'vitest';

// 懒加载 loader：TextoEditor 用 isSourceCodeEditorReady() 决定能不能播转场动画
// （未就绪时直接切，避免"空页面滑入"），用 preloadSourceCodeEditor() 做空闲预热。
// 模块级状态需要每个用例重新加载模块才能重置。

async function freshLoader() {
  vi.resetModules();
  return import('../TextoEditor/src/source-view/loader');
}

describe('SourceCodeEditor loader', () => {
  it('初始未就绪，加载完成后就绪', async () => {
    const loader = await freshLoader();
    expect(loader.isSourceCodeEditorReady()).toBe(false);
    const mod = await loader.loadSourceCodeEditor();
    expect(typeof mod.SourceCodeEditor).not.toBe('undefined');
    expect(loader.isSourceCodeEditorReady()).toBe(true);
  });

  it('重复调用复用同一个 Promise（只 import 一次）', async () => {
    const loader = await freshLoader();
    const a = loader.loadSourceCodeEditor();
    const b = loader.loadSourceCodeEditor();
    expect(a).toBe(b);
    await a;
  });

  it('preloadSourceCodeEditor 不抛出', async () => {
    const loader = await freshLoader();
    expect(() => loader.preloadSourceCodeEditor()).not.toThrow();
    await loader.loadSourceCodeEditor();
  });
});
