import { APP_IMAGE_UPLOADER, APP_SETTINGS_SECTION } from '@texto/app-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { defaultLocale, locales } from './locales';
import { createSettingsSection, picgoUploader } from './settings';

export default definePlugin({
  id: 'picgo',
  displayNameKey: 'picgo.pluginName',
  descriptionKey: 'picgo.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'image-hosting',
  icon: 'image-up',
  defaultEnabled: false,
  settingsApply: 'immediate',
  migration: {
    enableWhenImageStorageMode: 'picgo',
    appConfigKeys: { server_url: 'picgo_server_url' },
  },
  contributes: {
    [APP_IMAGE_UPLOADER]: [picgoUploader],
    [APP_SETTINGS_SECTION]: [createSettingsSection()],
  },
});
