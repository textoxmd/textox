import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type {
  EditorContextMenuCtx,
  EditorContextMenuItemMeta,
} from '@texto/markdown-editor-api';

import { buildContextMenuModel } from '../../src/features/context-menu/build';
import { CORE_CONTEXT_MENU_ITEMS } from '../../src/features/context-menu/builtins';

function blockNode(name = 'paragraph', attrs: Record<string, unknown> = {}): PMNode {
  return { attrs, type: { name }, textContent: '' } as unknown as PMNode;
}

function ctx(overrides: Partial<EditorContextMenuCtx> = {}): EditorContextMenuCtx {
  return {
    view: {} as EditorView,
    hasSelection: false,
    block: { pos: 0, node: blockNode() },
    ...overrides,
  };
}

function item(
  id: string,
  overrides: Partial<EditorContextMenuItemMeta> = {},
): EditorContextMenuItemMeta {
  return { id, labelKey: `${id}.label`, run: () => {}, ...overrides };
}

/** 与 builtins.ts 同形：两项都不写 requires，靠 enabled 表达可点性。 */
function builtins(): EditorContextMenuItemMeta[] {
  return [
    item('copy', { order: 0, enabled: (c) => c.hasSelection }),
    item('copy-html', { order: 1, enabled: (c) => c.hasSelection }),
  ];
}

/** 文案解析桩：直接回显 key，便于断言顺序与来源。 */
const t = (key: string) => key;

function build(args: {
  ctx?: EditorContextMenuCtx;
  builtins?: EditorContextMenuItemMeta[];
  contributions?: EditorContextMenuItemMeta[];
}) {
  return buildContextMenuModel({
    ctx: args.ctx ?? ctx(),
    t,
    builtins: args.builtins ?? [],
    contributions: args.contributions ?? [],
  });
}

