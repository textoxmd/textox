import type { ImageUploaderContribution, SettingsSection } from '@texto/app-api';
import type { PluginHost } from '@texto/plugin-sdk';

import { uploadViaPicgo } from './upload';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:36677';

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
];

async function serverUrlOf(host: PluginHost): Promise<string> {
  const value = await host.config.get<unknown>('server_url');
  return typeof value === 'string' && value ? value : DEFAULT_SERVER_URL;
}

export const picgoUploader: ImageUploaderContribution = {
  id: 'picgo.uploader',
  upload: async (host, filePath) => uploadViaPicgo(filePath, await serverUrlOf(host)),
};

export function createSettingsSection(): SettingsSection {
  return {
    id: 'picgo.settings',
    titleKey: 'picgo.sectionTitle',
    fields: [
      {
        type: 'text' as const,
        key: 'server_url',
        labelKey: 'picgo.serverUrl',
        descriptionKey: 'picgo.serverUrlDesc',
        placeholderKey: 'picgo.serverUrlPlaceholder',
        default: DEFAULT_SERVER_URL,
      },
      {
        type: 'action' as const,
        id: 'picgo.test',
        labelKey: 'picgo.testConnection',
        run: async (host: PluginHost, values: Record<string, unknown>) => {
          const picked = await host.dialogs.pickFile({ filters: IMAGE_FILTERS });
          if (!picked) return { ok: false };
          const serverUrl =
            (typeof values.server_url === 'string' && values.server_url) || DEFAULT_SERVER_URL;
          try {
            const url = await uploadViaPicgo(picked, serverUrl);
            return { ok: true, messageKey: 'picgo.testSuccess', detail: url };
          } catch (error) {
            host.log.error('[picgo] test connection failed:', error);
            return { ok: false, messageKey: 'picgo.testFailed', detail: String(error) };
          }
        },
      },
    ],
  };
}
