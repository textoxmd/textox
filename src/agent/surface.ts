import { updateAgentSettings } from './config';

/** 承载面切换广播：宿主据此切侧栏 AI tab / 收起 AI 视图（非 Tauri 事件，走 window）。 */
export const AGENT_SURFACE_EVENT = 'agent-surface-changed';

/**
 * 切换 Agent 结果承载面（悬浮块 / 侧栏 AI tab），持久化后广播。
 *
 * 事件是给宿主的「意图通知」：配置写入本身也会经 `config-changed` 同步到
 * 其它窗口，但本窗口的 tab 切换不需要绕一圈 Tauri，直接派发即可。
 */
export async function setAgentSurface(surface: 'floating' | 'sidebar'): Promise<void> {
  await updateAgentSettings({ surface });
  window.dispatchEvent(new CustomEvent(AGENT_SURFACE_EVENT, { detail: { surface } }));
}
