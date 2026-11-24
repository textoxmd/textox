export type ParticleDirection = 'up' | 'down' | 'radial' | 'random';
export type ParticleColorMode = 'theme' | 'fixed' | 'random';
export type ParticleShape = 'circle' | 'square' | 'star' | 'diamond' | 'triangle';
export type ParticlePalette = 'rainbow' | 'warm' | 'cool' | 'pastel' | 'neon';
export type ParticlePresetName = 'confetti' | 'explosion' | 'rain' | 'fireflies' | 'fountain';
export type ParticleEffectKey = ParticlePresetName | 'custom';

export const PALETTES: Record<ParticlePalette, string[]> = {
  rainbow: ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd', '#01a3a4', '#f368e0', '#ff6348', '#7bed9f'],
  warm: ['#ff6b6b', '#ff8c00', '#feca57', '#ff6348', '#e17055', '#d63031', '#e84393', '#fd79a8'],
  cool: ['#48dbfb', '#54a0ff', '#5f27cd', '#00bcd4', '#0984e3', '#6c5ce7', '#a29bfe', '#00cec9'],
  pastel: ['#ff9ff3', '#ffeaa7', '#81ecec', '#fab1a0', '#dfe6e9', '#a29bfe', '#fd79a8', '#55efc4'],
  neon: ['#ff0055', '#00ff87', '#ffeb00', '#00d4ff', '#b000ff', '#ff6600', '#ff00ff', '#00ffaa'],
};

export interface ParticleEffectConfig {
  colorMode: ParticleColorMode;
  color: string;
  palette: ParticlePalette;
  shape: ParticleShape;
  direction: ParticleDirection;
  count: number;
  size: number;
  speed: number;
  spread: number;
  gravity: number;
  duration: number;
}

export const PRESETS: Record<ParticlePresetName, ParticleEffectConfig> = {
  confetti: { colorMode: 'random', color: '', palette: 'rainbow', shape: 'square', direction: 'random', count: 15, size: 3.5, speed: 80, spread: 360, gravity: 30, duration: 1.0 },
  explosion: { colorMode: 'random', color: '', palette: 'neon', shape: 'star', direction: 'radial', count: 20, size: 3, speed: 200, spread: 360, gravity: 0, duration: 0.35 },
  rain: { colorMode: 'fixed', color: '#90caf9', palette: 'cool', shape: 'square', direction: 'down', count: 10, size: 1, speed: 200, spread: 30, gravity: 100, duration: 0.4 },
  fireflies: { colorMode: 'random', color: '', palette: 'pastel', shape: 'circle', direction: 'random', count: 6, size: 1.5, speed: 30, spread: 360, gravity: 0, duration: 1.2 },
  fountain: { colorMode: 'fixed', color: '#00bcd4', palette: 'cool', shape: 'circle', direction: 'up', count: 12, size: 2, speed: 180, spread: 60, gravity: 200, duration: 0.8 },
};

export const DEFAULT_CONFIG: ParticleEffectConfig = { ...PRESETS.confetti };

export const PARTICLE_RANGES = {
  count: { min: 3, max: 20, step: 1 },
  size: { min: 1, max: 6, step: 0.1 },
  speed: { min: 30, max: 250, step: 10 },
  spread: { min: 10, max: 360, step: 10 },
  gravity: { min: 0, max: 300, step: 10 },
  duration: { min: 0.1, max: 1.5, step: 0.1 },
} as const;

const CONFIG_KEYS: (keyof ParticleEffectConfig)[] = [
  'colorMode', 'color', 'palette', 'shape', 'direction',
  'count', 'size', 'speed', 'spread', 'gravity', 'duration',
];

const COLOR_MODES: ParticleColorMode[] = ['theme', 'fixed', 'random'];
const PALETTES_LIST: ParticlePalette[] = ['rainbow', 'warm', 'cool', 'pastel', 'neon'];
const SHAPES: ParticleShape[] = ['circle', 'square', 'star', 'diamond', 'triangle'];
const DIRECTIONS: ParticleDirection[] = ['up', 'down', 'radial', 'random'];

function equalConfig(a: ParticleEffectConfig, b: ParticleEffectConfig): boolean {
  return CONFIG_KEYS.every((key) => a[key] === b[key]);
}

/** 当前配置命中哪个官方预设；都不命中返回 'custom'。 */
export function resolvePreset(config: ParticleEffectConfig): ParticleEffectKey {
  for (const name of Object.keys(PRESETS) as ParticlePresetName[]) {
    if (equalConfig(config, PRESETS[name])) return name;
  }
  return 'custom';
}

/** 官方预设的整组参数（拷贝）。 */
export function applyPreset(name: ParticlePresetName): ParticleEffectConfig {
  return { ...PRESETS[name] };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 容错：非法/缺失字段回退默认；用于框架有效配置之外的最后一道防御。 */
export function clampConfig(raw: Record<string, unknown>): ParticleEffectConfig {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out: ParticleEffectConfig = { ...DEFAULT_CONFIG };
  if (COLOR_MODES.includes(source.colorMode as ParticleColorMode)) out.colorMode = source.colorMode as ParticleColorMode;
  if (typeof source.color === 'string') out.color = source.color;
  if (PALETTES_LIST.includes(source.palette as ParticlePalette)) out.palette = source.palette as ParticlePalette;
  if (SHAPES.includes(source.shape as ParticleShape)) out.shape = source.shape as ParticleShape;
  if (DIRECTIONS.includes(source.direction as ParticleDirection)) out.direction = source.direction as ParticleDirection;
  out.count = clampNumber(source.count, PARTICLE_RANGES.count.min, PARTICLE_RANGES.count.max, out.count);
  out.size = clampNumber(source.size, PARTICLE_RANGES.size.min, PARTICLE_RANGES.size.max, out.size);
  out.speed = clampNumber(source.speed, PARTICLE_RANGES.speed.min, PARTICLE_RANGES.speed.max, out.speed);
  out.spread = clampNumber(source.spread, PARTICLE_RANGES.spread.min, PARTICLE_RANGES.spread.max, out.spread);
  out.gravity = clampNumber(source.gravity, PARTICLE_RANGES.gravity.min, PARTICLE_RANGES.gravity.max, out.gravity);
  out.duration = clampNumber(source.duration, PARTICLE_RANGES.duration.min, PARTICLE_RANGES.duration.max, out.duration);
  return out;
}
