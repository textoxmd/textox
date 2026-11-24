import type { SettingsField as HostSettingsField } from '@texto/plugin-sdk';
import { applySettingsDefaults, type SettingsField } from '@textox/plugin-sdk';
import {
  toDisposable,
  type AgentCapability,
  type CommandContribution,
  type Disposable,
  type EditorContextMenuItemMeta,
  type EditorExtension,
  type EmbedBridgeOptions,
  type FileEditorBridgeOptions,
  type FormatToolbarItemMeta,
  type InsertCommandMeta,
  type PluginApp,
  type PluginExporter,
  type PluginImageUploader,
  type PluginManifest,
  type PluginDialogsApi,
  type PluginThemeApi,
  type SelectionActionMeta,
  type SettingsSnapshot,
  type SyntaxFeature,
  type SyntaxHighlightContribution,
} from '@textox/plugin-sdk';
import { toast } from 'sonner';

import i18n from '@/i18n';

import { pluginIpc, subscribePluginDataChanged, type PluginData } from './ipc';
import type { PluginRegistry } from './registry';

export type { PluginData };

/** 宿主侧能力实现（由骨架按插件注入，插件只看到 `PluginApp`）。 */
export interface PluginHostDeps {
  getActiveFilePath: () => string | null;
  getDocumentDir: () => string | null;
  openFile: (path: string) => Promise<void>;
  insertText: (text: string) => boolean;
  canEdit: () => boolean;
  /** `ownerId` 用于旧体系的按插件绑定（配置快照 / 文件编辑器 host）；插件侧不可见。 */
  registerEmbed: (options: EmbedBridgeOptions, ownerId: string) => Disposable;
  registerFileEditor: (options: FileEditorBridgeOptions, ownerId: string) => Disposable;
  /**
   * 编辑器贡献桥（7 个入口，均由 `editorBridge.ts` 适配到扩展点）。
   * 返回值的 `dispose()` 会立即移除贡献并请求编辑器重建；`ownerId` 插件侧不可见。
   * 贡献值一律 `unknown`：形状由 `@texto/plugin-sdk` 的扩展点契约收窄。
   */
  registerSyntaxFeature: (feature: unknown, ownerId: string) => Disposable;
  registerExtension: (extension: unknown, ownerId: string) => Disposable;
  registerFormatToolbarItem: (item: unknown, ownerId: string) => Disposable;
  registerContextMenuItem: (item: unknown, ownerId: string) => Disposable;
  registerSelectionAction: (action: unknown, ownerId: string) => Disposable;
  registerSyntaxHighlight: (contribution: unknown, ownerId: string) => Disposable;
  registerInsertCommand: (command: unknown, ownerId: string) => Disposable;
  /**
   * 登记导出器（作者包形态）；宿主收敛 `kind` 缺省值、补 `labelKey` 前缀并同步原生菜单。
   * 返回值的 `dispose()` 立即从注册表移除并再次同步菜单。
   */
  registerExporter: (exporter: PluginExporter, ownerId: string) => Disposable;
  /**
   * 登记图片上传器；桥接层会用该插件自己的 `PluginApp` 调用作者实现（见 `getPluginApp`）。
   * 返回值的 `dispose()` 立即注销 `app:imageUploader` 贡献。
   */
  registerImageUploader: (uploader: PluginImageUploader, ownerId: string) => Disposable;
  /** 构造绑定到该插件的 Agent 能力（`available()` 在模型配置未就绪时为 false）。 */
  createAgentCapability: (ownerId: string) => AgentCapability;
  /** 构造绑定到该插件的主题能力（应用/订阅代码块高亮配色、读当前外观）。 */
  createThemeApi: (ownerId: string) => PluginThemeApi;
  /** 构造绑定到该插件的原生对话框能力（无原生环境时降级为取消，不抛错）。 */
  createDialogsApi: (ownerId: string) => PluginDialogsApi;
  /** 请求编辑器按最新运行期配置重建（未接入编辑器时为空操作）。 */
  requestReload: () => void;
  /** 不带 `ownerId`：它不写按 owner 键控的注册表，只走文档打开流程。 */
  createNewDocument: (options: { content: string; extension?: string }) => Promise<void>;
  addMessages: (
    locales: Record<string, Record<string, unknown>>,
    defaultLocale: string | undefined,
    ownerId: string,
  ) => void;
  parseEmbedRef: (text: string) => { src: string; alt: string; title?: string } | null;
}

