import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const readAssetMock = vi.hoisted(() => vi.fn(async () => ''));
vi.mock('@/plugins/runtime/ipc', () => ({
  pluginIpc: { readAsset: readAssetMock },
}));

import { PluginIcon } from '../pluginIcon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(element: React.ReactElement): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  readAssetMock.mockReset();
});

describe('PluginIcon asset icons', () => {
  it('reads the icon file from the plugin directory and renders it as an image', async () => {
    // 1×1 透明 PNG 的 base64：只验证解码与 data URL 拼装
    readAssetMock.mockResolvedValue(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    );

    const view = render(<PluginIcon icon="icon.png" pluginId="app.textox.demo" size={18} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const img = view.querySelector('[data-slot="plugin-icon-asset"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(img!.style.width).toBe('100%');
    expect(readAssetMock).toHaveBeenCalledWith('app.textox.demo', 'icon.png');
  });

  it('falls back to the default glyph when the asset cannot be read', async () => {
    readAssetMock.mockRejectedValue(new Error('missing'));

    const view = render(<PluginIcon icon="icon.svg" pluginId="app.textox.demo" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.querySelector('[data-slot="plugin-icon-asset"]')).toBeNull();
    // 回退到 lucide 默认图标（WandSparkles 渲染成 svg）
    expect(view.querySelector('svg')).not.toBeNull();
  });

  it('keeps treating kebab names as lucide icons', () => {
    const view = render(<PluginIcon icon="pencil-ruler" />);
    expect(view.querySelector('[data-slot="plugin-icon-asset"]')).toBeNull();
    expect(readAssetMock).not.toHaveBeenCalled();
  });
});
