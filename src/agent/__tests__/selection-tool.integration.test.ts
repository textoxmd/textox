import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { declareAppExtensionPoints } from '@texto/app-api';
import { resetExtensionPointsForTests } from '@texto/plugin-sdk';

// 宿主装配会拉起 Tauri / toast / i18n：全部替换为无副作用实现，测试只关心链路。
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), confirm: vi.fn() }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }));
vi.mock('@/components/styles/theme', () => ({
  getCurrentAppearance: () => 'dark',
  getCurrentColorTheme: () => 'default',
}));

import { bindHost, selectionActions } from '../../../test-fixtures/plugins/ai-explain/src/actions';
import { createPluginHost, NOOP_HOST_DEPS } from '../../plugins/host';

// present 的宿主实现在真实运行里会发请求；这里只验证「动作 → 工具 → present」的链路。
const runtime = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock('../runtime', () => ({ runAgent: runtime.runAgent }));

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    heading: { attrs: { level: { default: 2 } }, content: 'text*', group: 'block' },
    paragraph: { content: 'text*', group: 'block' },
    text: {},
  },
  marks: {},
});

function fakeView(): EditorView {
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 2 }, [schema.text('概念')]),
    schema.node('paragraph', null, [schema.text('Markdown 是一种轻量标记语言。')]),
  ]);
  // 标题占 0..4，正文段落文本位于 5..13（选中 "Markdown"）。
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 5, 13) });
  return {
    state,
    coordsAtPos: () => ({ left: 100, top: 200, right: 240, bottom: 220 }),
    dom: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }) },
  } as unknown as EditorView;
}

beforeEach(() => {
  resetExtensionPointsForTests();
  declareAppExtensionPoints();
  runtime.runAgent.mockReset();
  runtime.runAgent.mockReturnValue({ abort: vi.fn() });
});

describe('ai-explain 生产路径（no-op 宿主 + 真实编辑器视图）', () => {
  it('选区动作把 view 交给核心工具，取到真实选区后 present', async () => {
    // 真实运行里插件 activate() 拿到的就是 NOOP_HOST_DEPS 装配的宿主：
    // editor.getSelectionContext() 恒为 null，上下文只能来自 run(view) 的视图。
    const host = createPluginHost(NOOP_HOST_DEPS, 'ai-explain');
    expect(host.editor.getSelectionContext()).toBeNull();

    const present = vi.spyOn(host.agent, 'present').mockReturnValue({ abort() {} });
    // 本用例只验证「动作 → 工具 → present」链路，不涉及同意/配置；
    // 配置未加载时 available() 恒 false，这里直接放行。
    vi.spyOn(host.agent, 'available').mockReturnValue(true);
    bindHost(host);
    const view = fakeView();

    await selectionActions[0]!.run(view);

    expect(present).toHaveBeenCalledTimes(1);
    const [request, options] = present.mock.calls[0]!;
    // 内容来自真实视图：锚点是选区矩形并集（视口坐标）。
    expect(options.anchor).toEqual({ left: 100, top: 200, right: 240, bottom: 220, width: 140, height: 20 });
    expect(options.size).toEqual({ width: 420, maxHeight: 480 });
    expect(request.messages[0]!.content).toContain('Markdown');
    expect(request.messages[0]!.content).toContain('概念');
  });

  it('没有视图时仍按「无选区」静默返回（不 present）', async () => {
    const host = createPluginHost(NOOP_HOST_DEPS, 'ai-explain');
    const present = vi.spyOn(host.agent, 'present').mockReturnValue({ abort() {} });
    bindHost(host);

    // 空选区视图：工具抛 no selected text，动作静默返回。
    const view = fakeView();
    const empty = EditorState.create({ doc: view.state.doc });
    const collapsed = { ...view, state: empty } as EditorView;

    await expect(selectionActions[0]!.run(collapsed)).resolves.toBeUndefined();
    expect(present).not.toHaveBeenCalled();
  });
});
