import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 显式声明可选入参：否则 `vi.fn(async () => …)` 推出零参签名，
// `mock.calls[0]![0]` 会触发 TS2493（元组长度 0），断言拿不到首个实参。
const popup = vi.fn(async (_position?: unknown) => {});
const menuNew = vi.fn(async (_options?: unknown) => ({ popup }));
const predefinedNew = vi.fn(async (_options?: unknown) => ({ kind: 'separator' }));

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: (...args: unknown[]) => menuNew(...(args as [])) },
  PredefinedMenuItem: { new: (...args: unknown[]) => predefinedNew(...(args as [])) },
}));

vi.mock('@tauri-apps/api/window', () => ({
  // 注意：编辑器 tsconfig 开了 erasableSyntaxOnly，禁止参数属性，必须显式赋值。
  LogicalPosition: class {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

import { openContextMenu } from '../../src/features/context-menu/open';
import type { ContextMenuModelEntry } from '../../src/features/context-menu/build';

const target = window as unknown as Record<string, unknown>;
const hadInternals = '__TAURI_INTERNALS__' in target;
const originalInternals = target.__TAURI_INTERNALS__;

function restoreTauriGlobal(): void {
  if (hadInternals) target.__TAURI_INTERNALS__ = originalInternals;
  else delete target.__TAURI_INTERNALS__;
}

beforeEach(() => {
  vi.clearAllMocks();
  restoreTauriGlobal();
});

afterEach(() => {
  restoreTauriGlobal();
});

describe('openContextMenu', () => {
  it('把 model 映射为原生菜单项并弹出（分隔符走 PredefinedMenuItem）', async () => {
    const run = vi.fn();
    const entries: ContextMenuModelEntry[] = [
      { id: 'copy', text: '复制', enabled: true, run },
      { id: '__sep__', text: '', enabled: false, separator: true },
      { id: 'mermaid.copySource', text: '复制 Mermaid 源码', enabled: false },
    ];

    await openContextMenu(entries, 10, 20);

    expect(predefinedNew).toHaveBeenCalledWith({ item: 'Separator' });
    expect(menuNew).toHaveBeenCalledTimes(1);
    const items = menuNew.mock.calls[0]![0] as { items: unknown[] };
    expect(items.items).toHaveLength(3);
    expect(items.items[1]).toEqual({ kind: 'separator' });
    expect(items.items[2]).toMatchObject({
      id: 'mermaid.copySource',
      text: '复制 Mermaid 源码',
      enabled: false,
    });

    // action 已接线到 model 的 run
    const first = items.items[0] as { action: (id: string) => void };
    first.action('copy');
    expect(run).toHaveBeenCalledTimes(1);

    expect(popup).toHaveBeenCalledTimes(1);
    const position = popup.mock.calls[0]![0] as { x: number; y: number };
    expect(position.x).toBe(11);
    expect(position.y).toBe(21);
  });

  it('非 Tauri 环境直接跳过，不创建菜单（并提示一次）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

    await openContextMenu([{ id: 'copy', text: '复制', enabled: true }], 0, 0);

    expect(menuNew).not.toHaveBeenCalled();
    // 模块级「只提示一次」标记：本文件内只有这条用例走非 Tauri 路径
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[context-menu] no native menu backend; skip popup');
    warnSpy.mockRestore();
  });

  it('菜单创建异常被吞掉，不外溢', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    menuNew.mockRejectedValueOnce(new Error('boom'));

    await expect(
      openContextMenu([{ id: 'copy', text: '复制', enabled: true }], 0, 0),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('popup 异常同样被吞掉', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    popup.mockRejectedValueOnce(new Error('popup-boom'));

    await expect(
      openContextMenu([{ id: 'copy', text: '复制', enabled: true }], 0, 0),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('无 run 的条目被点击后不抛错', async () => {
    await openContextMenu([{ id: 'noop', text: '无操作', enabled: true }], 0, 0);

    const items = menuNew.mock.calls[0]![0] as { items: unknown[] };
    const entry = items.items[0] as { action: (id: string) => void };
    expect(() => entry.action('noop')).not.toThrow();
  });
});