export interface CreatePluginAppOptions {
  manifest: PluginManifest;
  registry: PluginRegistry;
  deps: PluginHostDeps;
  data: PluginData;
  onDataChanged?: (data: PluginData) => void;
  /** 落盘通道；缺省走 `pluginIpc`（测试/宿主可注入）。 */
  writeData?: (pluginId: string, data: PluginData) => Promise<void>;
  /** 重读通道；缺省走 `pluginIpc`（跨窗口热更新用）。 */
  readData?: (pluginId: string) => Promise<PluginData>;
  /** 数据变更广播的订阅；缺省走 `subscribePluginDataChanged`。 */
  subscribeDataChanged?: (handler: (pluginId: string) => void) => () => void;
}

/** 非空字符串：空白 key / labelKey 都是坏声明。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 运行中的 `PluginApp` 实例（按插件 id）。
 *
 * 桥接层（图片上传器）需要**该插件自己的** app：作者实现的 `upload(app, filePath)`
 * 只能拿到 `PluginApp`（可读写本插件配置、发 toast），而扩展点贡献收到的 `PluginHost`
 * 是旧体系宿主。
 */
const pluginApps = new Map<string, PluginApp>();

/**
 * 运行中插件自己的贡献注册表（按插件 id）。
 *
 * 清单 `action` 字段只带命令 id（清单是 JSON，不能存函数），分派时据此确认命令由
 * **同一个插件**注册——否则点 A 插件的按钮可能跑到 B 插件的命令上。
 */
const pluginRegistries = new Map<string, PluginRegistry>();

/** 取运行中的插件实例；插件未启用 / 已停用时返回 undefined。 */
export function getPluginApp(ownerId: string): PluginApp | undefined {
  return pluginApps.get(ownerId);
}

/**
 * 执行清单里的 `action` 设置字段：按 `field.command` 找**该插件**注册的同名命令并调用。
 *
 * 清单是 JSON，函数无法随清单落盘，所以动作只能引用命令 id（插件在 `onload` 里
 * `addCommand({ id })` 注册）。返回 `false` 表示没有可执行入口：字段不是 `action`、
 * 缺 `command`、插件未运行，或该插件没有注册同名命令——面板据此提示「未启用 / 未注册」。
 * 命令自身抛错原样上抛，由调用方提示。
 */
export async function runManifestAction(ownerId: string, field: unknown): Promise<boolean> {
  if (typeof field !== 'object' || field === null) return false;
  const record = field as { type?: unknown; command?: unknown };
  if (record.type !== 'action' || !isNonEmptyString(record.command)) return false;
  const registry = pluginRegistries.get(ownerId);
  if (!registry) return false;
  const command = registry
    .owned<CommandContribution>('command', ownerId)
    .find((candidate) => candidate.id === record.command);
  if (!command) return false;
  await command.callback();
  return true;
}

/** `select` 的每项只强制 `value`：`labelKey` / `label` 的兜底由渲染器负责。 */
function isSelectOption(option: unknown): boolean {
  if (typeof option !== 'object' || option === null) return false;
  return isNonEmptyString((option as { value?: unknown }).value);
}

/** `preset` 的每项：`value` / `labelKey` 必填，`values` 必须是键值补丁对象。 */
function isPresetOption(option: unknown): boolean {
  if (typeof option !== 'object' || option === null) return false;
  const record = option as Record<string, unknown>;
  if (!isNonEmptyString(record.value)) return false;
  if (!isNonEmptyString(record.labelKey)) return false;
  return (
    typeof record.values === 'object' && record.values !== null && !Array.isArray(record.values)
  );
}

