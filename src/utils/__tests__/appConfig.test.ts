import { beforeEach, describe, expect, it, vi } from 'vitest';

type ConfigEvent = { payload: unknown };

const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>({}));
const listenMock = vi.fn(
  (_event: string, _handler: (event: ConfigEvent) => void) =>
    Promise.resolve<() => void>(() => {}),
);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: ConfigEvent) => void) =>
    listenMock(event, handler),
}));

import {
  invalidateAppConfig,
  readAppConfig,
  resetAppConfigCacheForTests,
  writeAppConfig,
} from '../appConfig';

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockClear();
  resetAppConfigCacheForTests();
  vi.useRealTimers();
});

describe('readAppConfig', () => {
  it('dedupes concurrent reads into one invoke', async () => {
    invokeMock.mockResolvedValue({ language: 'zh-CN' });

    const [a, b] = await Promise.all([readAppConfig(), readAppConfig()]);

    expect(a).toEqual({ language: 'zh-CN' });
    expect(b).toEqual(a);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('get_config');
  });

  it('serves the snapshot within the TTL and refetches after it', async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });

    expect(await readAppConfig()).toEqual({ v: 1 });
    expect(await readAppConfig()).toEqual({ v: 1 });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    expect(await readAppConfig()).toEqual({ v: 2 });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('refetches after invalidate', async () => {
    invokeMock.mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });

    await readAppConfig();
    invalidateAppConfig();

    expect(await readAppConfig()).toEqual({ v: 2 });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('updates snapshot from config-changed without invoking again', async () => {
    invokeMock.mockResolvedValue({ v: 1 });

    await readAppConfig();
    const handler = listenMock.mock.calls[0]?.[1];
    expect(handler).toBeTypeOf('function');
    handler!({ payload: { v: 3 } });

    expect(await readAppConfig()).toEqual({ v: 3 });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale in-flight read overwrite a newer write', async () => {
    let resolveRead: (value: unknown) => void = () => {};
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );

    const pending = readAppConfig();
    invalidateAppConfig();
    resolveRead({ v: 1 });
    await pending;

    invokeMock.mockResolvedValueOnce({ v: 2 });
    expect(await readAppConfig()).toEqual({ v: 2 });
  });
});

describe('writeAppConfig', () => {
  it('invalidates the snapshot after writing', async () => {
    invokeMock.mockResolvedValueOnce({ v: 1 });
    await readAppConfig();

    invokeMock.mockResolvedValueOnce(undefined);
    await writeAppConfig({ v: 2 });
    expect(invokeMock).toHaveBeenCalledWith('set_config', { config: { v: 2 } });

    invokeMock.mockResolvedValueOnce({ v: 2 });
    expect(await readAppConfig()).toEqual({ v: 2 });
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });
});
