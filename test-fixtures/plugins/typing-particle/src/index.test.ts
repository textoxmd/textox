import { MARKDOWN_EDITOR_EXTENSION } from '@texto/markdown-editor-api';
import { APP_SETTINGS_SECTION } from '@texto/app-api';
import { describe, expect, it } from 'vitest';

import plugin from './index';

describe('typing-particle plugin manifest', () => {
  it('declares id, default off, immediate settings', () => {
    expect(plugin.id).toBe('typing-particle');
    expect(plugin.defaultEnabled).toBe(false);
    expect(plugin.settingsApply).toBe('immediate');
  });

  it('contributes an editor extension and a settings section', () => {
    const editorExt = plugin.contributes?.[MARKDOWN_EDITOR_EXTENSION];
    expect(editorExt).toHaveLength(1);
    expect(editorExt?.[0]?.id).toBe('typing-particle.editor');

    const settings = plugin.contributes?.[APP_SETTINGS_SECTION];
    expect(settings).toHaveLength(1);
    expect(settings?.[0]?.id).toBe('typing-particle.settings');
  });
});
