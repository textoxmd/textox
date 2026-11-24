import { describe, expect, it } from 'vitest';

import { isValueField, type SettingsField, type SettingsValueField } from './app';
import { applySettingsDefaults, coerceSettingsValue } from './settings-defaults';

const fields: SettingsField[] = [
  { type: 'number', key: 'count', labelKey: 'x', default: 15 },
  { type: 'select', key: 'mode', labelKey: 'x', default: 'a', options: [{ value: 'a', label: 'A' }] },
  { type: 'color', key: 'color', labelKey: 'x', default: '#fff' },
  { type: 'boolean', key: 'on', labelKey: 'x', default: false },
  { type: 'preset', key: 'preset', labelKey: 'x', options: [], value: () => 'custom', apply: () => undefined },
];

const coerceFields: SettingsField[] = [
  { type: 'boolean', key: 'features.emoji', labelKey: 'k', default: true, group: 'inline' },
  {
    type: 'select',
    key: 'view',
    labelKey: 'k',
    default: 'panel',
    options: [
      { value: 'panel', label: 'Panel' },
      { value: 'source', label: 'Source' },
    ],
  },
  { type: 'color', key: 'color', labelKey: 'k', default: '#f7d54e' },
  { type: 'number', key: 'n', labelKey: 'k', default: 2, min: 1, max: 5 },
];

const valueFields = coerceFields.filter(isValueField);

describe('applySettingsDefaults', () => {
  it('fills missing keys with field defaults', () => {
    expect(applySettingsDefaults(fields, { count: 3 })).toEqual({
      count: 3,
      mode: 'a',
      color: '#fff',
      on: false,
    });
  });

  it('keeps stored values and ignores non-value fields (preset)', () => {
    const out = applySettingsDefaults(fields, { count: 9, mode: 'a' });
    expect(out.count).toBe(9);
    expect('preset' in out).toBe(false);
  });

  it('does not mutate the stored object', () => {
    const stored = { count: 1 };
    applySettingsDefaults(fields, stored);
    expect(stored).toEqual({ count: 1 });
  });

  it('keeps unknown keys so downgrade does not lose config', () => {
    expect(applySettingsDefaults(coerceFields, { unknown: 1 })).toMatchObject({
      unknown: 1,
      'features.emoji': true,
    });
  });

  it('ignores group/apply metadata when filling defaults', () => {
    const out = applySettingsDefaults(
      [{ type: 'text', key: 't', labelKey: 'k', default: 'x', group: 'g', apply: 'restart' }],
      {},
    );
    expect(out).toEqual({ t: 'x' });
  });
});

describe('isValueField', () => {
  it('excludes preset and action', () => {
    const preset: SettingsField = {
      type: 'preset',
      key: 'preset',
      labelKey: 'k',
      options: [],
      value: () => 'x',
      apply: () => undefined,
    };
    const action: SettingsField = {
      type: 'action',
      id: 'p.test',
      labelKey: 'k',
      run: async () => ({ ok: true }),
    };
    expect(isValueField(preset)).toBe(false);
    expect(isValueField(action)).toBe(false);
    expect(isValueField({ type: 'text', key: 't', labelKey: 'k' })).toBe(true);
  });
});

