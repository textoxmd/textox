import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  consentCoverage,
  defaultModelFor,
  defaultProfileName,
  getAgentSettings,
  isAgentSwitchOn,
  isProfileComplete,
  listAgentProfiles,
  newProfileId,
  providerChoices,
  removeAgentProfile,
  subscribeAgentSettings,
  updateAgentSettings,
  upsertAgentProfile,
  type AgentProfile,
} from '@/agent/config';
import { AI_CONSENT_VERSION } from '@/agent/consent';
import {
  modelOptionsFor,
  providerMeta,
  type AgentProviderId,
} from '@/agent/providers-catalog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { AiConsentPage } from './AiConsentPage';
import { ModelPicker } from './ModelPicker';

const EMPTY_PROFILE: AgentProfile = {
  id: '',
  name: '',
  provider: 'deepseek',
  model: '',
  apiKey: '',
  baseUrl: '',
  enabled: false,
};

/** 与旧设置页保持一致：测试连接最多等 8 秒。 */
const AI_TEST_TIMEOUT_MS = 8000;

export function AiModelSettings() {
  const { t } = useTranslation();
  /** 服务商显示名：custom 走专用文案；目录里登记了翻译 key；未知 provider 回退到裸 id。 */
  const providerName = (provider: AgentProviderId): string => {
    if (provider === 'custom') {
      return t('settings.ai.providerCustom', '自定义（OpenAI 兼容）');
    }
    const meta = providerMeta(provider);
    return t(meta?.labelKey ?? `settings.ai.provider.${provider}`, provider);
  };
  // 订阅 store 变化触发重渲染；列表经 listAgentProfiles() 读取最新值。
  const settings = useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  );
  const profiles = listAgentProfiles();
  const storedOn = isAgentSwitchOn();

  const [consentOpen, setConsentOpen] = useState(false);
  const [consentProviders, setConsentProviders] = useState<AgentProviderId[] | null>(null);
  const [draft, setDraft] = useState<AgentProfile | null>(null);
  const [deletingId, setDeletingId] = useState('');
  const [testingId, setTestingId] = useState('');
  const [busy, setBusy] = useState(false);

  const choices = useMemo(() => providerChoices(), []);

  const openConsent = () => {
    // 冻结本次同意的覆盖范围：页面展示与实际写入必须是同一份集合。
    setConsentProviders(consentCoverage());
    setConsentOpen(true);
  };

  const runWrite = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      console.error('[ai-settings] 写入失败', error);
      toast.error(t('settings.ai.saveFailed', '保存失败，请重试'));
    } finally {
      setBusy(false);
    }
  };

  const requestEnable = async () => {
    if (storedOn) {
      await runWrite(() => updateAgentSettings({ enabled: false }));
      return;
    }
    // 每次开启都要重新读一遍告知，不再复用历史同意记录。
    openConsent();
  };

  const acceptConsent = async () => {
    if (busy) return;
    const providers = consentProviders ?? [];
    await runWrite(async () => {
      await updateAgentSettings({
        consent: {
          version: AI_CONSENT_VERSION,
          acceptedAt: new Date().toISOString(),
          providers,
        },
        enabled: true,
      });
      setConsentOpen(false);
      setConsentProviders(null);
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const next: AgentProfile = {
      ...draft,
      name:
        draft.name.trim() ||
        defaultProfileName(draft.provider, draft.model, providerName(draft.provider)),
      // baseUrl 只对自定义服务有意义；切回内置 provider 时清掉，避免残留旧端点。
      baseUrl: draft.provider === 'custom' ? draft.baseUrl.trim() : '',
    };
    if (!isProfileComplete(next)) {
      toast.error(t('settings.ai.incomplete', '请填写模型与 API Key（自定义服务还需要 Base URL）'));
      return;
    }
    await runWrite(async () => {
      await upsertAgentProfile(next);
      setDraft(null);
    });
  };

  const confirmRemove = async (id: string) => {
    await runWrite(async () => {
      await removeAgentProfile(id);
      setDeletingId('');
    });
  };

  const testProfile = async (profile: AgentProfile) => {
    setTestingId(profile.id);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const { testAgentConnection } = await import('@/agent/run');
      await Promise.race([
        testAgentConnection(profile.id, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('timeout'));
          }, AI_TEST_TIMEOUT_MS);
        }),
      ]);
      toast.success(t('settings.ai.testSuccess', '连接成功'));
    } catch (error) {
      if (timedOut) {
        toast.error(t('settings.ai.testTimeout', '连接超时'));
      } else {
        const message =
          error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
        toast.error(`${t('settings.ai.testFailed', '连接失败')}：${message}`);
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      setTestingId((current) => (current === profile.id ? '' : current));
    }
  };

  const draftProviders = draft
    ? choices.includes(draft.provider)
      ? choices
      : [...choices, draft.provider]
    : choices;

  return (
    <>
      <Card className="flex-shrink-0 bg-background ring-0">
        <CardContent>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.ai.enabled', 'AI 功能')}</span>
              <span className="settings-item-description">
                {t('settings.ai.enabledDesc', '开启后，选中文字可调用 AI 解释 / 翻译')}
              </span>
            </div>
            <Checkbox
              checked={storedOn}
              aria-label={t('settings.ai.enabled', 'AI 功能')}
              disabled={busy}
              onCheckedChange={() => void requestEnable()}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardContent>
          <div className="ai-profile-header">
            <span className="settings-item-label">{t('settings.ai.profiles', '模型配置')}</span>
            <Button
              variant="outline"
              disabled={!storedOn}
              onClick={() => {
                setDraft({
                  ...EMPTY_PROFILE,
                  id: newProfileId(),
                  provider: choices[0] ?? 'deepseek',
                  model: defaultModelFor(choices[0] ?? 'deepseek'),
                });
                setDeletingId('');
              }}
            >
              {t('settings.ai.addProfile', '新建配置')}
            </Button>
          </div>

          {!storedOn && (
            <p className="settings-item-description" data-slot="ai-enable-first">
              {t('settings.ai.enableFirst', '先开启 AI 功能，再添加模型配置。')}
            </p>
          )}

          {storedOn && profiles.length === 0 && (
            <p className="settings-item-description">
              {t('settings.ai.emptyProfiles', '还没有模型配置，先新建一条。')}
            </p>
          )}

          {profiles.map((profile) => {
            const unavailable = !choices.includes(profile.provider);
            return (
              <div key={profile.id} className="ai-profile-row">
                <div className="settings-item-info">
                  <span className="settings-item-label">
                    {profile.name}
                    {unavailable && (
                      <span className="ai-provider-unavailable" data-slot="ai-provider-unavailable">
                        {t('settings.ai.providerUnavailable', '当前地区不提供')}
                      </span>
                    )}
                  </span>
                  <span className="settings-item-description">
                    {[
                      profile.provider === 'custom' ? profile.baseUrl : providerName(profile.provider),
                      profile.model,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="ai-profile-actions">
                  <Checkbox
                    checked={profile.enabled}
                    aria-label={`${t('settings.ai.enableProfile', '启用配置')}：${profile.name}`}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      void runWrite(() =>
                        upsertAgentProfile({ ...profile, enabled: checked === true }),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraft(profile);
                      setDeletingId('');
                    }}
                  >
                    {t('settings.ai.edit', '编辑')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || testingId === profile.id}
                    onClick={() => void testProfile(profile)}
                  >
                    {t('settings.ai.testConnection', '测试连接')}
                  </Button>
                  {deletingId === profile.id ? (
                    <>
                      <span className="ai-profile-confirm">
                        {t('settings.ai.deleteConfirm', '确认删除？')}
                      </span>
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => void confirmRemove(profile.id)}
                      >
                        {t('settings.ai.remove', '删除')}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDeletingId('')}
                      >
                        {t('settings.ai.cancel', '取消')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDeletingId(profile.id)}
                    >
                      {t('settings.ai.remove', '删除')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {draft && (
            <div className="ai-profile-form">
              <label>
                {t('settings.ai.name', '名称')}
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <div className="ai-profile-field">
                <span className="ai-profile-field-label">
                  {t('settings.ai.provider', '服务提供方')}
                </span>
                <Select
                  value={draft.provider}
                  onValueChange={(value) => {
                    const provider = value as AgentProviderId;
                    setDraft({ ...draft, provider, model: defaultModelFor(provider) });
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t('settings.ai.provider', '服务提供方')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {draftProviders.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {providerName(provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="ai-profile-field">
                <span className="ai-profile-field-label">{t('settings.ai.model', '模型')}</span>
                <ModelPicker
                  value={draft.model}
                  options={modelOptionsFor(draft.provider, draft.model)}
                  onChange={(model) => setDraft({ ...draft, model })}
                />
              </div>
              <label>
                {t('settings.ai.apiKey', 'API Key')}
                <Input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                />
              </label>
              {draft.provider === 'custom' && (
                <>
                  <label>
                    {t('settings.ai.baseUrl', 'Base URL')}
                    <Input
                      value={draft.baseUrl}
                      onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                    />
                  </label>
                  <p className="settings-item-description">
                    {t(
                      'settings.ai.customSelfHostedNote',
                      '该地址由你自行填写，请确认其运营方与数据处理方式。',
                    )}
                  </p>
                </>
              )}
              <div className="ai-profile-form-actions">
                <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                  {t('settings.ai.cancel', '取消')}
                </Button>
                <Button disabled={busy} onClick={() => void saveDraft()}>
                  {t('settings.ai.save', '保存')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardContent>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">
                {t('settings.ai.resultSurface', '结果显示')}
              </span>
            </div>
            <Select
              value={settings.surface}
              disabled={busy}
              onValueChange={(value) =>
                void runWrite(() =>
                  updateAgentSettings({ surface: value as 'floating' | 'sidebar' }),
                )
              }
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="floating">{t('settings.ai.surfaceFloating', '悬浮块')}</SelectItem>
                <SelectItem value="sidebar">{t('settings.ai.surfaceSidebar', '边栏')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {consentOpen && (
        <AiConsentPage
          providers={consentProviders ?? []}
          onCancel={() => {
            setConsentOpen(false);
            setConsentProviders(null);
          }}
          onAgree={acceptConsent}
        />
      )}
    </>
  );
}
