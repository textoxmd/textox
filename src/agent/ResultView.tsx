import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Copy,
  PanelRight,
  PictureInPicture2,
  Quote,
  RotateCcw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ModelSettingsIcon } from '@/components/icons';
import { ScrollEdges, useScrollEdges } from '@/components/sidebar/ScrollEdges';
import { AgentMarkdown } from './AgentMarkdown';
import {
  findAgentProfile,
  getAgentSettings,
  subscribeAgentSettings,
  upsertAgentProfile,
} from './config';
import { openAgentLink } from './links';
import { modelOptionsFor } from './providers-catalog';
import { ProviderIcon } from './ProviderIcon';
import { abortActiveAgentRun, startAgentRun } from './run';
import { getAgentSession, resetAgentSession, subscribeAgentSession } from './session';
import { setAgentSurface } from './surface';

export function useAgentSession() {
  return useSyncExternalStore(subscribeAgentSession, getAgentSession, getAgentSession);
}

export function useAgentSurface() {
  return useSyncExternalStore(
    subscribeAgentSettings,
    () => getAgentSettings().surface,
    () => getAgentSettings().surface,
  );
}

/**
 * 本轮会话绑定的模型配置（按 `session.profileId` 反查）。
 * 配置已被删除时返回 null，由调用方退回通用标签。
 *
 * 同时订阅配置变更：配置被编辑/删除后视图立即反映（`getSnapshot` 收回同一
 * settings 下的同一对象引用，不会触发重渲染循环）。
 */
export function useAgentProfile() {
  const session = useAgentSession();
  const profileId = session.profileId;
  return useSyncExternalStore(
    subscribeAgentSettings,
    () => findAgentProfile(profileId),
    () => findAgentProfile(profileId),
  );
}

/**
 * 悬浮块与侧栏面板共用的结果视图。
 *
 * 侧栏顶部有一条常驻状态行（流式时显示加载声波）；悬浮卡没有状态行。
 * 底部工具条参考 macOS 26 的滚动边缘效果：内容延伸到工具条下方时，
 * 底边出现从透明到底色的渐隐；胶囊本身保持玻璃质感。
 */
