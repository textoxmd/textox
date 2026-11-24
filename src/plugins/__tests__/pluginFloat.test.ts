import { describe, expect, it } from 'vitest';

import { floatParams } from '../pluginFloat';

describe('floatParams', () => {
  // 黄金值取引导页基线实现的 4 位小数；实时值与之最多差约 2.35e-5
  // （duration 未被 round），故用 precision 4 而非 10。
  it('与引导页既有实现逐位一致（黄金值，防止顺手优化算法）', () => {
    const table = floatParams('table');
    expect(table.delay).toBeCloseTo(1.2072, 4);
    expect(table.duration).toBeCloseTo(2.9788, 4);
    expect(table.distance).toBe(4);

    const mermaid = floatParams('mermaid');
    expect(mermaid.delay).toBeCloseTo(1.824, 4);
    expect(mermaid.duration).toBeCloseTo(3.5106, 4);
    expect(mermaid.distance).toBe(2);
  });

  it('同一插件 id 每次结果稳定', () => {
    expect(floatParams('table')).toEqual(floatParams('table'));
  });

  it('不同插件 id 至少一项参数不同', () => {
    const a = floatParams('table');
    const b = floatParams('mermaid');
    expect([a.delay, a.duration, a.distance]).not.toEqual([b.delay, b.duration, b.distance]);
  });

  it('取值落在引导页约定的范围内', () => {
    for (const id of ['table', 'mermaid', 'math', 'footnote', 'excalidraw']) {
      const { delay, duration, distance } = floatParams(id);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(2.4);
      expect(duration).toBeGreaterThanOrEqual(2.8);
      expect(duration).toBeLessThan(4.0);
      expect(Number.isInteger(distance)).toBe(true);
      expect(distance).toBeGreaterThanOrEqual(2);
      expect(distance).toBeLessThanOrEqual(4);
    }
  });
});
