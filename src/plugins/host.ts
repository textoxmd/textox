import { invoke } from '@tauri-apps/api/core';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm as confirmDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { subscribePluginConfig } from '@texto/plugin-sdk';
import type { SelectionContextSnapshot } from '@texto/plugin-sdk';
import { toast } from 'sonner';

import { agentCapability } from '@/agent/capability';
import { isFreeVersion } from '@/app/constants';
import { getCurrentAppearance, getCurrentColorTheme } from '@/components/styles/theme';
import { loadThemeQuickSettings } from '@/components/styles/theme-quick-settings';
import { applyHighlightTheme } from '@/components/TextoEditor/src/highlight-theme';
import { logger } from '@/utils/logger';
import i18n from '@/i18n';

import { writePluginConfig } from './configSync';
import type { PluginHost } from './types';

export interface HostDeps {
  getCurrentFile(): string | null;
  getDocumentDir(): string | null;
  openFile(path: string): Promise<void>;
  /** 绝对路径 → 相对当前文档的写入路径（`![](...)` 的 src） */
  toDocumentRelative(absPath: string): string;
  /** 以给定内容新建临时（未保存）文档并打开；extension 决定编辑器类型 */
  createNewDocument(opts: { content: string; extension?: string }): Promise<void>;
  /** 在当前 IR 编辑器光标处插入 `![alt](src)` */
  insertImageRef(src: string, alt: string): void;
  /** 当前 IR 编辑器是否可编辑 */
  canEdit(): boolean;
  /** 当前选区上下文（选区 / 段落 / 标题链 / 锚点）；无编辑器或空选区时 null */
  getSelectionContext(): SelectionContextSnapshot | null;
}

/**
 * 用真实骨架能力构造宿主服务。普通对象，无需 React Context。
 *
 * `pluginId` 是宿主能力的绑定身份：`config` 读写该插件自己的 store，
 * 插件因此不可能读到别的插件的配置。
 */
export function createPluginHost(deps: HostDeps, pluginId: string): PluginHost {
  const host = {
    edition: isFreeVersion ? 'lite' : 'full',
    documents: {
      openFile: (path) => deps.openFile(path),
      getCurrentFile: () => deps.getCurrentFile(),
      getDocumentDir: () => deps.getDocumentDir(),
      toDocumentRelative: (absPath) => deps.toDocumentRelative(absPath),
      createNewDocument: (opts) => deps.createNewDocument(opts),
    },
    editor: {
      insertImageRef: (src, alt) => deps.insertImageRef(src, alt),
      canEdit: () => deps.canEdit(),
      getSelectionContext: () => deps.getSelectionContext(),
    },
    config: {
      get: async <T,>(key: string) => {
        const cfg = await invoke<Record<string, unknown>>('get_plugin_config', { pluginId });
        return cfg?.[key] as T | undefined;
      },
      set: async (key, value) => {
        const cfg = await invoke<Record<string, unknown>>('get_plugin_config', { pluginId });
        await writePluginConfig(pluginId, { ...cfg, [key]: value });
      },
      getAll: async <T,>() =>
        invoke<Record<string, unknown>>('get_plugin_config', { pluginId }) as Promise<T>,
      subscribe: (listener) => subscribePluginConfig(pluginId, listener),
    },
    i18n: {
      t: (key, opts) => i18n.t(`${pluginId}.${key}`, { ns: 'plugins', ...opts }),
      language: () => i18n.language,
    },
    theme: {
      appearance: () => getCurrentAppearance(),
      subscribe: (cb) => {
        const handler = () => cb();
        window.addEventListener('appearancechange', handler);
        return () => window.removeEventListener('appearancechange', handler);
      },
      applyCodeHighlightTheme: (light, dark) => {
        const isDark = document.documentElement.classList.contains('dark');
        const theme = isDark ? dark : light;
        // 主题 CSS 是按需动态加载的（见 highlight-theme.ts），无需在此等待。
        if (theme) void applyHighlightTheme(theme);
      },
      codeHighlightThemeDefaults: async () => {
        const settings = await loadThemeQuickSettings(getCurrentColorTheme());
        const raw = (settings ?? {}) as Record<string, unknown>;
        return {
          light:
            typeof raw.codeEditorThemeLight === 'string' && raw.codeEditorThemeLight !== ''
              ? raw.codeEditorThemeLight
              : undefined,
          dark:
            typeof raw.codeEditorThemeDark === 'string' && raw.codeEditorThemeDark !== ''
              ? raw.codeEditorThemeDark
              : undefined,
        };
      },
    },
    events: {
      on: (name, cb) => {
        const handler = (event: Event) => cb((event as CustomEvent).detail);
        window.addEventListener(name, handler);
        return () => window.removeEventListener(name, handler);
      },
      emit: (name, detail) => {
        window.dispatchEvent(new CustomEvent(name, { detail }));
        void tauriEmit(name, detail).catch(() => {});
      },
    },
    toast: {
      info: (msg) => toast.info(msg),
      success: (msg) => toast.success(msg),
      error: (msg) => toast.error(msg),
    },
    dialogs: {
      pickFile: async (opts) => {
        const result = await openDialog({
          multiple: false,
          directory: false,
          defaultPath: opts.defaultPath,
          filters: opts.filters,
        });
        return typeof result === 'string' ? result : null;
      },
      confirm: (opts) =>
        confirmDialog(opts.message, {
          title: opts.title,
          okLabel: opts.confirmLabel,
          cancelLabel: opts.cancelLabel,
        }),
    },
    window: {
      isMain: () => {
        try {
          return getCurrentWindow().label === 'main';
        } catch {
          return false;
        }
      },
    },
    log: {
      log: (...args) => logger.log(...args),
      warn: (...args) => logger.warn(...args),
      error: (...args) => logger.error(...args),
    },
  } as Omit<PluginHost, 'agent'>;
  // 工具的 execute 需要宿主本身；插件工具还要拿到「贡献方」的宿主，保证 config/i18n
  // 按插件隔离。hostFor 只在真正调用工具时按 ownerId 构造，缺席时回退调用方宿主。
  const resolveHost = (ownerId: string): PluginHost =>
    ownerId === pluginId ? (host as PluginHost) : createPluginHost(deps, ownerId);
  return Object.assign(host, {
    agent: agentCapability(host as PluginHost, resolveHost),
  });
}

/** documents/editor 为 no-op 的最小宿主 deps；仅需 config/toast/log 的场景（如图片上传器）使用。 */
export const NOOP_HOST_DEPS: HostDeps = Object.freeze({
  getCurrentFile: () => null,
  getDocumentDir: () => null,
  openFile: async () => {},
  toDocumentRelative: (absPath: string) => absPath,
  createNewDocument: async () => {},
  insertImageRef: () => {},
  canEdit: () => false,
  getSelectionContext: () => null,
});

let installedHostDeps: HostDeps | null = null;

/**
 * 由 `App` 在渲染期注入真实宿主能力，供新插件运行时（`src/plugins/runtime`）复用。
 * 旧体系仍通过 `createPluginHost(deps, id)` 按插件绑定，不读这里。
 */
export function installHostDeps(deps: HostDeps): void {
  installedHostDeps = deps;
}

/** 新运行时用：尚未注入时返回 null（调用方回退到占位实现）。 */
export function getInstalledHostDeps(): HostDeps | null {
  return installedHostDeps;
}
