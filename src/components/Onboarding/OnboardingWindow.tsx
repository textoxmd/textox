import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import {
  applyAppearance,
  applyColorTheme,
  getCurrentAppearance,
  getCurrentColorTheme,
  setAppearance,
  setColorTheme,
  type Appearance,
} from '@/components/styles';
import {
  getAvailableThemes,
  initThemeRegistry,
  type ColorThemeConfig,
} from '@/components/styles/theme-registry';
import { IS_WINDOWS } from '@/utils/windowManager';
import { isRTLLanguage } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  loadOnboardingState,
  markOnboardingSeen,
  setOnboardingMuted,
} from './onboardingStore';
import type { OnboardingConfig } from './types';
import { WelcomeStep } from './steps/WelcomeStep';
import { StartupModeStep } from './steps/StartupModeStep';
import { BookmarkMigrationStep } from './steps/BookmarkMigrationStep';
import { AppearanceStep } from './steps/AppearanceStep';
import { PluginModeStep } from './steps/PluginModeStep';
import { FinishStep } from './steps/FinishStep';

type StepId = 'welcome' | 'startup' | 'bookmarks' | 'appearance' | 'pluginMode' | 'finish';

/** 需要整宽渲染的步骤（内容区不受 560px 限制）。 */
const WIDE_STEPS: StepId[] = ['pluginMode'];

/** 步骤淡出时长，与 onboarding.css 中 leave 动画时长保持一致 */
const STEP_FADE_MS = 200;

