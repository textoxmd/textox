import { describe, expect, it, vi } from 'vitest';

import type { Disposable } from '@textox/plugin-sdk';
import {
  MARKDOWN_EDITOR_CONTEXT_MENU,
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_SELECTION_ACTION,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
  MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
} from '@texto/plugin-sdk';

import { createEditorBridge, type EditorBridge } from '../runtime/editorBridge';

const DEMO_EXTENSION = {
  id: 'demo.extension',
  create: (): Record<string, never> => ({}),
};

/** 最小可用的插入命令（形状由 `InsertCommandMeta` 收窄）。 */
const INSERT_COMMAND = {
  id: 'demo.insert',
  keyword: 'demo',
  labelKey: 'demo.insert.label',
  icon: 'table',
  insert: () => {},
};

const OWNER = 'p1';

/** 记录注册/注销与重建请求；`requestReload` 单独记，便于断言注册与注销的时序。 */
function harness() {
  const calls: string[] = [];
  const reloads: string[] = [];
  const registrations: Array<{ point: string; value: unknown; owner: string }> = [];
  const bridge = createEditorBridge({
    register: (point, value, owner) => {
      calls.push(`${point}:${owner}`);
      registrations.push({ point, value, owner });
      return { dispose: () => calls.push(`off:${point}`) };
    },
    requestReload: () => reloads.push('reload'),
  });
  return { bridge, calls, reloads, registrations };
}

