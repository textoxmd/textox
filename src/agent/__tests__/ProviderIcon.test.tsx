import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentProviderId } from '../config';
import { ProviderIcon } from '../ProviderIcon';

function render(provider: AgentProviderId): string {
  return renderToStaticMarkup(createElement(ProviderIcon, { provider }));
}

describe('ProviderIcon', () => {
  it('openai 用官方图形（256×260 视区）', () => {
    const markup = render('openai');

    expect(markup).toContain('<svg');
    expect(markup).toContain('viewBox="0 0 256 260"');
    expect(markup).toContain('fill="currentColor"');
  });

  it('deepseek 用官方鲸鱼图形（24×24 视区，颜色跟随主题）', () => {
    const markup = render('deepseek');

    expect(markup).toContain('<svg');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toContain('#5786FE');
  });

  it('anthropic 用字母标而不是 OpenAI 图形', () => {
    const markup = render('anthropic');

    expect(markup).toContain('data-provider="anthropic"');
    expect(markup).not.toContain('data-provider="openai"');
    expect(markup).not.toContain('viewBox="0 0 256 260"');
    // 字母标：圆角方块 + 居中字母（SVG <text> 里就是纯文本 A）。
    expect(markup).toContain('>A</text>');
    expect(markup).toContain('currentColor');
  });

  it('custom 没有品牌图形，用 lucide Cpu 兜底', () => {
    const markup = render('custom');

    expect(markup).toContain('<svg');
    expect(markup).toContain('data-provider="custom"');
    // lucide 图标没有自带 viewBox 之外的品牌标识，这里只确认是 svg。
    expect(markup).not.toContain('<path d="M239.184');
  });
});
