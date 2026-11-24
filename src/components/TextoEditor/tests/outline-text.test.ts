import { describe, expect, test } from 'vitest';

import { outlinePlainText } from '../src/outline-text.ts';

describe('outlinePlainText', () => {
  test.each([
    ['**粗体**', '粗体'],
    ['*斜体*', '斜体'],
    ['_斜体_', '斜体'],
    ['`code`', 'code'],
    ['[链接](https://x)', '链接'],
    ['![图](a.png)', '图'],
    ['~~删除~~', '删除'],
    ['\\*x*', '*x*'],
    ['**a *b* c**', 'a b c'],
    ['<https://x.y>', 'https://x.y'],
    ['$x^2$', 'x^2'],
    [':smile:', '😄'],
    ['<u>下划线</u>', '下划线'],
    ['~sub~', 'sub'],
    ['^sup^', 'sup'],
    ['==高亮==', '高亮'],
    ['**未闭合', '**未闭合'],
    ['[](url)', ''],
    ['', ''],
    ['<script>alert(1)</script>', '<script>alert(1)</script>'],
    ['x[^1]', 'x1'],
    ['x[^1] y[^2]', 'x1 y2'],
    ['**:smile:**', '😄'],
    [':smile: tail', '😄 tail'],
    ['\\::smile:', ':😄'],
    ['[a][ref]', '[a][ref]'],
    ['![alt][img]', '![alt][img]'],
  ])('%j → %j', (raw, expected) => {
    expect(outlinePlainText(raw)).toBe(expected);
  });

  test('removes multiple independent markers in one heading', () => {
    expect(outlinePlainText('**a** and `b`')).toBe('a and b');
  });

  test('keeps code span content literal', () => {
    expect(outlinePlainText('`**x**`')).toBe('**x**');
  });

  test('caches by raw text without changing the result', () => {
    expect(outlinePlainText('**缓存**')).toBe('缓存');
    expect(outlinePlainText('**缓存**')).toBe('缓存');
  });
});