describe('coerceSettingsValue', () => {
  const byKey = (key: string) => valueFields.find((f) => f.key === key)!;

  it('accepts valid values', () => {
    expect(coerceSettingsValue(byKey('n'), 3)).toBe(3);
    expect(coerceSettingsValue(byKey('view'), 'source')).toBe('source');
    expect(coerceSettingsValue(byKey('color'), '#a3e07a')).toBe('#a3e07a');
  });

  it('rejects invalid select/number/color values', () => {
    expect(coerceSettingsValue(byKey('view'), 'nope')).toBeNull();
    expect(coerceSettingsValue(byKey('n'), 9)).toBeNull();
    expect(coerceSettingsValue(byKey('color'), 'red')).toBeNull();
  });

  it('rejects non-boolean values', () => {
    expect(coerceSettingsValue(byKey('features.emoji'), 'true')).toBeNull();
    expect(coerceSettingsValue(byKey('features.emoji'), 1)).toBeNull();
    expect(coerceSettingsValue(byKey('features.emoji'), true)).toBe(true);
  });

  it('normalizes colors to lowercase 6-digit hex', () => {
    expect(coerceSettingsValue(byKey('color'), '#abc')).toBe('#aabbcc');
    expect(coerceSettingsValue(byKey('color'), '#AABBCC')).toBe('#aabbcc');
    expect(coerceSettingsValue(byKey('color'), '#abcd')).toBeNull();
    expect(coerceSettingsValue(byKey('color'), '#aabbccdd')).toBeNull();
    expect(coerceSettingsValue(byKey('color'), 'red')).toBeNull();
  });

  it('enforces number bounds and rejects NaN/non-numbers', () => {
    expect(coerceSettingsValue(byKey('n'), 1)).toBe(1);
    expect(coerceSettingsValue(byKey('n'), 5)).toBe(5);
    expect(coerceSettingsValue(byKey('n'), 0)).toBeNull();
    expect(coerceSettingsValue(byKey('n'), Number.NaN)).toBeNull();
    expect(coerceSettingsValue(byKey('n'), '3')).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    expect(coerceSettingsValue(byKey('n'), Number.POSITIVE_INFINITY)).toBeNull();
    const unbounded: SettingsValueField = { type: 'number', key: 'u', labelKey: 'k' };
    expect(coerceSettingsValue(unbounded, Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('applies min and max independently', () => {
    const minOnly: SettingsValueField = { type: 'number', key: 'lo', labelKey: 'k', min: 10 };
    const maxOnly: SettingsValueField = { type: 'number', key: 'hi', labelKey: 'k', max: -1 };
    expect(coerceSettingsValue(minOnly, 10)).toBe(10);
    expect(coerceSettingsValue(minOnly, 9)).toBeNull();
    expect(coerceSettingsValue(minOnly, 1_000_000)).toBe(1_000_000);
    expect(coerceSettingsValue(maxOnly, -1)).toBe(-1);
    expect(coerceSettingsValue(maxOnly, 0)).toBeNull();
    expect(coerceSettingsValue(maxOnly, -1_000_000)).toBe(-1_000_000);
  });

  it('rejects every value when select has no options', () => {
    const empty: SettingsValueField = { type: 'select', key: 's', labelKey: 'k', options: [] };
    expect(coerceSettingsValue(empty, 'a')).toBeNull();
    expect(coerceSettingsValue(empty, '')).toBeNull();
  });

  it('accepts strings for text/password/modelProfile', () => {
    const text: SettingsValueField = { type: 'text', key: 't', labelKey: 'k' };
    expect(coerceSettingsValue(text, 'a')).toBe('a');
    expect(coerceSettingsValue({ type: 'password', key: 'p', labelKey: 'k' }, 'secret')).toBe('secret');
    expect(coerceSettingsValue({ type: 'modelProfile', key: 'm', labelKey: 'k' }, 'p1')).toBe('p1');
    expect(coerceSettingsValue(text, 1)).toBeNull();
    expect(coerceSettingsValue({ type: 'modelProfile', key: 'm', labelKey: 'k' }, '')).toBe('');
    expect(coerceSettingsValue({ type: 'modelProfile', key: 'm', labelKey: 'k' }, null)).toBeNull();
  });

  it('enforces the string length cap', () => {
    const text: SettingsValueField = { type: 'text', key: 't', labelKey: 'k' };
    const model: SettingsValueField = { type: 'modelProfile', key: 'm', labelKey: 'k' };
    expect(coerceSettingsValue(text, 'x'.repeat(8 * 1024))).toHaveLength(8 * 1024);
    expect(coerceSettingsValue(text, 'x'.repeat(8 * 1024 + 1))).toBeNull();
    expect(coerceSettingsValue(model, 'x'.repeat(8 * 1024))).toHaveLength(8 * 1024);
    expect(coerceSettingsValue(model, 'x'.repeat(8 * 1024 + 1))).toBeNull();
  });

  it('fails closed on an unknown field type', () => {
    const bogus = {
      type: 'weird',
      key: 'k',
      labelKey: 'k',
      default: 'x',
    } as unknown as SettingsValueField;
    expect(coerceSettingsValue(bogus, 'x')).toBeNull();
  });

  it('fails closed for non-value fields (preset / action never become stored values)', () => {
    // 运行期纵深防御：调用方本应先过 `isValueField`，绕过时也绝不能把字段对象当值返回
    const preset = {
      type: 'preset',
      key: 'p',
      labelKey: 'k',
      options: [],
      value: () => 'x',
      apply: () => undefined,
    } as unknown as SettingsValueField;
    const action = {
      type: 'action',
      id: 'p.test',
      labelKey: 'k',
      run: async () => ({ ok: true }),
    } as unknown as SettingsValueField;

    expect(coerceSettingsValue(preset, 'x')).toBeNull();
    expect(coerceSettingsValue(action, 'x')).toBeNull();
  });
});