/** 合法颜色：3 / 6 位十六进制（与 `coerceSettingsValue` 的归一化规则同一套）。 */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * 校验清单里一条设置声明的**形状**。
 *
 * 只校验宿主实际读取的成员（`key` / `labelKey` / `type` / `default` / `options` / `command`）：
 * 第三方手写的 `manifest.json` 可能给出「type 合法但形状残缺」的字段（如缺 `options`
 * 的 select、缺 `values` 的 preset），渲染器会直接抛 `TypeError`，所以必须在入口丢弃，
 * 不能只验 type 白名单。
 *
 * 返回值带类型谓词的副作用是调用方无需再自证转换（`const declared: SettingsField = field`）。
 */
function isSettingsField(field: unknown): field is SettingsField {
  if (typeof field !== 'object' || field === null) return false;
  const record = field as Record<string, unknown>;
  if (!isNonEmptyString(record.key)) return false;
  if (!isNonEmptyString(record.labelKey)) return false;
  switch (record.type) {
    case 'boolean':
      return typeof record.default === 'boolean';
    case 'number':
      return typeof record.default === 'number' && Number.isFinite(record.default);
    case 'select':
      return (
        Array.isArray(record.options) &&
        record.options.length > 0 &&
        record.options.every(isSelectOption)
      );
    case 'color':
      return typeof record.default === 'string' && HEX_COLOR_RE.test(record.default);
    case 'modelProfile':
    case 'text':
    case 'password':
      // modelProfile 的 default 是 profile id，空串表示未绑定；与 text 同受渲染器约束。
      return typeof record.default === 'string';
    case 'preset':
      return (
        Array.isArray(record.options) &&
        record.options.length > 0 &&
        record.options.every(isPresetOption)
      );
    case 'action':
      // 动作字段不承载值，只需要一个可解析的命令引用（命令存在性在点击时分派）
      return isNonEmptyString(record.command);
    default:
      // 未知 type：一律丢弃，避免渲染器按未处理的类型渲染空行
      return false;
  }
}

/** 预设选项的 `values` 是否与当前有效配置逐键一致（`Object.is`，避免 `NaN` 干扰）。 */
function matchesPresetValues(
  values: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  const keys = Object.keys(patch);
  // 空补丁无法判断「选中了哪个预设」：不能让它永远匹配
  if (keys.length === 0) return false;
  return keys.every((key) => Object.is(values[key], patch[key]));
}

/**
 * 把清单字段（纯 JSON）转成设置面板的富字段。
 *
 * 值字段两种形状本就相容（清单里的 `default` 是必填，面板侧是可缺省），只有两处需要桥：
 * - `preset`：清单用数据描述「选中后写哪些键」，面板用 `value()` / `apply()` 求值；
 * - `action`：清单只有 `command`，面板按 `id` 渲染、由 `onAction` 交给 `runManifestAction`。
 */
export function toHostSettingsFields(fields: SettingsField[]): HostSettingsField[] {
  return fields.map((field): HostSettingsField => {
    if (field.type === 'action') {
      // `command` 由展开式带出：面板的 `onAction` 直接把它交给 `runManifestAction`
      return { ...field, type: 'action', id: field.key };
    }
    if (field.type === 'preset') {
      return {
        type: 'preset',
        key: field.key,
        labelKey: field.labelKey,
        descriptionKey: field.descriptionKey,
        group: field.group,
        groupLabelKey: field.groupLabelKey,
        visibleWhen: field.visibleWhen,
        options: field.options.map((option) => ({
          value: option.value,
          labelKey: option.labelKey,
        })),
        // 当前选中项 = 有效配置与某个选项的 values 逐键一致；用户手工改过某键时为空
        value: (values) =>
          field.options.find((option) => matchesPresetValues(values, option.values))?.value ?? '',
        apply: (value) => {
          const option = field.options.find((candidate) => candidate.value === value);
          return option ? { ...option.values } : undefined;
        },
      };
    }
    return field;
  });
}

