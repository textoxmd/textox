import { SHARED_MODULES } from '@textox/plugin-sdk';

const SHARED = new Set<string>(SHARED_MODULES);

/**
 * 只精确命中宿主 import map 提供的裸模块。
 * 不做 `startsWith(spec + '/')` 子路径放行：import map 没有子路径键，
 * 把 `react-dom/server` 之类外部化会在运行期解析失败；让它们被打进插件包反而安全。
 */
export function isExternal(specifier: string): boolean {
  return SHARED.has(specifier);
}