export function AgentResultView({ variant }: { variant: 'floating' | 'sidebar' }) {
  const { t } = useTranslation();
  const session = useAgentSession();
  const profile = useAgentProfile();
  const provider = profile?.provider ?? 'custom';
  const modelName = profile?.model ?? '';
  const [sourceOpen, setSourceOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const isSidebar = variant === 'sidebar';
  // 正文滚动状态同时驱动底边渐隐（工具条）与侧栏顶边渐隐
  const bodyEdges = useScrollEdges<HTMLDivElement>();

  useEffect(() => setSourceOpen(false), [session.id]);
  useEffect(() => setModelMenuOpen(false), [session.id]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.agent-model-menu, .agent-result-model-toggle')) return;
      setModelMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modelMenuOpen]);

  const models = modelOptionsFor(provider, modelName);

  const chooseModel = (next: string) => {
    setModelMenuOpen(false);
    if (!profile || next === modelName) return;
    // 只按 id 合并这一条：磁盘上其它（含未知 provider）条目与 API Key 保持原样。
    void upsertAgentProfile({ ...profile, model: next }).catch(() => {});
  };

  const copy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      toast.error(t('agent.copyFailed'));
      return;
    }
    void clipboard
      .writeText(session.text)
      .then(() => toast.success(t('agent.copied')))
      .catch(() => toast.error(t('agent.copyFailed')));
  };

  const retry = () => {
    if (!session.request) return;
    startAgentRun(
      session.request,
      session.anchor,
      session.title,
      session.tabLabel,
      session.sourceText,
      session.profileId,
    );
  };

  const toggleSurface = () => {
    void setAgentSurface(isSidebar ? 'floating' : 'sidebar').catch(() => {});
  };

  const close = () => {
    abortActiveAgentRun();
    resetAgentSession();
  };

  if (session.status === 'idle') return null;

  const body =
    session.text.length === 0 ? (
      !isSidebar && session.status === 'streaming' ? (
        <div ref={bodyEdges.ref} className="agent-result-body agent-result-placeholder">
          …
        </div>
      ) : null
    ) : (
      <div ref={bodyEdges.ref} className="agent-result-body">
        <AgentMarkdown
          source={session.text}
          isAnimating={session.status === 'streaming'}
          onLinkClick={openAgentLink}
        />
      </div>
    );

  const renderActions = () => (
    <div className="agent-result-actions">
      <button
        type="button"
        className="agent-result-model-toggle"
        title={t('agent.switchModel')}
        aria-label={t('agent.switchModel')}
        aria-haspopup="menu"
        aria-expanded={modelMenuOpen}
        onClick={() => {
          setModelMenuOpen((open) => !open);
          setSourceOpen(false);
        }}
      >
        <ProviderIcon provider={provider} size={15} />
      </button>
      {isSidebar && session.sourceText ? (
        <button
          type="button"
          className="agent-result-source-toggle"
          title={t('agent.source')}
          aria-label={t('agent.source')}
          aria-expanded={sourceOpen}
          onClick={() => {
            setSourceOpen((open) => !open);
            setModelMenuOpen(false);
          }}
        >
          <Quote size={14} />
        </button>
      ) : null}
      <button type="button" title={t('agent.copy')} aria-label={t('agent.copy')} onClick={copy}>
        <Copy size={14} />
      </button>
      <button
        type="button"
        title={t('agent.retry')}
        aria-label={t('agent.retry')}
        onClick={retry}
      >
        <RotateCcw size={14} />
      </button>
      <button
        type="button"
        title={isSidebar ? t('agent.floatBack') : t('agent.moveToSidebar')}
        aria-label={isSidebar ? t('agent.floatBack') : t('agent.moveToSidebar')}
        onClick={toggleSurface}
      >
        {isSidebar ? <PictureInPicture2 size={14} /> : <PanelRight size={14} />}
      </button>
      <button
        type="button"
        title={t('agent.close')}
        aria-label={t('agent.close')}
        onClick={close}
      >
        <X size={14} />
      </button>
    </div>
  );

  return (
    <div
      className={`agent-result agent-result-${variant}${bodyEdges.canScrollDown ? ' has-scroll-underlap' : ''}`}
    >
      {isSidebar ? (
        <div className="agent-result-header">
          {session.status === 'streaming' ? (
            <span className="agent-result-busy" aria-hidden="true">
              <ModelSettingsIcon className="agent-result-busy-wave" />
            </span>
          ) : null}
        </div>
      ) : null}
      {session.status === 'error' && session.error ? (
        <div className="agent-result-error">{session.error}</div>
      ) : null}
      {isSidebar ? (
        <div className="agent-result-body-area">
          {body}
          <ScrollEdges
            sides="top"
            canScrollUp={bodyEdges.canScrollUp}
            canScrollDown={bodyEdges.canScrollDown}
          />
        </div>
      ) : (
        body
      )}
      {isSidebar && sourceOpen && session.sourceText ? (
        <div className="agent-result-source-panel" role="region" aria-label={t('agent.source')}>
          <div className="agent-result-source-panel-header">
            <span>{t('agent.source')}</span>
            <button
              type="button"
              title={t('agent.close')}
              aria-label={t('agent.close')}
              onClick={() => setSourceOpen(false)}
            >
              <X size={12} />
            </button>
          </div>
          <blockquote className="agent-result-source">{session.sourceText}</blockquote>
        </div>
      ) : null}
      <div className="agent-result-footer">
        {renderActions()}
        {modelMenuOpen ? (
          <div className="agent-model-menu" role="menu">
            {models.length ? (
              models.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item === modelName}
                  onClick={() => chooseModel(item)}
                >
                  <span>{item}</span>
                  {item === modelName ? <Check size={12} /> : null}
                </button>
              ))
            ) : (
              <div className="agent-model-menu-empty">{modelName || provider}</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
