import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONFIG,
  PRESETS,
  applyPreset,
  clampConfig,
  resolvePreset,
} from './config';

describe('presets', () => {
  it('has five official presets', () => {
    expect(Object.keys(PRESETS)).toEqual(['confetti', 'explosion', 'rain', 'fireflies', 'fountain']);
  });

  it('factory default is confetti', () => {
    expect(DEFAULT_CONFIG).toEqual(PRESETS.confetti);
  });

  it('every preset round-trips through resolvePreset', () => {
    for (const name of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      expect(resolvePreset({ ...PRESETS[name] })).toBe(name);
    }
  });
});

describe('resolvePreset', () => {
  it('returns the matching preset name', () => {
    expect(resolvePreset({ ...PRESETS.rain })).toBe('rain');
  });

  it('returns custom after any parameter change', () => {
    expect(resolvePreset({ ...PRESETS.confetti, count: PRESETS.confetti.count + 1 })).toBe('custom');
  });
});

describe('applyPreset', () => {
  it('returns a copy of the preset config', () => {
    const config = applyPreset('fountain');
    expect(config).toEqual(PRESETS.fountain);
    expect(config).not.toBe(PRESETS.fountain);
  });
});

describe('clampConfig', () => {
  it('falls back to defaults for missing / invalid values', () => {
    const out = clampConfig({ count: 999, colorMode: 'nope', size: 'big' });
    expect(out.count).toBe(20);
    expect(out.colorMode).toBe(DEFAULT_CONFIG.colorMode);
    expect(out.size).toBe(DEFAULT_CONFIG.size);
  });

  it('keeps valid values', () => {
    expect(clampConfig({ count: 7 }).count).toBe(7);
  });

  it('falls back for values that are not finite numbers', () => {
    expect(clampConfig({ count: null }).count).toBe(DEFAULT_CONFIG.count);
    expect(clampConfig({ count: '' }).count).toBe(DEFAULT_CONFIG.count);
    expect(clampConfig({ count: false }).count).toBe(DEFAULT_CONFIG.count);
    expect(clampConfig({ count: NaN }).count).toBe(DEFAULT_CONFIG.count);
    expect(clampConfig({ count: Infinity }).count).toBe(DEFAULT_CONFIG.count);
  });

  it('clamps out-of-range finite numbers', () => {
    expect(clampConfig({ count: 1 }).count).toBe(3);
    expect(clampConfig({ duration: 99 }).duration).toBe(1.5);
  });

  it('tolerates non-object input', () => {
    expect(clampConfig(undefined as unknown as Record<string, unknown>)).toEqual(DEFAULT_CONFIG);
  });
});
