import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeGallery } from '@/components/ThemeEditor/ThemeGallery';
import { getColorThemeTranslationKey, type ColorThemeConfig } from '@/components/styles/theme-registry';
import type { Appearance } from '@/components/styles';

const isFreeVersion = import.meta.env.VITE_FREE_VERSION === 'true';

/** 外观预览：迷你窗口缩略图（浅色 / 深色 / 跟随系统） */
function WindowPane({ dark }: { dark: boolean }) {
  const bg = dark ? '#1c1c1e' : '#ffffff';
  const header = dark ? '#2c2c2e' : '#f2f2f7';
  const line = dark ? '#3a3a3c' : '#e5e5ea';
  const panel = dark ? '#2c2c2e' : '#f2f2f7';
  return (
    <div className="flex h-full w-full flex-col" style={{ background: bg }}>
      <div
        className="flex h-3.5 shrink-0 items-center gap-1 border-b border-black/10 px-1.5"
        style={{ background: header }}
      >
        <span className="size-1.5 rounded-full bg-[#ff5f57]" />
        <span className="size-1.5 rounded-full bg-[#febc2e]" />
        <span className="size-1.5 rounded-full bg-[#28c840]" />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <span className="h-1.5 w-3/4 rounded" style={{ background: line }} />
        <span className="h-1.5 w-1/2 rounded" style={{ background: line }} />
        <span className="mt-1 h-3 w-1/3 rounded ring-1 ring-black/10" style={{ background: panel }} />
      </div>
    </div>
  );
}

function AppearancePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  if (mode === 'system') {
    return (
      <div className="flex h-full w-full">
        <div className="min-w-0 flex-1 overflow-hidden">
          <WindowPane dark={false} />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <WindowPane dark />
        </div>
      </div>
    );
  }
  return <WindowPane dark={mode === 'dark'} />;
}

interface AppearanceStepProps {
  themes: ColorThemeConfig[];
  selectedTheme: string;
  appearance: Appearance;
  onSelectTheme: (id: string) => void;
  onSelectAppearance: (value: Appearance) => void;
}

export function AppearanceStep({
  themes,
  selectedTheme,
  appearance,
  onSelectTheme,
  onSelectAppearance,
}: AppearanceStepProps) {
  const { t } = useTranslation();
  const builtinThemes = themes.filter((th) => th.isBuiltin);
  const userThemes = themes.filter((th) => !th.isBuiltin);

  const getThemeName = (theme: ColorThemeConfig) => {
    if (theme.isBuiltin) return t(getColorThemeTranslationKey(theme.id));
    return theme.label || theme.name;
  };

  const appearanceOptions: { value: Appearance; label: string }[] = [
    { value: 'light', label: t('settings.appearanceLight') },
    { value: 'dark', label: t('settings.appearanceDark') },
    { value: 'system', label: t('settings.appearanceSystem') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{t('onboarding.appearance.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.appearance.desc')}</p>
      </div>

      <div>
        <p className="mb-2 text-xs text-muted-foreground">{t('settings.themePresets')}</p>
        {builtinThemes.length > 0 && (
          <ThemeGallery
            themes={builtinThemes}
            selectedTheme={selectedTheme}
            onSelect={onSelectTheme}
            getThemeName={getThemeName}
            isFreeVersion={isFreeVersion}
            hideEditMenu
          />
        )}

        {userThemes.length > 0 && (
          <>
            <p className="mb-2 mt-4 text-xs text-muted-foreground">
              {t('settings.themeCustomProfiles')}
            </p>
            {/* 自定义主题较多时滚动展示 */}
            <div className="no-scrollbar max-h-44 overflow-y-auto rounded-xl border border-border/60 bg-background p-2">
              <ThemeGallery
                themes={userThemes}
                selectedTheme={selectedTheme}
                onSelect={onSelectTheme}
                getThemeName={getThemeName}
                isFreeVersion={isFreeVersion}
                onUpgradePrompt={() => {
                  import('@/utils/upgradePrompt').then((m) =>
                    m.showUpgradePrompt('upgrade.features.customThemes'),
                  );
                }}
                hideEditMenu
              />
            </div>
          </>
        )}

      </div>

      <div>
        <p className="mb-2 text-xs text-muted-foreground">{t('settings.appearance')}</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {appearanceOptions.map((opt) => {
            const selected = appearance === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelectAppearance(opt.value)}
                className="group flex w-full flex-col items-center gap-2 rounded-2xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className={cn(
                    'w-full rounded-xl p-1.5 transition-all duration-200',
                    selected ? 'bg-primary/10 shadow-md' : '',
                  )}
                >
                  <div
                    className={cn(
                      'relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-background transition-all duration-200',
                      selected ? '' : 'ring-1 ring-border/40 group-hover:ring-border',
                    )}
                  >
                    <AppearancePreview mode={opt.value} />
                    {selected && (
                      <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    'text-xs',
                    selected ? 'font-medium text-primary' : 'text-muted-foreground',
                  )}
                >
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}
