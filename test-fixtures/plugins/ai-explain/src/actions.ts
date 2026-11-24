import type {
  AgentAnchorRect,
  AgentPresentSize,
  PluginHost,
  SelectionContextSnapshot,
} from '@texto/plugin-sdk';
import type { SelectionActionMeta } from '@texto/markdown-editor-api';
import { buildSelectionPrompt, commonPromptMessages } from '@texto/ai-prompt';

let host: PluginHost | null = null;
/** 当前选中的模型配置 id；`when` 是同步的，靠 bindHost 读取 + 订阅维护。 */
let profileId = '';
/** bind 代次：旧 bind 的订阅回调与迟到的初次读取都按代次丢弃。 */
let bindSeq = 0;
/** 本次 bind 是否已收到过订阅推送；迟到的初次读取不再覆盖更新的值。 */
let synced = false;
let unsubscribe: (() => void) | null = null;

export function bindHost(value: PluginHost): void {
  const seq = ++bindSeq;
  host = value;
  profileId = '';
  synced = false;
  unsubscribe?.();
  unsubscribe = value.config.subscribe((config) => {
    if (seq !== bindSeq) return;
    const next = config.modelProfile;
    profileId = typeof next === 'string' ? next : '';
    synced = true;
  });
  void value.config
    .get<unknown>('modelProfile')
    .then((stored) => {
      if (seq !== bindSeq || synced) return;
      profileId = typeof stored === 'string' ? stored : '';
    })
    .catch((error: unknown) => {
      if (seq !== bindSeq) return;
      value.log.warn('[ai-explain] 读取 modelProfile 失败', error);
    });
}

const SUMMARY_LENGTH = 20;
/** 悬浮结果卡尺寸：宽度固定，最大高度限制在视口内（宿主仍会按视口夹取）。 */
const CARD_SIZE: AgentPresentSize = { width: 420, maxHeight: 480 };

function summaryOf(selection: string): string {
  return selection.replace(/\n/g, ' ').slice(0, SUMMARY_LENGTH).trim();
}

/**
 * 工具结果来自外部实现，只接受最小可信形状：非空 selection、字符串 paragraph、
 * 数组 headings；anchor 只在是对象时采用（可能缺失）。
 */
function toSelectionContext(details: unknown): SelectionContextSnapshot | null {
  if (!details || typeof details !== 'object') return null;
  const value = details as Record<string, unknown>;
  if (typeof value.selection !== 'string' || !value.selection.trim()) return null;
  if (typeof value.paragraph !== 'string') return null;
  if (!Array.isArray(value.headings)) return null;
  const anchor =
    typeof value.anchor === 'object' && value.anchor !== null
      ? (value.anchor as AgentAnchorRect)
      : null;
  return {
    selection: value.selection,
    paragraph: value.paragraph,
    headings: value.headings.filter((item): item is string => typeof item === 'string'),
    anchor,
  };
}

export const selectionActions: SelectionActionMeta[] = [
  {
    id: 'ai-explain.explain',
    labelKey: 'ai-explain.explain',
    icon: 'book-open-text',
    order: 0,
    when: () => host?.agent.available(profileId) ?? false,
    async run(view) {
      if (!host) return;
      // 运行期间配置可能被改：进入时快照，并保证快照仍可用。
      const profile = profileId;
      if (!host.agent.available(profile)) return;
      let details: unknown;
      try {
        // v1 手动调用核心工具取上下文；模型自主调用工具是后续版本。
        // 插件宿主是启动期 no-op 装配的，必须把真实编辑器视图交给工具。
        ({ details } = await host.agent.tools.call('core.read-selection-context', { view }));
      } catch {
        // 无选区 / 工具失败：静默返回，避免在控制台留下噪音。
        return;
      }
      const ctx = toSelectionContext(details);
      // 工具拿不到选区或锚点时不动 UI。
      if (!ctx || !ctx.anchor) return;
      const common = commonPromptMessages(host.i18n.language());
      const task = host.i18n.t('promptTask', { language: common.languageName });
      const { system, user } = buildSelectionPrompt(ctx, { ...common, task });
      const summary = summaryOf(ctx.selection);
      const title = host.i18n.t('explain');
      host.agent.present(
        { system, messages: [{ role: 'user', content: user }] },
        {
          profileId: profile,
          anchor: ctx.anchor,
          title: summary ? `${title} · ${summary}` : title,
          tabLabel: title,
          sourceText: ctx.selection,
          size: CARD_SIZE,
        },
      );
    },
  },
];
