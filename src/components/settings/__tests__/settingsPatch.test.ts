import { describe, expect, it } from 'vitest';

import { coerceSettingsPatch } from '../settingsPatch';
import type { SettingsField } from '@texto/plugin-sdk';

/** 一个典型的预设目标字段集：预设一次写数字 + 布尔 + 颜色。 */
const fields: SettingsField[] = [
  { type: 'number', key: 'spacing', labelKey: 'spacing', default: 1, min: 0, max: 4 },
  { type: 'boolean', key: 'accent', labelKey: 'accent', default: false },
  { type: 'color', key: 'tint', labelKey: 'tint', default: '#f7d54e' },
  {
    type: 'preset',
    key: 'density',
    labelKey: 'density',
    options: [{ value: 'roomy', labelKey: 'roomy' }],
    value: () => 'roomy',
    apply: () => ({}),
  },
  { type: 'action', id: 'ping', labelKey: 'ping', run: async () => ({ ok: true }) },
];

describe('coerceSettingsPatch', () => {
  it('coerces every key of a multi-key patch', () => {
    expect(coerceSettingsPatch(fields, { spacing: 3, accent: true, tint: '#ABC' })).toEqual({
      spacing: 3,
      accent: true,
      // 颜色统一归一化为 6 位小写
      tint: '#aabbcc',
    });
  });

  it('rejects the whole patch when one key is invalid', () => {
    // spacing 超上限：不能只写 accent，否则用户会看到一半生效的预设
    expect(coerceSettingsPatch(fields, { accent: true, spacing: 9 })).toBeNull();
    expect(coerceSettingsPatch(fields, { accent: 'yes' })).toBeNull();
    expect(coerceSettingsPatch(fields, { tint: 'red' })).toBeNull();
  });

  it('rejects keys that are not declared, or that carry no stored value', () => {
    expect(coerceSettingsPatch(fields, { unknown: 1 })).toBeNull();
    // preset / action 不是值字段：写它们只会污染配置
    expect(coerceSettingsPatch(fields, { density: 'roomy' })).toBeNull();
    expect(coerceSettingsPatch(fields, { ping: true })).toBeNull();
  });

  it('returns an empty patch for an empty input', () => {
    expect(coerceSettingsPatch(fields, {})).toEqual({});
  });
});
