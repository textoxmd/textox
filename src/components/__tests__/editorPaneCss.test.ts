import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { PANE_TRANSITION_MS } from '@/components/TextoEditor/src/panes/usePaneTransition';

// CSS 契约测试。happy-dom 不做真实布局，样式错在这里就是"改错了也测不出来"，
// 因此直接对编辑器样式表做文本断言——重点是守住两条不能破的约定：
//   ① 稳态（非过渡相位）非活动 pane 必须 display:none，否则窗口缩放 / 主题切换 /
//      字体变化都要为两个编辑器付双份重排，而且肉眼看不出来；
//   ② 没有任何 .editor-pane 规则能在过渡相位之外引入 transition / will-change /
//      transform —— transform 常驻会额外建立 fixed 包含块与层叠上下文。

const cssPath = path.resolve(__dirname, '../styles/components/editor.css');
const raw = readFileSync(cssPath, 'utf8');

interface Rule {
  selector: string;
  body: string;
  /** 外层 at-rule（如 `@media (prefers-reduced-motion: reduce)`），顶层为空串。 */
  at: string;
}

/** 极简 CSS 解析：按大括号深度切出"选择器 + 声明块"，at-rule 外壳保留在 `at` 上。 */
function parseRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const stack: string[] = [];
  let buf = '';
  for (const ch of src) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      const selector = stack.pop() ?? '';
      const at = stack[stack.length - 1] ?? '';
      if (selector && !selector.startsWith('@')) rules.push({ selector, body: buf, at });
      buf = '';
    } else {
      buf += ch;
    }
  }
  return rules;
}

/** 相位规则的选择器带有值（`[data-pane-transition='run']`），不能匹配闭合方括号。 */
const PHASE_MARKER = '[data-pane-transition';

const rules = parseRules(raw);
const paneRules = rules.filter((r) => /\.editor-pane\b/.test(r.selector));

describe('editor.css · 编辑模式转场契约', () => {
  it('存在 .editor-pane 基础规则，且默认 display: none', () => {
    const base = rules.find((r) => r.selector.trim() === '.editor-pane');
    expect(base, '缺少 .editor-pane 基础规则').toBeTruthy();
    expect(base!.body).toMatch(/display:\s*none/);
  });

  it('.editor-panes 是定位容器，且用 clip（而非可滚动的 hidden）裁掉平移出去的内容', () => {
    const panes = rules.find((r) => r.selector.trim() === '.editor-panes');
    expect(panes, '缺少 .editor-panes 规则').toBeTruthy();
    expect(panes!.body).toMatch(/position:\s*relative/);
    // clip = 裁掉但不产生滚动容器。用 hidden 时它仍是可滚动容器：过渡期间屏外那层
    // 被 focus() / scrollIntoView 带进视野时，浏览器会横向滚动整个容器再被夹回来，
    // 表现为切换到源码模式时的抖动。
    expect(panes!.body).toMatch(/overflow:\s*clip/);
    expect(panes!.body).not.toMatch(/overflow:\s*hidden/);
  });

  it('transition / will-change 只出现在过渡相位选择器下', () => {
    const leaked = paneRules
      .filter((r) => !r.selector.includes(PHASE_MARKER))
      .filter((r) => /(^|[^-])transition\s*:/.test(r.body) || /will-change/.test(r.body));
    expect(leaked.map((r) => r.selector)).toEqual([]);
  });

  it('transform / opacity 只在过渡相位生效（避免常驻建立 fixed 包含块）', () => {
    const leaked = paneRules
      .filter((r) => !r.selector.includes(PHASE_MARKER))
      .filter((r) => /(^|[^-])transform\s*:/.test(r.body) || /(^|[^-])opacity\s*:/.test(r.body));
    expect(leaked.map((r) => r.selector)).toEqual([]);
  });

  it('纯平移长带：任何 .editor-pane 规则都不声明 opacity（不做淡入淡出）', () => {
    const withOpacity = paneRules.filter((r) => /(^|[^-])opacity\s*:/.test(r.body));
    expect(withOpacity.map((r) => r.selector)).toEqual([]);
  });

  it('RTL 下位移方向镜像', () => {
    const panes = rules.find((r) => r.selector.trim() === '.editor-panes');
    expect(panes!.body).toContain('--pane-off: 100%');
    const rtl = rules.find((r) => r.selector.includes('editor-content-rtl'));
    expect(rtl, '缺少 RTL 镜像规则').toBeTruthy();
    expect(rtl!.body).toContain('--pane-off: -100%');
  });

  it('run 相位的时长与 hook 常量一致，且只过渡 transform（纯平移，无淡入淡出）', () => {
    const runRules = paneRules.filter((r) => r.selector.includes(PHASE_MARKER) && r.selector.includes('run'));
    expect(runRules.length, '缺少 run 相位规则').toBeGreaterThan(0);
    const body = runRules.map((r) => r.body).join('\n');
    expect(body).toContain(`${PANE_TRANSITION_MS}ms`);
    // 平移（轮播）长带：两页边对边整体滑动，不做透明度淡化。
    expect(body).toMatch(/transition:\s*transform/);
    expect(body).not.toMatch(/opacity/);
  });

  it('reduced-motion 下关掉过渡', () => {
    const reduced = rules.filter((r) => r.at.includes('prefers-reduced-motion'));
    expect(reduced.length, '缺少 prefers-reduced-motion 覆盖').toBeGreaterThan(0);
    const body = reduced.map((r) => r.body).join('\n');
    expect(body).toMatch(/transition:\s*none/);
  });
});
