import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { IconDef, IconSpec } from '@texto/plugin-sdk';

const { loadIconMock, resolveIconMock, prefetchIconsMock } = vi.hoisted(() => ({
  loadIconMock: vi.fn(),
  resolveIconMock: vi.fn(),
  prefetchIconsMock: vi.fn(),
}));

vi.mock('@/components/TextoEditor/src/iconLoader', () => ({
  loadIcon: loadIconMock,
  resolveIcon: resolveIconMock,
  prefetchIcons: prefetchIconsMock,
}));

import {
  PluginGlyph,
  prefetchPluginIcons,
  resetPluginIconWarningsForTests,
} from '../pluginIcon';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEF: IconDef = [['path', 'M4 6h16']];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetPluginIconWarningsForTests();
  loadIconMock.mockReset();
  resolveIconMock.mockReset();
  resolveIconMock.mockReturnValue(undefined);
  prefetchIconsMock.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  warnSpy.mockRestore();
});

async function render(icon?: IconSpec, id = 'demo'): Promise<void> {
  await act(async () => {
    root?.render(createElement(PluginGlyph, { id, icon, size: 24 }));
  });
}

describe('PluginGlyph', () => {
  it('缺省 icon 回退为 Puzzle 兜底图标', async () => {
    await render(undefined);
    expect(container?.querySelector('svg.lucide-puzzle')).not.toBeNull();
  });

  it('lucide 名称先渲染同尺寸占位，解析完成后渲染线框 svg', async () => {
    let resolveLoad: (def: IconDef) => void = () => {};
    loadIconMock.mockReturnValue(new Promise<IconDef>((res) => { resolveLoad = res; }));

    await render('underline');

    // 占位：同尺寸 span，无 svg
    const placeholder = container?.querySelector('span[aria-hidden="true"]') as HTMLElement | null;
    expect(placeholder).not.toBeNull();
    expect(placeholder?.style.width).toBe('24px');
    expect(container?.querySelector('svg')).toBeNull();

    await act(async () => { resolveLoad(DEF); });

    const svg = container?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
  });

  it('手绘 IconDef 直接按线框渲染，不触发加载', async () => {
    await render(DEF);
    expect(container?.querySelector('path')?.getAttribute('d')).toBe('M4 6h16');
    expect(container?.querySelector('svg')?.getAttribute('fill')).toBe('none');
    expect(loadIconMock).not.toHaveBeenCalled();
  });

  it('遗留裸 path 字符串按填充渲染并给出 DEV 告警', async () => {
    const legacy = 'M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z';
    await render(legacy);

    const svg = container?.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(container?.querySelector('path')?.getAttribute('d')).toBe(legacy);
    expect(loadIconMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('既不是可用名称也不像 path 的字符串回退为 Puzzle 并告警', async () => {
    await render('Underline');
    expect(container?.querySelector('svg.lucide-puzzle')).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('名称存在但模块加载失败时回退为 Puzzle 并告警', async () => {
    loadIconMock.mockRejectedValue(new Error('chunk load failed'));
    await render('underline');

    await act(async () => { await Promise.resolve(); });

    expect(container?.querySelector('svg.lucide-puzzle')).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('含空白的名称按非法字符串兜底为 Puzzle 并告警，不渲染空白 svg', async () => {
    await render('arrow up');

    expect(container?.querySelector('svg.lucide-puzzle')).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('空 IconDef 回退为 Puzzle 并告警', async () => {
    await render([]);

    expect(container?.querySelector('svg.lucide-puzzle')).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('icon 切换后在 effect 执行前的那一帧不残留上一个图标', async () => {
    loadIconMock.mockImplementation((name: string) =>
      name === 'underline' ? Promise.resolve(DEF) : new Promise<IconDef>(() => {}),
    );
    await render('underline');
    expect(container?.querySelector('path')?.getAttribute('d')).toBe('M4 6h16');

    // 关掉 act 环境，用 flushSync 观察「已提交但 passive effect 未跑」的那一帧
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      flushSync(() => {
        root?.render(createElement(PluginGlyph, { id: 'demo', icon: 'sparkles', size: 24 }));
      });
      expect(container?.querySelector('path')).toBeNull();
      expect(container?.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    }

    await act(async () => {}); // 冲掉 pending effect，避免 afterEach unmount 告警
  });

  it('预热只处理 lucide 名称，跳过裸 path / IconDef / 缺省', () => {
    prefetchPluginIcons([
      { icon: 'M6 17h3l2-4V7H5v6h3z' },
      { icon: [['path', 'M4 6h16']] },
      { icon: 'sparkles' },
      {},
    ]);

    expect(prefetchIconsMock).toHaveBeenCalledWith(['sparkles']);
  });
});
