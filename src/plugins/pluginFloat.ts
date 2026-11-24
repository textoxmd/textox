export interface PluginFloatParams {
  delay: number;
  duration: number;
  distance: number;
}

/**
 * 由插件 id 派生一组**稳定**的「随机」漂浮参数（延迟 / 时长 / 幅度，FNV-1a 哈希）。
 * 用哈希而不是 Math.random()：同一插件每次渲染结果一致，不会抖动。
 * 引导页「插件模式」与插件中心的紧凑视图共用，保证动态手感一致。
 */
export function floatParams(id: string): PluginFloatParams {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  return {
    delay: ((unsigned % 1000) / 1000) * 2.4,
    duration: 2.8 + (((unsigned >>> 10) & 0xff) / 255) * 1.2,
    distance: 2 + ((unsigned >>> 20) % 3),
  };
}