/**
 * 清单里的设置字段声明（`plugin-build` 写入 `manifest.settings`）。
 * 运行时类型是 `unknown[]`：第三方可手写 manifest，这里只保留形状合法的字段，
 * 避免坏数据让默认值回填或设置面板渲染抛错。
 *
 * 被丢掉的字段要告警：静默变 `[]` 会让插件作者以为清单已经生效，排查不到问题。
 *
 * 公开给设置面板复用（`PluginManagerPanel`）：字段校验只此一份，两个消费点
 * （启动期回填默认值、面板渲染控件）不会各自漂移；面板再经 `toHostSettingsFields`
 * 桥接成渲染器的富字段。
 */
export function parseManifestSettings(
  manifest: PluginManifest,
  log: { warn: (...args: unknown[]) => void },
): SettingsField[] {
  const raw = manifest.settings;
  if (!Array.isArray(raw)) {
    if (raw !== undefined) log.warn('dropping invalid settings declaration', raw);
    return [];
  }
  return raw.filter((field): field is SettingsField => {
    if (isSettingsField(field)) return true;
    log.warn('dropping invalid settings field', field);
    return false;
  });
}

/**
 * 两份配置的稳定浅比较：键集合一致 + 值相同（`Object.is`，避免 `NaN` 每次都被判为变化）。
 * 设置值都是 JSON 标量（string / number / boolean），无需深比较。
 */
function sameSettings(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]),
  );
}

/**
 * 为单个插件构造 `PluginApp`：能力全部落到宿主实现上，插件不接触骨架模块。
 *
 * 设置默认值取自 `manifest.settings`，只回填到本 app 持有的副本（不修改调用方对象）；
 * 调用方从 `settings.all()` / `settings.onDidChange()` / `onDataChanged` 取结果。
 *
 * 返回类型是契约面 + 宿主私有的 `dispose()`：停用插件时释放设置订阅者与
 * `plugin:data-changed` 监听（不释放会按插件数量累积泄漏）。`dispose` 不属于 vendor 契约。
 */
