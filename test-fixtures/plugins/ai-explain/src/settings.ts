import type { SettingsSection } from '@texto/app-api';

export function createSettingsSection(): SettingsSection {
  return {
    id: 'ai-explain.settings',
    titleKey: 'ai-explain.sectionTitle',
    fields: [
      {
        type: 'modelProfile',
        key: 'modelProfile',
        labelKey: 'ai-explain.modelProfile',
        descriptionKey: 'ai-explain.modelProfileDesc',
        default: '',
      },
    ],
  };
}
