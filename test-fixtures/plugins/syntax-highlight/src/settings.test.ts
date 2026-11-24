import { describe, expect, it } from 'vitest';

import { CONFIG_DARK, CONFIG_LIGHT, DEFAULT_DARK, DEFAULT_LIGHT, settingsSection } from './settings';

describe('syntax-highlight settings section', () => {
  it('declares light/dark select fields backed by the theme catalog', () => {
    expect(settingsSection.id).toBe('syntax-highlight');
    expect(settingsSection.fields).toHaveLength(2);
    const light = settingsSection.fields[0]!;
    const dark = settingsSection.fields[1]!;
    expect(light).toMatchObject({ type: 'select', key: CONFIG_LIGHT });
    expect(dark).toMatchObject({ type: 'select', key: CONFIG_DARK });
    expect(light).toMatchObject({ default: DEFAULT_LIGHT });
    expect(dark).toMatchObject({ default: DEFAULT_DARK });
    const lightOptions = (light as { options: Array<{ value: string; label?: string }> }).options;
    const darkOptions = (dark as { options: Array<{ value: string; label?: string }> }).options;
    expect(lightOptions).toHaveLength(7);
    expect(darkOptions).toHaveLength(8);
    expect(lightOptions.every((o) => typeof o.label === 'string' && o.label.length > 0)).toBe(true);
    expect(lightOptions.map((o) => o.value)).toContain('githubLight');
    expect(darkOptions.map((o) => o.value)).toContain('vscodeDark');
    expect(lightOptions.map((o) => o.value)).not.toContain('vscodeDark');
  });
});
