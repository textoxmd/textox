import { afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { registerContributions, resetExtensionPointsForTests } from '@texto/plugin-sdk';
import { MARKDOWN_EDITOR_SELECTION_ACTION } from '@texto/markdown-editor-api';
import type { SelectionActionMeta } from '@texto/markdown-editor-api';

import { createState } from '../../src/editor.ts';
import { parse } from '../../src/parser.ts';
import { getSchema } from '../../src/schema.ts';
import {
  declareMarkdownEditorExtensionPoint,
  editorSelectionActions,
} from '../../src/extension/registry.ts';
import {
  INLINE_FORMAT_TOOLBAR_CHANGED_EVENT,
  availableSelectionActions,
  setInlineFormatToolbarEnabled,
  syncActions,
} from '../../src/features/inline-format-toolbar/index.ts';

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});

beforeEach(() => {
  resetExtensionPointsForTests();
  declareMarkdownEditorExtensionPoint();
});

afterEach(() => {
  vi.useRealTimers();
  setInlineFormatToolbarEnabled(true);
  resetExtensionPointsForTests();
  document.body.innerHTML = '';
});

const icon: SelectionActionMeta['icon'] = [['path', 'M0 0h1v1H0z']];

function registerAction(overrides: Partial<SelectionActionMeta> = {}): SelectionActionMeta {
  const meta: SelectionActionMeta = {
    id: 'test.action',
    labelKey: 'test.action.label',
    icon,
    run: () => {},
    ...overrides,
  };
  registerContributions('selection-action-test', {
    [MARKDOWN_EDITOR_SELECTION_ACTION]: [meta],
  });
  return meta;
}

function stateWithSelection(md = 'hello world'): EditorState {
  const doc = parse(md);
  const base = EditorState.create({ schema, doc });
  return base.apply(base.tr.setSelection(TextSelection.create(doc, 1, 6)));
}

function findTextRange(view: EditorView, text: string): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (range) return false;
    const idx = node.isText ? node.text?.indexOf(text) ?? -1 : -1;
    if (idx >= 0) {
      range = { from: pos + idx, to: pos + idx + text.length };
      return false;
    }
    return true;
  });
  if (!range) throw new Error(`text not found: ${text}`);
  return range;
}

function setupView(md: string) {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state: createState(parse(md)) });
  return { view, mount };
}

function selectText(view: EditorView, text: string): void {
  const { from, to } = findTextRange(view, text);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  view.focus();
}

function actionButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.fmt-toolbar .floating-toolbar-actions button')];
}

function formatButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.fmt-toolbar > .floating-toolbar-btn')];
}

function visibleToolbar(): HTMLElement | null {
  return document.querySelector('.fmt-toolbar');
}

function actionSeparator(): HTMLElement | null {
  return document.querySelector('.fmt-toolbar .floating-toolbar-sep');
}

function makeToolbarStub() {
  const root = document.createElement('div');
  const actionHost = document.createElement('span');
  const actionSep = document.createElement('span');
  return { root, buttons: [], actionHost, actionSep };
}

