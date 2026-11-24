import { describe, expect, it } from 'vitest';

const IGNORED = new Set(['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED', 'module.exports']);

// 明确不共享：act/unstable_act 是测试 API，createFactory 已被 React 19 移除。
// `default` 必须留在豁免里：CJS 的 module.exports 上没有 default 属性，但本测试运行在
// Vite 的 ESM/CJS interop 下，namespace 会合成一个 default；共享入口不为 client /
// jsx-runtime 凭空造 default（宿主与构建产物都按具名导入使用它们）。
const ALLOWED_MISSING: Record<string, readonly string[]> = {
  react: ['act', 'unstable_act', 'createFactory'],
  'react-dom': [],
  'react-dom/client': ['default'],
  'react/jsx-runtime': ['default'],
};

describe('shared entry exports', () => {
  it.each([
    ['react', () => import('react'), () => import('../shared/react')],
    ['react-dom', () => import('react-dom'), () => import('../shared/react-dom')],
    [
      'react-dom/client',
      () => import('react-dom/client'),
      () => import('../shared/react-dom-client'),
    ],
    [
      'react/jsx-runtime',
      () => import('react/jsx-runtime'),
      () => import('../shared/react-jsx-runtime'),
    ],
  ] as const)('%s 的共享导出不落后于真实模块', async (name, actual, shared) => {
    const allowed = new Set(ALLOWED_MISSING[name] ?? []);
    const sharedKeys = new Set(Object.keys(await shared()));
    const missing = Object.keys(await actual()).filter(
      (key) => !IGNORED.has(key) && !allowed.has(key) && !sharedKeys.has(key),
    );
    expect(missing).toEqual([]);
  });
});
