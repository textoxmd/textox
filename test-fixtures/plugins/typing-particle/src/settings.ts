import type { SettingsField, SettingsSection } from '@texto/app-api';

import {
  DEFAULT_CONFIG,
  PARTICLE_RANGES,
  applyPreset,
  resolvePreset,
  type ParticleEffectConfig,
  type ParticlePresetName,
} from './config';

const PRESET_ORDER: ParticlePresetName[] = ['confetti', 'explosion', 'rain', 'fireflies', 'fountain'];

const number = (
  key: keyof typeof PARTICLE_RANGES,
  labelKey: string,
  descriptionKey: string,
): SettingsField => ({
  type: 'number',
  key,
  labelKey,
  descriptionKey,
  default: DEFAULT_CONFIG[key],
  ...PARTICLE_RANGES[key],
});

const fields: SettingsField[] = [
  {
    type: 'preset',
    key: 'preset',
    labelKey: 'typing-particle.particlePreset',
    options: [
      ...PRESET_ORDER.map((name) => ({
        value: name,
        labelKey: `typing-particle.particlePreset_${name}`,
      })),
      { value: 'custom', labelKey: 'typing-particle.particleCustom' },
    ],
    value: (values) => resolvePreset(values as unknown as ParticleEffectConfig),
    apply: (value) =>
      value === 'custom' ? undefined : { ...applyPreset(value as ParticlePresetName) },
  },
  {
    type: 'select',
    key: 'colorMode',
    labelKey: 'typing-particle.particleColor',
    descriptionKey: 'typing-particle.particleColorDesc',
    default: DEFAULT_CONFIG.colorMode,
    options: [
      { value: 'theme', labelKey: 'typing-particle.particleColorTheme' },
      { value: 'fixed', labelKey: 'typing-particle.particleColorFixed' },
      { value: 'random', labelKey: 'typing-particle.particleColorRandom' },
    ],
  },
  {
    type: 'color',
    key: 'color',
    labelKey: 'typing-particle.particleColorFixed',
    visibleWhen: { key: 'colorMode', equals: 'fixed' },
    // 必须等于 DEFAULT_CONFIG.color（confetti 为 ''）。若换成 '#90caf9' 之类，
    // applySettingsDefaults 会让空白配置的 effective.color 偏离 confetti，
    // 导致 resolvePreset 误判为 'custom'（首次打开显示「自定义」而非彩纸）。
    default: DEFAULT_CONFIG.color,
  },
  {
    type: 'select',
    key: 'palette',
    labelKey: 'typing-particle.particlePalette',
    visibleWhen: { key: 'colorMode', equals: 'random' },
    default: DEFAULT_CONFIG.palette,
    options: (['rainbow', 'warm', 'cool', 'pastel', 'neon'] as const).map((value) => ({
      value,
      labelKey: `typing-particle.particlePalette${value.charAt(0).toUpperCase()}${value.slice(1)}`,
    })),
  },
  {
    type: 'select',
    key: 'shape',
    labelKey: 'typing-particle.particleShape',
    descriptionKey: 'typing-particle.particleShapeDesc',
    default: DEFAULT_CONFIG.shape,
    options: (['circle', 'square', 'star', 'diamond', 'triangle'] as const).map((value) => ({
      value,
      labelKey: `typing-particle.particleShape${value.charAt(0).toUpperCase()}${value.slice(1)}`,
    })),
  },
  {
    type: 'select',
    key: 'direction',
    labelKey: 'typing-particle.particleDirection',
    descriptionKey: 'typing-particle.particleDirectionDesc',
    default: DEFAULT_CONFIG.direction,
    options: [
      { value: 'up', labelKey: 'typing-particle.particleDirUp' },
      { value: 'down', labelKey: 'typing-particle.particleDirDown' },
      { value: 'radial', labelKey: 'typing-particle.particleDirRadial' },
      { value: 'random', labelKey: 'typing-particle.particleDirRandom' },
    ],
  },
  number('count', 'typing-particle.particleCount', 'typing-particle.particleCountDesc'),
  number('size', 'typing-particle.particleSize', 'typing-particle.particleSizeDesc'),
  number('speed', 'typing-particle.particleSpeed', 'typing-particle.particleSpeedDesc'),
  number('spread', 'typing-particle.particleSpread', 'typing-particle.particleSpreadDesc'),
  number('gravity', 'typing-particle.particleGravity', 'typing-particle.particleGravityDesc'),
  number('duration', 'typing-particle.particleDuration', 'typing-particle.particleDurationDesc'),
];

export function createTypingParticleSettingsSection(): SettingsSection {
  return {
    id: 'typing-particle.settings',
    titleKey: 'typing-particle.settingsTitle',
    fields,
  };
}
