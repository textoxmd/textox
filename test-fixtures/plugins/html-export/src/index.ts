import { APP_EXPORTER } from '@texto/app-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { htmlExporter } from './html';

export default definePlugin({
  id: 'html-export',
  displayNameKey: 'menu.export_html',
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'export',
  settingsApply: 'immediate',
  icon: 'download',
  contributes: {
    [APP_EXPORTER]: [htmlExporter],
  },
});
