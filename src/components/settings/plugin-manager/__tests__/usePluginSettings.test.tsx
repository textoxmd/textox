import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PluginManifest } from '@textox/plugin-sdk';
import type { SettingsField } from '@texto/plugin-sdk';

const { readDataMock, writeDataMock, dataChangedHandlers } = vi.hoisted(() => ({
  readDataMock: vi.fn(),
  writeDataMock: vi.fn(),
  dataChangedHandlers: [] as Array<(pluginId: string) => void>,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n', () => ({
  default: { getFixedT: () => () => '', t: (key: string) => key },
}));
vi.mock('@/plugins/runtime/ipc', () => ({
  pluginIpc: { readData: readDataMock, writeData: writeDataMock },
  subscribePluginDataChanged: (handler: (pluginId: string) => void) => {
    dataChangedHandlers.push(handler);
    return () => {
      const index = dataChangedHandlers.indexOf(handler);
      if (index >= 0) dataChangedHandlers.splice(index, 1);
    };
  },
}));

import { toast } from 'sonner';

import { usePluginSettings, type PluginSettingsApi } from '../usePluginSettings';
import type { PluginData } from '@/plugins/runtime/ipc';
import type { RuntimeEntry } from '@/plugins/runtime/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'app.textox.demo-a';
const B = 'app.textox.demo-b';

const MANIFEST_A: PluginManifest = {
  id: A,
  name: 'Demo A',
  version: '1.0.0',
  minAppVersion: '2.3.8',
  author: { name: 'Textox' },
  settings: [
    {
      key: 'density',
      type: 'select',
      labelKey: 'density',
      default: 'cozy',
      options: [
        { value: 'cozy', labelKey: 'cozy' },
        { value: 'compact', labelKey: 'compact' },
      ],
    },
    { key: 'count', type: 'number', labelKey: 'count', default: 1, min: 1, max: 5 },
  ],
};

const MANIFEST_B: PluginManifest = {
  id: B,
  name: 'Demo B',
  version: '1.0.0',
  minAppVersion: '2.3.8',
  author: { name: 'Textox' },
  settings: [{ key: 'note', type: 'text', labelKey: 'note', default: '' }],
};

function entry(manifest: PluginManifest): RuntimeEntry {
  return {
    id: manifest.id,
    dir: `/plugins/${manifest.id}`,
    manifest,
    enabled: true,
    error: null,
    status: 'enabled',
  };
}

const ENTRY_A = entry(MANIFEST_A);
const ENTRY_B = entry(MANIFEST_B);

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const apiRef: { current: PluginSettingsApi | null } = { current: null };

function Harness({
  entries,
  activeId,
}: {
  entries: readonly RuntimeEntry[];
  activeId: string | null;
}) {
  const api = usePluginSettings(entries, activeId);
  apiRef.current = api;
  return null;
}

async function render(
  entries: readonly RuntimeEntry[],
  activeId: string | null,
): Promise<void> {
  await act(async () => {
    root?.render(createElement(Harness, { entries, activeId }));
  });
}

