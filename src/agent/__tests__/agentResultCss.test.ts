import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  path.resolve(__dirname, '../../components/styles/components/agent.css'),
  'utf8',
);

describe('Agent 侧栏加载态样式契约', () => {
  it('加载声波不额外增加左缩进，与正文左边缘对齐', () => {
    const alignRule =
      css.match(/\.agent-result-sidebar \.agent-result-header,[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(alignRule).toContain('--directory-tree-content-padding-x');
    expect(css).not.toMatch(
      /\.agent-result-sidebar \.agent-result-header\s*\{[\s\S]*?padding-left/,
    );
  });

  it('加载声波是连续单向波，且明显快于设置页图标', () => {
    expect(css).toMatch(
      /\.agent-result-busy \.agent-result-busy-wave \.model-settings-icon__bar\s*\{[\s\S]*?animation-name:\s*agent-loading-breathe;[\s\S]*?animation-duration:\s*1\.4s;[\s\S]*?animation-fill-mode:\s*backwards;/,
    );
    expect(css).toContain('@keyframes agent-loading-breathe');

    // 同周期 + 相位差：每根条只延迟 0.12s，波峰从左到右扫过。
    for (const delay of ['0s', '0.12s', '0.24s', '0.36s', '0.48s']) {
      expect(css).toContain(`animation-delay: ${delay};`);
    }
  });
});

describe('Agent 结果视图底部操作栏契约', () => {
  it('工具条采用 macOS 风格滚动边缘渐隐，胶囊保持玻璃质感', () => {
    const footer = css.match(/\.agent-result-footer\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(footer).toContain('position: absolute');
    expect(footer).toContain('height: 64px');

    // 内容延伸到工具条下方时才显示渐变遮罩
    expect(css).toMatch(
      /\.agent-result\.has-scroll-underlap \.agent-result-footer::before\s*\{\s*opacity:\s*1;/,
    );
    expect(css).toMatch(
      /\.agent-result-footer::before\s*\{[\s\S]*?linear-gradient\([\s\S]*?transparent 0%/,
    );
    expect(css).toMatch(
      /\.agent-result-sidebar \.agent-result-footer::before\s*\{[\s\S]*?var\(--sidebar\)/,
    );

    const pill = css.match(/\.agent-result-footer \.agent-result-actions\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(pill).toContain('border-radius: 999px');
    expect(pill).toContain('color-mix(in oklab, var(--popover) 82%, transparent)');
    expect(pill).toContain('backdrop-filter: blur(16px)');

    expect(css).not.toContain('is-scrolling');
    expect(css).not.toContain('has-scrolled-content');
    expect(css).not.toContain('.agent-result:hover .agent-result-footer');
    expect(css).not.toContain('.agent-result-footer.is-open');
  });

  it('悬浮块不再保留顶部标题栏样式', () => {
    expect(css).not.toContain('.agent-result-title');
  });

  it('正文底部预留工具条高度，最后一行停在渐变之外', () => {
    const rule = css.match(/\.agent-result-body\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(rule).toContain('padding: 10px 12px 72px;');
  });

  it('正文首末块不叠加外边距，四边留白不被撑大', () => {
    expect(css).toMatch(/\.agent-result-body :is\([^)]*\):first-child\s*\{\s*margin-top:\s*0;/);
    expect(css).toMatch(/\.agent-result-body :is\([^)]*\):last-child\s*\{\s*margin-bottom:\s*0;/);
  });
});
