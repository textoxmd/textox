import { Fragment, type ReactElement, type ReactNode } from 'react';

import { listAgentProfiles } from '@/agent/config';
import { profileOptions } from '@/agent/profile-options';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  applySettingsDefaults,
  isValueField,
  type SettingsActionField,
  type SettingsField,
} from '@texto/plugin-sdk';

export interface PluginSettingsFieldsProps {
  fields: SettingsField[];
  /**
   * 计算 `visibleWhen` / `preset` 有效值时使用的完整字段集；缺省回退到 `fields`。
   * 面板按 section 逐段渲染时，依赖字段可能在另一个 section（默认值也需要回填）。
   */
  allFields?: SettingsField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onAction?: (field: SettingsActionField) => void | Promise<void>;
  /**
   * 一次写入整组配置补丁（`preset` 字段的 `apply()` 会返回多键补丁）。
   * 缺省时退化为逐个 key 调用 `onChange`，宿主侧可能只保留最后一次写入。
   */
  onChangePatch?: (patch: Record<string, unknown>) => void;
  /**
   * 文案函数：第二参数为缺省文案（i18next 的 `defaultValue`）。资源尚未加载 /
   * 某个语言缺该 key 时用它兜底，避免界面出现裸 key。
   */
  t: (key: string, defaultValue?: string) => string;
  disabled?: boolean;
}

/** 未声明 `group` 的字段归入的默认分组（不渲染组标题）。 */
const DEFAULT_GROUP_KEY = '__default__';

interface FieldGroup {
  key: string;
  labelKey?: string;
  fields: SettingsField[];
}

/** 字段当前值：已存值优先，缺失时回填字段默认值（与 `applySettingsDefaults` 一致）。 */
function storedValue(field: SettingsField, values: Record<string, unknown>): unknown {
  if (!isValueField(field)) return undefined;
  return values[field.key] ?? field.default;
}

/** 是否展示「恢复默认」：有默认值且当前值已偏离（未写入过视为等于默认值）。 */
function isFieldChanged(field: SettingsField, values: Record<string, unknown>): boolean {
  if (!isValueField(field) || field.default === undefined) return false;
  const stored = values[field.key];
  return stored !== undefined && stored !== field.default;
}

function groupFields(fields: SettingsField[]): FieldGroup[] {
  const groups: FieldGroup[] = [];
  for (const field of fields) {
    const key = field.group ?? DEFAULT_GROUP_KEY;
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = { key, labelKey: field.groupLabelKey, fields: [] };
      groups.push(group);
    }
    group.fields.push(field);
  }
  return groups;
}

/**
 * 插件设置字段的受控渲染器（宿主与运行时插件共用）。
 *
 * 只负责「字段声明 → 控件」：值的读写、校验与落盘由调用方（`onChange` / `onAction`）
 * 决定；因此运行时插件（`data.json`）与第一方插件（`plugin_config.*.json`）可以复用同一份
 * 渲染逻辑，无需各自维护 type 白名单。
 *
 * `visibleWhen` 与 `preset` 都基于「回填默认值后的有效配置」求值，保证首次打开时
 * 隐藏分支与预设名判断正确；求值范围由 `allFields` 决定（跨 section 依赖同理）。
 */
