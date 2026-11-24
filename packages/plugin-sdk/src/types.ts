import type { ComponentType, MutableRefObject } from 'react';

import type { AgentAnchorRect, AgentCapability } from '@textox/plugin-sdk';

import type { PluginCategory } from './meta';
import type { IconSpec } from './icon';

/**
 * Agent 能力面：定义在作者包 `@textox/plugin-sdk`（外部插件只依赖它），
 * 宿主侧只做转出，避免两份类型漂移。
 */
export type {
  AgentAnchorRect,
  AgentCapability,
  AgentEvent,
  AgentHandlers,
  AgentMessageInput,
  AgentPresentOptions,
  AgentPresentSize,
  AgentProfileInfo,
  AgentRequest,
  AgentRunHandle,
  AgentRunOptions,
  AgentToolInfo,
  AgentToolResult,
} from '@textox/plugin-sdk';

/** 插件命名空间下的嵌套 messages（i18next resource 形状）。 */
export type PluginLocale = { [key: string]: string | PluginLocale };

export type Edition = 'full' | 'lite';
export type Appearance = 'light' | 'dark' | 'system';

/** 插件对外暴露的一个扩展点声明。 */
export interface ExtensionPointSpec {
  /** 形如 `<ownerId>:<pointName>`，命名空间即所有者插件 id */
  id: string;
  labelKey?: string;
  descriptionKey?: string;
}

/**
 * 扩展点 id → 贡献类型 的映射表。
 * 该接口由各扩展点所有者通过 TypeScript 声明合并增补；
 * `@texto/plugin-sdk` 自身不预置任何点。
 */
export interface ExtensionPointMap {
  // 由扩展点所有者通过 `declare module '@texto/plugin-sdk'` 增补
}

/** 插件清单里的贡献：按扩展点 id 分组。 */
export type Contributes = {
  [K in keyof ExtensionPointMap]?: ExtensionPointMap[K][];
};

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** 编辑器选区上下文快照（只读展示用，不含编辑器内部对象）。 */
export interface SelectionContextSnapshot {
  /** 选中文字（超长会截断）。 */
  selection: string;
  /** 选区起始处所在段落（非 textblock 时为空串）。 */
  paragraph: string;
  /** 选区起始处之前的标题祖先链（由外到内）。 */
  headings: string[];
  /** 选区在视口中的矩形；取不到时为 null。 */
  anchor: AgentAnchorRect | null;
}

