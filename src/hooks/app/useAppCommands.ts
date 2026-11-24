import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';
import { readAppConfig, writeAppConfig } from '@/utils/appConfig';
import { isMobilePlatform } from '@/utils/platform';
import { createNewWindow, createSettingsWindow } from '@/utils/windowManager';
import { setAppearance, setColorTheme } from '@/components/styles';
import { SHORTCUT_IDS, EDITOR_MODE_KEY, LOCK_KEY, isFreeVersion } from '@/app/constants';
import { syncExportMenu } from '@/app/menu/exportMenu';
import { resolveFileEditor, listCommandsWithOwner, isDisabledFileExtension } from '@/plugins/registry';
import { editorInsertCommands } from '@/components/TextoEditor/src/extension/registry';
import type { PluginHost } from '@/plugins/types';
import { listenShortcutsConfigChanges, type ShortcutsConfig, resolveBestShortcut } from '@/utils/shortcuts';
import { findExporterByMenuAction } from '@/utils/export/registry';
import type { useSidebar } from '@/hooks/useSidebar';
import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';
import type { useDocumentState } from './core/useDocumentState';
import type { useDocumentSession } from './core/useDocumentSession';
import type { useExportActions } from './useExportActions';
import type { useAppConfig } from './useAppConfig';
import { resolveUndoRoute } from './core/undoRoute';

type DocumentState = ReturnType<typeof useDocumentState>;
type DocumentSession = ReturnType<typeof useDocumentSession>;
type ExportActions = ReturnType<typeof useExportActions>;
type AppConfig = ReturnType<typeof useAppConfig>;

interface UseAppCommandsParams {
  doc: DocumentState;
  config: AppConfig;
  session: DocumentSession;
  exportActions: ExportActions;
  sidebar: ReturnType<typeof useSidebar>;
  editorRef: RefObject<TextoEditorRef | null>;
  clearRecentItems: () => void;
  removeRecentItem: (item: string) => void;
  setCommandOpen: Dispatch<SetStateAction<boolean>>;
  /** 按插件 id 取得绑定该插件的 host（命令回调用） */
  hostFor: (pluginId: string) => PluginHost;
}

/**
 * 命令分发：键盘快捷键、原生菜单事件、视图菜单同步，以及打开最近项/打开文件等
 * 应用级事件监听；同时持有顶栏的编辑模式、锁定与 HUD 状态。
 */
