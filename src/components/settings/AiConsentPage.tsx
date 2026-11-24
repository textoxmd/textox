import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { hasOverseasProvider } from '@/agent/consent';
import type { AgentProviderId } from '@/agent/providers-catalog';
import { providerMeta } from '@/agent/providers-catalog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type NamedProvider = Exclude<AgentProviderId, 'custom'>;

const RECIPIENTS: Record<NamedProvider, { key: string; fallback: string }> = {
  deepseek: { key: 'settings.aiConsent.recipientDeepseek', fallback: 'DeepSeek（深度求索）' },
  zhipu: { key: 'settings.aiConsent.recipientZhipu', fallback: '智谱 GLM' },
  moonshot: { key: 'settings.aiConsent.recipientMoonshot', fallback: '月之暗面 Kimi' },
  qwen: { key: 'settings.aiConsent.recipientQwen', fallback: '阿里云通义千问' },
  openai: { key: 'settings.aiConsent.recipientOpenai', fallback: 'OpenAI' },
  anthropic: { key: 'settings.aiConsent.recipientAnthropic', fallback: 'Anthropic Claude' },
  google: { key: 'settings.aiConsent.recipientGoogle', fallback: 'Google Gemini' },
  xai: { key: 'settings.aiConsent.recipientXai', fallback: 'xAI Grok' },
};

export interface AiConsentPageProps {
  providers: AgentProviderId[];
  onCancel(): void;
  onAgree(): void | Promise<void>;
}

function RecipientList({ providers }: { providers: AgentProviderId[] }) {
  const { t } = useTranslation();
  const named = providers.filter((provider): provider is NamedProvider => provider !== 'custom');

  return (
    <div className="ai-consent-block">
      <span className="ai-consent-label">
        {t('settings.aiConsent.recipientsTitle', '接收方')}
      </span>
      {named.length > 0 && (
        <ul className="ai-consent-recipients">
          {named.map((provider) => {
            const meta = providerMeta(provider);
            const recipient = RECIPIENTS[provider];
            return (
              <li key={provider}>
                <span>{t(recipient.key, recipient.fallback)}</span>
                {meta && (
                  <a href={meta.privacyUrl} target="_blank" rel="noreferrer">
                    {t('settings.aiConsent.privacyLink', '隐私政策')}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {providers.includes('custom') && (
        <p className="ai-consent-note">
          {t(
            'settings.aiConsent.customRegionNote',
            '自定义服务由你填写地址，请自行确认其运营方与数据处理方式。',
          )}
        </p>
      )}
    </div>
  );
}

function SentData() {
  const { t } = useTranslation();
  return (
    <div className="ai-consent-block">
      <span className="ai-consent-label">{t('settings.aiConsent.dataTitle', '发送内容')}</span>
      <p className="ai-consent-text">
        {t(
          'settings.aiConsent.dataBody',
          '发送内容取决于你使用的功能。当前功能只发送选中文本（不超过 4000 字符）、所在段落（不超过 2000 字符）、所在章节的标题，以及你输入的提示词。若后续功能需要读取当前文档、你指定的文件或工作区文档，Textox 会在该功能首次使用前说明发送范围，并重新征得你的同意。内容送达服务商后的留存与使用，适用该服务商的隐私政策。',
        )}
      </p>
    </div>
  );
}

export function AiConsentPage({ providers, onCancel, onAgree }: AiConsentPageProps) {
  const { t } = useTranslation();
  const twoStep = hasOverseasProvider(providers);
  const [step, setStep] = useState(1);
  const [accepted, setAccepted] = useState(false);
  const [crossBorder, setCrossBorder] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onLastStep = !twoStep || step === 2;
  const ready = accepted && (!twoStep || crossBorder);

  const agree = () => {
    if (submitting) return;
    setSubmitting(true);
    void Promise.resolve()
      .then(onAgree)
      .catch((error: unknown) => {
        console.error('[ai-consent] 写入同意记录失败', error);
      })
      .finally(() => setSubmitting(false));
  };

  const title = !twoStep
    ? t('settings.aiConsent.titleEnable', '开启 AI 功能')
    : step === 1
      ? t('settings.aiConsent.titleRecipients', '你的内容会发送到这些服务商')
      : t('settings.aiConsent.crossBorderTitle', '个人信息出境');

  const subtitle =
    twoStep && step === 2
      ? t(
          'settings.aiConsent.crossBorderBody',
          '这些服务商可能位于你所在的国家或地区之外，选中的内容与提示词会传输给它们处理，并由其政策决定留存与使用。',
        )
      : t('settings.aiConsent.transportBody', '请求由本机直接发往服务商，不经过 Textox 服务器。');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent className="ai-consent-dialog">
        {twoStep && (
          <div className="ai-consent-stepper">
            <span className="ai-consent-step">
              {t('settings.aiConsent.stepOf', '第 {{current}} 步 / 共 {{total}} 步', {
                current: step,
                total: 2,
              })}
            </span>
            <span className="ai-consent-progress" aria-hidden="true">
              <span className="is-done" />
              <span className={step === 2 ? 'is-done' : ''} />
            </span>
          </div>
        )}

        <DialogTitle className="ai-consent-title">{title}</DialogTitle>
        <DialogDescription className="ai-consent-subtitle">{subtitle}</DialogDescription>

        <div className="ai-consent-body">
          {(!twoStep || step === 1) && (
            <>
              <RecipientList providers={providers} />
              <SentData />
            </>
          )}

          {onLastStep && (
            <>
              <p className="ai-consent-control">
                {t(
                  'settings.aiConsent.controlNote',
                  'API Key 明文保存在本机配置文件中。你可以随时关闭 AI 功能或删除配置；删除配置不会删除服务商侧已经产生的数据。',
                )}
              </p>
              <div className="ai-consent-checks">
                <label className="ai-consent-check">
                  <Checkbox
                    checked={accepted}
                    onCheckedChange={(value) => setAccepted(value === true)}
                  />
                  <span>
                    {t('settings.aiConsent.acceptNotice', '我已阅读并同意本告知的全部内容')}
                  </span>
                </label>
                {twoStep && (
                  <label className="ai-consent-check">
                    <Checkbox
                      checked={crossBorder}
                      onCheckedChange={(value) => setCrossBorder(value === true)}
                    />
                    <span>
                      {t(
                        'settings.aiConsent.acceptCrossBorder',
                        '我同意将选中的内容与提示词传输至我所在国家或地区之外（个人信息出境）',
                      )}
                    </span>
                  </label>
                )}
              </div>
            </>
          )}
        </div>

        <div className="ai-consent-actions">
          {twoStep && step === 2 ? (
            <Button
              variant="ghost"
              className="ai-consent-back"
              disabled={submitting}
              onClick={() => setStep(1)}
            >
              {t('settings.aiConsent.back', '上一步')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="ai-consent-decline"
              disabled={submitting}
              onClick={onCancel}
            >
              {t('settings.aiConsent.decline', '暂不开启')}
            </Button>
          )}
          {onLastStep ? (
            <Button className="ai-consent-agree" disabled={!ready || submitting} onClick={agree}>
              {t('settings.aiConsent.agree', '同意并开启')}
            </Button>
          ) : (
            <Button className="ai-consent-next" disabled={submitting} onClick={() => setStep(2)}>
              {t('settings.aiConsent.next', '下一步')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
