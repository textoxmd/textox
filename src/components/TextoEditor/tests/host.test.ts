import { afterEach, describe, expect, it, vi } from 'vitest';

import { getEditorHost, setEditorHost } from '../src/host';
import type { EditorDialogOptions, EditorHost } from '../src/host';

// host 是模块级单例；本文件内测试之间需复位到默认实现。
const defaultHost = getEditorHost();

afterEach(() => {
  vi.restoreAllMocks();
  setEditorHost(defaultHost);
});

/** 拦截浏览器下载三件套，返回被点击的 anchor 以便断言下载属性。 */
function mockBrowserDownload(objectUrl = 'blob:mock') {
  const clicked: HTMLAnchorElement[] = [];
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue(objectUrl);
  const revokeObjectURL = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => {});
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  return { clicked, click, createObjectURL, revokeObjectURL };
}

/** 让 revokeObjectURL 的 setTimeout(0) 在 mock 仍生效时跑完。 */
async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('EditorHost', () => {
  it('exposes a safe default implementation', async () => {
    const host = getEditorHost();
    expect(await host.getImageUploader()).toBeNull();
    expect(host.resolveImageSrc('https://a.test/x.png', null)).toBe('https://a.test/x.png');
    expect(host.resolveImageSrc('images/cat.png', null)).toBeNull();
    expect(host.resolveImageSrc('/abs/cat.png', '/docs')).toBeNull();
    const value = await host.showDialog<number>({
      title: 't',
      buttons: [{ text: 'ok', variant: 'primary', value: 1 }],
      dismissValue: 0,
    });
    expect(value).toBe(0);
    // 懒加载契约的缺省实现必须能安全 resolve，调用方无需判空
    expect(await host.loadCodeLanguageSupport?.()).toBeNull();
  });

  it('returns the injected host', async () => {
    const uploader = { upload: async () => 'remote://url' };
    const custom: EditorHost = {
      getImageUploader: async () => uploader,
      resolveImageSrc: () => 'resolved',
      showDialog: async <T>(options: EditorDialogOptions<T>) => options.dismissValue as T,
      saveMedia: async () => ({ saved: true }),
    };
    setEditorHost(custom);
    expect(getEditorHost()).toBe(custom);
    await expect(getEditorHost().getImageUploader()).resolves.toBe(uploader);
  });

  it('downloads text media with the browser fallback', async () => {
    const { clicked, createObjectURL, revokeObjectURL } = mockBrowserDownload();

    const result = await getEditorHost().saveMedia({
      source: {
        kind: 'text',
        text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        mimeType: 'image/svg+xml',
      },
      suggestedName: 'diagram.svg',
      filterName: 'SVG',
      extension: 'svg',
    });

    expect(result).toEqual({ saved: true });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('diagram.svg');
    expect(clicked[0].href).toBe('blob:mock');

    await flushTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('downloads url media with the browser fallback', async () => {
    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
    } as unknown as Response);
    const { createObjectURL } = mockBrowserDownload('blob:url');

    const result = await getEditorHost().saveMedia({
      source: { kind: 'url', url: 'https://a.test/cat.png' },
      suggestedName: 'cat.png',
      filterName: 'Image',
      extension: 'png',
    });

    expect(result).toEqual({ saved: true });
    expect(fetchSpy).toHaveBeenCalledWith('https://a.test/cat.png');
    expect(createObjectURL).toHaveBeenCalledWith(blob);

    await flushTimers();
  });

  it('rejects url media when the response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      blob: async () => new Blob(),
    } as unknown as Response);
    const { createObjectURL } = mockBrowserDownload();

    await expect(
      getEditorHost().saveMedia({
        source: { kind: 'url', url: 'https://a.test/missing.png' },
        suggestedName: 'missing.png',
        filterName: 'Image',
        extension: 'png',
      }),
    ).rejects.toThrow('HTTP 404');

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
