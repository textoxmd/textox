import { describe, expect, it } from 'vitest';
import {
  buildAgentStreamSchedule,
  splitGraphemes,
  type AgentStreamStep,
} from '../src/agent-stream';

const constantRandom = (value: number) => () => value;

function gaps(steps: AgentStreamStep[]): number[] {
  return steps.map((step, index) => step.at - (index === 0 ? 0 : steps[index - 1].at));
}

describe('agent-stream 节奏表', () => {
  it('空文本没有调度步', () => {
    expect(buildAgentStreamSchedule('')).toEqual([]);
  });

  it('按字素拆分（emoji / 组合字符不拆开）', () => {
    expect(splitGraphemes('ab')).toEqual(['a', 'b']);
    const emoji = splitGraphemes('👍🏽x');
    expect(emoji).toHaveLength(2);
    expect(emoji[0]).toBe('👍🏽');
  });

  it('时间轴严格递增，且每个播放步都在撤销合并窗口内', () => {
    const text = '第一行文字\n\n第二段，有标点。最后一句！';
    const steps = buildAgentStreamSchedule(text, { random: constantRandom(0.5) });
    expect(steps.map((step) => step.text).join('')).toBe(text);
    for (let i = 0; i < steps.length; i += 1) {
      if (i > 0) expect(steps[i].at).toBeGreaterThan(steps[i - 1].at);
    }
    // 单步间隔不超过 420ms：历史会话 500ms 合并窗口内，整段插入算一步撤销
    for (const gap of gaps(steps)) expect(gap).toBeLessThanOrEqual(420);
  });

  it('标点与换行比普通字符停得久', () => {
    const plain = buildAgentStreamSchedule('aaa', { random: constantRandom(0.5) });
    const punctuation = buildAgentStreamSchedule('a，a', { random: constantRandom(0.5) });
    const newline = buildAgentStreamSchedule('a\na', { random: constantRandom(0.5) });
    const plainGap = gaps(plain)[1];
    expect(gaps(punctuation)[1]).toBeGreaterThan(plainGap);
    expect(gaps(newline)[1]).toBeGreaterThan(gaps(punctuation)[1]);
  });

  it('超长文本按总时长上限等比压缩', () => {
    const text = '一'.repeat(3000);
    const steps = buildAgentStreamSchedule(text, { maxDuration: 4000 });
    expect(steps).toHaveLength(3000);
    expect(steps[steps.length - 1].at).toBeLessThanOrEqual(4000);
    expect(steps[steps.length - 1].at).toBeGreaterThan(0);
  });
});
