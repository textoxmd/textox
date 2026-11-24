import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { OnboardingConfig } from '../types';
import { LanguageWheel } from '../LanguageWheel';
import { Typewriter } from '../Typewriter';
import '../onboarding.css';

const BUILT_IN_LANGS = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en-US', name: 'English' },
  { code: 'ja-JP', name: '日本語' },
  { code: 'ko-KR', name: '한국어' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'es-ES', name: 'Español' },
  { code: 'it-IT', name: 'Italiano' },
  { code: 'pt-PT', name: 'Português' },
  { code: 'ru-RU', name: 'Русский' },
  { code: 'ar-SA', name: 'العربية' },
  { code: 'hi-IN', name: 'हिन्दी' },
  { code: 'vi-VN', name: 'Tiếng Việt' },
  { code: 'th-TH', name: 'ไทย' },
];

interface WelcomeStepProps {
  config: OnboardingConfig | null;
  onSelectLanguage: (code: string) => void;
}

export function WelcomeStep({ config, onSelectLanguage }: WelcomeStepProps) {
  const { t, i18n } = useTranslation();
  const [langCode, setLangCode] = useState(
    () => config?.language || i18n.language || 'zh-CN',
  );
  const [oldTitle, setOldTitle] = useState('');
  const [fadingOut, setFadingOut] = useState(false);
  const [typeKey, setTypeKey] = useState(0);
  const outTimer = useRef<number | null>(null);

  // 切换语言：旧文字完整淡出（200ms）→ 切换 i18n → 新文字逐字打出
  const handleLanguageChange = useCallback(
    (code: string) => {
      if (code === langCode) return;
      setOldTitle(t('onboarding.welcome.title'));
      setFadingOut(true);
      if (outTimer.current) window.clearTimeout(outTimer.current);
      outTimer.current = window.setTimeout(() => {
        setLangCode(code);
        onSelectLanguage(code);
        setFadingOut(false);
        setTypeKey((k) => k + 1);
      }, 200);
    },
    [langCode, onSelectLanguage, t],
  );

  useEffect(() => {
    return () => {
      if (outTimer.current) window.clearTimeout(outTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <img
        src="/icon.png"
        alt="Textox"
        draggable={false}
        className="size-32 shrink-0 rounded-2xl drop-shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
      />
      {/* 固定高度文字区：换语言时文字在框内居中，不挤压下方滚轮位置 */}
      <div
        className="relative flex h-[72px] w-full max-w-[320px] shrink-0 flex-col items-center justify-center"
      >
        {fadingOut && (
          <div
            key={`old-${typeKey}`}
            className="onboarding-fade-out absolute inset-0 flex flex-col items-center justify-center"
          >
            <h2 className="text-2xl font-semibold tracking-tight">{oldTitle}</h2>
          </div>
        )}
        <div
          className={cn(
            'flex flex-col items-center justify-center',
            fadingOut && 'opacity-0',
          )}
        >
          <h2
            className="text-2xl font-semibold tracking-tight"
            aria-label={t('onboarding.welcome.title')}
          >
            <Typewriter key={typeKey} text={t('onboarding.welcome.title')} />
          </h2>
        </div>
      </div>
      <div className="w-full max-w-[300px] shrink-0">
        <LanguageWheel
          languages={BUILT_IN_LANGS}
          defaultValue={langCode}
          onChange={(code) => {
            handleLanguageChange(code);
          }}
        />
      </div>
    </div>
  );
}