export function PluginSettingsFields({
  fields,
  allFields,
  values,
  onChange,
  onAction,
  onChangePatch,
  t,
  disabled = false,
}: PluginSettingsFieldsProps): ReactElement {
  const effectiveValues = applySettingsDefaults(allFields ?? fields, values);
  const visibleFields = fields.filter(
    (field) =>
      !field.visibleWhen || effectiveValues[field.visibleWhen.key] === field.visibleWhen.equals,
  );

  const applyPresetPatch = (patch: Record<string, unknown>) => {
    if (onChangePatch) {
      onChangePatch(patch);
      return;
    }
    for (const [key, value] of Object.entries(patch)) onChange(key, value);
  };

  const renderField = (field: SettingsField): ReactElement => {
    const value = storedValue(field, values);
    const changed = isFieldChanged(field, values);

    // 「恢复默认」放在标签行内（而不是控件旁）：`.settings-item` 的 CSS 依赖
    // 「末尾直接子元素是控件」来切换开关类字段的布局，多包一层会静默改变行高。
    const row = (control: ReactNode, info?: ReactNode): ReactElement => (
      <div key={'key' in field ? field.key : field.id} className="settings-item">
        <div className="settings-item-info">
          <span className="settings-item-label">
            {t(field.labelKey)}
            {changed && isValueField(field) && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 h-auto px-1 py-0 text-xs font-normal text-muted-foreground"
                disabled={disabled}
                data-slot="plugin-field-reset"
                onClick={() => onChange(field.key, field.default)}
              >
                {t('common.reset', '恢复默认')}
              </Button>
            )}
          </span>
          {field.descriptionKey && (
            <span className="settings-item-description">{t(field.descriptionKey)}</span>
          )}
          {info}
        </div>
        {control}
      </div>
    );

    if (field.type === 'action') {
      // 与设置页其它动作按钮一致用 outline：secondary 的边框是透明的，在深色底上
      // 看起来像纯文字、没有框线
      return row(
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => {
            void onAction?.(field);
          }}
        >
          {t(field.labelKey)}
        </Button>,
      );
    }

    if (field.type === 'modelProfile') {
      const current = typeof value === 'string' ? value : '';
      const { options, state } = profileOptions(listAgentProfiles(), current);
      const empty = options.length === 0;
      return row(
        <Select
          value={current}
          disabled={disabled || empty}
          onValueChange={(next) => onChange(field.key, next)}
        >
          <SelectTrigger className="w-46">
            <SelectValue placeholder={t('settings.aiProfile.none', '未选择')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id} disabled={option.inactive}>
                {option.label}
                {option.inactive ? t('settings.aiProfile.disabled', '（已停用）') : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
        <>
          {state === 'deleted' && (
            <span className="settings-item-description" data-slot="model-profile-deleted">
              {t('settings.aiProfile.deleted', '配置已删除，请重新选择')}
            </span>
          )}
          {empty && (
            <span className="settings-item-description" data-slot="model-profile-empty">
              {t('settings.aiProfile.empty', '先到模型设置启用一条配置')}
            </span>
          )}
        </>,
      );
    }

    switch (field.type) {
      case 'boolean':
        return row(
          <Checkbox
            checked={value === true}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(field.key, checked === true)}
          />,
        );
      case 'select':
        return row(
          <Select
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onValueChange={(next) => onChange(field.key, next)}
          >
            <SelectTrigger className="w-46">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.labelKey ? t(option.labelKey) : (option.label ?? option.value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        );
      case 'number':
        return row(
          <Input
            type="number"
            className="w-24"
            disabled={disabled}
            value={value === undefined || value === null ? '' : String(value)}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(event) =>
              onChange(
                field.key,
                event.target.value === '' ? undefined : Number(event.target.value),
              )
            }
          />,
        );
      case 'color': {
        const currentValue =
          typeof value === 'string' && value ? value : (field.default ?? '#000000');
        const presets = field.presets ?? [];
        const customActive = !presets.some(
          (preset) => preset.value.toLowerCase() === currentValue.toLowerCase(),
        );
        return row(
          presets.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              {presets.map((preset) => {
                const isActive = currentValue.toLowerCase() === preset.value.toLowerCase();
                const label = preset.labelKey
                  ? t(preset.labelKey)
                  : (preset.label ?? preset.value);
                return (
                  <button
                    key={preset.value}
                    type="button"
                    data-slot="plugin-color-preset"
                    aria-label={label}
                    aria-pressed={isActive}
                    title={label}
                    disabled={disabled}
                    onClick={() => onChange(field.key, preset.value)}
                    className={`h-6 w-6 cursor-pointer rounded-full border-2 transition-all hover:scale-105 ${
                      isActive ? 'border-primary scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: preset.value }}
                  />
                );
              })}
              <label
                data-slot="plugin-color-custom"
                data-active={customActive ? 'true' : 'false'}
                className="relative cursor-pointer"
              >
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs transition-colors"
                  style={
                    customActive
                      ? {
                          backgroundColor: currentValue,
                          borderColor: currentValue,
                          color: 'oklch(1 0 0)',
                          textShadow: '0 0 2px oklch(0 0 0 / 0.5)',
                        }
                      : {
                          borderColor: 'var(--border)',
                          borderStyle: 'dashed',
                          color: 'var(--muted-foreground)',
                        }
                  }
                >
                  {customActive ? '✓' : '+'}
                </div>
                <input
                  type="color"
                  data-slot="plugin-color-input"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  disabled={disabled}
                  value={currentValue}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
              </label>
            </div>
          ) : (
            <input
              type="color"
              data-slot="plugin-color-input"
              className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
              disabled={disabled}
              value={currentValue}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          ),
        );
      }
      case 'preset': {
        const current = field.value(effectiveValues);
        return row(
          <Select
            value={current}
            disabled={disabled}
            onValueChange={(next) => {
              const patch = field.apply(next, effectiveValues);
              if (patch) applyPresetPatch(patch);
            }}
          >
            <SelectTrigger className="w-46">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.labelKey ? t(option.labelKey) : (option.label ?? option.value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        );
      }
      case 'text':
      case 'password':
      default:
        return row(
          <Input
            type={field.type}
            className="w-60"
            disabled={disabled}
            value={
              typeof value === 'string'
                ? value
                : value === undefined || value === null
                  ? ''
                  : String(value)
            }
            placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            onChange={(event) => onChange(field.key, event.target.value)}
          />,
        );
    }
  };

  const groups = groupFields(visibleFields);

  return (
    <>
      {groups.map((group) => {
        const labelKey = group.key === DEFAULT_GROUP_KEY ? undefined : group.labelKey;
        return (
          <Fragment key={group.key}>
            {labelKey && (
              <div
                data-slot="plugin-settings-group-title"
                className="text-xs font-medium text-muted-foreground"
              >
                {t(labelKey)}
              </div>
            )}
            {group.fields.map(renderField)}
          </Fragment>
        );
      })}
    </>
  );
}