/** 宿主暴露给插件的稳定能力集合。 */
export interface PluginHost {
  edition: Edition;
  documents: {
    openFile(path: string): Promise<void>;
    getCurrentFile(): string | null;
    getDocumentDir(): string | null;
    /** 计算绝对路径相对当前文档的写入路径（`![](...)` 的 src）；无文档目录时返回绝对路径 */
    toDocumentRelative(absPath: string): string;
    /** 以给定内容新建一个临时（未保存）文档并打开；extension 决定编辑器类型（默认 md） */
    createNewDocument(opts: { content: string; extension?: string }): Promise<void>;
  };
  editor: {
    /** 在当前可编辑的 IR 编辑器光标处插入 `![alt](src)`（空段落时提交为块）；不可编辑时 no-op */
    insertImageRef(src: string, alt: string): void;
    /** 当前编辑器是否可编辑 */
    canEdit(): boolean;
    /** 读取当前选区 / 段落 / 标题链 / 锚点；仅 IR 模式，SV 或空选区返回 null */
    getSelectionContext(): SelectionContextSnapshot | null;
  };
  config: {
    get<T>(key: string): Promise<T | undefined>;
    /**
     * 写入本插件的某个配置项。实现为「读取-合并-写回」，**非原子**：
     * 跨窗口/并发写入可能丢失更新（当前无并发写场景）。
     */
    set(key: string, value: unknown): Promise<void>;
    getAll<T = Record<string, unknown>>(): Promise<T>;
    /**
     * 订阅本插件「有效配置」的实时变更。仅在清单声明
     * `settingsApply: 'immediate'` 时宿主才会触发（`'restart'` 不通知）；
     * 回调收到含字段默认值的有效配置。返回取消订阅函数。
     */
    subscribe(listener: (config: Record<string, unknown>) => void): () => void;
  };
  i18n: {
    t(key: string, opts?: Record<string, unknown>): string;
    language(): string;
  };
  theme: {
    appearance(): Appearance;
    subscribe(cb: () => void): () => void;
    /** 应用代码块高亮主题（亮/暗各一 id）；按当前 `.dark` 选。 */
    applyCodeHighlightTheme(light: string, dark: string): void;
    /** 仅迁移用：当前配色主题历史 --code-editor-theme-* 自定义值。 */
    codeHighlightThemeDefaults(): Promise<{ light?: string; dark?: string }>;
  };
  events: {
    on(name: string, cb: (detail?: unknown) => void): () => void;
    emit(name: string, detail?: unknown): void;
  };
  toast: {
    info(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
  };
  dialogs: {
    pickFile(opts: { filters: FileFilter[]; defaultPath?: string }): Promise<string | null>;
    confirm(opts: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }): Promise<boolean>;
  };
  window: {
    isMain(): boolean;
  };
  agent: AgentCapability;
  log: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface FileEditorProps {
  filePath: string | null;
  isTemp: boolean;
  editable: boolean;
  onModifiedChange(modified: boolean): void;
  onPathChange(path: string): void;
  host: PluginHost;
  /** 插件把通用编辑器句柄写入此 ref，供骨架的保存/关闭/外部修改流程调用 */
  handleRef: MutableRefObject<FileEditorHandle | null>;
}

/** 骨架持有的通用编辑器句柄，取代按功能硬编码的 ref。 */
export interface FileEditorHandle {
  save(): Promise<{ ok: boolean; path?: string }>;
  handleExternalModify?(): void;
}

export interface FileEditorContribution {
  id: string;
  extensions: string[];
  /** 目录树"新建"菜单描述；有值时为该类型暴露一条"新建 <label>"项 */
  newFile?: {
    labelKey: string;
    /** 默认文件名（含扩展名）的 i18n key，由骨架翻译后作为唯一名 base */
    defaultFileNameKey: string;
  };
  createEmptyContent?(path: string): string | Promise<string>;
  load(): Promise<{ default: ComponentType<FileEditorProps> }>;
  preload?(ctx: { isSingleFileMode: boolean; currentFile: string | null }): void;
  capabilities?: {
    customSave?: boolean;
    externalModify?: boolean;
    exportable?: boolean;
  };
}

export interface ExporterContribution {
  id: string;
  labelKey: string;
  extension: string;
  kind: 'text' | 'binary';
  /** 该导出器占用的原生菜单项 id（如 'export_html'）。有值 → 参与原生菜单声明同步。 */
  menuAction?: string;
  /** UI 排序权重（升序）；缺省 0。用于让导出菜单/工具栏顺序不依赖插件注册顺序。 */
  order?: number;
  run(ctx: { currentFile: string | null; documentDir: string | null }): Promise<{
    data: string | Uint8Array;
    suggestedName: string;
  }>;
}

export type CommandCategory = 'file' | 'view' | 'insert' | 'export' | 'plugin';

export interface CommandContribution {
  id: string;
  titleKey: string;
  category: CommandCategory;
  menuAction?: string;
  run(host: PluginHost): void | Promise<void>;
  enabled?(): boolean;
}

/**
 * 升级迁移声明：骨架按声明通用处理，插件侧保留自己的历史细节。
 * 刻意保持窄（非通用迁移框架），当前仅服务「内置图片存储模式转插件」。
 */
export interface PluginMigration {
  /** 旧 AppConfig.image_storage_mode 等于此值时，自动启用本插件 */
  enableWhenImageStorageMode?: string;
  /**
   * 插件配置键 → 旧 AppConfig 键；仅当插件配置未设置该键时复制。
   * 例：`{ server_url: 'picgo_server_url' }`（方向不可写反）。
   */
  appConfigKeys?: Record<string, string>;
}

/** 插件默认导出的清单。 */
export interface TextoPlugin {
  id: string;
  displayNameKey?: string;
  /** 设置页描述文案的 i18n key（插件自带 key，骨架只引用） */
  descriptionKey?: string;
  /** 插件自带的多语言资源：语言代码 → 本插件命名空间下的嵌套 messages。 */
  locales?: Record<string, PluginLocale>;
  /** 回退基准语言（缺失语言用它补齐）。缺省取 `locales` 的第一个键。 */
  defaultLocale?: string;
  version: string;
  /** 作者；官方插件使用 OFFICIAL_AUTHOR，其余视为第三方。 */
  author?: string;
  /**
   * 卡片分类；相同分类归为一组，按 PLUGIN_CATEGORIES 顺序展示。
   * 内置分类有本地化标题；其余自定义字符串按原文分组并排在内置分类之后。
   */
  category?: PluginCategory | (string & {});
  /**
   * 卡片图标：lucide 图标名（kebab-case，如 `'sparkles'`），或手绘 `IconDef`
   * 图元数组（24×24 viewBox）。骨架统一渲染；裸 SVG path 字符串是遗留写法，
   * 仍可用但 DEV 下会告警（请迁移）。
   */
  icon?: IconSpec;
  /** 是否默认启用；缺省为 true */
  defaultEnabled?: boolean;
  /** 升级迁移声明（当前唯一用途：内置图片存储模式转插件） */
  migration?: PluginMigration;
  /** 我对外暴露的扩展点（别人可以往这里贡献） */
  extensionPoints?: ExtensionPointSpec[];
  /** 我向别人声明的扩展点提交的贡献（按扩展点 id 分组） */
  contributes?: Contributes;
  /**
   * 设置变更的生效方式：
   * - `'immediate'`：写入配置即广播并更新实时快照，编辑器扩展立即读到新值；
   * - `'restart'`（缺省）：重启后生效。
   */
  settingsApply?: 'immediate' | 'restart';
  /**
   * 启用插件在应用启动时调用一次（切换插件需重启）。
   * 只放幂等的启动期副作用（如按 config 应用主题）。
   * 启动早于编辑器就绪，`documents`/`editor` 为 no-op，只用 config/theme/events/log/toast。
   */
  activate?(host: PluginHost): void | Promise<void>;
}
