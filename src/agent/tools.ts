import type { EditorView } from 'prosemirror-view';

import { APP_AGENT_TOOL } from '@texto/app-api';
import type { AgentToolContribution } from '@texto/app-api';
import type { AgentToolInfo, AgentToolResult, PluginHost } from '@texto/plugin-sdk';
import { getContributionsWithOwner } from '@texto/plugin-sdk';

import { readSelectionContext } from './selection-context';

const DEV = import.meta.env.DEV;

/** 核心工具的所有者 id：核心工具的 execute 收调用方的宿主。 */
const CORE_OWNER = 'core';

interface AgentToolEntry {
  tool: AgentToolContribution;
  ownerId: string;
}

/** 核心内置工具：读当前选区上下文（供 AI 插件手动调用）。 */
const readSelectionContextTool: AgentToolContribution = {
  name: 'core.read-selection-context',
  description:
    'Read the current editor selection, its paragraph, heading chain and anchor rectangle.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(host, args) {
    // 插件在选区动作里能拿到真实 EditorView（`run(view)`），但插件宿主是启动期用
    // no-op deps 装配的，`host.editor` 在真实运行中没有编辑器句柄。优先用调用方传入的
    // view，缺省才回退宿主能力；两者都拿不到时仍视为「没有选区」。
    // `view` 是运行时对象、不可 JSON 序列化，故不出现在 tools.list() 的 parameters 里。
    const view = args.view as EditorView | null | undefined;
    const ctx = view ? readSelectionContext(view) : host.editor.getSelectionContext();
    if (!ctx) throw new Error('no selected text');
    // content 是给模型看的正文，不带视口坐标；details 保留完整快照供插件取锚点。
    return {
      content: JSON.stringify({
        selection: ctx.selection,
        paragraph: ctx.paragraph,
        headings: ctx.headings,
      }),
      details: ctx,
    };
  },
};

const CORE_TOOLS: AgentToolContribution[] = [readSelectionContextTool];
const CORE_NAMES = new Set(CORE_TOOLS.map((tool) => tool.name));

/** 核心命名空间冲突只告警一次，避免每次 list/call 都刷屏。 */
const warnedCoreConflicts = new Set<string>();

/**
 * 合并核心工具与插件贡献。核心命名空间不可覆盖：插件声明 `core.*` 时告警并忽略；
 * 其余同名由扩展点注册表去重（last-wins）。
 */
function resolveTools(): AgentToolEntry[] {
  const byName = new Map<string, AgentToolEntry>();
  for (const tool of CORE_TOOLS) byName.set(tool.name, { tool, ownerId: CORE_OWNER });
  for (const { ownerId, value } of getContributionsWithOwner(APP_AGENT_TOOL)) {
    if (CORE_NAMES.has(value.name)) {
      if (DEV && !warnedCoreConflicts.has(value.name)) {
        warnedCoreConflicts.add(value.name);
        console.warn(`[agent] 工具名占用核心命名空间，已忽略：${value.name}（来自 ${ownerId}）`);
      }
      continue;
    }
    byName.set(value.name, { tool: value, ownerId });
  }
  return [...byName.values()];
}

/** 工具元信息列表（不含实现），供模型 / 调试展示。 */
export function listAgentTools(): AgentToolInfo[] {
  return resolveTools().map(({ tool }) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/**
 * 调用工具；未注册的工具抛错。
 *
 * 插件工具收**贡献方**的宿主（配置 / i18n 按插件隔离）；`hostFor` 由宿主按 ownerId
 * 解析，核心工具仍用调用方宿主。`hostFor` 缺省时退化为调用方宿主。
 */
export async function callAgentTool(
  host: PluginHost,
  name: string,
  args: Record<string, unknown> = {},
  hostFor?: (ownerId: string) => PluginHost,
): Promise<AgentToolResult> {
  const entry = resolveTools().find((item) => item.tool.name === name);
  if (!entry) throw new Error(`unknown agent tool: ${name}`);
  const execHost =
    entry.ownerId === CORE_OWNER ? host : (hostFor?.(entry.ownerId) ?? host);
  return entry.tool.execute(execHost, args);
}

/** 仅供测试：清空「已告警冲突」记忆。 */
export function resetAgentToolWarningsForTests(): void {
  warnedCoreConflicts.clear();
}
