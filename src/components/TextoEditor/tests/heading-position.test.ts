import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser';
import { findHeadingPosition } from '../src/outline';

/** 断言位置处确实是标题，并返回其文本。 */
function headingTextAt(md: string, pos: number | null): string | null {
  if (pos == null) return null;
  const node = parse(md).nodeAt(pos);
  expect(node?.type.name).toBe('heading');
  return node!.textContent;
}

/** 文档中所有标题的位置（按出现顺序）。 */
function headingPositions(md: string): number[] {
  const positions: number[] = [];
  parse(md).descendants((node, pos) => {
    if (node.type.name === 'heading') positions.push(pos);
    return true;
  });
  return positions;
}

describe('findHeadingPosition', () => {
  it('原文精确命中优先于更早的包含匹配', () => {
    const md = '# B 前缀\n\n# B\n';
    const doc = parse(md);
    const positions = headingPositions(md);
    // 第一个标题“包含” B，第二个才“等于” B：必须命中第二个。
    expect(findHeadingPosition(doc, 'B')).toBe(positions[1]);
    expect(headingTextAt(md, findHeadingPosition(doc, 'B'))).toBe('B');
  });

  it('原文精确命中优先于规范化命中', () => {
    // 第一个标题规范化后也是 "a l end"，但原文不同；第二个标题原文就是查询文本。
    const md = '# a [l][r] end\n\n[r]: https://x\n\n# a l end\n';
    const doc = parse(md);
    const positions = headingPositions(md);
    expect(positions).toHaveLength(2);
    expect(findHeadingPosition(doc, 'a l end')).toBe(positions[1]);
  });

  it('规范化匹配参考式链接（扫描侧原文 vs 编辑器规范化文本）', () => {
    const md = '# a [l][r] end\n\n[r]: https://x\n';
    const doc = parse(md);
    const pos = findHeadingPosition(doc, 'a [l][r] end');
    expect(pos).not.toBeNull();
    expect(doc.nodeAt(pos!)?.type.name).toBe('heading');
    // 解析器把参考式链接规范化成行内形式，扫描侧原文因此匹配不上原文分支。
    expect(doc.nodeAt(pos!)?.textContent).toBe('a [l](https://x) end');
  });

  it('包含匹配兜底（规范化后）', () => {
    const md = '# B 后缀\n';
    expect(headingTextAt(md, findHeadingPosition(parse(md), 'B'))).toBe('B 后缀');
  });

  it('规范化包含兜底：文档侧是行内链接，查询侧是参考式原文前缀', () => {
    const md = '# a [l](https://x) end\n';
    const doc = parse(md);
    const pos = findHeadingPosition(doc, 'a l');
    expect(pos).not.toBeNull();
    expect(doc.nodeAt(pos!)?.type.name).toBe('heading');
    expect(doc.nodeAt(pos!)?.textContent).toBe('a [l](https://x) end');
  });

  it('规范化匹配快捷引用链接（[l] + 定义）', () => {
    const md = '# a [l] end\n\n[l]: https://x\n';
    const doc = parse(md);
    const pos = findHeadingPosition(doc, 'a [l] end');
    expect(pos).not.toBeNull();
    // 解析器同样把快捷引用规范化为行内形式。
    expect(doc.nodeAt(pos!)?.textContent).toBe('a [l](https://x) end');
  });

  it('规范化匹配目标 URL 含单层括号的参考式链接', () => {
    const md = '# a [l][r] end\n\n[r]: https://x/Foo_(bar)\n';
    const doc = parse(md);
    const pos = findHeadingPosition(doc, 'a [l][r] end');
    expect(pos).not.toBeNull();
    expect(doc.nodeAt(pos!)?.textContent).toBe('a [l](https://x/Foo_(bar)) end');
  });

  it('规范化匹配标签内带转义的参考式链接', () => {
    const md = '# a [l\\]x][r] end\n\n[r]: https://x\n';
    const doc = parse(md);
    const pos = findHeadingPosition(doc, 'a [l\\]x][r] end');
    expect(pos).not.toBeNull();
    expect(doc.nodeAt(pos!)?.textContent).toBe('a [l\\]x](https://x) end');
  });

  it('空查询返回 null（即使文档里有空标题）', () => {
    const doc = parse('# A\n\n#\n');
    expect(findHeadingPosition(doc, '')).toBeNull();
    expect(findHeadingPosition(doc, '   ')).toBeNull();
  });

  it('完全不匹配时返回 null', () => {
    const md = '# A\n\n# B\n';
    expect(findHeadingPosition(parse(md), 'zzz')).toBeNull();
  });

  it('同名标题取第一个（已知限制）', () => {
    const md = '# X\n\n# X\n';
    const positions = headingPositions(md);
    expect(positions).toHaveLength(2);
    expect(findHeadingPosition(parse(md), 'X')).toBe(positions[0]);
  });
});