describe('createEditorBridge', () => {
  it('registers a syntax feature and removes it on dispose', () => {
    const calls: string[] = [];
    const bridge = createEditorBridge({
      register: (point, _value, owner) => {
        calls.push(`${point}:${owner}`);
        return { dispose: () => calls.push(`off:${point}`) };
      },
      // 重建请求由下面的时序用例单独覆盖，这里不混进 calls
      requestReload: () => {},
    });
    const sub = bridge.registerSyntaxFeature({ name: 'demo' }, OWNER);
    expect(calls).toEqual(['markdown-editor:syntaxFeature:p1']);
    sub.dispose();
    expect(calls).toEqual(['markdown-editor:syntaxFeature:p1', 'off:markdown-editor:syntaxFeature']);
  });

  it.each<{ name: string; point: string; value: unknown; register: (bridge: EditorBridge) => Disposable }>([
    {
      name: 'registerSyntaxFeature',
      point: MARKDOWN_EDITOR_SYNTAX_FEATURE,
      value: { name: 'demo' },
      register: (bridge) => bridge.registerSyntaxFeature({ name: 'demo' }, OWNER),
    },
    {
      name: 'registerExtension',
      point: MARKDOWN_EDITOR_EXTENSION,
      value: DEMO_EXTENSION,
      register: (bridge) => bridge.registerExtension(DEMO_EXTENSION, OWNER),
    },
    {
      name: 'registerFormatToolbarItem',
      point: MARKDOWN_EDITOR_FORMAT_TOOLBAR,
      value: { id: 'demo.bold' },
      register: (bridge) => bridge.registerFormatToolbarItem({ id: 'demo.bold' }, OWNER),
    },
    {
      name: 'registerContextMenuItem',
      point: MARKDOWN_EDITOR_CONTEXT_MENU,
      value: { id: 'demo.copy' },
      register: (bridge) => bridge.registerContextMenuItem({ id: 'demo.copy' }, OWNER),
    },
    {
      name: 'registerSelectionAction',
      point: MARKDOWN_EDITOR_SELECTION_ACTION,
      value: { id: 'demo.explain' },
      register: (bridge) => bridge.registerSelectionAction({ id: 'demo.explain' }, OWNER),
    },
    {
      name: 'registerSyntaxHighlight',
      point: MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
      value: { languages: [{ id: 'demo', aliases: [] }] },
      register: (bridge) =>
        bridge.registerSyntaxHighlight({ languages: [{ id: 'demo', aliases: [] }] }, OWNER),
    },
    {
      // insert 命令进编辑器扩展点的 `insert` 字段（editorInsertCommands 的读取路径），
      // 不进 app:command：CommandContribution 需要 titleKey + run，形状对不上。
      name: 'registerInsertCommand',
      point: MARKDOWN_EDITOR_EXTENSION,
      value: {
        id: 'runtime.insert.p1.demo.insert',
        insert: { ...INSERT_COMMAND, labelKey: 'p1.demo.insert.label' },
        create: expect.any(Function),
      },
      register: (bridge) => bridge.registerInsertCommand(INSERT_COMMAND, OWNER),
    },
  ])('routes $name to $point with the owner', ({ point, value, register }) => {
    const registerSpy = vi.fn(() => ({ dispose: () => {} }));
    const bridge = createEditorBridge({ register: registerSpy, requestReload: () => {} });

    const sub = register(bridge);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith(point, value, OWNER);
    sub.dispose();
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  it('requests a reload after register and after dispose, in that order', () => {
    const order: string[] = [];
    const bridge = createEditorBridge({
      register: (point) => {
        order.push(`register:${point}`);
        return { dispose: () => order.push(`off:${point}`) };
      },
      requestReload: () => order.push('reload'),
    });

    const sub = bridge.registerExtension({ id: 'demo.extension' }, OWNER);
    expect(order).toEqual(['register:markdown-editor:extension', 'reload']);

    sub.dispose();
    expect(order).toEqual([
      'register:markdown-editor:extension',
      'reload',
      'off:markdown-editor:extension',
      'reload',
    ]);

    // 幂等：重复 dispose 不再触发第二次注销 / 重建
    sub.dispose();
    expect(order).toEqual([
      'register:markdown-editor:extension',
      'reload',
      'off:markdown-editor:extension',
      'reload',
    ]);
  });

  it('给插件贡献的文案 key 补上插件 id 前缀，已带前缀的不重复加', () => {
    const { bridge, registrations } = harness();

    bridge.registerFormatToolbarItem(
      { id: 'demo.underline', labelKey: 'underline.label' },
      'app.textox.mkdext',
    );
    bridge.registerSelectionAction(
      { id: 'demo.explain', labelKey: 'app.textox.mkdext.explain.label' },
      'app.textox.mkdext',
    );
    bridge.registerInsertCommand(INSERT_COMMAND, 'app.textox.mkdext');

    const toolbar = registrations[0]?.value as { labelKey: string };
    const action = registrations[1]?.value as { labelKey: string };
    const insert = registrations[2]?.value as { insert: { labelKey: string } };

    expect(toolbar.labelKey).toBe('app.textox.mkdext.underline.label');
    expect(action.labelKey).toBe('app.textox.mkdext.explain.label');
    expect(insert.insert.labelKey).toBe('app.textox.mkdext.demo.insert.label');
  });

  it('keeps two registrations of the same owner independent', () => {
    const { bridge, calls } = harness();

    const first = bridge.registerSelectionAction({ id: 'demo.first' }, OWNER);
    const second = bridge.registerSelectionAction({ id: 'demo.second' }, OWNER);
    expect(calls).toEqual([
      'markdown-editor:selectionAction:p1',
      'markdown-editor:selectionAction:p1',
    ]);

    first.dispose();
    expect(calls).toEqual([
      'markdown-editor:selectionAction:p1',
      'markdown-editor:selectionAction:p1',
      'off:markdown-editor:selectionAction',
    ]);

    // 第一条的释放不影响第二条：它自己的 dispose 仍会生效
    second.dispose();
    expect(calls.slice(2)).toEqual([
      'off:markdown-editor:selectionAction',
      'off:markdown-editor:selectionAction',
    ]);
  });

  it('requests a reload after every contribution registration, insert commands included', () => {
    const { bridge, reloads } = harness();

    bridge.registerSyntaxFeature({ name: 'a' }, OWNER);
    bridge.registerSyntaxHighlight({ languages: [] }, OWNER);
    // insert 命令也是编辑器扩展贡献：编辑器重建时才重新读取扩展列表
    bridge.registerInsertCommand(INSERT_COMMAND, OWNER);

    expect(reloads).toEqual(['reload', 'reload', 'reload']);
  });
});
