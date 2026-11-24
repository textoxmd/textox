import { useMemo } from 'react';
import type { ComponentProps, MouseEvent } from 'react';
import { Streamdown, defaultRehypePlugins, type Components, type ExtraProps } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import 'streamdown/styles.css';
import { isClickableAgentLink } from './links';

export interface AgentMarkdownProps {
  source: string;
  isAnimating: boolean;
  onLinkClick: (href: string) => void;
}

/**
 * 刻意省略 raw：原始 HTML 按文本转义/丢弃，不执行。
 *
 * harden 默认用英文 indicator（`[blocked]` / `[Image blocked: …]`），且在
 * `components` 之前替换节点，`img: () => null` 拦不住；这里改成保留链接
 * 文字、直接移除图片，并关闭 data: 图片。
 */
const hardenEntry = defaultRehypePlugins.harden as unknown as [unknown, Record<string, unknown>];
const HARDEN_PLUGIN = [
  hardenEntry[0],
  {
    ...hardenEntry[1],
    linkBlockPolicy: 'text-only',
    imageBlockPolicy: 'remove',
    allowDataImages: false,
  },
] as never;
const SAFE_REHYPE_PLUGINS = [defaultRehypePlugins.sanitize, HARDEN_PLUGIN];
const PLUGINS = { cjk };

export function AgentMarkdown({ source, isAnimating, onLinkClick }: AgentMarkdownProps) {
  const components = useMemo<Components>(() => {
    const Link = ({ href, children, node: _node, ...props }: ComponentProps<'a'> & ExtraProps) => {
      const target = href?.trim();
      // 未闭合链接、相对链接与打开白名单外的协议都不呈现可点击性。
      if (!target || target === 'streamdown:incomplete-link' || !isClickableAgentLink(target)) {
        return <span>{children}</span>;
      }
      const handle = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onLinkClick(target);
      };
      return (
        <a
          {...props}
          href={target}
          // harden 会注入 target="_blank"；中键/修饰键会绕过 onClick，显式去掉。
          target={undefined}
          rel="noreferrer"
          data-streamdown="link"
          className={['wrap-anywhere', props.className].filter(Boolean).join(' ')}
          onClick={(event) => {
            if (event.button !== 0) return;
            handle(event);
          }}
          onAuxClick={(event) => {
            // 只有中键算「打开链接」；右键/后退/前进键不应拉起系统浏览器。
            if (event.button === 1) handle(event);
          }}
        >
          {children}
        </a>
      );
    };

    return {
      a: Link,
      // 模型输出不可信：图片一律不渲染，避免远程请求与追踪像素
      img: () => null,
    };
  }, [onLinkClick]);

  return (
    <Streamdown
      className="agent-streamdown"
      mode="streaming"
      dir="auto"
      parseIncompleteMarkdown
      isAnimating={isAnimating}
      controls={false}
      lineNumbers={false}
      rehypePlugins={SAFE_REHYPE_PLUGINS}
      components={components}
      plugins={PLUGINS}
    >
      {source}
    </Streamdown>
  );
}
