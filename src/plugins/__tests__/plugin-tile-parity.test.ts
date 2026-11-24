import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as csstree from 'css-tree';

/**
 * 回归守卫：插件中心的紧凑方块（`.plugin-tile`）与设置向导「插件模式」步骤的
 * 方块（`.plugin-mode-tile`）必须**参数一致**。
 *
 * 两处选择器名字不同、代码也分属两个文件，只有注释约束「改动时同步两处」——
 * 注释无法阻止漂移，这里用双文件解析逐项对拍兜底：任何一侧改了尺寸 / 圆角 /
 * 边框 / 底色 / hover / 过渡 / 漂浮 / 入场曲线，测试都会指出是哪一对的哪个属性。
 *
 * 引导页是参照系（不要为了过测试改 onboarding.css，改 settings.css 对齐）。
 *
 * 注意：这是**文本级对拍**——量的是声明值的字符串，不是语义。语义等价但写法不同
 * 也会失败：`8px` vs `var(--space-2)`、`-3px` vs `calc(-3px)`、`0.22` vs `.22`。
 * 唯一的归一化是空白/逗号排版与选择器组合符空格（纯排版）；发现差异应改
 * settings.css 去对齐引导页写法，而不是放宽断言。
 */
const onboardingCssPath = path.resolve(
  __dirname,
  '../../components/Onboarding/onboarding.css',
);
const settingsCssPath = path.resolve(
  __dirname,
  '../../components/styles/components/settings.css',
);

const onboardingAst = csstree.parse(readFileSync(onboardingCssPath, 'utf8'));
const settingsAst = csstree.parse(readFileSync(settingsCssPath, 'utf8'));

/** 值归一化：压缩空白（多行声明 / 逗号后换行），去掉尾分号。 */
function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
}

/** 选择器归一化：压缩空白、去掉组合符两侧空白，便于书写时不用迁就生成格式。 */
function normalizeSelector(selector: string): string {
  return selector
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 一个 block 内 declaration 的属性 → 归一化值。 */
function blockDeclarations(block: csstree.CssNode): Map<string, string> {
  const map = new Map<string, string>();
  block.children.forEach((child: csstree.CssNode) => {
    if (child.type !== 'Declaration') return;
    map.set(
      String(child.property).toLowerCase(),
      normalizeValue(csstree.generate(child.value)),
    );
  });
  return map;
}

/**
 * 顶层规则里某选择器的 属性 → 值。
 *
 * 只遍历样式表的**顶层** children，不下钻 `@media`：`prefers-reduced-motion`
 * 块里存在同名选择器（如 `.plugin-tile:hover { transform: none }`），若一并收集
 * 会覆盖基样式，导致与引导页的对比出现假失败。
 */
function declarationsFor(ast: csstree.CssNode, selector: string): Map<string, string> {
  const wanted = normalizeSelector(selector);
  let map = new Map<string, string>();
  ast.children.forEach((node: csstree.CssNode) => {
    if (node.type !== 'Rule') return;
    const prelude = node.prelude ? csstree.generate(node.prelude) : '';
    if (normalizeSelector(prelude) !== wanted) return;
    map = new Map([...map, ...blockDeclarations(node.block)]);
  });
  return map;
}

/** 关键帧帧选择器 → 声明（帧选择器归一化为 `0%,100%` 形式）。 */
function framesFor(ast: csstree.CssNode, keyframesName: string): Map<string, Map<string, string>> {
  const frames = new Map<string, Map<string, string>>();
  ast.children.forEach((node: csstree.CssNode) => {
    if (node.type !== 'Atrule' || node.name !== 'keyframes') return;
    const prelude = node.prelude ? csstree.generate(node.prelude).trim() : '';
    if (prelude !== keyframesName || !node.block) return;
    node.block.children.forEach((frame: csstree.CssNode) => {
      if (frame.type !== 'Rule') return;
      const frameSelector = csstree
        .generate(frame.prelude)
        .replace(/,\s*/g, ',')
        .trim();
      frames.set(frameSelector, blockDeclarations(frame.block));
    });
  });
  return frames;
}

/**
 * `@media (prefers-reduced-motion: reduce)` 内的选择器 → 声明。
 *
 * 该块里存在逗号分组规则（`.plugin-center--animated .plugin-row,
 * .plugin-center--animated .plugin-tile, .plugin-tile-icon { animation: none }`），
 * 因此按选择器列表拆开逐个登记，而不是整串匹配。
 */
function reducedMotionDeclarations(ast: csstree.CssNode): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  ast.children.forEach((node: csstree.CssNode) => {
    if (node.type !== 'Atrule' || node.name !== 'media' || !node.prelude || !node.block) return;
    // css-tree 生成的 prelude 是 `(prefers-reduced-motion:reduce)`（冒号后无空格）。
    const query = normalizeValue(csstree.generate(node.prelude)).replace(/\s*:\s*/g, ':');
    if (query !== '(prefers-reduced-motion:reduce)') return;
    node.block.children.forEach((child: csstree.CssNode) => {
      if (child.type !== 'Rule') return;
      const decls = blockDeclarations(child.block);
      csstree
        .generate(child.prelude)
        .split(',')
        .map((sel) => normalizeSelector(sel))
        .forEach((sel) => out.set(sel, new Map([...(out.get(sel) ?? []), ...decls])));
    });
  });
  return out;
}

