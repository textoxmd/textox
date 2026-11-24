// 测试环境的 localStorage 兼容层。
//
// Node 22+ 默认启用实验性 WebStorage，会在 globalThis/window 上放置一个由
// `--localstorage-file` 驱动的 localStorage；未配置路径时其 setItem/clear 等
// 方法不可用。它会遮蔽 happy-dom 的实现，导致任何依赖 localStorage 的用例失败
// （典型症状：`TypeError: localStorage.clear is not a function`）。
//
// 这里在环境就绪后检测并替换成一个可用的内存实现。两个 vitest 配置
// （根 `vitest.config.ts` 经 `vitest.setup.ts`、编辑器 `src/components/TextoEditor/vitest.config.ts`
// 经 setupFiles）都挂载本文件——编辑器配置的 include 也会收集骨架测试，因此同样需要它。
class MemoryStorage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function define(target: object, prop: string, value: unknown): void {
  Object.defineProperty(target, prop, { value, configurable: true, writable: true });
}

const current = (globalThis as unknown as { localStorage?: { setItem?: unknown } }).localStorage;
if (typeof current?.setItem !== 'function') {
  const storage = new MemoryStorage();
  define(globalThis, 'Storage', MemoryStorage);
  define(globalThis, 'localStorage', storage);
  const win = (globalThis as unknown as { window?: object }).window;
  if (win) {
    define(win, 'Storage', MemoryStorage);
    define(win, 'localStorage', storage);
  }
}
