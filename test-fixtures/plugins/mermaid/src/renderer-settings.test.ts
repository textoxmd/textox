import { describe, expect, it } from 'vitest';

import { isRendererId } from './diagram-engine';
import {
  CONFIG_RENDERER,
  DEFAULT_RENDERER,
  mermaidSettingsSection,
} from './renderer-settings';

describe('mermaid settings section', () => {
  it('声明渲染器下拉，默认标准渲染器', () => {
    expect(mermaidSettingsSection.id).toBe('mermaid.settings');
    expect(mermaidSettingsSection.titleKey).toBe('mermaid.settingsTitle');

    const field = mermaidSettingsSection.fields[0];
    if (field?.type !== 'select') throw new Error('expected select field');
    expect(field.key).toBe(CONFIG_RENDERER);
    expect(CONFIG_RENDERER).toBe('renderer');
    expect(field.default).toBe(DEFAULT_RENDERER);
    expect(field.default).toBe('mermaid');
  });

  it('提供标准与 Pele 两个选项', () => {
    const field = mermaidSettingsSection.fields[0];
    if (field?.type !== 'select') throw new Error('expected select field');

    expect(field.options).toEqual([
      { value: 'mermaid', labelKey: 'mermaid.rendererMermaid' },
      { value: 'pele', labelKey: 'mermaid.rendererPele' },
    ]);

    for (const option of field.options) {
      expect(isRendererId(option.value)).toBe(true);
    }
  });
});
