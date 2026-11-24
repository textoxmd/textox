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
import { locales, type TranslateMessages } from './locales';

const CONTEXT: SelectionContextSnapshot = {
  selection: 'Markdown',
  paragraph: 'Markdown 是一种轻量标记语言。',
  headings: ['概念'],
  anchor: { left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20 },
};

const view = { marker: 'editor-view' } as unknown as EditorView;

/** 让 `bindHost` 里的 `config.get(...).then(...)` 落地。 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function translate(language: string, key: string, opts?: Record<string, unknown>): string {
  const messages = locales[language] ?? locales['en-US']!;
  const raw = messages[key as keyof TranslateMessages];
  if (typeof raw !== 'string') return key;
  return raw.replace(/\{\{language\}\}/g, String(opts?.language ?? ''));
}

function makeHost(
  opts: {
    available?: boolean;
    details?: SelectionContextSnapshot | null;
    callRejects?: Error;
    language?: string;
    target?: string | null;
    /** 初始 modelProfile 配置值；可为非字符串，用于验证归一化。 */
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
    if (key === 'translateTarget') return Promise.resolve(opts.target);
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
    i18n: { t, language: () => language },
    config: { get, set: vi.fn(async () => {}), getAll: () => ({}), subscribe },
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

describe('ai-translate selection actions', () => {
  it('只暴露翻译一个动作', () => {
    expect(selectionActions).toHaveLength(1);
    expect(selectionActions[0]!.id).toBe('ai-translate.translate');
    expect(selectionActions[0]!.icon).toBe('languages');
    expect(selectionActions[0]?.order).toBe(1);
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

  it('未配置目标语言时跟随界面语言', async () => {
    const { host, present, call, get } = makeHost({ modelProfile: 'profile-a' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    expect(call).toHaveBeenCalledWith('core.read-selection-context', { view });
    expect(get).toHaveBeenCalledWith('translateTarget');
    expect(present).toHaveBeenCalledTimes(1);
    const [request, options] = present.mock.calls[0]!;
    expect(request.system).toContain('翻译成简体中文');
    expect(request.system).not.toContain('翻译成English');
    expect(options.tabLabel).toBe('翻译');
    expect(options.sourceText).toBe(CONTEXT.selection);
    expect(options.title).toBe('翻译 · Markdown');
    expect(options.anchor).toEqual(CONTEXT.anchor);
    expect(options.size).toEqual({ width: 420, maxHeight: 480 });
    expect(options.profileId).toBe('profile-a');
  });

  it('present 使用配置订阅更新后的 profileId', async () => {
    const { host, present, emit } = makeHost({ modelProfile: '' });
    bindHost(host);
    await flush();

    emit({ modelProfile: 'profile-b' });
    await selectionActions[0]!.run(view);

    expect(present.mock.calls[0]![1].profileId).toBe('profile-b');
  });

  it('显式设置 en-US 时以选择为准', async () => {
    const { host, present } = makeHost({ target: 'en-US' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    const [request] = present.mock.calls[0]!;
    expect(request.system).toContain('翻译成English');
    expect(request.system).not.toContain('翻译成简体中文');
  });

  it('auto + 英文界面时翻译成英文', async () => {
    const { host, present } = makeHost({ target: 'auto', language: 'en-US' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    const [request] = present.mock.calls[0]!;
    expect(request.system).toContain('translate the selected text into English');
  });

  it('设置 zh-CN 后翻译成简体中文', async () => {
    const { host, present } = makeHost({ target: 'zh-CN' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    const [request] = present.mock.calls[0]!;
    expect(request.system).toContain('翻译成简体中文');
  });

  it('界面语言为英文时提示词使用英文模板', async () => {
    const { host, present } = makeHost({ language: 'en-US', target: 'ja-JP' });
    bindHost(host);
    await flush();

    await selectionActions[0]!.run(view);

    const [request, options] = present.mock.calls[0]!;
    expect(request.system).toContain('You are a Markdown document assistant.');
    expect(request.system).toContain('translate the selected text into 日本語');
    expect(request.messages[0]!.content).toContain('Selected text:');
    expect(options.tabLabel).toBe('Translate');
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

  it('工具调用失败时静默返回且不 present', async () => {
    const { host, present } = makeHost({ callRejects: new Error('no selected text') });
    bindHost(host);
    await flush();

    await expect(selectionActions[0]!.run(view)).resolves.toBeUndefined();
    expect(present).not.toHaveBeenCalled();
  });
});
