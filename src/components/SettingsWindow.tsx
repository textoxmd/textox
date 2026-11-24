import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { applyCustomTranslation } from '@/i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { logger } from '@/utils/logger';
import { getCopyrightYearLabel } from '@/utils/copyright';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { createNewWindow, IS_WINDOWS, IS_MAC, minimizeWindow, toggleMaximizeWindow, closeWindow, isWindowMaximized, onWindowResized } from '../utils/windowManager';
import { Settings, Palette, Keyboard, Shield, Info, Star, UserPlus, Bookmark, Wand2, FlaskConical, Puzzle, FolderOpen } from 'lucide-react';
import { ModelSettingsIcon } from './icons';
import { showGlassDialog } from '@/components/GlassDialog';



import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FileText } from 'lucide-react';
import {
  isSourcePreserveEnabled,
  setSourcePreserveEnabled,
} from '@/components/TextoEditor/src/source-preserve-config';
import { WorkspaceFolderPicker } from '@/components/WorkspaceFolderPicker';
import { BookmarkManagerSettings } from '@/components/BookmarkManagerSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { PluginManagerPanel } from './settings/plugin-manager';
import { ShortcutsConfig } from '../utils/shortcuts';
import { AiModelSettings } from './settings/AiModelSettings';
import { McpSettings } from './settings/McpSettings';

import {
  setColorTheme,
  setAppearance,
  setFontFamily,
  setEditorFontFamily,
  getCurrentColorTheme,
  getCurrentFontFamily,
  getCurrentEditorFontFamily,
  getCurrentAppearance,
  applyColorTheme,
  applyAppearance,
  initThemeRegistry,
  PRESET_FONTS,
  PRESET_EDITOR_FONTS,
  type Appearance,
  type FontFamily,
  type EditorFontFamily,
} from './styles';
import { ThemeEditor } from '@/components/ThemeEditor';
import { getSystemFonts, type SystemFontInfo } from '@/utils/fontManager';
import { Slider } from '@/components/ui/slider';
import { isAbsoluteImageStoragePath } from '@/utils/imageStoragePath';

type ImageStorageMode = 'app_data' | 'alongside_document' | 'custom_path';
type ImageAggregationMode = 'none' | 'by_document_name' | 'by_date';
type ImageDateFormat = 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD';

interface AppConfig {
  auto_save: boolean;
  sync_editor_bg: boolean;
  language: string;
  custom_lang_hash: string;
  color_theme?: string;
  appearance?: string;
  font_family?: FontFamily;
  editor_font_family?: EditorFontFamily;
  editor_font_size: number;
  source_font_size: number;
  image_storage_mode: ImageStorageMode;
  image_folder_name: string;
  image_custom_path: string | null;
  image_aggregation_mode: ImageAggregationMode;
  image_date_format: ImageDateFormat;
  window_width: number;
  window_height: number;
  watch_external_file_changes: boolean;
  silent_external_file_changes: boolean;
  code_block_word_wrap: boolean;
  show_line_numbers: boolean;
  auto_capitalize: boolean;
  show_word_count: boolean;
  openable_extensions: string[];
  show_editor_toolbar?: boolean;
  show_inline_format_toolbar?: boolean;
  typewriter_enabled?: boolean;
  editor_readable_line_length?: boolean;
  outline_style?: 'off' | 'text' | 'minimap';
  startup_behavior: 'blank' | 'workspace';
  workspace_folder: string | null;
  /** MCP 服务开关（本机回环，供外部 agent 调用） */
  mcp_enabled?: boolean;
  mcp_port?: number;
}

type SettingsCategory = 'general' | 'ai' | 'shortcuts' | 'privacy' | 'about' | 'themes' | 'bookmarks' | 'experimental' | 'plugins';

// 语言名称映射（用于显示当前选中的语言）
const LANGUAGE_NAMES: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
  'es-ES': 'Español',
  'it-IT': 'Italiano',
  'pt-PT': 'Português',
  'ru-RU': 'Русский',
  'ar-SA': 'العربية',
  'hi-IN': 'हिन्दी',
  'vi-VN': 'Tiếng Việt',
  'th-TH': 'ไทย',
};

// 初始配置（用于 React useState 的同步初始值）
// 注意：恢复默认设置时，会通过 get_default_config 命令从 Rust 后端获取真正的默认值
const INITIAL_CONFIG: AppConfig = {
  auto_save: false,
  sync_editor_bg: false,
  language: '',
  custom_lang_hash: '',
  color_theme: 'default',
  appearance: 'system',
  font_family: 'system',
  editor_font_family: 'system',
  editor_font_size: 13,
  source_font_size: 13,
  image_storage_mode: 'alongside_document',
  image_folder_name: 'assets',
  image_custom_path: null,
  image_aggregation_mode: 'none',
  image_date_format: 'YYYY-MM',
  window_width: 1200,
  window_height: 800,
  watch_external_file_changes: true,
  silent_external_file_changes: false,
  code_block_word_wrap: true,
  show_line_numbers: true,
  auto_capitalize: false,
  show_word_count: false,
  openable_extensions: [
    'md', 'markdown', 'txt',
  ],
  show_editor_toolbar: undefined,
  show_inline_format_toolbar: true,
  typewriter_enabled: false,
  editor_readable_line_length: true,
  outline_style: 'off',
  startup_behavior: 'blank',
  workspace_folder: null,
  mcp_enabled: false,
  mcp_port: 38471,
};