describe('buildContextMenuModel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('有选区：内置两项可点，requires: block 的贡献项不列出（选区优先）', () => {
    const model = build({
      ctx: ctx({ hasSelection: true }),
      builtins: builtins(),
      contributions: [item('mermaid.copySource', { requires: ['block'] })],
    });
    expect(model.map((e) => e.id)).toEqual(['copy', 'copy-html']);
    expect(model.map((e) => e.enabled)).toEqual([true, true]);
  });

  it('无选区：内置两项列出但置灰，requires: block 的贡献项列出且可点', () => {
    const model = build({
      ctx: ctx({ hasSelection: false }),
      builtins: builtins(),
      contributions: [item('mermaid.copySource', { requires: ['block'] })],
    });
    expect(model.map((e) => [e.id, e.enabled])).toEqual([
      ['copy', false],
      ['copy-html', false],
      ['__sep__', false],
      ['mermaid.copySource', true],
    ]);
  });

  it('无选区且命中不到块（block: null）：requires: block 的项不列出，仅两个置灰项', () => {
    const model = build({
      ctx: ctx({ hasSelection: false, block: null }),
      builtins: builtins(),
      contributions: [item('mermaid.copySource', { requires: ['block'] })],
    });
    expect(model.map((e) => [e.id, e.enabled])).toEqual([
      ['copy', false],
      ['copy-html', false],
    ]);
    expect(model.some((e) => e.separator)).toBe(false);
  });

  it('不写 requires 的贡献项：有选区与无选区都列出', () => {
    const contribution = item('always');
    const withSelection = build({ ctx: ctx({ hasSelection: true }), contributions: [contribution] });
    const withoutSelection = build({
      ctx: ctx({ hasSelection: false }),
      contributions: [contribution],
    });
    expect(withSelection.map((e) => e.id)).toEqual(['always']);
    expect(withoutSelection.map((e) => e.id)).toEqual(['always']);
  });

  it('requires: selection + block（任一满足）：有选区与无选区都列出', () => {
    const contribution = item('both', { requires: ['selection', 'block'] });
    const withSelection = build({ ctx: ctx({ hasSelection: true }), contributions: [contribution] });
    const withoutSelection = build({
      ctx: ctx({ hasSelection: false }),
      contributions: [contribution],
    });
    expect(withSelection.map((e) => e.id)).toEqual(['both']);
    expect(withoutSelection.map((e) => e.id)).toEqual(['both']);
  });

  it('requires: selection 的贡献项：无选区时不列出', () => {
    const model = build({
      ctx: ctx({ hasSelection: false }),
      contributions: [item('selOnly', { requires: ['selection'] })],
    });
    expect(model).toEqual([]);
  });

  it('内置组在前、贡献组在后，并在两组之间插一条分隔符', () => {
    const model = build({
      ctx: ctx({ hasSelection: false }),
      builtins: builtins(),
      contributions: [item('mermaid.copySource', { requires: ['block'] })],
    });
    expect(model.map((e) => e.id)).toEqual([
      'copy',
      'copy-html',
      '__sep__',
      'mermaid.copySource',
    ]);
    expect(model[2]!.separator).toBe(true);
  });

  it('只有内置组时不插分隔符', () => {
    const model = build({ builtins: [item('copy'), item('copy-html')] });
    expect(model.map((e) => e.id)).toEqual(['copy', 'copy-html']);
    expect(model.some((e) => e.separator)).toBe(false);
  });

  it('组内按 order 升序，相等保持传入顺序', () => {
    const model = build({
      builtins: [item('b2', { order: 2 }), item('b1', { order: 1 })],
      contributions: [item('c3', { order: 30 }), item('c1', { order: 10 }), item('c2', { order: 10 })],
    });
    expect(model.map((e) => e.id)).toEqual(['b1', 'b2', '__sep__', 'c1', 'c2', 'c3']);
  });

  it('贡献项 order 更小也不会插进内置组之间', () => {
    const model = build({
      builtins: [item('copy', { order: 0 }), item('copy-html', { order: 1 })],
      contributions: [item('x', { order: 0 })],
    });
    expect(model.map((e) => e.id)).toEqual(['copy', 'copy-html', '__sep__', 'x']);
  });

  it('when 返回 false 的项不可见；抛错视为不可见且不抛出', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const model = build({
      builtins: [
        item('hidden', { when: () => false }),
        item('boom', {
          when: () => {
            throw new Error('when-boom');
          },
        }),
        item('visible'),
      ],
    });
    expect(model.map((e) => e.id)).toEqual(['visible']);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('enabled false 或抛错 ⇒ 该条置灰但不消失', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const model = build({
      builtins: [
        item('grey', { enabled: () => false }),
        item('boom', {
          enabled: () => {
            throw new Error('enabled-boom');
          },
        }),
        item('ok'),
      ],
    });
    expect(model.map((e) => [e.id, e.enabled])).toEqual([
      ['grey', false],
      ['boom', false],
      ['ok', true],
    ]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('run 同步抛错不外溢，且其它项仍可执行', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    const model = build({
      builtins: [
        item('throw', {
          run: () => {
            throw new Error('run-boom');
          },
        }),
        item('ok', { run: ok }),
      ],
    });

    expect(() => model.forEach((e) => e.run?.())).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[context-menu] run failed: throw', expect.any(Error));
  });

  it('run 返回 rejected Promise 时被捕获（不产生未处理 rejection）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const model = build({
      builtins: [item('reject', { run: () => Promise.reject(new Error('run-reject')) })],
    });

    model[0]!.run?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith('[context-menu] run failed: reject', expect.any(Error));
  });

  it('文案取自 t(labelKey)', () => {
    const model = build({ builtins: [item('copy', { labelKey: 'contextMenu.copy' })] });
    expect(model[0]!.text).toBe('contextMenu.copy');
  });

  it('无选区且未命中块时，requires: selection + block 的项不列出（available = []）', () => {
    const model = build({
      ctx: ctx({ hasSelection: false, block: null }),
      contributions: [item('both', { requires: ['selection', 'block'] })],
    });
    expect(model).toEqual([]);
  });
});

describe('CORE_CONTEXT_MENU_ITEMS', () => {
  it('不声明 requires（任何场景都列出）且以 hasSelection 表达可点性', () => {
    for (const meta of CORE_CONTEXT_MENU_ITEMS) {
      expect(meta.requires).toBeUndefined();
      const enabled = meta.enabled!;
      expect(enabled(ctx({ hasSelection: false }))).toBe(false);
      expect(enabled(ctx({ hasSelection: true }))).toBe(true);
    }
  });

  it('无选区且未命中块时 model 仍非空（保证「永远弹同一个菜单」）', () => {
    const model = buildContextMenuModel({
      ctx: ctx({ hasSelection: false, block: null }),
      t,
      builtins: CORE_CONTEXT_MENU_ITEMS,
      contributions: [],
    });
    expect(model.map((e) => e.id)).toEqual(['copy', 'copy-html']);
    expect(model.every((e) => e.enabled === false)).toBe(true);
  });
});
