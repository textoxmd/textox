import { describe, expect, it } from 'vitest';
import { truncateExcerpt } from '../src/excerpt';

describe('truncateExcerpt 与 CRLF', () => {
  it('摘要不含 CRLF 的 \\r', () => {
    const md = 'a\r\n\r\nb'.repeat(50);
    const excerpt = truncateExcerpt(md);
    expect(excerpt).not.toContain('\r');
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('长文本在块边界截断后以省略号结尾', () => {
    const md = `${'段落'.repeat(50)}\r\n\r\n${'b'.repeat(200)}`;
    const excerpt = truncateExcerpt(md);
    expect(excerpt).not.toContain('\r');
    expect(excerpt.endsWith('…')).toBe(true);
    // 在空行处截断，不把下一块内容带进摘要。
    expect(excerpt).not.toContain('\n\n');
    expect(excerpt).not.toContain('bbb');
  });
});
