import { useSyncExternalStore } from 'react';
import { getAgentSession, subscribeAgentSession } from './session';
import type { AgentSessionStatus } from './session';

/**
 * 只订阅状态原语：文本增量仍会触发 listener，但 React 会比较快照，
 * 状态不变时不重渲染 App。
 */
export function useAgentSessionStatus(): AgentSessionStatus {
  return useSyncExternalStore(
    subscribeAgentSession,
    () => getAgentSession().status,
    () => getAgentSession().status,
  );
}

/**
 * 只订阅 tab 标签原语；文本增量不会重渲染 App。
 */
export function useAgentSessionTabLabel(): string {
  return useSyncExternalStore(
    subscribeAgentSession,
    () => getAgentSession().tabLabel,
    () => getAgentSession().tabLabel,
  );
}
