import { useTranslation } from 'react-i18next';
import { Check, Info } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

interface FinishStepProps {
  muted: boolean;
  onToggleMute: (muted: boolean) => void;
}

export function FinishStep({ muted, onToggleMute }: FinishStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center">
      <div
        className="onboarding-finish-badge"
        role="img"
        aria-label={t('onboarding.finish.title')}
      >
        <Check className="size-8" strokeWidth={2.5} aria-hidden />
      </div>

      <div className="flex flex-col items-center gap-2">
        <h2 className="text-3xl font-semibold tracking-tight">
          {t('onboarding.finish.title')}
        </h2>
        <p className="max-w-[420px] text-sm text-muted-foreground">
          {t('onboarding.finish.desc')}
        </p>
      </div>

      <div className="flex max-w-[440px] items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-2.5 text-xs leading-5 text-muted-foreground">
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span>{t('onboarding.finish.hint')}</span>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={muted} onCheckedChange={(v) => onToggleMute(v === true)} />
        {t('onboarding.finish.noPrompt')}
      </label>
    </div>
  );
}