describe('selectionAction registry', () => {
  it('注册表读取函数存在', () => {
    expect(typeof editorSelectionActions).toBe('function');
  });

  it('按 id last-wins 读取贡献', () => {
    registerAction();
    registerAction({ labelKey: 'test.action.updated' });
    const actions = editorSelectionActions();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.labelKey).toBe('test.action.updated');
  });

  it('when() 抛错的动作不进入可用列表，并记录日志', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerAction({
      id: 'test.broken',
      when: () => {
        throw new Error('boom');
      },
    });
    registerAction({ id: 'test.ok' });
    expect(availableSelectionActions().map((a) => a.id)).toEqual(['test.ok']);
    expect(errorSpy).toHaveBeenCalledWith(
      '[selection-action] when failed: test.broken',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('按 order 升序，相等时保持注册序', () => {
    registerAction({ id: 'test.late', order: 10 });
    registerAction({ id: 'test.first', order: 1 });
    registerAction({ id: 'test.same', order: 1 });
    expect(availableSelectionActions().map((a) => a.id)).toEqual([
      'test.first',
      'test.same',
      'test.late',
    ]);
  });
});

describe('selectionAction toolbar rendering', () => {
  it('每次调用 syncActions 都重建动作区（when 重新求值）', () => {
    let enabled = false;
    registerAction({ when: () => enabled });

    const state = stateWithSelection();
    const view = { state } as unknown as EditorView;
    const tb = makeToolbarStub();

    syncActions(view, tb, availableSelectionActions());
    expect(tb.actionHost.children).toHaveLength(0);
    expect(tb.actionHost.style.display).toBe('none');

    enabled = true;
    syncActions(view, tb, availableSelectionActions());
    expect(tb.actionHost.children).toHaveLength(1);
    expect(tb.actionHost.style.display).toBe('');

    enabled = false;
    syncActions(view, tb, availableSelectionActions());
    expect(tb.actionHost.children).toHaveLength(0);
    expect(tb.actionHost.style.display).toBe('none');
  });

  it('run 同步 throw 被隔离并记录日志', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerAction({
      id: 'test.sync-throw',
      run: () => {
        throw new Error('sync boom');
      },
    });

    const view = { state: stateWithSelection() } as unknown as EditorView;
    const tb = makeToolbarStub();
    syncActions(view, tb, availableSelectionActions());
    const btn = tb.actionHost.querySelector('button');
    expect(btn).not.toBeNull();

    expect(() => btn!.click()).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      '[selection-action] run failed: test.sync-throw',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('run reject 被捕获并记录日志', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerAction({
      id: 'test.reject',
      run: () => Promise.reject(new Error('async boom')),
    });

    const view = { state: stateWithSelection() } as unknown as EditorView;
    const tb = makeToolbarStub();
    syncActions(view, tb, availableSelectionActions());
    const btn = tb.actionHost.querySelector('button');
    expect(btn).not.toBeNull();

    expect(() => btn!.click()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalledWith(
      '[selection-action] run failed: test.reject',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  test('显示非空选区的动作，且不受 show_inline_format_toolbar 开关影响', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    registerAction({ run });
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('hello world');
    try {
      selectText(view, 'hello');
      vi.advanceTimersByTime(600);

      expect(visibleToolbar()).not.toBeNull();
      const buttons = actionButtons();
      expect(buttons).toHaveLength(1);
      // 格式按钮被开关隐藏，动作按钮仍可见；无格式按钮时不显示分隔符。
      expect(formatButtons().every((b) => b.style.display === 'none')).toBe(true);
      expect(actionSeparator()?.style.display).toBe('none');

      buttons[0]!.click();
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]![0]).toBe(view);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('标题内选区也显示动作', () => {
    vi.useFakeTimers();
    registerAction();
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('# heading');
    try {
      selectText(view, 'heading');
      vi.advanceTimersByTime(600);
      expect(actionButtons()).toHaveLength(1);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('代码块内选区也显示动作', () => {
    vi.useFakeTimers();
    registerAction();
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('```\nconst a = 1;\n```');
    try {
      selectText(view, 'const a = 1;');
      vi.advanceTimersByTime(600);
      expect(actionButtons()).toHaveLength(1);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('跨块选区也显示动作', () => {
    vi.useFakeTimers();
    registerAction();
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('hello\n\nworld');
    try {
      const from = findTextRange(view, 'hello').from;
      const to = findTextRange(view, 'world').to;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      view.focus();
      vi.advanceTimersByTime(600);

      expect(actionButtons()).toHaveLength(1);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('when() 为 false 时不显示动作', () => {
    vi.useFakeTimers();
    registerAction({ when: () => false });
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('hello world');
    try {
      selectText(view, 'hello');
      vi.advanceTimersByTime(600);
      expect(visibleToolbar()).toBeNull();
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('空选区不显示动作', () => {
    vi.useFakeTimers();
    registerAction();

    const { view, mount } = setupView('hello world');
    try {
      view.focus();
      vi.advanceTimersByTime(600);
      expect(actionButtons()).toHaveLength(0);
      const toolbar = visibleToolbar();
      expect(toolbar === null || toolbar.style.display === 'none').toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('when() 在下次显示时重新求值（启动期配置晚到）', () => {
    vi.useFakeTimers();
    let enabled = false;
    registerAction({ when: () => enabled });
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('hello world');
    try {
      selectText(view, 'hello');
      vi.advanceTimersByTime(600);
      expect(actionButtons()).toHaveLength(0);

      enabled = true;
      // 再次触发一次更新（如选区变化 / 配置到达）后重新求值。
      selectText(view, 'world');
      vi.advanceTimersByTime(600);
      expect(actionButtons()).toHaveLength(1);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('滚动/resize 只重新定位，不重新求值 when() 或重建按钮', () => {
    vi.useFakeTimers();
    let whenCalls = 0;
    registerAction({
      when: () => {
        whenCalls += 1;
        return true;
      },
    });
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('hello world');
    try {
      selectText(view, 'hello');
      vi.advanceTimersByTime(600);
      const button = actionButtons()[0];
      expect(button).toBeDefined();

      let coordsCalls = 0;
      const orig = view.coordsAtPos.bind(view);
      view.coordsAtPos = ((pos: number, side?: number) => {
        coordsCalls += 1;
        return orig(pos, side);
      }) as EditorView['coordsAtPos'];
      const callsAfterShow = whenCalls;

      view.dom.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(50);

      // rAF 已执行定位，但 when() 没有再次求值，按钮 DOM 被复用。
      expect(coordsCalls).toBeGreaterThan(0);
      expect(whenCalls).toBe(callsAfterShow);
      expect(actionButtons()[0]).toBe(button);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test('重新开启格式工具栏后格式按钮恢复显示', () => {
    vi.useFakeTimers();
    registerAction();
    setInlineFormatToolbarEnabled(false);

    const { view, mount } = setupView('hello world');
    try {
      selectText(view, 'hello');
      vi.advanceTimersByTime(600);
      expect(actionButtons()).toHaveLength(1);
      expect(formatButtons().every((b) => b.style.display === 'none')).toBe(true);
      expect(actionSeparator()?.style.display).toBe('none');

      window.dispatchEvent(
        new CustomEvent(INLINE_FORMAT_TOOLBAR_CHANGED_EVENT, { detail: { enabled: true } }),
      );
      expect(formatButtons().every((b) => b.style.display !== 'none')).toBe(true);
      expect(actionButtons()).toHaveLength(1);
      expect(actionSeparator()?.style.display).toBe('');
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
