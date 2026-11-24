import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as csstree from 'css-tree';

/**
 * 回归守卫：插件中心「禁用态置灰」不得被逐项入场动画覆盖。
 *
 * 背景（曾经的 BUG）：`plugin-item-in` keyframes 把 `opacity` 由 0 动到 1，
 * 且 `animation ... both` 会永久保留最后一帧 `opacity: 1`。CSS 级联中动画
 * 声明优先级高于普通作者声明，于是内部切换（进入二级页 / 切视图）启用动画后，
 * `.plugin-row[data-disabled="true"] { opacity: 0.6 }` 被覆盖，禁用插件不再置灰
 * （插件功能上仍禁用）。
 *
 * 不变量：禁用态用于「变暗」的属性，不能同时是入场动画所驱动的属性。
 */
const cssPath = path.resolve(
  __dirname,
  '../../components/styles/components/settings.css',
);
const ast = csstree.parse(readFileSync(cssPath, 'utf8'));

/** 入场动画实际驱动的 CSS 属性名（小写）。 */
function propertiesAnimatedBy(keyframesName: string): Set<string> {
  const props = new Set<string>();
  csstree.walk(ast, {
    visit: 'Atrule',
    enter(node: csstree.CssNode) {
      if (node.name !== 'keyframes') return;
      const prelude = node.prelude ? csstree.generate(node.prelude).trim() : '';
      if (prelude !== keyframesName) return;
      csstree.walk(node.block, {
        visit: 'Declaration',
        enter(decl: csstree.CssNode) {
          props.add(String(decl.property).toLowerCase());
        },
      });
    },
  });
  return props;
}

/** 某个选择器规则里声明的属性 → 值（小写属性名）。 */
function declarationsFor(selector: string): Map<string, string> {
  const map = new Map<string, string>();
  csstree.walk(ast, {
    visit: 'Rule',
    enter(node: csstree.CssNode) {
      const prelude = node.prelude ? csstree.generate(node.prelude) : '';
      if (prelude.trim() !== selector) return;
      node.block.children.forEach((child: csstree.CssNode) => {
        if (child.type === 'Declaration') {
          map.set(String(child.property).toLowerCase(), csstree.generate(child.value));
        }
      });
    },
  });
  return map;
}

describe('plugin center disabled dimming vs entry animation', () => {
  const animated = propertiesAnimatedBy('plugin-item-in');
  const tileAnimated = propertiesAnimatedBy('plugin-tile-in');

  it('入场动画确实驱动了 opacity（回归前提）', () => {
    expect(animated.has('opacity')).toBe(true);
    expect(tileAnimated.has('opacity')).toBe(true);
  });

  /** 置灰选择器不得使用入场动画所驱动的属性（如 opacity），否则动画期间会被覆盖。 */
  function expectDimmingNotOverridden(selector: string, animatedProps: Set<string>) {
    const decls = declarationsFor(selector);
    // 该选择器必须真的定义了置灰效果。
    expect(decls.size, `${selector} 必须存在且有声明`).toBeGreaterThan(0);

    // 变暗所用属性若与动画驱动的属性重合（如 opacity），动画的 forwards/both
    // 填充会把它覆盖掉——正是曾经的 BUG。
    const conflicting = [...decls.keys()].filter((prop) => animatedProps.has(prop));
    expect(conflicting, `${selector} 的置灰属性与入场动画冲突`).toEqual([]);
  }

  it('列表行的置灰属性不被入场动画覆盖', () => {
    expectDimmingNotOverridden('.plugin-row[data-disabled="true"]', animated);
  });

  it('紧凑方块的置灰属性不被 plugin-tile-in 覆盖', () => {
    expectDimmingNotOverridden('.plugin-tile[data-disabled="true"]', tileAnimated);
  });
});
