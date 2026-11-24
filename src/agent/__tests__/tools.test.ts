import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { declareAppExtensionPoints, APP_AGENT_TOOL } from '@texto/app-api';
import type { AgentToolContribution } from '@texto/app-api';
import { registerContributions, resetExtensionPointsForTests } from '@texto/plugin-sdk';
import type { PluginHost, SelectionContextSnapshot } from '@texto/plugin-sdk';

import { callAgentTool, listAgentTools, resetAgentToolWarningsForTests } from '../tools';

const CONTEXT: SelectionContextSnapshot = {
  selection: 'Markdown',
  paragraph: 'Markdown 是一种轻量标记语言。',
  headings: ['概念'],
  anchor: { left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20 },
};

// 生产路径的真实来源：插件经选区动作拿到编辑器视图，工具从 view.state 里读选区。
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: {},
  },
  marks: {},
});

function makeView(text = 'Markdown'): EditorView {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 1 + text.length) });
  return {
    state,
    coordsAtPos: () => ({ left: 10, top: 20, right: 30, bottom: 40 }),
    dom: { getBoundingClientRect: () => ({ left: 1, top: 2, right: 101, bottom: 42, width: 100, height: 40 }) },
  } as unknown as EditorView;
}


function makeHost(ctx: SelectionContextSnapshot | null = CONTEXT, label = 'caller'): PluginHost {
  return {
    editor: { getSelectionContext: () => ctx },
    i18n: { t: (key: string) => `${label}:${key}`, language: () => 'en' },
  } as unknown as PluginHost;
}

function contribute(ownerId: string, ...tools: AgentToolContribution[]): void {
  registerContributions(ownerId, { [APP_AGENT_TOOL]: tools });
}

function echoTool(name = 'p.echo', execute?: AgentToolContribution['execute']): AgentToolContribution {
  return {
    name,
    description: 'echo',
    parameters: { type: 'object', properties: {} },
    execute: execute ?? (async () => ({ content: 'ok' })),
  };
}

beforeEach(() => {
  resetExtensionPointsForTests();
  resetAgentToolWarningsForTests();
  declareAppExtensionPoints();
});

describe('listAgentTools', () => {
  it('包含核心选区上下文工具', () => {
    const names = listAgentTools().map((tool) => tool.name);

    expect(names).toContain('core.read-selection-context');
  });

  it('合并插件贡献，同名 last-wins', () => {
    contribute('p1', { ...echoTool(), description: 'first' });
    contribute('p2', { ...echoTool(), description: 'second' });

    const listed = listAgentTools().filter((tool) => tool.name === 'p.echo');

    expect(listed).toHaveLength(1);
    expect(listed[0]!.description).toBe('second');
  });
});

describe('callAgentTool', () => {
  it('核心工具返回选区上下文（content 不含锚点）', async () => {
    const result = await callAgentTool(makeHost(), 'core.read-selection-context');

    expect(JSON.parse(result.content)).toEqual({
      selection: CONTEXT.selection,
      paragraph: CONTEXT.paragraph,
      headings: CONTEXT.headings,
    });
    expect(result.details).toEqual(CONTEXT);
  });

  it('无选区时核心工具抛错', async () => {
    await expect(callAgentTool(makeHost(null), 'core.read-selection-context')).rejects.toThrow(
      'no selected text',
    );
  });

  it('生产路径：no-op 宿主（getSelectionContext 为 null）+ args.view 仍返回上下文', async () => {
    // 插件宿主由启动期 no-op deps 装配，host.editor 没有编辑器句柄；
    // 真实上下文必须来自选区动作传进来的 view。
    const result = await callAgentTool(makeHost(null), 'core.read-selection-context', {
      view: makeView(),
    });

    const details = result.details as SelectionContextSnapshot;
    expect(details.selection).toBe('Markdown');
    expect(details.paragraph).toBe('Markdown');
    expect(details.headings).toEqual([]);
    expect(details.anchor).toEqual({ left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20 });
    expect(JSON.parse(result.content)).toEqual({
      selection: 'Markdown',
      paragraph: 'Markdown',
      headings: [],
    });
  });

  it('args.view 优先于宿主能力', async () => {
    const result = await callAgentTool(makeHost(CONTEXT), 'core.read-selection-context', {
      view: makeView('来自视图'),
    });

    expect((result.details as SelectionContextSnapshot).selection).toBe('来自视图');
  });

  it('args.view 无选区时仍抛错，不回退宿主', async () => {
    const view = makeView();
    const empty = EditorState.create({
      doc: view.state.doc,
      selection: TextSelection.create(view.state.doc, 1),
    });
    const collapsed = { ...view, state: empty } as EditorView;

    await expect(
      callAgentTool(makeHost(CONTEXT), 'core.read-selection-context', { view: collapsed }),
    ).rejects.toThrow('no selected text');
  });

  it('插件工具收到贡献方的宿主，而不是调用方宿主', async () => {
    const execute = vi.fn(async (host: PluginHost) => ({
      content: host.i18n.t('who'),
    }));
    contribute('other', echoTool('other.who', execute));

    const caller = makeHost(CONTEXT, 'caller');
    const owner = makeHost(CONTEXT, 'owner');
    const hostFor = vi.fn((ownerId: string) => {
      expect(ownerId).toBe('other');
      return owner;
    });

    const result = await callAgentTool(caller, 'other.who', { n: 1 }, hostFor);

    expect(result.content).toBe('owner:who');
    expect(execute).toHaveBeenCalledWith(owner, { n: 1 });
    expect(hostFor).toHaveBeenCalledWith('other');
  });

  it('核心工具始终用调用方宿主', async () => {
    const hostFor = vi.fn(() => makeHost(null, 'owner'));

    const result = await callAgentTool(makeHost(), 'core.read-selection-context', {}, hostFor);

    expect(result.details).toEqual(CONTEXT);
    expect(hostFor).not.toHaveBeenCalled();
  });

  it('缺少 hostFor 时回退调用方宿主', async () => {
    const execute = vi.fn(async (host: PluginHost) => ({ content: host.i18n.t('who') }));
    contribute('other', echoTool('other.who', execute));

    const result = await callAgentTool(makeHost(CONTEXT, 'caller'), 'other.who');

    expect(result.content).toBe('caller:who');
  });

  it('插件不能覆盖 core.*，核心实现仍生效', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const execute = vi.fn(async () => ({ content: 'overridden' }));
      contribute('p', echoTool('core.read-selection-context', execute));

      expect(listAgentTools().filter((tool) => tool.name === 'core.read-selection-context')).toHaveLength(1);
      const result = await callAgentTool(makeHost(), 'core.read-selection-context');

      expect(result.content).not.toBe('overridden');
      expect(JSON.parse(result.content)).toEqual({
        selection: CONTEXT.selection,
        paragraph: CONTEXT.paragraph,
        headings: CONTEXT.headings,
      });
      expect(execute).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('核心命名空间'));
    } finally {
      warn.mockRestore();
    }
  });

  it('未知工具抛错', async () => {
    await expect(callAgentTool(makeHost(), 'nope')).rejects.toThrow('unknown agent tool: nope');
  });
});
