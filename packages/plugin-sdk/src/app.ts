import { declareExtensionPoint, hasExtensionPoint } from './extension-points';
import type { AgentToolResult, PluginHost } from './types';

declare module './types' {
  interface ExtensionPointMap {
    // 增强块内的引用不计入 noUnusedLocals，故这三个用内联 import 类型。
    'app:fileEditor': import('./types').FileEditorContribution;
    'app:exporter': import('./types').ExporterContribution;
    'app:command': import('./types').CommandContribution;
    'app:settingsSection': SettingsSection;
    'app:imageUploader': ImageUploaderContribution;
    'app:agentTool': AgentToolContribution;
  }
}

interface SettingsFieldBase {
  labelKey: string;
  descriptionKey?: string;
  /** 分区（同 group 的字段渲染在一起）；缺省为默认分区。 */
  group?: string;
  /** 分区标题的 i18n key。 */
  groupLabelKey?: string;
  /** 可选：仅当 `values[key] === equals` 时显示。 */
  visibleWhen?: { key: string; equals: unknown };
}

/**
 * 承载存储值的字段的公共声明。
 * `preset` / `action` 不承载存储值，故不带 `apply`（否则与 preset 的 `apply()` 冲突）。
 */
interface SettingsValueFieldBase extends SettingsFieldBase {
  key: string;
  /** 生效方式：`immediate` 立即生效，`restart` 重启后生效；缺省 `immediate`。 */
  apply?: 'immediate' | 'restart';
}

export interface SettingsTextField extends SettingsValueFieldBase {
  type: 'text' | 'password';
  default?: string;
  placeholderKey?: string;
}

export interface SettingsNumberField extends SettingsValueFieldBase {
  type: 'number';
  default?: number;
  placeholderKey?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface SettingsBooleanField extends SettingsValueFieldBase {
  type: 'boolean';
  default?: boolean;
}

export interface SettingsSelectField extends SettingsValueFieldBase {
  type: 'select';
  default?: string;
  /** 选项标签：`labelKey`（i18n）或 `label`（纯文本，如品牌名）至少一个。 */
  options: Array<{ value: string } & (
    | { labelKey: string; label?: string }
    | { label: string; labelKey?: string }
  )>;
}

export interface SettingsModelProfileField extends SettingsValueFieldBase {
  type: 'modelProfile';
  /** 默认空串 = 未选择 */
  default?: string;
}

export interface SettingsColorField extends SettingsValueFieldBase {
  type: 'color';
  default?: string;
  /** 预设色板：存在时设置面板渲染「色板圆点 + 自定义取色器」；缺省回退单个取色器。 */
  presets?: Array<{ value: string; labelKey?: string; label?: string }>;
}

export interface SettingsPresetField extends SettingsFieldBase {
  type: 'preset';
  /** 仅作标识，不写入配置。 */
  key: string;
  options: Array<{ value: string } & (
    | { labelKey: string; label?: string }
    | { label: string; labelKey?: string }
  )>;
  /** 根据当前配置计算应显示的选项值。 */
  value(values: Record<string, unknown>): string;
  /**
   * 选择某项时返回要写入的整组配置补丁；返回空表示不写入。
   * 注意：与值字段的 `apply` 生效策略同名，读取策略前必须按 type 收窄。
   */
  apply(value: string, values: Record<string, unknown>): Record<string, unknown> | void;
}

export interface SettingsActionField extends SettingsFieldBase {
  type: 'action';
  /** 同一插件内唯一 */
  id: string;
  /**
   * 行内执行器（第一方插件）：`host` 是本插件的宿主能力面，`values` 是当前配置。
   * 失败且未给 `messageKey` 时不弹提示（例如用户取消选择）；
   * 返回值带 `detail` 时由设置面板展示（如测试连接返回的 URL）。
   *
   * 第三方插件的清单字段是 JSON，函数无法随清单落盘，改为引用命令 id
   * （`{ type: 'action', key, command }`）；这类字段没有 `run`，由宿主按命令分派。
   */
  run?(
    host: PluginHost,
    values: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    messageKey?: string;
    /** 可选补充信息：成功时为结果信息（如远端 URL），失败时为诊断信息。 */
    detail?: string;
    /** 有值时用整组配置覆盖该插件的配置（用于恢复默认）。 */
    set?: Record<string, unknown>;
  }>;
}

export type SettingsField =
  | SettingsTextField
  | SettingsNumberField
  | SettingsBooleanField
  | SettingsSelectField
  | SettingsModelProfileField
  | SettingsColorField
  | SettingsPresetField
  | SettingsActionField;

/** 承载存储值的字段（`preset` / `action` 除外）。 */
export type SettingsValueField =
  | SettingsTextField
  | SettingsNumberField
  | SettingsBooleanField
  | SettingsSelectField
  | SettingsModelProfileField
  | SettingsColorField;

/** 全部合法值都是标量。 */
export type SettingsValue = string | number | boolean;

export function isValueField(field: SettingsField): field is SettingsValueField {
  if (field.type === 'action' || field.type === 'preset') return false;
  // 类型护栏：`SettingsField` 新增变体若忘记加入 `SettingsValueField`，这里会报错。
  field satisfies SettingsValueField;
  return true;
}

export interface SettingsSection {
  /** 建议用 `<pluginId>.<name>` 命名；贡献按 id 全局去重（后注册覆盖）。 */
  id: string;
  titleKey: string;
  fields: SettingsField[];
}

export interface ImageUploaderContribution {
  /** 建议用 `<pluginId>.<name>` 命名；贡献按 id 全局去重（后注册覆盖）。 */
  id: string;
  /** 本地图片绝对路径 → 远端 URL */
  upload(host: PluginHost, filePath: string): Promise<string>;
}

/** Agent 工具贡献：核心与插件共用的工具注册表单条。 */
export interface AgentToolContribution {
  /** 建议 `<owner>.<name>`；同名时后注册者覆盖。 */
  name: string;
  description: string;
  /** JSON Schema（object） */
  parameters: Record<string, unknown>;
  execute(host: PluginHost, args: Record<string, unknown>): Promise<AgentToolResult>;
}

/** 应用级扩展点所有者 id。 */
export const APP_OWNER = 'app';

/** 主窗口文件编辑器扩展点 id。 */
export const APP_FILE_EDITOR = 'app:fileEditor';
/** 导出格式扩展点 id。 */
export const APP_EXPORTER = 'app:exporter';
/** 命令面板 / 菜单命令扩展点 id。 */
export const APP_COMMAND = 'app:command';
/** 插件设置项扩展点 id。 */
export const APP_SETTINGS_SECTION = 'app:settingsSection';
/** 图片上传器扩展点 id。 */
export const APP_IMAGE_UPLOADER = 'app:imageUploader';
/** Agent 工具扩展点 id。 */
export const APP_AGENT_TOOL = 'app:agentTool';

const APP_POINTS = [
  APP_FILE_EDITOR,
  APP_EXPORTER,
  APP_COMMAND,
  APP_SETTINGS_SECTION,
  APP_IMAGE_UPLOADER,
  APP_AGENT_TOOL,
] as const;

/** 声明全部应用级扩展点。宿主启动时、登记插件贡献之前调用一次；幂等。 */
export function declareAppExtensionPoints(): void {
  for (const id of APP_POINTS) {
    if (hasExtensionPoint(id)) continue;
    declareExtensionPoint({ id }, APP_OWNER);
  }
}
