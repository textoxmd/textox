import i18n from '@/i18n';

export async function showUpgradePrompt(featureKey: string) {
  const { confirm } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');

  const featureName = i18n.t(featureKey);

  const confirmed = await confirm(
    `${i18n.t('upgrade.message', { feature: featureName })}\n\n${i18n.t('upgrade.confirm')}`,
    {
      title: i18n.t('upgrade.title'),
      kind: 'info',
      okLabel: i18n.t('upgrade.okLabel'),
      cancelLabel: i18n.t('upgrade.cancelLabel'),
    }
  );

  if (confirmed) {
    await invoke('open_app_store');
  }
}
