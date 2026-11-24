import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string): Promise<void> => {}),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

import { isClickableAgentLink, openAgentLink } from '../links';

beforeEach(() => {
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
});

describe('openAgentLink', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/a', 'http://example.com/a'],
    ['mailto:help@example.com', 'mailto:help@example.com'],
  ])('放行 %s', (href, expected) => {
    openAgentLink(href);

    expect(openUrl).toHaveBeenCalledWith(expected);
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'http://[invalid'])(
    '拒绝 %s',
    (href) => {
      openAgentLink(href);

      expect(openUrl).not.toHaveBeenCalled();
    },
  );

  it('openUrl 失败通过 catch 吞掉', () => {
    const catchSpy = vi.fn();
    openUrl.mockReturnValueOnce({ catch: catchSpy } as unknown as Promise<void>);

    openAgentLink('https://example.com');

    expect(catchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['#anchor', '/docs', 'foo.md', '//evil.example/x'])(
    '忽略相对链接 %s（桌面 WebView 没有可靠目标）',
    (href) => {
      openAgentLink(href);

      expect(openUrl).not.toHaveBeenCalled();
    },
  );
});

describe('isClickableAgentLink', () => {
  it.each(['https://example.com', 'mailto:a@b.co'])('可点击 %s', (href) => {
    expect(isClickableAgentLink(href)).toBe(true);
  });

  it.each(['tel:+123', 'irc://server/chan', 'xmpp:a@b', 'javascript:alert(1)', '#anchor', '/docs'])(
    '不可点击 %s',
    (href) => {
      expect(isClickableAgentLink(href)).toBe(false);
    },
  );
});