export function useAppCommands({
  doc,
  config,
  session,
  exportActions,
  sidebar,
  editorRef,
  clearRecentItems,
  removeRecentItem,
  setCommandOpen,
  hostFor,
}: UseAppCommandsParams) {
  const { t } = useTranslation();
  const { currentFile, fileHandle, isModified } = doc;
  const {
    editorMode,
    setEditorMode,
    isLocked,
    setIsLocked,
    isLockedRef,
    showEditorToolbar,
    setShowEditorToolbar,
    setAppearanceState,
    configRef,
    syncGlobalEditorConfigFromStore,
  } = config;
  const {
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleOpenInFinder,
    executeOpenFile,
  } = session;
  const { handleExportPdf, handleExport, handleExportPng, handlePrint } = exportActions;

  const toolbarWasVisibleRef = useRef(false);

  // 切换编辑器模式
  const toggleEditorMode = useCallback(() => {
    setEditorMode(prev => {
      const next = prev === 'ir' ? 'sv' : 'ir';
      localStorage.setItem(EDITOR_MODE_KEY, next);
      return next;
    });
  }, []);

  const toggleLock = useCallback(() => {
    const next = !isLockedRef.current;
    setIsLocked(prev => {
      const next = !prev;
      localStorage.setItem(LOCK_KEY, JSON.stringify(next));
      return next;
    });

    if (next) {
      toolbarWasVisibleRef.current = showEditorToolbar;
      if (showEditorToolbar) {
        setShowEditorToolbar(false);
      }
    } else if (toolbarWasVisibleRef.current) {
      setShowEditorToolbar(true);
    }
  }, [showEditorToolbar]);

  // 监听快捷键配置变化
  useEffect(() => {
    const unlisten = listenShortcutsConfigChanges((config: ShortcutsConfig) => {
      logger.log('Shortcuts config changed:', config);
    });
    return () => {
      unlisten();
    };
  }, []);

  // 切换打字机模式（全局 AppConfig）。桌面端快捷键由原生菜单在 Rust 端翻转并广播
  // config-changed；这里兜底处理直接到达 DOM 的快捷键（如网页预览），
  // 非 Tauri 环境退回编辑器本地切换。
  const toggleTypewriterPreference = useCallback(async () => {
    try {
      const config = await readAppConfig<any>();
      const next = !config.typewriter_enabled;
      await writeAppConfig({ ...config, typewriter_enabled: next });
    } catch {
      // 非 Tauri 环境（网页演示）：退回编辑器本地切换
      editorRef.current?.toggleTypewriterMode();
    }
  }, []);

  // 撤销/重做按焦点路由：编辑器（统一历史）优先，普通输入框走原生命令。
  const handleUndo = useCallback(() => {
    const active = document.activeElement;
    const route = resolveUndoRoute(active, editorRef.current?.isFocused() ?? false);
    if (route === 'editor' && editorRef.current) {
      try {
        editorRef.current.undo();
      } catch (err) {
        // 菜单/快捷键监听在原生事件里，异常不能逃逸出去打断后续命令。
        console.error('[app] undo failed', err);
      }
      return;
    }
    document.execCommand('undo');
  }, [editorRef]);

  const handleRedo = useCallback(() => {
    const active = document.activeElement;
    const route = resolveUndoRoute(active, editorRef.current?.isFocused() ?? false);
    if (route === 'editor' && editorRef.current) {
      try {
        editorRef.current.redo();
      } catch (err) {
        console.error('[app] redo failed', err);
      }
      return;
    }
    document.execCommand('redo');
  }, [editorRef]);

  // 共享的 action 分发函数，同时用于菜单事件和键盘快捷键
  const handleWindowAction = useCallback((action: string) => {
    // 插件命令优先：原生菜单/快捷键 action 经 menuAction 映射到插件命令（后注册者优先）。
    // 用带 owner 的列表，把 host 绑定到命令所属插件。
    const pluginCommands = listCommandsWithOwner();
    for (let i = pluginCommands.length - 1; i >= 0; i -= 1) {
      const { pluginId, command } = pluginCommands[i]!;
      if (command.menuAction !== action) continue;
      void Promise.resolve(command.run(hostFor(pluginId))).catch((err) => {
        console.error(`[plugins] command failed: ${command.id}`, err);
      });
      return;
    }
    // 导出器声明的原生菜单位（如 export_html/export_epub）按 menuAction 分派
    const exporter = findExporterByMenuAction(action);
    if (exporter) {
      handleExport(exporter.id);
      return;
    }
    switch (action) {
      case 'new_window':
        createNewWindow().catch(err => console.error('Failed to create new window:', err));
        break;
      case 'open_file':
        handleOpenFile();
        break;
      case 'open_folder':
        handleOpenFolder();
        break;
      case 'save_file':
        handleSave();
        break;
      case 'toggle_sidebar':
        sidebar.toggleCollapsed();
        break;
      case 'toggle_edit_mode':
        toggleEditorMode();
        break;
      case 'open_file_location':
        if (currentFile) handleOpenInFinder(currentFile);
        break;
      case 'minimize':
        logger.log('Minimize window');
        getCurrentWindow().minimize().catch(err => console.error('Minimize failed:', err));
        break;
      case 'zoom':
        logger.log('Zoom window');
        getCurrentWindow().toggleMaximize().catch(err => console.error('Zoom failed:', err));
        break;
      case 'fullscreen':
        logger.log('Toggle fullscreen');
        getCurrentWindow().isFullscreen().then(fs => getCurrentWindow().setFullscreen(!fs)).catch(err => console.error('Fullscreen failed:', err));
        break;
      case 'center':
        logger.log('Center window');
        getCurrentWindow().center().catch(err => console.error('Center failed:', err));
        break;
      case 'export_pdf':
        handleExportPdf();
        break;
      case 'export_png':
        handleExportPng();
        break;
      case 'print_document':
        handlePrint();
        break;
      case 'undo':
        handleUndo();
        break;
      case 'redo':
        handleRedo();
        break;
      case 'heading_1': editorRef.current?.toggleHeading(1); break;
      case 'heading_2': editorRef.current?.toggleHeading(2); break;
      case 'heading_3': editorRef.current?.toggleHeading(3); break;
      case 'heading_4': editorRef.current?.toggleHeading(4); break;
      case 'heading_5': editorRef.current?.toggleHeading(5); break;
      case 'heading_6': editorRef.current?.toggleHeading(6); break;
      case 'bullet_list': editorRef.current?.toggleBulletList(); break;
      case 'ordered_list': editorRef.current?.toggleOrderedList(); break;
      case 'task_list': editorRef.current?.toggleTaskList(); break;
      case 'code_block': editorRef.current?.insertCodeBlock(); break;
      case 'blockquote': editorRef.current?.insertBlockquote(); break;
      case 'horizontal_rule': editorRef.current?.insertHorizontalRule(); break;
      case 'image': editorRef.current?.insertImage(); break;
      default:
        // 通用回退：插件贡献的插入命令（id 与快捷键 / 原生菜单 action 一致）。
        // 放在 default 内，避免与内置 case 命中时双分发（runEditorInsert 非幂等）。
        if (editorInsertCommands().some((c) => c.id === action)) {
          editorRef.current?.runEditorInsert(action);
        }
        break;
    }
  }, [handleOpenFile, handleOpenFolder, handleSave, sidebar.toggleCollapsed, toggleEditorMode, handleOpenInFinder, currentFile, fileHandle, isModified, isFreeVersion, t, handleExportPdf, handleExport, handleExportPng, clearRecentItems, hostFor, handleUndo, handleRedo]);

  // 菜单监听器代次：仅最新注册的实例处理事件（见下方订阅处说明）
  const menuListenerGenerationRef = useRef(0);

  // 菜单/快捷键共用的分发函数始终通过 ref 取最新实现：菜单监听器只注册一次，
  // 必须能在不重新订阅的前提下读到当前 state（currentFile 等）。
  const handleWindowActionRef = useRef(handleWindowAction);
  handleWindowActionRef.current = handleWindowAction;

  // 菜单事件监听器只注册一次。
  //
  // listen() 返回的注销函数是异步生效的，若把订阅挂在会频繁变化的依赖上反复重建，
  // 旧监听器会短暂（甚至长期）残留，同一个菜单事件就会被投递给多个实例：
  // 注册最早的那个实例先用旧 state 处理，导出 PDF 时保存面板默认名会退化成
  // 上一个文件名（曾出现 Untitled.pdf / README.pdf），并可能重复触发导出。
  // 因此这里只订阅一次，并用 generation 兜底忽略卸载滞后的旧实例。
  useEffect(() => {
    const generation = ++menuListenerGenerationRef.current;
    const unlisten = listen('menu-event', (event) => {
      if (generation !== menuListenerGenerationRef.current) return;
      const action = event.payload as string;
      logger.log('Menu event received:', action, 'Window focused:', document.hasFocus());

      // 窗口菜单事件和设置相关事件不需要检查焦点，因为它们总是作用于当前窗口
      const windowActions = ['minimize', 'zoom', 'fullscreen', 'center', 'open_settings', 'open_onboarding', 'acknowledgments', 'privacy', 'clear_recent', 'appearance_light', 'appearance_dark', 'appearance_system', 'theme_default', 'theme_pastel', 'theme_spring', 'theme_settings'];
      const isWindowAction = windowActions.includes(action);

      // 用户导入的主题事件：始终处理，不受焦点限制
      if (action.startsWith('theme_user_')) {
        const themeId = action.replace('theme_user_', '');
        configRef.current.colorTheme = themeId;
        setColorTheme(themeId).then(() => {
          invoke('sync_theme_menu', { theme: themeId });
          void readAppConfig<Record<string, unknown>>().then((config) =>
            writeAppConfig({ ...config, color_theme: themeId }),
          );
        });
        return;
      }

      // 只处理当前聚焦的窗口的事件（窗口菜单和设置相关事件除外）
      if (!isWindowAction && !document.hasFocus()) {
        logger.log('Window is not focused, ignoring menu event');
        return;
      }

      // 菜单特有操作（键盘快捷键无对应）
      switch (action) {
        case 'clear_recent':
          clearRecentItems();
          return;
        case 'open_settings':
          createSettingsWindow();
          return;
        case 'open_onboarding':
          if (!isMobilePlatform()) {
            invoke('create_onboarding_window').catch((error) => {
              console.error('Failed to open onboarding window:', error);
            });
          }
          return;
        case 'acknowledgments':
          if (!isMobilePlatform()) {
            invoke('create_acknowledgments_window').catch((error) => {
              console.error('Failed to open acknowledgments window:', error);
            });
          }
          return;
        case 'privacy':
          if (!isMobilePlatform()) {
            invoke('create_privacy_window').catch((error) => {
              console.error('Failed to open privacy window:', error);
            });
          }
          break;
        // 外观菜单
        case 'appearance_light':
          setAppearance('light');
          setAppearanceState('light');
          invoke('sync_appearance_menu', { appearance: 'light' });
          void readAppConfig<Record<string, unknown>>().then((config) =>
            writeAppConfig({ ...config, appearance: 'light' }),
          );
          return;
        case 'appearance_dark':
          setAppearance('dark');
          setAppearanceState('dark');
          invoke('sync_appearance_menu', { appearance: 'dark' });
          void readAppConfig<Record<string, unknown>>().then((config) =>
            writeAppConfig({ ...config, appearance: 'dark' }),
          );
          return;
        case 'appearance_system':
          setAppearance('system');
          setAppearanceState('system');
          invoke('sync_appearance_menu', { appearance: 'system' });
          void readAppConfig<Record<string, unknown>>().then((config) =>
            writeAppConfig({ ...config, appearance: 'system' }),
          );
          return;
        case 'theme_default':
          setColorTheme('default');
          invoke('sync_theme_menu', { theme: 'default' });
          void readAppConfig<Record<string, unknown>>().then((config) =>
            writeAppConfig({ ...config, color_theme: 'default' }),
          );
          return;
        case 'theme_pastel':
          setColorTheme('pastel');
          invoke('sync_theme_menu', { theme: 'pastel' });
          void readAppConfig<Record<string, unknown>>().then((config) =>
            writeAppConfig({ ...config, color_theme: 'pastel' }),
          );
          return;
        case 'theme_spring':
          setColorTheme('spring');
          invoke('sync_theme_menu', { theme: 'spring' });
          void readAppConfig<Record<string, unknown>>().then((config) =>
            writeAppConfig({ ...config, color_theme: 'spring' }),
          );
          return;
        case 'theme_settings':
          createSettingsWindow();
          setTimeout(async () => {
            const { emit } = await import('@tauri-apps/api/event');
            await emit('switch-settings-category', 'themes');
          }, 500);
          return;
      }

      // 共享操作（段落/文件/窗口菜单等）统一交给 handleWindowAction 处理一次，
      // 避免与上面的 switch 重复分发（曾导致导出 PDF 被触发两次、编辑器变黑）
      handleWindowActionRef.current(action);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // 当 currentFile 或 fileHandle.kind === 'temp' 变化时，更新菜单项的启用状态
  const exportMenuSyncRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    const fileEnabled = fileHandle.kind === 'persistent';
    const exportable = resolveFileEditor(currentFile)?.capabilities?.exportable !== false;
    const exportEnabled = fileHandle.kind === 'persistent' && editorMode === 'ir' && exportable;
    logger.log('Updating menu enabled states:', fileEnabled, 'hasFile:', !!currentFile, 'fileHandle:', fileHandle);
    void (async () => {
      // 按插件声明重建导出子菜单：memoize 同一个 Promise，且每次运行都 await 它，
      // 使各次回调按注册顺序在 Promise 落定后执行、最后注册者最后落定取最新值；
      // 若只首次 await、其余立即发 invoke，首轮 sync 的旧 enabled 可能覆盖新一轮。
      if (!exportMenuSyncRef.current) {
        exportMenuSyncRef.current = syncExportMenu().catch((err) => {
          console.error('[plugins] syncExportMenu failed:', err);
          // 允许下次依赖变化时重试
          exportMenuSyncRef.current = null;
        });
      }
      await exportMenuSyncRef.current;
      invoke('update_open_file_location_menu', { enabled: fileEnabled }).catch(err => {
        console.error('Failed to update open_file_location menu state:', err);
      });
      invoke('update_export_menu', { enabled: exportEnabled }).catch(err => {
        console.error('Failed to update export menu state:', err);
      });
    })();
  }, [fileHandle, editorMode, currentFile]);

  // 当编辑器模式或锁定状态变化时，更新段落菜单项的启用状态
  useEffect(() => {
    const enabled = editorMode === 'ir' && !isLocked;
    invoke('update_paragraph_menu', { enabled }).catch(err => {
      console.error('Failed to update paragraph menu state:', err);
    });
  }, [editorMode, isLocked]);

  // 同步视图菜单的窗口级勾选状态（侧边栏/编辑模式）。
  // 打字机与工具栏开关是全局配置，勾选由后端在写配置时校准，不在这里回推，
  // 否则某个窗口的本地旧 state 会把菜单勾选覆盖回旧值。
  const syncViewMenu = useCallback(() => {
    invoke('sync_view_menu', {
      sidebarVisible: !sidebar.collapsed,
      editMode: editorMode === 'ir',
    }).catch(err => {
      console.error('Failed to sync view menu state:', err);
    });
  }, [sidebar.collapsed, editorMode]);


  // 初始化及侧边栏/编辑模式/打字机状态变化时同步视图菜单
  useEffect(() => {
    syncViewMenu();
  }, [syncViewMenu]);

  // 窗口获得焦点时重新同步视图菜单（各窗口的侧边栏/模式状态可能不同）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          syncViewMenu();
          syncGlobalEditorConfigFromStore();
        }
      })
      .then(fn => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [syncViewMenu, syncGlobalEditorConfigFromStore]);

  // 大纲可见性由 outlineStyle + currentFile 派生（见 outlineVisible），
  // 无文档时面板不渲染，无需再单独收起。


  // 监听打开文件事件（从"文件"App 用本应用打开，iOS/iPadOS）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await listen<string | { path: string; target?: string }>(
          'open-file',
          async (event) => {
          const payload = event.payload;
          const filePath = typeof payload === 'string' ? payload : payload?.path;
          // MCP 定向打开：事件会被所有窗口收到，只处理发给本窗口的。
          if (typeof payload === 'object' && payload?.target && payload.target !== getCurrentWindow().label) {
            return;
          }
          if (!filePath || cancelled) return;
          logger.log('[App] Open file from OS:', filePath);
          try {
            const pathType = await invoke<string>('check_path_type', { path: filePath });
            const isDirectory = pathType === 'directory';
            await executeOpenFile(filePath, isDirectory);
          } catch (error) {
            console.error('[App] Failed to open file from OS:', error);
            toast.error(t('error.openFailed', { error: String(error) }));
          }
          },
        );
      } catch (error) {
        console.error('[App] Failed to listen open-file:', error);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [executeOpenFile]);

  // 监听在新窗口中打开最近项目事件
  useEffect(() => {
    const unlisten = listen('open-recent-new-window', async (event) => {
      const item = event.payload as string;
      logger.log('Open recent item in new window:', item, 'Window focused:', document.hasFocus());

      // 只处理当前聚焦的窗口的事件
      if (!document.hasFocus()) {
        logger.log('Window is not focused, ignoring event');
        return;
      }

      if (!item) return;

      // 检查路径是否存在
      const type = await invoke<string>('check_path_type', { path: item }).catch(() => null);
      if (!type) {
        logger.log('Path does not exist or cannot be accessed:', item);
        // 从最近记录中移除不存在的路径
        removeRecentItem(item);
        // 提示用户
        const isDirectory = !item.match(/\.[a-zA-Z0-9]+$/);
        toast.error(isDirectory ? t('message.recentFolderNotFound') : t('message.recentFileNotFound'));
        return;
      }

      // 所属插件被禁用时，该文件类型视为不可打开
      if (type === 'file' && isDisabledFileExtension(item)) {
        toast.info(t('settings.pluginFileDisabled'));
        return;
      }

      const hasBookmark = await invoke<boolean>('has_bookmark', { path: item });

      if (hasBookmark) {
        const accessStarted = await invoke('start_access', { path: item })
          .then(() => true)
          .catch(err => {
            console.warn('Failed to resolve bookmark access:', err);
            return false;
          });

        if (accessStarted) {
          createNewWindow(item).catch(err => {
            console.error('Failed to create new window with file:', err);
          });
          return;
        }
      }

      // 无书签或书签失效：通过系统文件选择器打开，确保沙盒权限正确授予
      const selected = await open({
        multiple: false,
        defaultPath: item,
        title: t('dialog.selectFile'),
      });
      if (selected && typeof selected === 'string') {
        if (isDisabledFileExtension(selected)) {
          toast.info(t('settings.pluginFileDisabled'));
          return;
        }
        createNewWindow(selected).catch(err => {
          console.error('Failed to create new window with file:', err);
        });
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [t, removeRecentItem]);

  // 监听键盘快捷键（使用配置化的快捷键）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isSaveShortcut =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's';
      // 文件类型编辑器（customSave，如白板）在编辑内容时会自己吞掉 Cmd+S：
      // 例如白板编辑器在编辑文字元素时，其内部 onkeydown 会对 Cmd+S 调用
      // preventDefault（并把事件交给被禁用的内部保存动作），导致这里因
      // `defaultPrevented` 提前返回、快捷键失效。此时仍需放行，交给 handleSave →
      // 编辑器自身的保存流程。Markdown 等非 customSave 文件不受影响。
      const customSaveActive =
        resolveFileEditor(currentFile)?.capabilities?.customSave === true;
      if (e.isComposing) return;
      if (e.defaultPrevented && !(isSaveShortcut && customSaveActive)) return;

      // Command Palette (Cmd+P) — 硬编码，不属于可配置快捷键。
      // 必须排除 Shift：Cmd+Shift+P 是打印（print_document）的默认快捷键，
      // 若不排除会被这里拦截，永远走不到下面的快捷键分派。
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }

      // 用前缀匹配（最长优先）解析快捷键，最具体的胜出
      const actionId = resolveBestShortcut(e, SHORTCUT_IDS);
      if (!actionId) return;

      e.preventDefault();
      switch (actionId) {
        case 'toggle_sidebar':
          sidebar.toggleCollapsed();
          break;
        case 'toggle_edit_mode':
          toggleEditorMode();
          break;
        case 'toggle_typewriter_mode':
          toggleTypewriterPreference();
          break;
        case 'new_window':
          createNewWindow().catch(err => console.error('Failed to create new window:', err));
          break;
        case 'open_file':
          handleOpenFile();
          break;
        case 'export_pdf':
          if (resolveFileEditor(currentFile)?.capabilities?.exportable === false) break;
          handleExportPdf();
          break;
        case 'print_document':
          if (resolveFileEditor(currentFile)?.capabilities?.exportable === false) break;
          handlePrint();
          break;
        case 'save_file':
          handleSave();
          break;
        case 'open_folder':
          handleOpenFolder();
          break;
        case 'open_file_location':
          if (currentFile) handleOpenInFinder(currentFile);
          break;
        case 'minimize':
          getCurrentWindow().minimize().catch(() => {});
          break;
        case 'fullscreen':
          getCurrentWindow().isFullscreen().then(fs => getCurrentWindow().setFullscreen(!fs)).catch(() => {});
          break;
        case 'center':
          getCurrentWindow().center().catch(() => {});
          break;
        case 'heading_1':
          editorRef.current?.toggleHeading(1);
          break;
        case 'heading_2':
          editorRef.current?.toggleHeading(2);
          break;
        case 'heading_3':
          editorRef.current?.toggleHeading(3);
          break;
        case 'heading_4':
          editorRef.current?.toggleHeading(4);
          break;
        case 'heading_5':
          editorRef.current?.toggleHeading(5);
          break;
        case 'heading_6':
          editorRef.current?.toggleHeading(6);
          break;
        case 'bullet_list':
          editorRef.current?.toggleBulletList();
          break;
        case 'ordered_list':
          editorRef.current?.toggleOrderedList();
          break;
        case 'task_list':
          editorRef.current?.toggleTaskList();
          break;
        case 'code_block':
          editorRef.current?.insertCodeBlock();
          break;
        case 'blockquote':
          editorRef.current?.insertBlockquote();
          break;
        case 'horizontal_rule':
          editorRef.current?.insertHorizontalRule();
          break;
        case 'image':
          editorRef.current?.insertImage();
          break;
        default:
          // 通用回退：插件贡献的插入命令（resolveBestShortcut 命中的 action id）。
          // 放在 default 内，避免与内置 case 命中时双分发（runEditorInsert 非幂等）。
          if (editorInsertCommands().some((c) => c.id === actionId)) {
            editorRef.current?.runEditorInsert(actionId);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebar.toggleCollapsed, toggleEditorMode, handleOpenFile, handleSave, handleOpenFolder, currentFile, handleOpenInFinder, fileHandle.kind === 'temp', handleExportPdf, handleExport, handlePrint, toggleTypewriterPreference]);
  return { handleWindowAction, toggleEditorMode, toggleLock, toggleTypewriterPreference };
}
