import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import type {
  AgentPresentOptions,
  AgentRequest,
  AgentRunHandle,
  AgentToolResult,
  PluginHost,
  SelectionContextSnapshot,
} from '@texto/plugin-sdk';

import { bindHost, selectionActions } from './actions';
import { locales, type ExplainMessages } from './locales';

const CONTEXT: SelectionContextSnapshot = {
  selection: 'Markdown',
  paragraph: 'Markdown 是一种轻量标记语言。',
  headings: ['概念'],
  anchor: { left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20 },
};

// 选区动作把编辑器视图交给核心工具取上下文（插件宿主是 no-op 装配的）。
const view = { marker: 'editor-view' } as unknown as EditorView;

/** 让 `bindHost` 里的 `config.get(...).then(...)` 落地。 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * 模拟真实宿主：`PluginHost.i18n.t(key)` 只接受裸 key（宿主再拼 `<pluginId>.`），
 * 这里直接按裸 key 查当前语言文案，并处理 `{{language}}` 插值。
 */
function translate(language: string, key: string, opts?: Record<string, unknown>): string {
  const messages = locales[language] ?? locales['en-US']!;
  const raw = messages[key as keyof ExplainMessages];
  if (typeof raw !== 'string') return key;
  return raw.replace(/\{\{language\}\}/g, String(opts?.language ?? ''));
}

function makeHost(
  opts: {
    available?: boolean;
    details?: SelectionContextSnapshot | null;
    callRejects?: Error;
    language?: string;
    /** 初始配置值；可为非字符串，用于验证归一化。 */
    modelProfile?: unknown;
    /** 挂起初次 `get`，由测试显式 resolve（用于竞态用例）。 */
    holdGet?: boolean;
  } = {},
) {
  const present = vi.fn(
    (_request: AgentRequest, _options: AgentPresentOptions): AgentRunHandle => ({ abort() {} }),
  );
  const available = vi.fn((_profileId: string) => opts.available ?? true);
  const details = 'details' in opts ? (opts.details ?? undefined) : CONTEXT;
  const call = vi.fn(async (): Promise<AgentToolResult> => {
    if (opts.callRejects) throw opts.callRejects;
    return { content: '{}', details };
  });
  const language = opts.language ?? 'zh-CN';
  const t = vi.fn((key: string, i18nOpts?: Record<string, unknown>) =>
    translate(language, key, i18nOpts),
  );
  // 真实宿主只在配置变更时推送，订阅本身不回调。
  // 这里退订后仍允许 emit 投递：模拟宿主把事件排进队列、退订后才迟到送达。
  let listener: ((config: Record<string, unknown>) => void) | null = null;
  const subscribe = vi.fn((cb: (config: Record<string, unknown>) => void) => {
    listener = cb;
    return () => {};
  });
  /** `holdGet` 时挂起的初次读取，按调用顺序由测试显式 resolve。 */
  const pendingGets: Array<(value: unknown) => void> = [];
  const get = vi.fn((key: string) => {
    if (key !== 'modelProfile') return Promise.resolve(undefined);
    if (opts.holdGet) {
      return new Promise<unknown>((resolve) => {
        pendingGets.push(resolve);
      });
    }
    return Promise.resolve(opts.modelProfile);
  });
  const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const host = {
    agent: {
      available,
      present,
      run: () => ({ abort() {} }),
      tools: { call, list: () => [] },
    },
    config: { get, set: vi.fn(), getAll: vi.fn(), subscribe },
    i18n: { t, language: () => language },
    log,
  } as unknown as PluginHost;
  const emit = (config: Record<string, unknown>) => listener?.(config);
  return {
    host,
    present,
    call,
    get,
    subscribe,
    available,
    log,
    emit,
    resolveGet: (value: unknown, index = 0) => pendingGets[index]?.(value),
  };
}