const isFreeVersion = import.meta.env.VITE_FREE_VERSION === "true";
const EDITION_TAG = isFreeVersion ? "texto-lite" : "texto"
const PERSIST_KEY = `${EDITION_TAG}:settings-active-category`;
export function SettingsWindow() {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(() => {
    try {
      const stored = localStorage.getItem(PERSIST_KEY);
      const allowed: SettingsCategory[] = ['general', 'ai', 'shortcuts', 'privacy', 'about', 'themes', 'bookmarks', 'experimental', 'plugins'];
      if (stored && allowed.includes(stored as SettingsCategory)) {
        return stored as SettingsCategory;
      }
    } catch { }
    return 'general';
  });
  const hasSetupCloseListenerRef = useRef(false);
  const [currentFontFamily, setCurrentFontFamily] = useState<FontFamily>('system');
  const [currentEditorFontFamily, setCurrentEditorFontFamily] = useState<EditorFontFamily>('system');
  const [systemFonts, setSystemFonts] = useState<SystemFontInfo[]>([]);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [extensionsInputValue, setExtensionsInputValue] = useState('');
  const [isWindows] = useState(IS_WINDOWS);
  const [isMaximized, setIsMaximized] = useState(false);
  const isInitialContentRender = useRef(true);
  const [sourcePreserveEnabled, setSourcePreserveEnabledState] = useState<boolean>(() => {
    try { return isSourcePreserveEnabled(); } catch { return false; }
  });
  const fontsRequestedRef = useRef(false);
  const loadSystemFonts = useCallback(async () => {
    // 系统字体枚举在 Rust 主线程执行，延迟到用户首次打开字体下拉框时再触发，
    // 避免设置窗口首开时阻塞主线程导致卡顿。
    if (fontsRequestedRef.current) return;
    fontsRequestedRef.current = true;
    try {
      const fonts = await getSystemFonts();
      setSystemFonts(fonts);
      setFontsLoaded(true);
    } catch (error) {
      console.error('Failed to load system fonts:', error);
    }
  }, []);

  useEffect(() => {
    if (!isWindows) return;
    isWindowMaximized().then(setIsMaximized);
    const unlisten = onWindowResized(setIsMaximized);
    return () => { unlisten.then(fn => fn()); };
  }, [isWindows]);

  useEffect(() => {
    loadConfig();
    loadAppVersion();

    // 监听切换分类事件
    const unlistenCategory = listen('switch-settings-category', (event) => {
      const category = event.payload as SettingsCategory;
      logger.log('Switching to category:', category);
      setActiveCategory(category);
    });

    // 监听菜单事件
    const unlistenMenu = listen('menu-event', (event) => {
      const action = event.payload as string;
      logger.log('Settings window received menu event:', action);

      // 只处理当前聚焦窗口的事件
      if (!document.hasFocus()) {
        logger.log('Settings window is not focused, ignoring menu event');
        return;
      }

      switch (action) {
        case 'new_window':
          // 创建新窗口
          createNewWindow().catch(err => {
            console.error('Failed to create new window:', err);
          });
          break;
        case 'open_settings':
          // 已经在设置窗口，切换到通用设置
          setActiveCategory('general');
          break;
        default:
          // 其他菜单事件在设置窗口中不处理
          break;
      }
    });

    // 监听全局配置变化（编辑器窗口或原生菜单可能修改工具栏等全局设置）。
    // 设置窗口打开期间也要跟随最新配置，否则后续 handler 用本地旧 config
    // 快照做 { ...config } 写回时会把其他入口的改动覆盖掉。
    const unlistenConfig = listen('config-changed', (event) => {
      setConfig(event.payload as AppConfig);
    });

    // 监听窗口关闭检查事件
    let unlistenClose: (() => void) | null = null;
    if (!hasSetupCloseListenerRef.current) {
      hasSetupCloseListenerRef.current = true;
      const setupCloseListener = async () => {
        const currentWindow = getCurrentWindow();
        unlistenClose = await currentWindow.listen('check-close', async () => {
          logger.log('Settings window received check-close event');
          // 设置窗口直接关闭，不需要保存检查
          // 先注销窗口，再销毁
          await invoke('unregister_window', { window: currentWindow });
          await currentWindow.destroy();
        });
      };
      setupCloseListener();
    }

    return () => {
      unlistenCategory.then(fn => fn());
      unlistenMenu.then(fn => fn());
      unlistenConfig.then(fn => fn());
      if (unlistenClose) {
        unlistenClose();
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await initThemeRegistry();
        // 与编辑器窗口一致的启动时序：主题（含暗色背景）就绪后再显示，
        // 避免暗色模式下窗口先以白色空白态亮相。
        await applyColorTheme(getCurrentColorTheme());
        applyAppearance(getCurrentAppearance());
      } catch (e) {
        console.error('[SettingsWindow] Init failed:', e);
      }
      // 无论主题初始化是否成功都显示窗口，避免窗口一直不可见
      try {
        await getCurrentWindow().show();
      } catch (e) {
        console.error('[SettingsWindow] Failed to show window:', e);
      }
    })();
  }, []);

  const persistedRef = useRef(false);
  useEffect(() => {
    if (!persistedRef.current) {
      persistedRef.current = true;
      return;
    }
    try {
      localStorage.setItem(PERSIST_KEY, activeCategory);
    } catch { }
  }, [activeCategory]);

  useEffect(() => {
    if (configLoaded) {
      isInitialContentRender.current = false;
    }
  }, [configLoaded]);

  const loadConfig = async () => {
    try {
      const loadedConfig = await invoke<AppConfig>('get_config');
      setConfig(loadedConfig);

      // 应用语言设置
      if (loadedConfig.language && loadedConfig.language !== i18n.language) {
        i18n.changeLanguage(loadedConfig.language);
      }

      // 应用主题设置
      const savedColorTheme = loadedConfig.color_theme || 'default';
      const savedAppearance = loadedConfig.appearance || 'system';
      const savedFontFamily = loadedConfig.font_family || getCurrentFontFamily();
      const savedEditorFontFamily = loadedConfig.editor_font_family || getCurrentEditorFontFamily();
      setCurrentFontFamily(savedFontFamily);
      setCurrentEditorFontFamily(savedEditorFontFamily);
      setColorTheme(savedColorTheme);
      setAppearance(savedAppearance as Appearance);
      await setFontFamily(savedFontFamily);
      await setEditorFontFamily(savedEditorFontFamily);

      setConfigLoaded(true);
    } catch (error) {
      console.error('Failed to load config:', error);
      setConfigLoaded(true);
    }
  };

  const loadAppVersion = async () => {
    try {
      const version = await invoke<string>('get_app_version');
      setAppVersion(version);
    } catch (error) {
      console.error('Failed to load app version:', error);
      setAppVersion('0.1.0');
    }
  };

  const handleAutoSaveChange = async (checked: boolean) => {
    if (isFreeVersion) {
      const { showUpgradePrompt } = await import('@/utils/upgradePrompt');
      showUpgradePrompt('upgrade.features.autoSave');
      return;
    }
    try {
      const newConfig = { ...config, auto_save: checked };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const handleAutoCapitalizeChange = async (checked: boolean) => {
    try {
      const newConfig = { ...config, auto_capitalize: checked };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const handleShowWordCountChange = async (checked: boolean) => {
    try {
      const newConfig = { ...config, show_word_count: checked };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const handleShowEditorToolbarChange = async (checked: boolean) => {
    try {
      const newConfig = { ...config, show_editor_toolbar: checked };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const handleShowInlineFormatToolbarChange = async (checked: boolean) => {
    try {
      const newConfig = { ...config, show_inline_format_toolbar: checked };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const handleTypewriterModeChange = async (checked: boolean) => {
    try {
      const newConfig = { ...config, typewriter_enabled: checked === true };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to toggle typewriter mode:', error);
    }
  };

  const handleReadableLineLengthChange = async (checked: boolean) => {
    try {
      const newConfig = { ...config, editor_readable_line_length: checked === true };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to toggle readable line length:', error);
    }
  };

  const handleOutlineStyleChange = async (value: string) => {
    try {
      const newConfig = { ...config, outline_style: value as 'off' | 'text' | 'minimap' };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save outline style setting:', error);
    }
  };

  const handleShortcutsConfigChange = useCallback(async (shortcutsConfig: ShortcutsConfig) => {
    try {
      await invoke('set_shortcuts_config', { config: shortcutsConfig });
    } catch (error) {
      console.error('Failed to save shortcuts config:', error);
    }
  }, []);

  const handleFontFamilyChange = async (fontFamily: FontFamily) => {
    try {
      const newConfig = { ...config, font_family: fontFamily };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
      setCurrentFontFamily(fontFamily);
      await setFontFamily(fontFamily);
      const preset = PRESET_FONTS.find(f => f.id === fontFamily);
      toast.success(`界面字体已切换为: ${preset?.label || fontFamily}`);
    } catch (error) {
      console.error('Failed to save font family:', error);
      toast.error('界面字体切换失败');
    }
  };

  const handleEditorFontFamilyChange = async (fontFamily: EditorFontFamily) => {
    try {
      // 只更新变化的字段，避免触发其他状态变化
      const newConfig = { ...config, editor_font_family: fontFamily };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
      setCurrentEditorFontFamily(fontFamily);
      await setEditorFontFamily(fontFamily);
      const preset = PRESET_EDITOR_FONTS.find(f => f.id === fontFamily);
      toast.success(`编辑器字体已切换为: ${preset?.label || fontFamily}`);
    } catch (error) {
      console.error('Failed to save editor font family:', error);
      toast.error('编辑器字体切换失败');
    }
  };

  const handleResetToDefault = async () => {
    try {
      const defaultConfig = await invoke<AppConfig>('get_default_config');
      await invoke('set_config', { config: defaultConfig });
      setConfig(defaultConfig);
      setCurrentFontFamily(defaultConfig.font_family!);
      setCurrentEditorFontFamily(defaultConfig.editor_font_family!);
      setColorTheme(defaultConfig.color_theme!);
      setAppearance(defaultConfig.appearance! as Appearance);
      await setFontFamily(defaultConfig.font_family!);
      await setEditorFontFamily(defaultConfig.editor_font_family!);
      i18n.changeLanguage(defaultConfig.language);
      toast.success(t('settings.resetSuccess'));
    } catch (error) {
      console.error('Failed to reset config:', error);
      toast.error(t('settings.resetFailed'));
    }
  };

  // ---- 图片自定义绝对目录 ----
  const [customPathDraft, setCustomPathDraft] = useState('');

  useEffect(() => {
    setCustomPathDraft(config.image_custom_path ?? '');
  }, [config.image_custom_path]);

  // 对话框/异步等待期间 config 可能被其他入口更新，写回前读取最新快照，避免覆盖。
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  /** 弹出系统目录选择框，返回选中的绝对路径；取消或失败返回 null。 */
  const pickCustomPathDirectory = useCallback(async (): Promise<string | null> => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.selectImageStoragePath'),
      });
      return typeof selected === 'string' && selected ? selected : null;
    } catch (error) {
      console.error('Failed to open image storage directory picker:', error);
      toast.error(t('settings.failedToSetImagePath'));
      return null;
    }
  }, [t]);

  /** 落库自定义目录（并切到 custom_path 模式）；macOS 额外创建安全作用域书签。 */
  const applyCustomPath = useCallback(async (path: string) => {
    try {
      const newConfig: AppConfig = {
        ...configRef.current,
        image_storage_mode: 'custom_path',
        image_custom_path: path,
      };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
      setCustomPathDraft(path);
    } catch (error) {
      console.error('Failed to save image custom path:', error);
      toast.error(t('settings.failedToSetImagePath'));
      return;
    }
    if (IS_MAC) {
      try {
        await invoke('create_bookmark', { path });
      } catch (error) {
        console.warn('Failed to create bookmark for image custom path:', error);
        toast.error(t('settings.failedToSetImagePath'));
        return;
      }
    }
    toast.success(t('settings.imagePathSet'));
  }, [t]);

  /** 存储方式切换：选到自定义目录且尚无路径时先弹框，取消则回退原模式（不落库）。 */
  const handleImageStorageModeChange = useCallback(async (mode: ImageStorageMode) => {
    if (mode !== 'custom_path' || configRef.current.image_custom_path) {
      try {
        const newConfig = { ...configRef.current, image_storage_mode: mode };
        await invoke('set_config', { config: newConfig });
        setConfig(newConfig);
      } catch (error) {
        console.error('Failed to save image storage mode:', error);
      }
      return;
    }
    const selected = await pickCustomPathDirectory();
    if (selected) await applyCustomPath(selected);
  }, [pickCustomPathDirectory, applyCustomPath]);

  /** 手输路径（仅非 macOS）失焦/回车提交；非绝对路径拒绝并回退。 */
  const commitCustomPathDraft = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!isAbsoluteImageStoragePath(value)) {
      toast.error(t('settings.invalidImagePath'));
      setCustomPathDraft(configRef.current.image_custom_path ?? '');
      return;
    }
    if (value === configRef.current.image_custom_path) {
      // 归一化草稿（例如去掉首尾空白），避免显示与已存值不一致的原文。
      setCustomPathDraft(value);
      return;
    }
    await applyCustomPath(value);
  }, [t, applyCustomPath]);

  const renderGeneralSettings = () => (
    <>
      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.general')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.workspaceEnabled')}</span>
              <span className="settings-item-description">
                {t('settings.workspaceEnabledDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.startup_behavior === 'workspace'}
              onCheckedChange={async (checked) => {
                try {
                  const behavior: 'blank' | 'workspace' =
                    checked === true ? 'workspace' : 'blank';
                  const newConfig = {
                    ...config,
                    startup_behavior: behavior,
                  };
                  await invoke('set_config', { config: newConfig });
                  setConfig(newConfig);
                } catch (error) {
                  console.error('Failed to save workspace enabled:', error);
                  toast.error(t('settings.failedToSetWorkspaceFolder'));
                }
              }}
            />
          </div>
          {config.startup_behavior === 'workspace' && (
            <div className="settings-item">
              <div className="settings-item-info">
                <span className="settings-item-label">{t('settings.workspaceFolder')}</span>
                <span className="settings-item-description">
                  {t('settings.workspaceFolderDesc')}
                </span>
              </div>
              <WorkspaceFolderPicker
                value={config.workspace_folder}
                placeholder={t('settings.chooseWorkspaceFolder')}
                onSelect={async (path) => {
                  try {
                    // 持久化沙盒安全作用域书签，使下次启动无需重新授权即可读取工作区目录
                    invoke('create_bookmark', { path }).catch(() => {});
                    const newConfig = { ...config, workspace_folder: path };
                    await invoke('set_config', { config: newConfig });
                    setConfig(newConfig);
                    toast.success(t('settings.workspaceFolderSet'));
                  } catch (error) {
                    console.error('Failed to save workspace folder:', error);
                    toast.error(t('settings.failedToSetWorkspaceFolder'));
                  }
                }}
                onError={() => toast.error(t('settings.failedToSetWorkspaceFolder'))}
              />
            </div>
          )}
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.editorFontSize')}</span>
              <span className="settings-item-description">
                {t('settings.editorFontSizeDesc')}
              </span>
            </div>
            {configLoaded ? (
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.editor_font_size]}
                  min={10}
                  max={24}
                  step={1}
                  className="w-35"
                  onValueChange={async ([value]) => {
                    try {
                      const newConfig = { ...config, editor_font_size: value };
                      await invoke('set_config', { config: newConfig });
                      setConfig(newConfig);
                    } catch (error) {
                      console.error('Failed to save editor font size:', error);
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground w-[4ch] text-right">{config.editor_font_size}px</span>
              </div>
            ) : (
              <span style={{ color: 'var(--text-quaternary)', fontSize: '12px' }}>13px</span>
            )}
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.sourceFontSize')}</span>
              <span className="settings-item-description">
                {t('settings.sourceFontSizeDesc')}
              </span>
            </div>
            {configLoaded ? (
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.source_font_size]}
                  min={10}
                  max={24}
                  step={1}
                  className="w-35"
                  onValueChange={async ([value]) => {
                    try {
                      const newConfig = { ...config, source_font_size: value };
                      await invoke('set_config', { config: newConfig });
                      setConfig(newConfig);
                    } catch (error) {
                      console.error('Failed to save source font size:', error);
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground w-[4ch] text-right">{config.source_font_size}px</span>
              </div>
            ) : (
              <span style={{ color: 'var(--text-quaternary)', fontSize: '12px' }}>13px</span>
            )}
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.autoSave')}</span>
              <span className="settings-item-description">
                {t('settings.autoSaveDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.auto_save}
              disabled={isFreeVersion}
              onCheckedChange={handleAutoSaveChange}
            />
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.autoCapitalize')}</span>
              <span className="settings-item-description">
                {t('settings.autoCapitalizeDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.auto_capitalize}
              onCheckedChange={handleAutoCapitalizeChange}
            />
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.showWordCount')}</span>
              <span className="settings-item-description">
                {t('settings.showWordCountDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.show_word_count}
              onCheckedChange={handleShowWordCountChange}
            />
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.typewriterMode')}</span>
              <span className="settings-item-description">
                {t('settings.typewriterModeDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.typewriter_enabled ?? false}
              onCheckedChange={handleTypewriterModeChange}
            />
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.readableLineLength')}</span>
              <span className="settings-item-description">
                {t('settings.readableLineLengthDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.editor_readable_line_length ?? true}
              onCheckedChange={handleReadableLineLengthChange}
            />
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.outlineStyle')}</span>
              <span className="settings-item-description">
                {t('settings.outlineStyleDesc')}
              </span>
            </div>
            <Select
              value={config.outline_style ?? 'off'}
              onValueChange={handleOutlineStyleChange}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t('settings.outlineStyleOff')}</SelectItem>
                <SelectItem value="text">{t('settings.outlineStyleText')}</SelectItem>
                <SelectItem value="minimap">{t('settings.outlineStyleMinimap')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.externalFileChangeAction')}</span>
              <span className="settings-item-description">
                {t('settings.externalFileChangeActionDesc')}
              </span>
            </div>
            <Select
              value={
                !config.watch_external_file_changes
                  ? 'ignore'
                  : config.silent_external_file_changes
                    ? 'silent'
                    : 'prompt'
              }
              onValueChange={async (value) => {
                try {
                  let newConfig;
                  if (value === 'ignore') {
                    newConfig = {
                      ...config,
                      watch_external_file_changes: false,
                      silent_external_file_changes: false,
                    };
                  } else if (value === 'silent') {
                    newConfig = {
                      ...config,
                      watch_external_file_changes: true,
                      silent_external_file_changes: true,
                    };
                  } else {
                    newConfig = {
                      ...config,
                      watch_external_file_changes: true,
                      silent_external_file_changes: false,
                    };
                  }
                  await invoke('set_config', { config: newConfig });
                  setConfig(newConfig);
                } catch (error) {
                  console.error('Failed to save external file change action setting:', error);
                }
              }}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ignore">{t('settings.externalFileChangeIgnore')}</SelectItem>
                <SelectItem value="silent">{t('settings.externalFileChangeSilent')}</SelectItem>
                <SelectItem value="prompt">{t('settings.externalFileChangePrompt')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.fontFamily')}</span>
              <span className="settings-item-description">
                {t('settings.fontFamilyDesc')}
              </span>
            </div>
            <Select
              value={currentFontFamily}
              onValueChange={(value) => handleFontFamilyChange(value as FontFamily)}
              onOpenChange={(open) => { if (open) loadSystemFonts(); }}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">预设字体</div>
                {PRESET_FONTS.map((font) => (
                  <SelectItem key={font.id} value={font.id}>
                    <span style={{ fontFamily: font.value }}>
                      {font.id === 'system' ? t('settings.fontSystemDefault') : font.label} - {t('settings.fontSampleText')}
                    </span>
                  </SelectItem>
                ))}
                {fontsLoaded && systemFonts.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1">系统字体</div>
                    {systemFonts.map((font) => (
                      <SelectItem key={font.family} value={font.family}>
                        <span style={{ fontFamily: `"${font.family}", sans-serif` }}>
                          {font.family} - {t('settings.fontSampleText')}
                        </span>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.editorFontFamily')}</span>
              <span className="settings-item-description">
                {t('settings.editorFontFamilyDesc')}
              </span>
            </div>
            <Select
              value={currentEditorFontFamily}
              onValueChange={(value) => handleEditorFontFamilyChange(value as EditorFontFamily)}
              onOpenChange={(open) => { if (open) loadSystemFonts(); }}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">预设字体</div>
                {PRESET_EDITOR_FONTS.map((font) => (
                  <SelectItem key={font.id} value={font.id}>
                    <span style={{ fontFamily: font.value }}>
                      {font.id === 'system' ? t('settings.fontSystemDefault') : font.id === 'mono' ? t('settings.fontMono') : font.label} - {t('settings.fontSampleText')}
                    </span>
                  </SelectItem>
                ))}
                {fontsLoaded && systemFonts.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1">系统字体</div>
                    {systemFonts.map((font) => (
                      <SelectItem key={font.family} value={font.family}>
                        <span style={{ fontFamily: `"${font.family}", sans-serif` }}>
                          {font.family} - {t('settings.fontSampleText')}
                        </span>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.windowSize')}</span>
              <span className="settings-item-description">
                {t('settings.windowSizeDesc')}
              </span>
            </div>
            {configLoaded ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={config.window_width}
                  onChange={async (e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setConfig({ ...config, window_width: 0 });
                      return;
                    }
                    const width = parseInt(value, 10);
                    if (isNaN(width) || width < 1) return;
                    try {
                      const newConfig = { ...config, window_width: width };
                      await invoke('set_config', { config: newConfig });
                      setConfig(newConfig);
                    } catch (error) {
                      console.error('Failed to save window width:', error);
                    }
                  }}
                  className="w-20"
                  min={1}
                />
                <span className="text-muted-foreground">×</span>
                <Input
                  type="number"
                  value={config.window_height}
                  onChange={async (e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setConfig({ ...config, window_height: 0 });
                      return;
                    }
                    const height = parseInt(value, 10);
                    if (isNaN(height) || height < 1) return;
                    try {
                      const newConfig = { ...config, window_height: height };
                      await invoke('set_config', { config: newConfig });
                      setConfig(newConfig);
                    } catch (error) {
                      console.error('Failed to save window height:', error);
                    }
                  }}
                  className="w-20"
                  min={1}
                />
              </div>
            ) : (
              <span style={{ color: 'var(--text-quaternary)', fontSize: '12px' }}>1200×800</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.toolbar')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.showEditorToolbar')}</span>
              <span className="settings-item-description">
                {t('settings.showEditorToolbarDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.show_editor_toolbar ?? IS_WINDOWS}
              onCheckedChange={handleShowEditorToolbarChange}
            />
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.showInlineFormatToolbar')}</span>
              <span className="settings-item-description">
                {t('settings.showInlineFormatToolbarDesc')}
              </span>
            </div>
            <Checkbox
              checked={config.show_inline_format_toolbar ?? true}
              onCheckedChange={handleShowInlineFormatToolbarChange}
            />
          </div>
        </CardContent>
      </Card>

      <hr className="border-t border-border/60 mx-4" />

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.imageStorage')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.imageStorageMode')}</span>
              <span className="settings-item-description">
                {t('settings.imageStorageModeDesc')}
              </span>
            </div>
            <Select
              value={config.image_storage_mode}
              onValueChange={handleImageStorageModeChange}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alongside_document">{t('settings.imageStorageAlongside')}</SelectItem>
                <SelectItem value="custom_path">{t('settings.imageStorageCustom')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {config.image_storage_mode === 'alongside_document' && (
            <div className="settings-item">
              <div className="settings-item-info">
                <span className="settings-item-label">{t('settings.imageFolderName')}</span>
                <span className="settings-item-description">
                  {t('settings.imageFolderNameDesc')}
                </span>
              </div>
              <Input
                value={config.image_folder_name}
                onChange={async (e) => {
                  const newName = e.target.value;
                  try {
                    const newConfig = { ...config, image_folder_name: newName };
                    await invoke('set_config', { config: newConfig });
                    setConfig(newConfig);
                  } catch (error) {
                    console.error('Failed to save image folder name:', error);
                  }
                }}
                className="w-46"
                placeholder="assets"
              />
            </div>
          )}

          {config.image_storage_mode === 'custom_path' && (
            <div className="settings-item">
              <div className="settings-item-info">
                <span className="settings-item-label">{t('settings.imageStoragePath')}</span>
                <span className="settings-item-description">
                  {t('settings.imageStoragePathDesc')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={customPathDraft}
                  readOnly={IS_MAC}
                  className="w-64"
                  placeholder={t('settings.selectImageStoragePath')}
                  onChange={(e) => setCustomPathDraft(e.target.value)}
                  onBlur={() => {
                    if (!IS_MAC) void commitCustomPathDraft(customPathDraft);
                  }}
                  onKeyDown={(e) => {
                    if (!IS_MAC && e.key === 'Enter') void commitCustomPathDraft(customPathDraft);
                  }}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={async () => {
                    const selected = await pickCustomPathDirectory();
                    if (selected) await applyCustomPath(selected);
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* 图片聚合模式设置 */}
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.imageAggregationMode')}</span>
              <span className="settings-item-description">
                {t('settings.imageAggregationModeDesc')}
              </span>
            </div>
            <Select
              value={config.image_aggregation_mode}
              onValueChange={async (mode: ImageAggregationMode) => {
                try {
                  const newConfig = { ...config, image_aggregation_mode: mode };
                  await invoke('set_config', { config: newConfig });
                  setConfig(newConfig);
                } catch (error) {
                  console.error('Failed to save image aggregation mode:', error);
                }
              }}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('settings.imageAggregationNone')}</SelectItem>
                <SelectItem value="by_document_name">{t('settings.imageAggregationByDocument')}</SelectItem>
                <SelectItem value="by_date">{t('settings.imageAggregationByDate')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 日期格式设置（仅在按日期聚合时显示） */}
          {config.image_aggregation_mode === 'by_date' && (
            <div className="settings-item">
              <div className="settings-item-info">
                <span className="settings-item-label">{t('settings.imageDateFormat')}</span>
                <span className="settings-item-description">
                  {t('settings.imageDateFormatDesc')}
                </span>
              </div>
              <Select
                value={config.image_date_format}
                onValueChange={async (format: ImageDateFormat) => {
                  try {
                    const newConfig = { ...config, image_date_format: format };
                    await invoke('set_config', { config: newConfig });
                    setConfig(newConfig);
                  } catch (error) {
                    console.error('Failed to save image date format:', error);
                  }
                }}
              >
                <SelectTrigger className="w-46">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YYYY">2026</SelectItem>
                  <SelectItem value="YYYY-MM">2026-01</SelectItem>
                  <SelectItem value="YYYY-MM-DD">2026-01-01</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <hr className="border-t border-border/60 mx-4" />

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-1.5">
              <span className="leading-none">{t('common.language')}</span>
              <Popover>
                <PopoverTrigger className="flex items-center justify-center h-5 w-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Info className="h-3.5 w-3.5" />
                </PopoverTrigger>
                <PopoverContent className="w-72 p-4" side="bottom" align="start">
                   <p className="text-xs text-foreground mb-3">{t('settings.importRepoLink')}</p>
                  <a
                    href="https://github.com/textoxmd/translations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md bg-muted p-3 font-mono text-xs break-all text-muted-foreground hover:text-foreground transition-colors"
                  >
                    github.com/textoxmd/translations
                  </a>
                </PopoverContent>
              </Popover>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">Language & 语言</span>
              <span className="settings-item-description">
                {t('settings.languageDesc')}
              </span>
            </div>
            <LanguageSelect
              config={config}
              setConfig={setConfig}
            />
          </div>
          <hr className="border-t border-border/60" />
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.importLabel')}</span>
              <span className="settings-item-description">{t('settings.importDesc')}</span>
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const { open } = await import('@tauri-apps/plugin-dialog');
                  const selected = await open({
                    filters: [{ name: 'Translations', extensions: ['json', 'yaml'] }],
                    title: t('settings.selectTranslationFile'),
                  });
                  if (selected) {
                    await invoke('import_translation_file', { filePath: selected });
                    toast.success(t('settings.importSuccess'));
                  }
                } catch (e: any) {
                  toast.error(t('settings.importError'));
                }
              }}
            >
              {t('settings.importButton')}
            </Button>
          </div>
          <ImportedTranslationTags config={config} setConfig={setConfig} />
        </CardContent>
      </Card>

      <hr className="border-t border-border/60 mx-4" />

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.fileExtensions')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.fileExtensionsDesc')}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pb-1">
            {config.openable_extensions.map((ext) => (
              <span
                key={ext}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs leading-5 rounded-md border border-border text-muted-foreground"
              >
                <span className="font-light">.{ext}</span>
                <button
                  className="font-normal leading-none p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => handleRemoveExtension(ext)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              autoCapitalize="off"
              autoCorrect="off"
              value={extensionsInputValue}
              onChange={(e) => setExtensionsInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddExtension();
                }
              }}
              placeholder={t('settings.fileExtensionsPlaceholder')}
              className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.resetSettings')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.resetToDefault')}</span>
              <span className="settings-item-description">
                {t('settings.resetToDefaultDesc')}
              </span>
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                const confirmed = await window.confirm(t('settings.resetConfirm'));
                if (confirmed) {
                  await handleResetToDefault();
                }
              }}
            >
              {t('settings.resetButton')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );

  const renderShortcutsSettings = () => (
    <Card className="flex-shrink-0 bg-background ring-0">
      <CardHeader>
        <CardTitle>{t('settings.shortcutsConfig')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ShortcutSettings onConfigChange={handleShortcutsConfigChange} />
      </CardContent>
    </Card>
  );

  const renderAISettings = () => <AiModelSettings />;

  const renderAboutSettings = () => (
    <div className="about-native-container">
      <div className="about-native-content">
        <img
          src="/icon.png"
          alt="Textox"
          className="about-native-icon"
          draggable={false}
        />
        <h1 className="about-native-title">Textox</h1>
        <p className="about-native-version">{t('settings.version')} {appVersion || '0.1.0'}</p>
        <p className="about-native-copyright">
          Copyright © {getCopyrightYearLabel()} Textox.<br />
          {t('settings.allRightsReserved')}
        </p>
        <div className="about-native-actions">
          <Button
            variant="outline"
            className="about-native-rate-btn"
            onClick={() => {
              invoke('create_onboarding_window').catch((error) => {
                console.error('Failed to open onboarding window:', error);
              });
            }}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            {t('menu.onboarding_wizard')}
          </Button>
          <Button
            variant="outline"
            className="about-native-rate-btn"
            onClick={() => {
              invoke('open_app_review_page').catch((error) => {
                console.error('Failed to open review page:', error);
                toast.error(t('settings.rateOnAppStoreFailed', '打开评分页面失败'));
              });
            }}
          >
            <Star className="h-4 w-4 mr-2" />
            {t('settings.rateOnAppStore')}
          </Button>
          <Button
            variant="outline"
            className="about-native-rate-btn"
            onClick={() => {
              invoke('open_follow_author').catch((error) => {
                console.error('Failed to open author profile:', error);
                toast.error(t('settings.followAuthorFailed', '打开作者主页失败'));
              });
            }}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            {t('settings.followAuthor')}
          </Button>
        </div>
      </div>
    </div>
  );

  // 打开隐私政策窗口
  const handleOpenPrivacyWindow = async () => {
    try {
      await invoke('create_privacy_window');
    } catch (error) {
      console.error('Failed to open privacy window:', error);
      toast.error(t('settings.openPrivacyFailed', '打开隐私政策窗口失败'));
    }
  };

  const renderPrivacySettings = () => (
    <div className="privacy-simple-container">
      <div className="privacy-simple-content">
        <h1 className="privacy-simple-title">{t('settings.privacy', '隐私政策')}</h1>
        <p className="privacy-simple-subtitle">
          {t('settings.privacySubtitle', '我们重视您的隐私保护')}
        </p>

        <Card className="privacy-simple-card">
          <CardContent className="privacy-simple-list">
            <div className="privacy-simple-item">
              <span className="privacy-simple-check">✓</span>
              <span className="privacy-simple-text">{t('settings.privacyNoCollect', '不收集个人身份信息')}</span>
            </div>
            <div className="privacy-simple-item">
              <span className="privacy-simple-check">✓</span>
              <span className="privacy-simple-text">{t('settings.privacyNoUpload', '文档内容不上传服务器')}</span>
            </div>
            <div className="privacy-simple-item">
              <span className="privacy-simple-check">✓</span>
              <span className="privacy-simple-text">{t('settings.privacyLocalOnly', '所有数据仅存储在本地')}</span>
            </div>
            <div className="privacy-simple-item">
              <span className="privacy-simple-check">✓</span>
              <span className="privacy-simple-text">{t('settings.privacyNoTrack', '无追踪、无广告')}</span>
            </div>
          </CardContent>
        </Card>

        {/* 查看完整隐私政策按钮 */}
        <Button
          variant="outline"
          className="privacy-view-full-btn"
          onClick={handleOpenPrivacyWindow}
        >
          <FileText className="h-4 w-4 mr-2" />
          {t('settings.viewFullPrivacy', '查看完整隐私政策')}
        </Button>

        <p className="privacy-simple-contact">
          {t('settings.privacyContact', '如有疑问，请联系：hi@textox.cn')}
        </p>
      </div>
    </div>
  );

  const handleAddExtension = async () => {
    const ext = extensionsInputValue.trim().toLowerCase();
    if (!ext) return;
    if (config.openable_extensions.includes(ext)) {
      setExtensionsInputValue('');
      return;
    }
    const newExtensions = [...config.openable_extensions, ext];
    try {
      const newConfig = { ...config, openable_extensions: newExtensions };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
      setExtensionsInputValue('');
    } catch (error) {
      console.error('Failed to save extensions:', error);
    }
  };

  const handleRemoveExtension = async (ext: string) => {
    const newExtensions = config.openable_extensions.filter(e => e !== ext);
    try {
      const newConfig = { ...config, openable_extensions: newExtensions };
      await invoke('set_config', { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save extensions:', error);
    }
  };

  // 获取当前分类的标题和图标
  const getCategoryInfo = (category: SettingsCategory) => {
    switch (category) {
      case 'general':
        return { title: t('settings.general'), icon: Settings };
      case 'ai':
        return { title: t('settings.ai.title', 'Model settings'), icon: ModelSettingsIcon };
      case 'shortcuts':
        return { title: t('settings.shortcuts'), icon: Keyboard };
      case 'privacy':
        return { title: t('settings.privacy'), icon: Shield };
      case 'about':
        return { title: t('settings.about'), icon: Info };
      case 'themes':
        return { title: t('settings.themeManagement'), icon: Palette };
      case 'bookmarks':
        return { title: t('settings.bookmarkManagement'), icon: Bookmark };
      case 'experimental':
        return { title: t('settings.experimental'), icon: FlaskConical };
      case 'plugins':
        return { title: t('settings.pluginManagement'), icon: Puzzle };
      default:
        return { title: t('common.settings'), icon: Settings };
    }
  };

  const renderExperimentalSettings = () => {
    const handleSourcePreserveToggle = (checked: boolean) => {
      setSourcePreserveEnabled(checked);
      setSourcePreserveEnabledState(checked);
      // 保真开关在编辑器挂载时一次性读取（保真上下文在建 doc 时生成），
      // 切换后需重启应用才能生效，与语法功能开关保持一致。
      showGlassDialog({
        title: t('settings.markdownRestartTitle'),
        content: t('settings.markdownRestartDesc', {
          feature: t('settings.sourcePreserveTitle'),
        }),
        buttons: [
          { text: t('common.confirm'), variant: 'primary', value: 'ok' as const },
        ],
      });
    };

    return (
      <Card className="flex-shrink-0 bg-background ring-0">
        <CardContent className="space-y-5">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.sourcePreserveTitle')}</span>
              <span
                className="settings-item-description"
                dangerouslySetInnerHTML={{ __html: t('settings.sourcePreserveDesc') }}
              />
            </div>
            <Checkbox
              checked={sourcePreserveEnabled}
              onCheckedChange={(checked) => handleSourcePreserveToggle(checked === true)}
            />
          </div>
          <hr className="border-t border-border/60" />
          <McpSettings />
        </CardContent>
      </Card>
    );
  };


  const currentCategoryInfo = getCategoryInfo(activeCategory);
  const CurrentIcon = currentCategoryInfo.icon;

  if (!configLoaded) {
    return (
      <div className="settings-page">
        <div className="settings-layout">
          <div className="settings-sidebar-area">
            <div className="settings-sidebar-titlebar" />
            <div className="settings-sidebar" />
          </div>
          <div className="settings-content-area">
            <div className="settings-content-titlebar" />
            <div className="settings-content" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`settings-page${isInitialContentRender.current ? ' settings-content-fade-in' : ''}`}>
      <div className="settings-layout">
        {/* 左侧边栏区域 */}
        <div className="settings-sidebar-area">
          {/* 左侧标题栏 */}
          <div className="settings-sidebar-titlebar" data-tauri-drag-region>
            {/* <div className="settings-sidebar-titlebar-content" data-tauri-drag-region>
              <span className="settings-sidebar-title" data-tauri-drag-region>{t('common.settings')}</span>
            </div> */}
          </div>
          {/* 左侧分类导航 */}
          <div className="settings-sidebar">
            <nav className="settings-nav">
              <button
                className={`settings-nav-item ${activeCategory === 'general' ? 'active' : ''}`}
                onClick={() => setActiveCategory('general')}
              >
                <Settings className="settings-nav-icon" />
                <span>{t('settings.general')}</span>
              </button>
              <button
                className={`settings-nav-item ${activeCategory === 'ai' ? 'active' : ''}`}
                onClick={() => setActiveCategory('ai')}
              >
                <ModelSettingsIcon className="settings-nav-icon" />
                <span>{t('settings.ai.title', 'Model settings')}</span>
              </button>
              <button
                className={`settings-nav-item ${activeCategory === 'plugins' ? 'active' : ''}`}
                onClick={() => setActiveCategory('plugins')}
              >
                <Puzzle className="settings-nav-icon" />
                <span>{t('settings.pluginManagement')}</span>
              </button>
              {!isWindows && (
                <button
                  className={`settings-nav-item ${activeCategory === 'bookmarks' ? 'active' : ''}`}
                  onClick={() => setActiveCategory('bookmarks')}
                >
                  <Bookmark className="settings-nav-icon" />
                  <span>{t('settings.bookmarkManagement')}</span>
                </button>
              )}
              <button
                className={`settings-nav-item ${activeCategory === 'themes' ? 'active' : ''}`}
                onClick={() => setActiveCategory('themes')}
              >
                <Palette className="settings-nav-icon" />
                <span>{t('settings.themeManagement')}</span>
              </button>
              <button
                className={`settings-nav-item ${activeCategory === 'experimental' ? 'active' : ''}`}
                onClick={() => setActiveCategory('experimental')}
              >
                <FlaskConical className="settings-nav-icon" />
                <span>{t('settings.experimental')}</span>
              </button>
              <button
                className={`settings-nav-item ${activeCategory === 'shortcuts' ? 'active' : ''}`}
                onClick={() => setActiveCategory('shortcuts')}
              >
                <Keyboard className="settings-nav-icon" />
                <span>{t('settings.shortcuts')}</span>
              </button>
              <button
                className={`settings-nav-item ${activeCategory === 'privacy' ? 'active' : ''}`}
                onClick={() => setActiveCategory('privacy')}
              >
                <Shield className="settings-nav-icon" />
                <span>{t('settings.privacy')}</span>
              </button>
              <button
                className={`settings-nav-item ${activeCategory === 'about' ? 'active' : ''}`}
                onClick={() => setActiveCategory('about')}
              >
                <Info className="settings-nav-icon" />
                <span>{t('settings.about')}</span>
              </button>
            </nav>
          </div>
        </div>

        {/* 右侧内容区域 */}
        <div className="settings-content-area">
          {/* 右侧标题栏 */}
          <div className={`settings-content-titlebar${isWindows ? ' windows' : ''}`} data-tauri-drag-region onContextMenu={(e) => { if (isWindows) { e.preventDefault(); invoke('show_titlebar_menu'); } }}>
            <div className="settings-content-titlebar-left" data-tauri-drag-region>
              <CurrentIcon className="settings-content-titlebar-icon" />
              <span className="settings-content-title" data-tauri-drag-region>{currentCategoryInfo.title}</span>
            </div>
            <div className="settings-content-titlebar-right" data-tauri-drag-region>
              {isWindows && (
                <div className="window-controls">
                  <button className="window-control-button minimize" onClick={minimizeWindow} title="最小化">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="4.5" width="8" height="1" rx="0.5" fill="currentColor" fillOpacity="0.8" /></svg>
                  </button>
                  <button className="window-control-button maximize-restore" onClick={toggleMaximizeWindow} title={isMaximized ? '还原' : '最大化'}>
                    {isMaximized ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <rect x="2" y="0.5" width="7.5" height="7.5" rx="0.5" stroke="currentColor" strokeOpacity="0.8" strokeWidth="0.8" />
                        <rect x="0.5" y="2" width="7.5" height="7.5" rx="0.5" fill="var(--titlebar-bg)" stroke="currentColor" strokeOpacity="0.8" strokeWidth="0.8" />
                      </svg>
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeOpacity="0.8" strokeWidth="0.8" />
                      </svg>
                    )}
                  </button>
                  <button className="window-control-button close" onClick={closeWindow} title="关闭">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* 右侧配置内容 */}
          <div className="settings-content">
            {activeCategory === 'general' && renderGeneralSettings()}
            {activeCategory === 'ai' && renderAISettings()}
            {activeCategory === 'shortcuts' && renderShortcutsSettings()}
            {activeCategory === 'privacy' && renderPrivacySettings()}
            {activeCategory === 'about' && renderAboutSettings()}
            {activeCategory === 'themes' && <ThemeEditor />}
            {activeCategory === 'experimental' && renderExperimentalSettings()}
            {activeCategory === 'plugins' && <PluginManagerPanel />}
            {activeCategory === 'bookmarks' && <BookmarkManagerSettings />}
          </div>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}

interface LanguageSelectProps {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
}

const BUILT_IN_LANGS = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en-US', name: 'English' },
  { code: 'ja-JP', name: '日本語' },
  { code: 'ko-KR', name: '한국어' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'es-ES', name: 'Español' },
  { code: 'it-IT', name: 'Italiano' },
  { code: 'pt-PT', name: 'Português' },
  { code: 'ru-RU', name: 'Русский' },
  { code: 'ar-SA', name: 'العربية' },
  { code: 'hi-IN', name: 'हिन्दी' },
  { code: 'vi-VN', name: 'Tiếng Việt' },
  { code: 'th-TH', name: 'ไทย' },
];

function LanguageSelect({ config, setConfig }: LanguageSelectProps) {
  const { t, i18n } = useTranslation();
  type CustomLangInfo = { lang: string; name: string; hash: string };
  const [customLangs, setCustomLangs] = useState<CustomLangInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const langs = await invoke<CustomLangInfo[]>('list_custom_translations');
      setCustomLangs(langs);
    } catch { }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const unlisten = listen<string>('custom-translation-imported', () => { refresh(); });
    return () => { unlisten.then(fn => fn()); };
  }, [refresh]);

  // 用唯一 id 区分选项：内置语言用 "builtin:{code}"，自定义用 "custom:{hash}"
  const customEntries = customLangs.map(c => ({ id: `custom:${c.hash}`, code: c.lang, name: c.name }));
  const builtinEntries = BUILT_IN_LANGS.map(l => ({ id: `builtin:${l.code}`, code: l.code, name: l.name }));
  const hasCustom = customEntries.length > 0;
  const allEntries = [...customEntries, ...builtinEntries];

  // 优先匹配内置语言，同名自定义语言也显示为独立选项
  const currentId = (() => {
    // 优先匹配自定义配置
    if (config.custom_lang_hash) {
      const custom = customEntries.find(e => e.id === `custom:${config.custom_lang_hash}`);
      if (custom) return custom.id;
    }
    const lang = config.language || i18n.language;
    return builtinEntries.find(l => l.code === lang)?.id
      || allEntries.find(l => l.code === lang)?.id
      || '';
  })();

  return (
    <Select
      value={currentId}
      onValueChange={async (id) => {
        const entry = allEntries.find(l => l.id === id);
        if (!entry) return;
        const isCustom = id.startsWith('custom:');
        const hash = isCustom ? id.replace('custom:', '') : '';
        try {
          if (isCustom) {
            await applyCustomTranslation(entry.code);
          } else {
            await i18n.changeLanguage(entry.code);
          }
          const newConfig = { ...config, language: entry.code, custom_lang_hash: hash };
          await invoke('set_config', { config: newConfig });
          setConfig(newConfig);
        } catch (error) {
          console.error('Failed to save language config:', error);
        }
      }}
    >
      <SelectTrigger className="w-46">
        <SelectValue>
          {allEntries.find(l => l.id === currentId)?.name || config.language || i18n.language}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {customEntries.map(({ id, name }) => (
          <SelectItem key={id} value={id}>
            <span className="flex items-center gap-2">
              <span>{name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {t('settings.customLabel')}
              </span>
            </span>
          </SelectItem>
        ))}
        {hasCustom && <div className="h-px bg-border mx-2 my-1" />}
        {builtinEntries.map(({ id, name }) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ImportedTranslationTags({ config, setConfig }: LanguageSelectProps) {
  const { t, i18n } = useTranslation();
  type CustomLangInfo = { lang: string; name: string; hash: string };
  const [importedLangs, setImportedLangs] = useState<CustomLangInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const langs = await invoke<CustomLangInfo[]>('list_custom_translations');
      setImportedLangs(langs);
    } catch { }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const unlisten = listen<string>('custom-translation-imported', () => { refresh(); });
    return () => { unlisten.then(fn => fn()); };
  }, [refresh]);

  if (importedLangs.length === 0) {
    return null;
  }

  const handleRemove = async (hash: string) => {
    try {
      await invoke('remove_custom_translation', { hash });
      toast.success(t('settings.removeSuccess'));
      refresh();
      if (config.custom_lang_hash === hash) {
        const fallback = (() => {
          const nav = navigator.language;
          if (LANGUAGE_NAMES[nav]) return nav;
          const short = nav.split('-')[0];
          const matched = Object.keys(LANGUAGE_NAMES).find(l => l.startsWith(short));
          return matched || 'zh-CN';
        })();
        await i18n.changeLanguage(fallback);
        const newConfig = { ...config, language: fallback, custom_lang_hash: '' };
        await invoke('set_config', { config: newConfig });
        setConfig(newConfig);
      }
    } catch (e: any) {
      toast.error(t('settings.removeError'));
    }
  };

  const isActive = (hash: string) => config.custom_lang_hash === hash;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1">
      {importedLangs.map(({ name, hash }) => (
        <span
          key={hash}
          className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-sm rounded-md border text-foreground ${isActive(hash) ? 'border-primary' : 'border-border'}`}
        >
          {name}
          <button
            className="text-muted-foreground hover:text-foreground leading-none p-0.5"
            onClick={() => handleRemove(hash)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
