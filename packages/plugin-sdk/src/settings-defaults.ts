import {
  isValueField,
  type SettingsField,
  type SettingsValue,
  type SettingsValueField,
} from './app';

/**
 * 计算某插件设置段的「有效配置」：已存值优先，缺失项用字段 default 补齐。
 * `preset` / `action` 不承载存储值，跳过。
 *
 * 注意与 `vendor/plugin-sdk/src/settings.ts` 的同名实现保持一致：两边都必须
 * 「保留未声明键」（插件版本回退 / 前向兼容时不丢配置），否则运行时会静默抹掉配置。
 * 两个包的 `SettingsField` 形状不同，此处刻意不合并。
 */
export function applySettingsDefaults(
  fields: SettingsField[],
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored };
  for (const field of fields) {
    if (!isValueField(field)) continue;
    if (out[field.key] === undefined && field.default !== undefined) {
      out[field.key] = field.default;
    }
  }
  return out;
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 上限按字符数（UTF-16 code unit）计，非字节数。 */
const TEXT_MAX = 8 * 1024;

/** 归一化为 `<input type="color">` 能回显的小写 6 位形式。 */
function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string' || !COLOR_RE.test(value)) return null;
  const lower = value.toLowerCase();
  if (lower.length === 7) return lower;
  return `#${lower
    .slice(1)
    .split('')
    .map((ch) => `${ch}${ch}`)
    .join('')}`;
}

/**
 * 返回合法值；`null` 表示拒绝（调用方保留旧值）。
 *
 * 覆盖全部**值字段**（含清单侧新增的 `modelProfile` / `color`）：`modelProfile` 是
 * profile id（与 `text` 同受一处长度上限约束），`color` 归一化为 6 位小写十六进制。
 * `preset` / `action` 不承载存储值，落到 `default` 分支一律拒绝——绝不把字段对象当值返回。
 */
export function coerceSettingsValue(
  field: SettingsValueField,
  value: unknown,
): SettingsValue | null {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'number': {
      // ±Infinity 无法 JSON 往返（落盘成 null），视为非法。
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      if (field.min !== undefined && value < field.min) return null;
      if (field.max !== undefined && value > field.max) return null;
      return value;
    }
    case 'select':
      return typeof value === 'string' && field.options.some((option) => option.value === value)
        ? value
        : null;
    case 'color':
      return normalizeColor(value);
    case 'text':
    case 'password':
    case 'modelProfile':
      // password 用于保存密钥粘贴，modelProfile 是 profile id，与 text 同受一处上限约束。
      return typeof value === 'string' && value.length <= TEXT_MAX ? value : null;
    default:
      // 编译期：`field` 此时应为 never，新增变体未处理会在这里报错。
      // 运行期：第三方 manifest 可能给出未知 type，一律拒绝，绝不把字段对象当值返回。
      field satisfies never;
      return null;
  }
}