interface SelectorPair {
  onboarding: string;
  settings: string;
  properties: string[];
}

/**
 * 名字不同、参数必须相同的选择器对。
 *
 * `.plugin-tile:hover svg` 在插件中心已收紧为 `.plugin-tile-icon > svg`（图标层
 * 直接子级，防内部嵌套 svg 时缩放叠加），此处按收紧后的实际选择器取证。
 */
const selectorPairs: SelectorPair[] = [
  {
    onboarding: '.plugin-mode-grid',
    settings: '.plugin-grid',
    properties: ['grid-template-columns', 'gap'],
  },
  {
    onboarding: '.plugin-mode-tile',
    settings: '.plugin-tile',
    properties: [
      'display',
      'align-items',
      'justify-content',
      'aspect-ratio',
      'overflow',
      'border',
      'border-radius',
      'background',
      'transition',
    ],
  },
  {
    // 引导页把主色写在 svg 上，插件中心写在方块上靠继承（svg 用 currentColor）；
    // 位置不同但值必须相同。
    onboarding: '.plugin-mode-tile svg',
    settings: '.plugin-tile',
    properties: ['color'],
  },
  {
    onboarding: '.plugin-mode-tile:hover',
    settings: '.plugin-tile:hover',
    properties: ['transform', 'border-color', 'background', 'box-shadow'],
  },
  {
    onboarding: '.plugin-mode-tile:hover svg',
    settings: '.plugin-tile:hover .plugin-tile-icon > svg',
    properties: ['transform'],
  },
  {
    // 基础缩放过渡：hover 放大取 0.16s 缓动，缺了它就是瞬间跳变。
    onboarding: '.plugin-mode-tile svg',
    settings: '.plugin-tile-icon > svg',
    properties: ['transition'],
  },
  {
    onboarding: '.plugin-mode-tile-icon',
    settings: '.plugin-tile-icon',
    properties: ['display', 'align-items', 'justify-content'],
  },
];

