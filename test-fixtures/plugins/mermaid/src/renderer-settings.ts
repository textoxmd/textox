import type { SettingsSection } from '@texto/app-api';

import { DEFAULT_RENDERER } from './diagram-engine';

export { DEFAULT_RENDERER };

export const CONFIG_RENDERER = 'renderer';

export const mermaidSettingsSection: SettingsSection = {
  id: 'mermaid.settings',
  titleKey: 'mermaid.settingsTitle',
  fields: [
    {
      type: 'select',
      key: CONFIG_RENDERER,
      labelKey: 'mermaid.renderer',
      descriptionKey: 'mermaid.rendererDesc',
      default: DEFAULT_RENDERER,
      options: [
        { value: 'mermaid', labelKey: 'mermaid.rendererMermaid' },
        { value: 'pele', labelKey: 'mermaid.rendererPele' },
      ],
    },
  ],
};
