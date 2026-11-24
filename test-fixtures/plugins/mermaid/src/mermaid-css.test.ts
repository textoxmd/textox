import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// happy-dom 以 DOM URL 替换了全局 URL（相对路径会按 location 解析成 http），
// 因此用 node:url 的 fileURLToPath 直接处理 import.meta.url。
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'mermaid.css');
const css = readFileSync(cssPath, 'utf8');

describe('mermaid.css', () => {
  it('--pele-* 映射挂在 :root 作用域（克隆 DOM 也能继承）', () => {
    const start = css.indexOf(':root {');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('}', start);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);

    expect(block).toContain('--pele-bg:');
    expect(block).toContain('--pele-fg:');
    // 只挂在 .mermaid-preview 时，放大浮层/克隆 DOM 会回落到浅色。
    expect(css).not.toContain('.mermaid-preview {');
  });

  it('--pele-font 跟随编辑器正文字体（与测宽字体一致）', () => {
    expect(css).toContain('--pele-font: var(--editor-font-family-base');
    // 指回 UI 字体会让「按编辑器字体测宽、按 UI 字体显示」。
    expect(css).not.toContain('--pele-font: var(--font-sans');
  });

  it('--pele-font-mono 映射到等宽字体 token', () => {
    expect(css).toContain('--pele-font-mono: var(--font-mono');
  });

  it('映射 Pele 支持的全部 8 个系列色', () => {
    for (let index = 1; index <= 8; index += 1) {
      expect(css, `缺少 --pele-series-${index}`).toContain(`--pele-series-${index}:`);
    }
  });
});