describe('plugin tile parity: onboarding vs plugin center', () => {
  describe.each(selectorPairs)('$onboarding ↔ $settings', ({ onboarding, settings, properties }) => {
    const onboardingDecls = declarationsFor(onboardingAst, onboarding);
    const settingsDecls = declarationsFor(settingsAst, settings);

    it('两侧规则都存在（防止选择器改名后静默跳过）', () => {
      expect(onboardingDecls.size, `onboarding.css 缺少规则：${onboarding}`).toBeGreaterThan(0);
      expect(settingsDecls.size, `settings.css 缺少规则：${settings}`).toBeGreaterThan(0);
    });

    for (const property of properties) {
      it(property, () => {
        const expected = onboardingDecls.get(property);
        const actual = settingsDecls.get(property);
        expect(expected, `onboarding.css 的 ${onboarding} 缺少 ${property}`).toBeDefined();
        expect(actual, `settings.css 的 ${settings} 缺少 ${property}`).toBeDefined();
        expect(
          actual,
          `参数不一致：${settings} 的 ${property} 必须与 ${onboarding} 相同`,
        ).toBe(expected);
      });
    }
  });

  describe.each([
    ['plugin-mode-tile-float', 'plugin-tile-float'],
    ['plugin-mode-tile-in', 'plugin-tile-in'],
  ])('keyframes %s ↔ %s', (onboardingName, settingsName) => {
    const onboardingFrames = framesFor(onboardingAst, onboardingName);
    const settingsFrames = framesFor(settingsAst, settingsName);

    it('帧与逐帧声明值都相同', () => {
      expect(onboardingFrames.size, `onboarding.css 缺少 @keyframes ${onboardingName}`).toBeGreaterThan(0);
      expect(settingsFrames.size, `settings.css 缺少 @keyframes ${settingsName}`).toBeGreaterThan(0);

      const onboardingKeys = [...onboardingFrames.keys()].sort();
      const settingsKeys = [...settingsFrames.keys()].sort();
      expect(settingsKeys, `@keyframes ${settingsName} 的帧必须与 ${onboardingName} 相同`).toEqual(
        onboardingKeys,
      );

      for (const frame of onboardingKeys) {
        const expected = Object.fromEntries(onboardingFrames.get(frame) ?? []);
        const actual = Object.fromEntries(settingsFrames.get(frame) ?? []);
        expect(
          actual,
          `@keyframes ${settingsName} 的 ${frame} 帧声明必须与 ${onboardingName} 相同`,
        ).toEqual(expected);
      }
    });
  });

  it('.plugin-tile 基样式不得声明 animation（入场只能由 .plugin-center--animated 门控）', () => {
    expect(declarationsFor(settingsAst, '.plugin-tile').has('animation')).toBe(false);
  });

  describe('动画 shorthand（替换 keyframes 名后整串相等）', () => {
    /** 把各自的 keyframes 名换成 `<kf>`：名字允许不同，其余 token 必须逐字相同。 */
    function withNeutralKeyframesName(value: string, keyframesName: string): string {
      return value.replace(keyframesName, '<kf>');
    }

    it('入场：时长 / 曲线 / 填充模式一致', () => {
      const onboardingAnimation = declarationsFor(onboardingAst, '.plugin-mode-tile').get('animation');
      const settingsAnimation = declarationsFor(
        settingsAst,
        '.plugin-center--animated .plugin-tile',
      ).get('animation');

      expect(onboardingAnimation, 'onboarding.css 的 .plugin-mode-tile 缺少 animation').toBeDefined();
      expect(
        settingsAnimation,
        'settings.css 的 .plugin-center--animated .plugin-tile 缺少 animation',
      ).toBeDefined();

      // 引导页的 `+0.7s` 偏移在独立的 animation-delay 声明里，不在 shorthand 内，
      // 所以这里可以整串比较（同时覆盖时长 0.34s 与 cubic-bezier 曲线）。
      expect(
        withNeutralKeyframesName(settingsAnimation!, 'plugin-tile-in'),
        `入场动画 shorthand 不一致：引导页 ${onboardingAnimation} / 插件中心 ${settingsAnimation}`,
      ).toBe(withNeutralKeyframesName(onboardingAnimation!, 'plugin-mode-tile-in'));
    });

    it('漂浮：时长默认值 / 缓动 / 延迟变量 / 次数一致', () => {
      const onboardingAnimation = declarationsFor(onboardingAst, '.plugin-mode-tile-icon').get(
        'animation',
      );
      const settingsAnimation = declarationsFor(settingsAst, '.plugin-tile-icon').get('animation');

      expect(
        onboardingAnimation,
        'onboarding.css 的 .plugin-mode-tile-icon 缺少 animation',
      ).toBeDefined();
      expect(settingsAnimation, 'settings.css 的 .plugin-tile-icon 缺少 animation').toBeDefined();

      expect(
        withNeutralKeyframesName(settingsAnimation!, 'plugin-tile-float'),
        `漂浮动画 shorthand 不一致：引导页 ${onboardingAnimation} / 插件中心 ${settingsAnimation}`,
      ).toBe(withNeutralKeyframesName(onboardingAnimation!, 'plugin-mode-tile-float'));
    });
  });

  describe('prefers-reduced-motion 兜底', () => {
    const reducedMotion = reducedMotionDeclarations(settingsAst);

    it.each([
      ['.plugin-tile-icon', 'animation', 'none'],
      ['.plugin-tile:hover', 'transform', 'none'],
      ['.plugin-tile:hover .plugin-tile-icon > svg', 'transform', 'none'],
    ])('reduced-motion 块里 %s 必须声明 %s: %s', (selector, property, expected) => {
      const decls = reducedMotion.get(normalizeSelector(selector));
      expect(decls, `settings.css 的 prefers-reduced-motion 块缺少选择器：${selector}`).toBeDefined();
      expect(
        decls!.get(property),
        `settings.css 的 prefers-reduced-motion 块里 ${selector} 必须声明 ${property}: ${expected}`,
      ).toBe(expected);
    });
  });
});
