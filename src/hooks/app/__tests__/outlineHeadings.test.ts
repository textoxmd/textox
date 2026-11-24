import { describe, expect, it } from 'vitest';
import { filterHeadings } from '@/hooks/useOutline';
import { toOutlineHeadings, withDisplayText } from '../useOutlineState';

describe('toOutlineHeadings', () => {
  it('保留 pos：窗口内标题可直接按 ProseMirror 位置跳转', () => {
    const headings = toOutlineHeadings([
      { level: 1, text: '第一章', line: 1, pos: 4 },
      { level: 2, text: '1.1', line: 12, pos: 96 },
    ]);

    expect(headings).toEqual([
      { id: 'heading-0', level: 1, text: '第一章', pos: 4, line: 1 },
      { id: 'heading-1', level: 2, text: '1.1', pos: 96, line: 12 },
    ]);
  });

  it('缺失 pos 的尾部标题标记为 -1（交给 revealHeadingRef 补窗）', () => {
    const headings = toOutlineHeadings([
      { level: 1, text: '窗口内', line: 3, pos: 0 },
      { level: 1, text: '未加载的尾部章节', line: 820 },
    ]);

    expect(headings[0]!.pos).toBe(0);
    expect(headings[1]!.pos).toBe(-1);
    expect(headings[1]!.line).toBe(820);
  });

  it('缺 pos 的标题保持在原文顺序并标记为 -1', () => {
    const merged = [
      { level: 1, text: 'A', line: 1, pos: 0 },
      { level: 1, text: 'B', line: 40, pos: 210 },
      { level: 2, text: 'C（无 pos）', line: 130 },
    ];

    const headings = toOutlineHeadings(merged);

    expect(headings.map((h) => h.text)).toEqual(['A', 'B', 'C（无 pos）']);
    expect(headings.map((h) => h.line)).toEqual([1, 40, 130]);
    expect(headings.map((h) => h.pos)).toEqual([0, 210, -1]);
  });

  it('空列表返回空数组', () => {
    expect(toOutlineHeadings([])).toEqual([]);
  });
});

describe('withDisplayText', () => {
  it('保留原始 text 并派生可见文本', () => {
    expect(
      withDisplayText([{ level: 1, text: '**粗体**', line: 1, pos: 4 }]),
    ).toEqual([
      { level: 1, text: '**粗体**', line: 1, pos: 4, displayText: '粗体' },
    ]);
  });
});

describe('toOutlineHeadings displayText', () => {
  it('透传 displayText，同时保留 text / pos / line', () => {
    const headings = toOutlineHeadings([
      { level: 1, text: '**Bold**', line: 1, pos: 4, displayText: 'Bold' },
    ]);

    expect(headings).toEqual([
      {
        id: 'heading-0',
        level: 1,
        text: '**Bold**',
        displayText: 'Bold',
        pos: 4,
        line: 1,
      },
    ]);
  });

  it('源项没有 displayText 时不写该字段', () => {
    const [heading] = toOutlineHeadings([
      { level: 1, text: 'Plain', line: 1, pos: 4 },
    ]);

    expect(heading).not.toHaveProperty('displayText');
  });
});

describe('filterHeadings displayText', () => {
  const headings = toOutlineHeadings([
    { level: 1, text: '**Bold**', line: 1, pos: 4, displayText: 'Bold' },
    { level: 1, text: '*Italic*', line: 2, pos: 20, displayText: 'Italic' },
  ]);

  it('按可见文本命中', () => {
    expect(filterHeadings(headings, 'bold').map((h) => h.text)).toEqual([
      '**Bold**',
    ]);
  });

  it('不再按语法标记命中', () => {
    expect(filterHeadings(headings, '**')).toEqual([]);
  });

  it('空搜索词返回全部', () => {
    expect(filterHeadings(headings, '')).toHaveLength(2);
  });
});
