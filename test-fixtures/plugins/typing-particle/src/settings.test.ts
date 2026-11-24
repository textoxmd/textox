import { applySettingsDefaults } from '@texto/app-api';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, PRESETS } from './config';
import { createTypingParticleSettingsSection } from './settings';

describe('typing particle settings section', () => {
  const section = createTypingParticleSettingsSection();

  it('exposes the expected fields', () => {
    const types = section.fields.map((f) => f.type);
    expect(types).toContain('preset');
    expect(types).toContain('color');
    expect(types.filter((t) => t === 'number')).toHaveLength(6);
    // 恢复默认值由框架内建提供，插件不再自带 action 字段。
    expect(types).not.toContain('action');
  });

  it('preset value derives from config and apply returns the preset config', () => {
    const preset = section.fields.find((f) => f.type === 'preset');
    if (preset?.type !== 'preset') throw new Error('missing preset field');
    expect(preset.value(PRESETS.rain as unknown as Record<string, unknown>)).toBe('rain');
    expect(preset.value({ ...PRESETS.rain, count: 99 })).toBe('custom');
    expect(preset.apply('rain', {})).toEqual(PRESETS.rain);
    expect(preset.apply('custom', {})).toBeUndefined();
  });

  it('number fields carry ranges', () => {
    const count = section.fields.find((f) => f.type === 'number' && f.key === 'count');
    if (count?.type !== 'number') throw new Error('missing count field');
    expect(count.min).toBe(3);
    expect(count.max).toBe(20);
    expect(count.default).toBe(DEFAULT_CONFIG.count);
  });

  it('color field default equals DEFAULT_CONFIG.color (confetti 为 "")', () => {
    const color = section.fields.find((f) => f.type === 'color');
    if (color?.type !== 'color') throw new Error('missing color field');
    expect(color.default).toBe(DEFAULT_CONFIG.color);
  });

  it('blank config resolves to confetti preset', () => {
    const preset = section.fields.find((f) => f.type === 'preset');
    if (preset?.type !== 'preset') throw new Error('missing preset field');
    const effective = applySettingsDefaults(section.fields, {});
    expect(preset.value(effective)).toBe('confetti');
  });
});
