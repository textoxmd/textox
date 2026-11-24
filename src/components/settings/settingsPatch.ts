import { coerceSettingsValue, isValueField, type SettingsField } from '@texto/plugin-sdk';

/**
 * 校验并归一化一组设置补丁（`preset` 一次写多个键）。
 *
 * 逐键按字段声明 `coerceSettingsValue`：**任一键非法 / 未声明即整组拒绝**（返回 `null`），
 * 避免写出「一半生效」的预设——比如 `density` 合法、`theme` 不是合法选项时，
 * 只写密度会让用户看到一个从未声明过的组合。
 *
 * 不承载存储值的字段（`preset` / `action`）不可能是补丁目标，一律拒绝。
 */
export function coerceSettingsPatch(
  fields: SettingsField[],
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = fields.find((candidate) => 'key' in candidate && candidate.key === key);
    if (!field || !isValueField(field)) return null;
    const coerced = coerceSettingsValue(field, value);
    if (coerced === null) return null;
    next[key] = coerced;
  }
  return next;
}

/**
 * 插件的已存配置是否偏离声明默认值。
 *
 * 只比较承载存储值的字段（`preset` / `action` 不产生配置键），且「未写入」视为等于默认值：
 * 面板据此决定「恢复默认设置」是否可点，避免在没有任何可恢复内容时给出可点的按钮。
 */
export function settingsDifferFromDefaults(
  fields: SettingsField[],
  values: Record<string, unknown>,
): boolean {
  return fields.some((field) => {
    if (!isValueField(field)) return false;
    const stored = values[field.key];
    return stored !== undefined && stored !== field.default;
  });
}