export function OnboardingWindow() {
  const { t, i18n } = useTranslation();
  const [currentStep, setCurrentStep] = useState<StepId>('welcome');
  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [themes, setThemes] = useState<ColorThemeConfig[]>([]);
  const [muted, setMutedState] = useState(false);
  const versionRef = useRef('');
  // 步骤切换：先淡出当前步骤，再挂载新步骤淡入
  const [stepPhase, setStepPhase] = useState<'enter' | 'leave'>('enter');
  const [stepDirection, setStepDirection] = useState<'next' | 'back'>('next');
  const [stepKey, setStepKey] = useState(0);
  const stepTimer = useRef<number | null>(null);

  const steps = useMemo<StepId[]>(() => {
    const list: StepId[] = ['welcome', 'startup'];
    if (!IS_WINDOWS) list.push('bookmarks');
    list.push('appearance', 'pluginMode', 'finish');
    return list;
  }, []);

  const stepIndex = steps.indexOf(currentStep);
  const isWideStep = WIDE_STEPS.includes(currentStep);

  const load = useCallback(async () => {
    try {
      const [cfg, ver] = await Promise.all([
        invoke<any>('get_config'),
        invoke<string>('get_app_version'),
      ]);
      versionRef.current = ver;
      setConfig({
        startup_behavior: cfg.startup_behavior,
        workspace_folder: cfg.workspace_folder,
        color_theme: cfg.color_theme,
        appearance: cfg.appearance,
        editor_font_family: cfg.editor_font_family,
        language: cfg.language,
        custom_lang_hash: cfg.custom_lang_hash,
      });
      setMutedState(loadOnboardingState().muted);
      await initThemeRegistry();
      setThemes(getAvailableThemes());
    } catch (error) {
      console.error('Failed to load onboarding data:', error);
    }
  }, []);

  // 主题（含暗色背景）就绪后再显示窗口，避免白屏闪烁
  useEffect(() => {
    (async () => {
      try {
        await initThemeRegistry();
        await applyColorTheme(getCurrentColorTheme());
        applyAppearance(getCurrentAppearance());
      } catch (error) {
        console.error('[OnboardingWindow] Theme init failed:', error);
      }
      void load();
      try {
        const win = getCurrentWindow();
        await win.show();
      } catch (error) {
        console.error('[OnboardingWindow] Failed to show window:', error);
      }
    })();
  }, [load]);

  // 窗口被关闭（含原生关闭按钮）时记录当前版本已看过
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onCloseRequested(() => {
      markOnboardingSeen(versionRef.current);
      // 通知主窗口：引导已完成，可以显示编辑器
      emit('onboarding-closed').catch(() => {});
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  const finish = useCallback(() => {
    markOnboardingSeen(versionRef.current);
    getCurrentWindow().close().catch(() => {});
  }, []);

  const goToStep = useCallback(
    (nextStep: StepId, direction: 'next' | 'back') => {
      if (stepPhase === 'leave') return;
      setStepDirection(direction);
      setStepPhase('leave');
      stepTimer.current = window.setTimeout(() => {
        setCurrentStep(nextStep);
        setStepKey((k) => k + 1);
        setStepPhase('enter');
      }, STEP_FADE_MS);
    },
    [stepPhase],
  );

  const goNext = useCallback(() => {
    const idx = steps.indexOf(currentStep);
    if (idx >= steps.length - 1) {
      finish();
      return;
    }
    goToStep(steps[idx + 1], 'next');
  }, [currentStep, steps, finish, goToStep]);

  const goBack = useCallback(() => {
    const idx = steps.indexOf(currentStep);
    if (idx > 0) goToStep(steps[idx - 1], 'back');
  }, [currentStep, steps, goToStep]);

  // 卸载时清理步骤切换定时器
  useEffect(() => {
    return () => {
      if (stepTimer.current) window.clearTimeout(stepTimer.current);
    };
  }, []);

  // 显示后确保处于最前（配合 Rust 侧 always-on-top）
  useEffect(() => {
    const win = getCurrentWindow();
    const id = window.setTimeout(() => {
      win.setFocus().catch(() => {});
    }, 80);
    return () => window.clearTimeout(id);
  }, []);

  // document 级键盘监听：焦点在任意位置（含 body）时上下键都能驱动滚轮，
  // 左右键切换步骤，Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finish();
        return;
      }
      const target = e.target as HTMLElement | null;
      // 滚轮自身聚焦时由它自己处理方向键
      if (target?.closest?.('[data-rwp]')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const wheel = document.querySelector<HTMLElement>('[data-rwp]');
        if (wheel) {
          wheel.dispatchEvent(
            new KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true }),
          );
        }
        return;
      }
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goBack();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goBack, finish]);

  // 非滚轮区域滚动时，把滚动量转发给语言滚轮（滚轮自带节流与动画）
  const handleWindowWheel = useCallback((e: React.WheelEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest?.('[data-rwp]')) return;
    const wheel = document.querySelector<HTMLElement>('[data-rwp]');
    if (!wheel) return;
    wheel.dispatchEvent(
      new WheelEvent('wheel', { deltaY: e.deltaY, bubbles: true, cancelable: true }),
    );
  }, []);

  const updateConfig = useCallback(async (patch: Partial<OnboardingConfig>) => {
    try {
      const current = await invoke<any>('get_config');
      await invoke('set_config', { config: { ...current, ...patch } });
    } catch (error) {
      console.error('Failed to save onboarding config:', error);
    }
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleStartupChange = useCallback(
    (behavior: 'blank' | 'workspace', folder?: string | null) => {
      if (behavior === 'workspace' && folder) {
        invoke('create_bookmark', { path: folder }).catch(() => {});
        void updateConfig({ startup_behavior: 'workspace', workspace_folder: folder });
      } else {
        void updateConfig({ startup_behavior: behavior });
      }
    },
    [updateConfig],
  );

  const handleSelectTheme = useCallback(
    (id: string) => {
      setColorTheme(id);
      void updateConfig({ color_theme: id });
    },
    [updateConfig],
  );

  const handleSelectAppearance = useCallback(
    (value: Appearance) => {
      setAppearance(value);
      void updateConfig({ appearance: value });
    },
    [updateConfig],
  );

  const handleSelectLanguage = useCallback(
    (code: string) => {
      void i18n.changeLanguage(code);
      void updateConfig({ language: code, custom_lang_hash: '' });
    },
    [i18n, updateConfig],
  );

  const renderStep = () => {
    if (!config) {
      return <div className="flex h-40 items-center justify-center" />;
    }
    switch (currentStep) {
      case 'welcome':
        return <WelcomeStep config={config} onSelectLanguage={handleSelectLanguage} />;
      case 'startup':
        return <StartupModeStep config={config} onChangeStartup={handleStartupChange} />;
      case 'bookmarks':
        return <BookmarkMigrationStep />;
      case 'appearance':
        return (
          <AppearanceStep
            themes={themes}
            selectedTheme={config.color_theme || 'default'}
            appearance={config.appearance || 'system'}
            onSelectTheme={handleSelectTheme}
            onSelectAppearance={handleSelectAppearance}
          />
        );
      case 'pluginMode':
        return <PluginModeStep />;
      case 'finish':
        return (
          <FinishStep
            muted={muted}
            onToggleMute={(value) => {
              setMutedState(value);
              setOnboardingMuted(value);
            }}
          />
        );
    }
  };

  return (
    <div
      dir={isRTLLanguage(i18n.language) ? 'rtl' : 'ltr'}
      className="flex h-screen flex-col overflow-hidden"
      onWheel={handleWindowWheel}
    >
      {/* 顶部拖拽区域（macOS overlay 标题栏 / Windows 无装饰窗口共用） */}
      <div className="h-10 w-full shrink-0" data-tauri-drag-region={true} />

      <div
        className={cn(
          'flex flex-1 flex-col justify-center pb-2',
          isWideStep ? 'px-7' : 'px-10',
        )}
      >
        <div className={cn('mx-auto w-full', isWideStep ? 'max-w-none' : 'max-w-[560px]')}>
          <div
            key={stepKey}
            className={
              stepPhase === 'leave'
                ? `onboarding-step-leave onboarding-step-leave-${stepDirection}`
                : `onboarding-step-enter onboarding-step-enter-${stepDirection}`
            }
          >
            {renderStep()}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-8 pb-8">
        {stepIndex > 0 ? (
          <Button variant="ghost" onClick={goBack}>
            {t('onboarding.nav.back')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {currentStep === 'finish' ? (
            <Button onClick={finish}>
              {t('onboarding.nav.done')}
            </Button>
          ) : (
            <Button onClick={goNext}>
              {t('onboarding.nav.next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