describe('ai-explain selection actions', () => {
  it('只暴露解释一个动作', () => {
    expect(selectionActions).toHaveLength(1);
    expect(selectionActions[0]!.id).toBe('ai-explain.explain');
    expect(selectionActions[0]!.labelKey).toBe('ai-explain.explain');
    expect(selectionActions[0]!.icon).toBe('book-open-text');
    expect(selectionActions[0]?.order).toBe(0);
  });

  it('when 用配置的 modelProfile 询问 agent.available(profileId)', async () => {
    const first = makeHost({ available: false, modelProfile: 'profile-a' });
    bindHost(first.host);
    await flush();
    expect(selectionActions[0]!.when?.()).toBe(false);
    expect(first.available.mock.lastCall).toEqual(['profile-a']);

    const second = makeHost({ available: true, modelProfile: 'profile-b' });
    bindHost(second.host);
    await flush();
    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(second.available.mock.lastCall).toEqual(['profile-b']);
  });

  it('未配置 modelProfile 时以空串询问（视为不可用）', async () => {
    const { host, available } = makeHost({ available: false });
    bindHost(host);
    await flush();
    expect(selectionActions[0]!.when?.()).toBe(false);
    expect(available.mock.lastCall).toEqual(['']);
  });

  it('配置订阅推送新的 modelProfile 后 when 立即反映', async () => {
    const { host, emit, available } = makeHost({ available: true, modelProfile: '' });
    bindHost(host);
    await flush();

    emit({ modelProfile: 'profile-c' });

    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(available.mock.lastCall).toEqual(['profile-c']);

    // 非字符串值回退为空串。
    emit({ modelProfile: 42 });
    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(available.mock.lastCall).toEqual(['']);
  });

  it('订阅先到、初次 get 后到时不用旧值覆盖', async () => {
    const { host, emit, available, resolveGet } = makeHost({
      modelProfile: 'profile-a',
      holdGet: true,
    });
    bindHost(host);

    // 用户在初次读取落地前就改了配置。
    emit({ modelProfile: 'profile-b' });
    resolveGet('profile-a');
    await flush();

    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(available.mock.lastCall).toEqual(['profile-b']);
  });

  it('初次 get 返回非字符串时归一化为空串', async () => {
    const { host, available } = makeHost({ available: false, modelProfile: 42 });
    bindHost(host);
    await flush();

    expect(selectionActions[0]!.when?.()).toBe(false);
    expect(available.mock.lastCall).toEqual(['']);
  });

  it('重绑后旧宿主的事件不生效', async () => {
    const first = makeHost({ modelProfile: '' });
    bindHost(first.host);
    await flush();

    const second = makeHost({ modelProfile: 'profile-b' });
    bindHost(second.host);
    await flush();
    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(second.available.mock.lastCall).toEqual(['profile-b']);

    // 旧宿主退订后仍有排队事件迟到送达：必须被丢弃。
    first.emit({ modelProfile: 'from-a' });
    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(second.available.mock.lastCall).toEqual(['profile-b']);
  });

  it('旧 bind 迟到的 get 被丢弃', async () => {
    const first = makeHost({ holdGet: true });
    bindHost(first.host);
    const second = makeHost({ holdGet: true });
    bindHost(second.host);

    first.resolveGet('from-a', 0);
    await flush();

    // 新 bind 的读取还没落地，旧 bind 的结果不能填进来。
    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(second.available.mock.lastCall).toEqual(['']);
  });

  it('重绑时 profileId 归零', async () => {
    const first = makeHost({ modelProfile: 'p1' });
    bindHost(first.host);
    await flush();
    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(first.available.mock.lastCall).toEqual(['p1']);

    const second = makeHost({ holdGet: true });
    bindHost(second.host);

    expect(selectionActions[0]!.when?.()).toBe(true);
    expect(second.available.mock.lastCall).toEqual(['']);
  });

  it('run 在 profileId 失效时不 present', async () => {
    const { host, present, call } = makeHost({ available: false, modelProfile: 'profile-a' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    expect(present).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it('先取选区上下文工具，再 present system、定界正文与带摘要的标题', async () => {
    const { host, present, call } = makeHost({ modelProfile: 'profile-a' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    // 真实视图必须随调用传给核心工具：工具优先用它读选区，宿主只是兜底。
    expect(call).toHaveBeenCalledWith('core.read-selection-context', { view });
    expect(call.mock.invocationCallOrder[0]!).toBeLessThan(present.mock.invocationCallOrder[0]!);

    expect(present).toHaveBeenCalledTimes(1);
    const [request, options] = present.mock.calls[0]!;
    expect(request.system).toContain('只输出结果正文');
    expect(request.system).toContain('解释选中文字');
    expect(request.system).toContain('用中文回答');
    expect(request.system).not.toContain('ai-explain.');
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.role).toBe('user');
    expect(request.messages[0]!.content).toContain('选中文字');
    expect(request.messages[0]!.content).toContain('```');
    expect(request.messages[0]!.content).toContain('Markdown');
    expect(options.title).toBe('解释 · Markdown');
    expect(options.tabLabel).toBe('解释');
    expect(options.sourceText).toBe(CONTEXT.selection);
    expect(options.anchor).toEqual(CONTEXT.anchor);
    expect(options.profileId).toBe('profile-a');
    // 卡片尺寸随 present 声明，由宿主按视口夹取。
    expect(options.size).toEqual({ width: 420, maxHeight: 480 });
  });

  it('present 使用配置订阅更新后的 profileId', async () => {
    const { host, present, emit } = makeHost({ modelProfile: '' });
    bindHost(host);
    await flush();

    emit({ modelProfile: 'profile-b' });
    await selectionActions[0]!.run(view);

    expect(present.mock.calls[0]![1].profileId).toBe('profile-b');
  });

  it('界面语言为英文时提示词与标题使用英文模板', async () => {
    const { host, present } = makeHost({ language: 'en-US', modelProfile: 'profile-a' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    const [request, options] = present.mock.calls[0]!;
    expect(request.system).toContain('You are a Markdown document assistant.');
    expect(request.system).toContain('Output only the result body');
    expect(request.system).toContain('Answer in English');
    expect(request.system).not.toContain('ai-explain.');
    expect(request.messages[0]!.content).toContain('Selected text:');
    expect(options.tabLabel).toBe('Explain');
  });

  it('工具返回空选区时不 present', async () => {
    const { host, present } = makeHost({ details: { ...CONTEXT, selection: '   ' } });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    expect(present).not.toHaveBeenCalled();
  });

  it('工具返回 null（无选区）时不 present', async () => {
    const { host, present } = makeHost({ details: null });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    expect(present).not.toHaveBeenCalled();
  });

  it('工具缺少锚点时不 present', async () => {
    const { host, present } = makeHost({ details: { ...CONTEXT, anchor: null } });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    expect(present).not.toHaveBeenCalled();
  });

  it('工具结果形状不合法时不 present', async () => {
    const { host, present } = makeHost({
      details: { selection: 'Markdown', headings: [] } as unknown as SelectionContextSnapshot,
    });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    expect(present).not.toHaveBeenCalled();
  });

  it('工具调用失败时静默返回且不 present', async () => {
    const { host, present } = makeHost({ callRejects: new Error('no selected text') });
    bindHost(host);
    await flush();

    await expect(selectionActions[0]!.run(view)).resolves.toBeUndefined();
    expect(present).not.toHaveBeenCalled();
  });
});