/** 触发一次 `plugin:data-changed` 广播（模拟 Rust 侧写入后的事件）。 */
async function emitDataChanged(pluginId: string): Promise<void> {
  await act(async () => {
    for (const handler of [...dataChangedHandlers]) handler(pluginId);
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 字段标识：值字段 / preset 用 `key`，宿主桥接后的 action 字段用 `id`。 */
function fieldKey(field: SettingsField): string {
  return 'key' in field ? field.key : field.id;
}

function data(settings: Record<string, unknown>, plugin: Record<string, unknown> = {}) {
  return { settings, plugin };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  apiRef.current = null;
  dataChangedHandlers.length = 0;
  readDataMock.mockReset();
  writeDataMock.mockReset();
  writeDataMock.mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
  readDataMock.mockResolvedValue(data({}));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('usePluginSettings 读盘', () => {
  it('展开时读取该插件的 settings，字段按 activeId 返回', async () => {
    readDataMock.mockResolvedValue(data({ density: 'compact' }));

    await render([ENTRY_A, ENTRY_B], A);

    expect(readDataMock).toHaveBeenCalledWith(A);
    expect(apiRef.current?.values).toEqual({ density: 'compact' });
    expect(apiRef.current?.fields.map(fieldKey)).toEqual(['density', 'count']);
  });

  it('切换 activeId 时重新读盘并换成该插件的字段', async () => {
    readDataMock.mockImplementation(async (pluginId: string) =>
      pluginId === A ? data({ density: 'cozy' }) : data({ note: 'hi' }),
    );

    await render([ENTRY_A, ENTRY_B], A);
    await render([ENTRY_A, ENTRY_B], B);

    expect(readDataMock).toHaveBeenLastCalledWith(B);
    expect(apiRef.current?.values).toEqual({ note: 'hi' });
    expect(apiRef.current?.fields.map(fieldKey)).toEqual(['note']);
  });

  it('activeId 为 null 时不读盘，values 为空对象', async () => {
    await render([ENTRY_A, ENTRY_B], null);

    expect(readDataMock).not.toHaveBeenCalled();
    expect(apiRef.current?.values).toEqual({});
    expect(apiRef.current?.fields).toEqual([]);
  });

  it('没有清单（manifest 为 null）的插件字段为空数组', async () => {
    const broken: RuntimeEntry = {
      id: 'app.textox.broken',
      dir: '/plugins/broken',
      manifest: null,
      enabled: false,
      error: 'bad manifest',
      status: 'load-failed',
    };

    await render([broken], broken.id);

    expect(apiRef.current?.fields).toEqual([]);
  });

  it('慢的旧读晚到不会覆盖新读', async () => {
    const first = deferred<PluginData>();
    const second = deferred<PluginData>();
    readDataMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await render([ENTRY_A], A);
    await emitDataChanged(A);

    await act(async () => {
      second.resolve(data({ density: 'compact' }));
    });
    expect(apiRef.current?.values).toEqual({ density: 'compact' });

    // 旧读在第二次读之后才返回：必须被丢弃
    await act(async () => {
      first.resolve(data({ density: 'old' }));
    });
    expect(apiRef.current?.values).toEqual({ density: 'compact' });
  });

  it('plugin:data-changed 只重读当前 activeId', async () => {
    await render([ENTRY_A, ENTRY_B], A);
    expect(readDataMock).toHaveBeenCalledTimes(1);

    await emitDataChanged(B);
    expect(readDataMock).toHaveBeenCalledTimes(1);

    await emitDataChanged(A);
    expect(readDataMock).toHaveBeenCalledTimes(2);
  });

  it('切换 activeId 后旧插件的广播不再触发读盘', async () => {
    await render([ENTRY_A, ENTRY_B], A);
    await render([ENTRY_A, ENTRY_B], B);
    expect(readDataMock).toHaveBeenCalledTimes(2);

    await emitDataChanged(A);
    expect(readDataMock).toHaveBeenCalledTimes(2);

    await emitDataChanged(B);
    expect(readDataMock).toHaveBeenCalledTimes(3);
  });

  it('卸载时取消订阅', async () => {
    await render([ENTRY_A], A);
    expect(dataChangedHandlers).toHaveLength(1);

    act(() => root?.unmount());
    root = null;

    expect(dataChangedHandlers).toHaveLength(0);
  });
});

describe('usePluginSettings 写入', () => {
  it('合法值：整份回写 data.json（payload 精确），并本地合并、返回 true', async () => {
    readDataMock.mockResolvedValue(data({ count: 2 }, { keep: true }));

    await render([ENTRY_A], A);

    let result: boolean | undefined;
    await act(async () => {
      result = await apiRef.current?.setValue(A, 'density', 'compact');
    });

    expect(result).toBe(true);
    expect(writeDataMock).toHaveBeenCalledTimes(1);
    expect(writeDataMock).toHaveBeenCalledWith(A, {
      settings: { count: 2, density: 'compact' },
      plugin: { keep: true },
    });
    expect(apiRef.current?.values).toEqual({ count: 2, density: 'compact' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('合法补丁：一次写入多个键', async () => {
    readDataMock.mockResolvedValue(data({}));

    await render([ENTRY_A], A);

    let result: boolean | undefined;
    await act(async () => {
      result = await apiRef.current?.setPatch(A, { density: 'compact', count: 3 });
    });

    expect(result).toBe(true);
    expect(writeDataMock).toHaveBeenCalledWith(A, {
      settings: { density: 'compact', count: 3 },
      plugin: {},
    });
    expect(apiRef.current?.values).toEqual({ density: 'compact', count: 3 });
  });

  it('非法值被拒绝：返回 false、不写盘、提示并强制回显原值', async () => {
    readDataMock.mockResolvedValue(data({ density: 'cozy' }));

    await render([ENTRY_A], A);
    const before = apiRef.current?.values;

    let result: boolean | undefined;
    await act(async () => {
      result = await apiRef.current?.setValue(A, 'density', 'nope');
    });

    expect(result).toBe(false);
    expect(writeDataMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('设置值无效，已保留原值');
    // 受控控件已把非法输入画进 DOM：换引用强制回写磁盘原值
    expect(apiRef.current?.values).toEqual({ density: 'cozy' });
    expect(apiRef.current?.values).not.toBe(before);
  });

  it('补丁里任一键非法即整体拒绝（其它合法键也不落盘）', async () => {
    readDataMock.mockResolvedValue(data({}));

    await render([ENTRY_A], A);

    let result: boolean | undefined;
    await act(async () => {
      result = await apiRef.current?.setPatch(A, { density: 'compact', count: 99 });
    });

    expect(result).toBe(false);
    expect(writeDataMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('设置值无效，已保留原值');
    expect(apiRef.current?.values).toEqual({});
  });

  it('未声明在清单里的键被拒绝', async () => {
    readDataMock.mockResolvedValue(data({}));

    await render([ENTRY_A], A);

    let result: boolean | undefined;
    await act(async () => {
      result = await apiRef.current?.setValue(A, 'ghost', 1);
    });

    expect(result).toBe(false);
    expect(writeDataMock).not.toHaveBeenCalled();
  });

  it('写盘失败：提示错误并返回 false', async () => {
    readDataMock.mockResolvedValue(data({}));
    writeDataMock.mockRejectedValue(new Error('disk full'));

    await render([ENTRY_A], A);

    let result: boolean | undefined;
    await act(async () => {
      result = await apiRef.current?.setValue(A, 'density', 'compact');
    });

    expect(result).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('disk full');
  });
});
