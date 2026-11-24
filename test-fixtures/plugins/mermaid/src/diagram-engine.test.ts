import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RENDERER,
  getActiveEngine,
  getActiveRenderer,
  registerPreview,
  resetRendererStateForTests,
  resolveRenderer,
  setActiveRenderer,
} from './diagram-engine';

beforeEach(() => {
  resetRendererStateForTests();
});

describe('diagram engine selection', () => {
  it('默认为 Mermaid 标准渲染器', () => {
    expect(DEFAULT_RENDERER).toBe('mermaid');
    expect(getActiveRenderer()).toBe('mermaid');
    expect(getActiveEngine().id).toBe('mermaid');
  });

  it('切换引擎并通知已注册预览一次', () => {
    const refresh = vi.fn();
    registerPreview(refresh);

    setActiveRenderer('pele');

    expect(getActiveRenderer()).toBe('pele');
    expect(getActiveEngine().id).toBe('pele');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('重复设置同一引擎不通知', () => {
    const refresh = vi.fn();
    registerPreview(refresh);

    setActiveRenderer('mermaid');

    expect(refresh).not.toHaveBeenCalled();
  });

  it('注销后不再收到通知', () => {
    const refresh = vi.fn();
    const unregister = registerPreview(refresh);
    unregister();

    setActiveRenderer('pele');

    expect(refresh).not.toHaveBeenCalled();
  });

  it('单个预览刷新抛错不影响其它预览', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    registerPreview(() => {
      throw new Error('bad preview');
    });
    registerPreview(good);

    setActiveRenderer('pele');

    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });

  it('resolveRenderer 对未知值回退默认', () => {
    expect(resolveRenderer('pele')).toBe('pele');
    expect(resolveRenderer('mermaid')).toBe('mermaid');
    expect(resolveRenderer('unknown')).toBe('mermaid');
    expect(resolveRenderer(undefined)).toBe('mermaid');
  });
});
