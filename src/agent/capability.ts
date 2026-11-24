import type { AgentCapability, PluginHost } from '@texto/plugin-sdk';

import { agentAvailable, getAgentSettings, listAgentProfiles } from './config';
import { startAgentRun } from './run';
import { runAgent } from './runtime';
import { failAgentSession } from './session';
import { AGENT_SURFACE_EVENT } from './surface';
import { callAgentTool, listAgentTools } from './tools';

/**
 * 宿主暴露给插件的 Agent 能力。
 *
 * 不静态 import presenter：`plugins/host` 在启动期就要装配好宿主，
 * 而 presenter 带 DOM 挂载副作用（createRoot / document.body），
 * 只在真正 `present()` 时动态加载，非 UI 调用（`available()` / `run()`）不引入。
 *
 * `host` 用于工具执行（工具通过宿主能力取编辑器/配置），`hostFor` 按贡献方 id
 * 解析插件宿主，保证插件工具拿到的配置 / i18n 属于它自己。均在宿主装配时回填。
 */
export function agentCapability(
  host: PluginHost,
  hostFor: (ownerId: string) => PluginHost,
): AgentCapability {
  return {
    available: (profileId) => agentAvailable(profileId),
    run: (request, handlers, options) =>
      runAgent(request, handlers, { writeSession: false, profileId: options.profileId }),
    present(request, options) {
      const handle = startAgentRun(
        request,
        options.anchor,
        options.title ?? '',
        options.tabLabel ?? '',
        options.sourceText ?? '',
        options.profileId,
      );
      // 侧栏承载面：通知宿主展开侧栏并切到 AI tab（App 监听该事件）。
      if (getAgentSettings().surface === 'sidebar') {
        window.dispatchEvent(new CustomEvent(AGENT_SURFACE_EVENT, { detail: { surface: 'sidebar' } }));
      }
      // 始终挂载悬浮块；surface=sidebar 时由设置订阅隐藏，浮回时复用。
      void import('./presenter')
        .then((m) => m.attachFloatingCard(options.anchor, options.size))
        .catch((error: unknown) => {
          // 视图挂不出来就没有承载面：先写错误态再中止，避免 abort 里的 finish 覆盖错误。
          console.error('[agent] presenter load failed', error);
          failAgentSession(String(error));
          handle.abort();
        });
      return handle;
    },
    profiles: {
      list: () =>
        listAgentProfiles().map((profile) => ({
          id: profile.id,
          name: profile.name,
          provider: profile.provider,
          model: profile.model,
          enabled: profile.enabled,
        })),
    },
    tools: {
      list: () => listAgentTools(),
      call: (name, args) => callAgentTool(host, name, args, hostFor),
    },
  };
}
