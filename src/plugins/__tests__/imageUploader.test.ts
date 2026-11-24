import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveMock, createHostMock, noopDeps } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  createHostMock: vi.fn((_deps: unknown, pluginId: string) => ({ id: pluginId })),
  noopDeps: {},
}));

vi.mock('../registry', () => ({ resolveImageUploaderWithOwner: resolveMock }));
vi.mock('../host', () => ({ NOOP_HOST_DEPS: noopDeps, createPluginHost: createHostMock }));

import { resolveImageUploader } from '../imageUploader';

describe('resolveImageUploader', () => {
  beforeEach(() => {
    resolveMock.mockReset();
    createHostMock.mockClear();
  });

  it('returns null when no uploader is registered', () => {
    resolveMock.mockReturnValue(null);
    expect(resolveImageUploader()).toBeNull();
    expect(createHostMock).not.toHaveBeenCalled();
  });

  it('binds the owner host and forwards the local path to the contribution', async () => {
    const upload = vi.fn(async () => 'https://cdn.example/x.png');
    resolveMock.mockReturnValue({
      pluginId: 'p',
      contribution: { id: 'p.uploader', upload },
    });
    const uploader = resolveImageUploader();
    expect(uploader).not.toBeNull();
    expect(createHostMock).toHaveBeenCalledWith(noopDeps, 'p');
    await expect(uploader!.upload('/tmp/x.png')).resolves.toBe('https://cdn.example/x.png');
    expect(upload).toHaveBeenCalledWith({ id: 'p' }, '/tmp/x.png');
  });
});