export function createPluginApp(
  options: CreatePluginAppOptions,
): PluginApp & { dispose(): void } {
  const { manifest, registry, deps } = options;

  const log = {
    info: (...args: unknown[]) => console.info(`[plugin:${manifest.id}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[plugin:${manifest.id}]`, ...args),
    error: (...args: unknown[]) => console.error(`[plugin:${manifest.id}]`, ...args),
  };

  // 校验放在 log 之后：坏字段要告警，而不是静默变 `[]`
  const settingsFields = parseManifestSettings(manifest, log);
  /**
   * 声明 `apply: 'restart'` 的键：写入立即落盘，但运行期内存值保持不变，
   * 由下次启动（用磁盘值初始化）兑现「重启后生效」。
   */
  const restartKeys = new Set<string>();
  /**
   * 已落盘但按 `apply: 'restart'` 尚未在内存生效的值：后续任何写入都必须原样带上，
   * 否则以内存值为准的整份 payload 会把磁盘上的新值回退成旧值。
   */
  const pendingRestart: Record<string, unknown> = {};
  for (const field of settingsFields) {
    // preset / action 不承载单值：只有值字段才能被声明为「重启后生效」
    if (field.type === 'preset' || field.type === 'action') continue;
    if (field.apply === 'restart') restartKeys.add(field.key);
  }
  const writeData =
    options.writeData ??
    ((pluginId: string, data: PluginData) => pluginIpc.writeData(pluginId, data));
  const readData = options.readData ?? ((pluginId: string) => pluginIpc.readData(pluginId));
  const data: PluginData = {
    ...options.data,
    // 两个命名空间都换成自己的副本：避免默认值回填 / 热更新改写调用方对象
    settings: applySettingsDefaults(settingsFields, options.data.settings),
    plugin: { ...options.data.plugin },
  };

  /** 释放后的守卫：`set()` 与 in-flight 重读都不得再改内存 / 回调宿主。 */
  let disposed = false;

  /** 生效配置变更的订阅者；每次落盘 / 跨窗口热更新后逐个通知（单项抛错不影响其余）。 */
  const listeners = new Set<(snapshot: SettingsSnapshot) => void>();
  const snapshot = (): SettingsSnapshot => {
    // `values` 是冻结副本，`read` 必须读同一份：否则跨 `set()` 后快照内部会自相矛盾
    const values = Object.freeze({ ...data.settings });
    return { values, read: <T,>(key: string) => values[key] as T | undefined };
  };
  const emit = (): void => {
    // 遍历拷贝：listener 里退订不会让本次派发跳过后续订阅者（与 SDK 的 notify 对齐）
    for (const listener of [...listeners]) {
      try {
        listener(snapshot());
      } catch (error) {
        log.error('settings listener threw', error);
      }
    }
  };

  /**
   * 跨窗口热更新：别的窗口（设置窗口）落盘后 Rust 广播 `plugin:data-changed`，
   * 本窗口按 id 过滤后重读磁盘并通知插件（编辑器窗口/设置窗口是两套 WebView）。
   */
  let unsubscribe: (() => void) | null = (
    options.subscribeDataChanged ?? subscribePluginDataChanged
  )((pluginId) => {
    if (pluginId !== manifest.id) return;
    void reloadData();
  });

  /**
   * 从磁盘重读本插件数据并广播；读失败只记日志（保留当前内存值）。
   *
   * 值未变则不 `emit`：`set()` 本地已经通知过一次，Rust 落盘后广播回来会再重读一遍，
   * 无脑 emit 会让插件在回调里重建编辑器跑两次。
   */
  async function reloadData(): Promise<void> {
    try {
      const next = await readData(manifest.id);
      // 停用期间完成的重读不得写回内存 / 回调宿主（此时插件已经不在了）
      if (disposed) return;
      const nextSettings = applySettingsDefaults(settingsFields, next.settings ?? {});
      // restart 键以运行期内存值为准：别的窗口改了磁盘值，本窗口的插件实例也不该立刻受影响
      for (const key of restartKeys) nextSettings[key] = data.settings[key];
      const changed = !sameSettings(data.settings, nextSettings);
      data.settings = nextSettings;
      data.plugin = { ...(next.plugin ?? {}) };
      options.onDataChanged?.(data);
      if (changed) emit();
    } catch (error) {
      log.error('reload plugin data failed', error);
    }
  }

  /** 释放设置订阅者与跨窗口监听；`stopPlugin` 时调用（可重复调用）。 */
  function dispose(): void {
    disposed = true;
    listeners.clear();
    if (pluginApps.get(manifest.id) === app) pluginApps.delete(manifest.id);
    if (pluginRegistries.get(manifest.id) === registry) pluginRegistries.delete(manifest.id);
    unsubscribe?.();
    unsubscribe = null;
  }

  /**
   * 落盘：失败会 `reject`（调用方回滚内存值，保持「内存 == 最近成功落盘」）。
   *
   * `settingsOverride` 用于 restart 键：把新值写进磁盘，但不改内存、不通知宿主——
   * 否则「落盘立即、生效延后」会变成两条各自演进的写盘路径。
   */
  async function persist(settingsOverride?: Record<string, unknown>): Promise<void> {
    try {
      const payload: PluginData = settingsOverride
        ? { ...data, settings: settingsOverride }
        : { ...data, settings: { ...data.settings, ...pendingRestart } };
      await writeData(manifest.id, payload);
      // 落盘已经完成：内存与磁盘一致，但插件已停用（或本次写入尚未生效），不再通知宿主
      if (disposed || settingsOverride) return;
      options.onDataChanged?.(data);
      emit();
    } catch (error) {
      log.error('persist plugin data failed', error);
      throw error;
    }
  }

  const app: PluginApp & { dispose(): void } = {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    // VITE_FREE_VERSION 是字符串 "true"/"false"，必须严格比较
    edition: import.meta.env.VITE_FREE_VERSION === 'true' ? 'lite' : 'full',
    register: (kind, id, value) => registry.register(manifest.id, kind, id, value),
    workspace: {
      getActiveFilePath: () => deps.getActiveFilePath(),
      getDocumentDir: () => deps.getDocumentDir(),
      openFile: (path: string) => deps.openFile(path),
      registerFileEditor: (options: FileEditorBridgeOptions) =>
        deps.registerFileEditor(options, manifest.id),
    },
    editor: {
      insertText: (text: string) => {
        deps.insertText(text);
      },
      canEdit: () => deps.canEdit(),
      registerEmbed: (options: EmbedBridgeOptions) => deps.registerEmbed(options, manifest.id),
      parseEmbedRef: (text: string) => deps.parseEmbedRef(text),
      registerSyntaxFeature: (feature: SyntaxFeature) =>
        deps.registerSyntaxFeature(feature, manifest.id),
      registerExtension: (extension: EditorExtension) =>
        deps.registerExtension(extension, manifest.id),
      registerFormatToolbarItem: (item: FormatToolbarItemMeta) =>
        deps.registerFormatToolbarItem(item, manifest.id),
      registerContextMenuItem: (item: EditorContextMenuItemMeta) =>
        deps.registerContextMenuItem(item, manifest.id),
      registerSelectionAction: (action: SelectionActionMeta) =>
        deps.registerSelectionAction(action, manifest.id),
      registerSyntaxHighlight: (contribution: SyntaxHighlightContribution) =>
        deps.registerSyntaxHighlight(contribution, manifest.id),
      registerInsertCommand: (command: InsertCommandMeta) =>
        deps.registerInsertCommand(command, manifest.id),
      requestReload: () => deps.requestReload(),
    },
    documents: {
      createNewDocument: (options: { content: string; extension?: string }) =>
        deps.createNewDocument(options),
    },
    settings: {
      get: <T,>(key: string) => data.settings[key] as T | undefined,
      set: async (key: string, value: unknown) => {
        // 停用后的迟到写入直接丢弃：不落盘、不改内存、不回调宿主
        if (disposed) return;
        // restart 键：落盘立即（下次启动生效），运行期内存值与订阅者都不变
        if (restartKeys.has(key)) {
          await persist({ ...data.settings, ...pendingRestart, [key]: value });
          // 只有落盘成功才记账：失败不污染 overlay，下一次普通写入不会带上没写进去的值
          pendingRestart[key] = value;
          return;
        }
        const hadKey = Object.prototype.hasOwnProperty.call(data.settings, key);
        const previous = data.settings[key];
        data.settings[key] = value;
        try {
          await persist();
        } catch (error) {
          // 失败即回滚：内存必须等于最近一次成功落盘的内容
          if (hadKey) data.settings[key] = previous;
          else delete data.settings[key];
          throw error;
        }
      },
      all: () => snapshot(),
      onDidChange: (listener: (snapshot: SettingsSnapshot) => void) => {
        listeners.add(listener);
        return toDisposable(() => {
          listeners.delete(listener);
        });
      },
    },
    exporters: {
      register: (exporter: PluginExporter) => deps.registerExporter(exporter, manifest.id),
    },
    imageUploader: {
      register: (uploader: PluginImageUploader) =>
        deps.registerImageUploader(uploader, manifest.id),
    },
    agent: deps.createAgentCapability(manifest.id),
    theme: deps.createThemeApi(manifest.id),
    dialogs: deps.createDialogsApi(manifest.id),
    i18n: {
      // 命名空间由 getFixedT 绑定，插件无法用 vars.ns 越界
      t: (key: string, vars?: Record<string, unknown>) =>
        i18n.getFixedT(null, 'plugins')(`${manifest.id}.${key}`, vars),
      addMessages: (locales: Record<string, Record<string, unknown>>, defaultLocale?: string) =>
        deps.addMessages(locales, defaultLocale, manifest.id),
      // i18next 初始化前 `language` 为空串；插件不该看到空语言码
      language: () => i18n.language || 'en',
    },
    toast: {
      info: (message: string) => {
        toast.info(message);
      },
      success: (message: string) => {
        toast.success(message);
      },
      error: (message: string) => {
        toast.error(message);
      },
    },
    log,
    dispose,
  };

  pluginApps.set(manifest.id, app);
  pluginRegistries.set(manifest.id, registry);
  return app;
}
