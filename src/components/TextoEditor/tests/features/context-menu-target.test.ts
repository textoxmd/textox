import { beforeAll, describe, expect, it } from 'vitest';
import type { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { getSchema } from '../../src/schema';
import { resolveContextMenuContext } from '../../src/features/context-menu/target';

let schema: Schema;
beforeAll(() => {
  schema = getSchema();
});

/** 两个段落：p1 = "hello"（0..7），p2 = "world"（7..14）。 */
function makeDoc() {
  return schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('hello')),
    schema.node('paragraph', null, schema.text('world')),
  ]);
}

/** 伪造 view：只需要 state 与 posAtCoords（本函数不接触 DOM）。 */
function fakeView(
  state: EditorState,
  posAtCoords?: () => { pos: number; inside: number } | null,
) {
  return {
    state,
    posAtCoords: posAtCoords ?? (() => null),
  } as unknown as EditorView;
}

const coords = { left: 0, top: 0 };

describe('resolveContextMenuContext', () => {
  it('命中段落 ⇒ block 取该顶层块', () => {
    const doc = makeDoc();
    const state = EditorState.create({ schema, doc });
    const view = fakeView(state, () => ({ pos: 8, inside: 7 })); // 命中 p2

    const context = resolveContextMenuContext({ view, coords });

    expect(context.block).not.toBeNull();
    expect(context.block!.pos).toBe(7);
    expect(context.block!.node.textContent).toBe('world');
  });

  it('命中 NodeView（pos 落在块边界）⇒ 取被点的块，而不是前一个兄弟块', () => {
    const doc = makeDoc();
    const state = EditorState.create({ schema, doc });
    // 模拟右键渲染出的图表：pos ≈ inside ≈ 目标块起点（7）。
    const view = fakeView(state, () => ({ pos: 7, inside: 7 }));

    const context = resolveContextMenuContext({ view, coords });

    expect(context.block).not.toBeNull();
    expect(context.block!.pos).toBe(7);
    expect(context.block!.node.textContent).toBe('world');
  });

  it('命中空 code_block ⇒ 取 code_block 顶层块', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', { lang: 'mermaid' }, undefined),
    ]);
    const state = EditorState.create({ schema, doc });
    const view = fakeView(state, () => ({ pos: 0, inside: 0 }));

    const context = resolveContextMenuContext({ view, coords });

    expect(context.block).not.toBeNull();
    expect(context.block!.pos).toBe(0);
    expect(context.block!.node.type.name).toBe('code_block');
    expect(context.block!.node.textContent).toBe('');
    expect(context.block!.node.attrs.lang).toBe('mermaid');
  });

  it('命中嵌套列表项 ⇒ 解析到其所属顶层块（bullet_list）', () => {
    const doc = schema.node('doc', null, [
      schema.node('bullet_list', null, [
        schema.node('list_item', null, [schema.node('paragraph', null, schema.text('item'))]),
      ]),
    ]);
    const state = EditorState.create({ schema, doc });
    // inside 指向 paragraph（位置 2），+1 后落到 paragraph 内部。
    const view = fakeView(state, () => ({ pos: 4, inside: 3 }));

    const context = resolveContextMenuContext({ view, coords });

    expect(context.block).not.toBeNull();
    expect(context.block!.pos).toBe(0);
    expect(context.block!.node.type.name).toBe('bullet_list');
  });

  it('inside === -1 时退回 hit.pos 取样', () => {
    const doc = makeDoc();
    const state = EditorState.create({ schema, doc });
    const view = fakeView(state, () => ({ pos: 3, inside: -1 }));

    const context = resolveContextMenuContext({ view, coords });

    expect(context.block!.pos).toBe(0); // probe = hit.pos = 3 ⇒ p1
    expect(context.block!.node.textContent).toBe('hello');
  });

  it('posAtCoords 未命中（null）⇒ block 为 null', () => {
    const doc = makeDoc();
    const state = EditorState.create({ schema, doc });
    const view = fakeView(state, () => null);

    expect(resolveContextMenuContext({ view, coords }).block).toBeNull();
  });

  it('probe 落在 depth < 1（文档边界）⇒ block 为 null', () => {
    const doc = makeDoc();
    const state = EditorState.create({ schema, doc });
    const view = fakeView(state, () => ({ pos: 0, inside: -1 }));

    expect(resolveContextMenuContext({ view, coords }).block).toBeNull();
  });
});
