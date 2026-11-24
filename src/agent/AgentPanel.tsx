import { useTranslation } from 'react-i18next';
import { AgentResultView, useAgentSession } from './ResultView';

/**
 * 侧栏释义视图：有结果才渲染；空态由「释义 tab 不显示」承担。
 */
export function AgentPanel() {
  const { t } = useTranslation();
  const session = useAgentSession();
  if (session.status === 'idle') return null;
  return (
    <div className="agent-sidebar-panel" aria-label={session.tabLabel || t('agent.panelTitle')}>
      <AgentResultView variant="sidebar" />
    </div>
  );
}
