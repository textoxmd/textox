import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { WorkspaceFolderPicker } from '@/components/WorkspaceFolderPicker';
import type { OnboardingConfig } from '../types';

interface StartupModeStepProps {
  config: OnboardingConfig;
  onChangeStartup: (behavior: 'blank' | 'workspace', folder?: string | null) => void;
}

export function StartupModeStep({ config, onChangeStartup }: StartupModeStepProps) {
  const { t } = useTranslation();
  const isWorkspace = config.startup_behavior === 'workspace';
  const workspaceFolder = config.workspace_folder;

  const options = [
    {
      id: 'blank' as const,
      title: t('onboarding.startup.blank'),
      desc: t('onboarding.startup.blankDesc'),
    },
    {
      id: 'workspace' as const,
      title: t('onboarding.startup.workspace'),
      desc: t('onboarding.startup.workspaceDesc'),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{t('onboarding.startup.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.startup.desc')}</p>
      </div>

      {/* 单选列表（固定两行） */}
      <div className="space-y-2">
        {options.map(({ id, title, desc }) => {
          const selected = isWorkspace === (id === 'workspace');
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeStartup(id, workspaceFolder)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                selected
                  ? 'border-border bg-muted/40'
                  : 'border-border/60 bg-background hover:border-border',
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                  selected ? 'border-primary' : 'border-border',
                )}
              >
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 固定高度详情区：切换模式不会引起布局变化 */}
      <div className="flex h-14 items-center gap-3 rounded-xl border border-border/60 bg-background px-4">
        {isWorkspace ? (
          <>
            <span className="shrink-0 text-sm text-muted-foreground">
              {t('settings.workspaceFolder')}
            </span>
            <WorkspaceFolderPicker
              value={workspaceFolder ?? null}
              placeholder={t('settings.chooseWorkspaceFolder')}
              onSelect={(path) => onChangeStartup('workspace', path)}
            />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{t('onboarding.startup.blankHint')}</span>
        )}
      </div>
    </div>
  );
}
