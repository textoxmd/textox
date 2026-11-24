import { describe, expect, it } from 'vitest';

import { getMdConfig, SerializerState } from '../src/serializer';

/**
 * `atBlankLine()` 被每个文本块 / 内联节点调用。此前实现直接对不断增长的 `out`
 * 做 `endsWith("\n")`，V8 每次都要拍平 rope，全文序列化从 O(n) 退化成 O(n²)
 * （600KB 实测 1.3s，直接拖慢大文件打开）。这里锁住尾字符缓存的行为。
 */
describe('SerializerState.atBlankLine', () => {
  it('tracks internal appends without re-reading the whole output', () => {
    const state = new SerializerState(getMdConfig());

    expect(state.atBlankLine()).toBe(true);
    state.append('a');
    expect(state.atBlankLine()).toBe(false);
    state.append('\n');
    expect(state.atBlankLine()).toBe(true);
    state.append('x\n');
    expect(state.atBlankLine()).toBe(true);
  });

  it('resyncs after plugins write `out` directly', () => {
    const state = new SerializerState(getMdConfig());

    state.append('paragraph');
    expect(state.atBlankLine()).toBe(false);

    // 插件契约允许直接追加 `state.out`（table / html / front-matter）。
    state.out += ' plugin';
    expect(state.atBlankLine()).toBe(false);
    state.out += '\n';
    expect(state.atBlankLine()).toBe(true);

    // 重新同步后，内部 append 继续走 O(1) 路径。
    state.append('next');
    expect(state.atBlankLine()).toBe(false);
  });

  it('treats empty appends as no-op', () => {
    const state = new SerializerState(getMdConfig());
    state.append('');
    expect(state.out).toBe('');
    expect(state.atBlankLine()).toBe(true);
  });
});
