import { useState, useRef, useCallback, useEffect, useMemo, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import i18n from '@/i18n';
import { logger } from '@/utils/logger';
import { readAppConfig } from '@/utils/appConfig';
import { createToolbarStatePlugin } from '@/components/TextoEditor/src/features/toolbar-state';
import { setInlineFormatToolbarEnabled, INLINE_FORMAT_TOOLBAR_CHANGED_EVENT } from '@/components/TextoEditor/src/features/inline-format-toolbar';
import {
  setColorTheme,
  setAppearance,
  getFontFamilyValue,
  getEditorFontFamilyValue,
  applyCodeThemeFromCss,
  type ColorTheme,
  type Appearance,
  type FontFamily,
  type EditorFontFamily,
} from '@/components/styles';
import { EDITOR_MODE_KEY, LOCK_KEY, isFreeVersion } from '@/app/constants';
import { toOutlineStyle } from '@/app/fileTree';
import type { OutlineStyle } from '@/app/types';
import { IS_WINDOWS } from '@/utils/windowManager';

interface UseAppConfigParams {
  /** 大纲样式设置器由大纲钩子提供，通过 ref 打破二者循环依赖 */
  setOutlineStyleRef: MutableRefObject<(value: OutlineStyle) => void>;
  /** 编辑器字体大小变化时强制重建编辑器 */
  setEditorKey: Dispatch<SetStateAction<number>>;
}

/**
 * 应用配置：全部编辑器/外观设置的本地状态、与后端 config 的同步
 * （首次加载 + config-changed 等广播），以及字体大小的 CSS 变量应用。
 */
export function useAppConfig({ setOutlineStyleRef, setEditorKey }: UseAppConfigParams) {
  const [editorMode, setEditorMode] = useState<'ir' | 'sv'>(() => {
    const saved = localStorage.getItem(EDITOR_MODE_KEY);
    if (saved === 'ir' || saved === 'sv') return saved;
    return 'ir';
  });
  // 打字机模式状态（单一数据源为 AppConfig，编辑器初值通过 prop 传入）
  const [typewriterEnabled, setTypewriterEnabled] = useState(false);
  // 可读行宽：IR 模式是否限制正文宽度并居中（全局配置）
  const [readableLineLength, setReadableLineLength] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'modified'>('saved');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [codeBlockWordWrap, setCodeBlockWordWrap] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [autoCapitalize, setAutoCapitalize] = useState(false);
  const [showWordCount, setShowWordCount] = useState(false);
  const [showEditorToolbar, setShowEditorToolbar] = useState(IS_WINDOWS);
  const [showInlineFormatToolbar, setShowInlineFormatToolbar] = useState(true);
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    const saved = localStorage.getItem(LOCK_KEY);
    return saved ? JSON.parse(saved) : false;
  });
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const [openableExtensions, setOpenableExtensions] = useState<string[]>([]);
  const [appearance, setAppearanceState] = useState<Appearance>('system');
  const [watchExternalChanges, setWatchExternalChanges] = useState(true);
  const [silentExternalChanges, setSilentExternalChanges] = useState(false);

  // 使用 ref 存储配置值，避免依赖数组变化导致重新订阅
  const configRef = useRef({
    autoSaveEnabled: true,
    codeBlockWordWrap: true,
    showLineNumbers: true,
    colorTheme: 'default' as ColorTheme,
    appearance: 'system' as Appearance,
    editorFontSize: 13,
    sourceFontSize: 13,
    watchExternalChanges: true,
    silentExternalChanges: false,
    autoCapitalize: false,
    showWordCount: false,
    showEditorToolbar: IS_WINDOWS,
    showInlineFormatToolbar: true,
    typewriterEnabled: false,
    readableLineLength: true,
    outlineStyle: 'off' as OutlineStyle,
  });

  // 同步 appearance state 到 configRef
  useEffect(() => {
    configRef.current.appearance = appearance;
  }, [appearance]);

  const toolbarStateController = useMemo(() => createToolbarStatePlugin(), []);

  // 应用编辑器字体大小到 CSS 变量
  const applyEditorFontSize = (fontSize: number) => {
    const basefont = configRef.current.editorFontSize;
    const root = document.documentElement;
    root.style.setProperty('--font-size-editor', `${fontSize}px`);
    const scale = fontSize / basefont;
    root.style.setProperty('--font-size-editor-h1', `${Math.round((basefont+12) * scale)}px`);
    root.style.setProperty('--font-size-editor-h2', `${Math.round((basefont+8) * scale)}px`);
    root.style.setProperty('--font-size-editor-h3', `${Math.round((basefont+6) * scale)}px`);
    root.style.setProperty('--font-size-editor-h4', `${Math.round((basefont+4) * scale)}px`);
    root.style.setProperty('--font-size-editor-h5', `${Math.round((basefont+2) * scale)}px`);
    root.style.setProperty('--font-size-editor-h6', `${Math.round(basefont * scale)}px`);
    root.style.setProperty('--font-size-editor-code', `${fontSize}px`);
  };

  // 应用源码模式字体大小到 CSS 变量
  const applySourceFontSize = (fontSize: number) => {
    document.documentElement.style.setProperty('--font-size-editor-source', `${fontSize}px`);
  };

  // 加载应用配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await readAppConfig<{
          auto_save: boolean;
          code_block_word_wrap?: boolean;
          show_line_numbers?: boolean;
          language?: string;
          color_theme?: string;
          appearance?: string;
          editor_font_size?: number;
          source_font_size?: number;
          watch_external_file_changes?: boolean;
          silent_external_file_changes?: boolean;
          auto_capitalize?: boolean;
          show_word_count?: boolean;
          openable_extensions?: string[];
          show_editor_toolbar?: boolean;
          show_inline_format_toolbar?: boolean;
          typewriter_enabled?: boolean;
          editor_readable_line_length?: boolean;
          outline_style?: string;
        }>();
        setAutoSaveEnabled(isFreeVersion ? false : config.auto_save);
        // 应用语言设置
        if (config.language && config.language !== i18n.language) {
          await i18n.changeLanguage(config.language);
        }
        // 应用颜色主题和外观设置
        if (config.color_theme) {
          setColorTheme(config.color_theme as ColorTheme);
        }
        if (config.appearance) {
          setAppearanceState(config.appearance as Appearance);
          setAppearance(config.appearance as Appearance);
        }
        // 应用编辑器字体大小
        if (config.editor_font_size !== undefined) {
          applyEditorFontSize(config.editor_font_size);
        }
        // 应用源码模式字体大小
        if (config.source_font_size !== undefined) {
          applySourceFontSize(config.source_font_size);
        }
        // 加载外部文件修改监听设置
        if (config.watch_external_file_changes !== undefined) {
          setWatchExternalChanges(config.watch_external_file_changes);
        }
        if (config.silent_external_file_changes !== undefined) {
          setSilentExternalChanges(config.silent_external_file_changes);
        }
        // 加载代码块自动换行设置
        if (config.code_block_word_wrap !== undefined) {
          setCodeBlockWordWrap(config.code_block_word_wrap);
        }
        // 加载行号显示设置
        if (config.show_line_numbers !== undefined) {
          setShowLineNumbers(config.show_line_numbers);
        }
        // 加载自动首字母大写设置
        if (config.auto_capitalize !== undefined) {
          setAutoCapitalize(config.auto_capitalize);
        }
        // 加载字数统计设置
        if (config.show_word_count !== undefined) {
          setShowWordCount(config.show_word_count);
        }
        // 加载工具栏显示设置
        if (config.show_editor_toolbar !== undefined) {
          setShowEditorToolbar(config.show_editor_toolbar);
        }
        // 加载悬浮格式工具栏设置
        if (config.show_inline_format_toolbar !== undefined) {
          setShowInlineFormatToolbar(config.show_inline_format_toolbar);
        }
        // 加载打字机模式（单一数据源为 AppConfig，编辑器通过 prop 同步）
        if (config.typewriter_enabled !== undefined) {
          setTypewriterEnabled(config.typewriter_enabled);
        }
        // 加载可读行宽设置（IR 模式内容宽度）
        if (config.editor_readable_line_length !== undefined) {
          setReadableLineLength(config.editor_readable_line_length);
        }
        // 加载大纲样式设置
        if (config.outline_style) {
          setOutlineStyleRef.current(toOutlineStyle(config.outline_style));
        }
        // 加载可打开的文件扩展名设置
        if (config.openable_extensions !== undefined) {
          setOpenableExtensions(config.openable_extensions);
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    };
    loadConfig();
  }, []);

  // 监听自动保存配置变化
  useEffect(() => {
    const unlisten = listen('auto-save-changed', (event) => {
      const enabled = event.payload as boolean;
      setAutoSaveEnabled(isFreeVersion ? false : enabled);
    });
    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // 同步 ref 和 state（outlineStyle 由 App 侧同步）
  configRef.current.autoSaveEnabled = autoSaveEnabled;
  configRef.current.codeBlockWordWrap = codeBlockWordWrap;
  configRef.current.showLineNumbers = showLineNumbers;
  configRef.current.autoCapitalize = autoCapitalize;
  configRef.current.showWordCount = showWordCount;
  configRef.current.showEditorToolbar = showEditorToolbar;
  configRef.current.showInlineFormatToolbar = showInlineFormatToolbar;
  configRef.current.typewriterEnabled = typewriterEnabled;
  configRef.current.readableLineLength = readableLineLength;

  // 悬浮格式工具栏开关变化时即时生效（PM 插件通过事件响应）
  useEffect(() => {
    setInlineFormatToolbarEnabled(showInlineFormatToolbar);
    window.dispatchEvent(new CustomEvent(INLINE_FORMAT_TOOLBAR_CHANGED_EVENT, { detail: { enabled: showInlineFormatToolbar } }));
  }, [showInlineFormatToolbar]);

  // 监听配置变化事件（从设置窗口或其他窗口广播）
  useEffect(() => {
    const unlisten = listen('config-changed', (event) => {
      // 只记字段名：payload 含 agent_profiles（每条含 api_key 明文）等敏感信息，不能整包进 DEV 控制台
      logger.log('Config changed event received:', Object.keys(event.payload ?? {}));
      const config = event.payload as { auto_save: boolean; code_block_word_wrap?: boolean; show_line_numbers?: boolean; color_theme?: string; appearance?: string; editor_font_size?: number; source_font_size?: number; font_family?: string; editor_font_family?: string; watch_external_file_changes?: boolean; silent_external_file_changes?: boolean; language?: string; auto_capitalize?: boolean; show_word_count?: boolean; show_editor_toolbar?: boolean; show_inline_format_toolbar?: boolean; typewriter_enabled?: boolean; editor_readable_line_length?: boolean; outline_style?: string };
      const currentConfig = configRef.current;

      // 语言切换：只在值变化时更新
      if (config.language && config.language !== i18n.language) {
        logger.log('Setting language:', config.language);
        i18n.changeLanguage(config.language);
      }

      // 只在值变化时更新状态，避免不必要的重新渲染
      if (config.auto_save !== currentConfig.autoSaveEnabled) {
        logger.log('Setting auto save:', config.auto_save);
        setAutoSaveEnabled(isFreeVersion ? false : config.auto_save);
      }

      // 代码块自动换行：只在值变化时更新，需要刷新页面或重启应用生效
      if (config.code_block_word_wrap !== undefined && config.code_block_word_wrap !== currentConfig.codeBlockWordWrap) {
        logger.log('Setting code block word wrap:', config.code_block_word_wrap);
        setCodeBlockWordWrap(config.code_block_word_wrap);
      }

      // 行号显示：只在值变化时更新
      if (config.show_line_numbers !== undefined && config.show_line_numbers !== currentConfig.showLineNumbers) {
        logger.log('Setting show line numbers:', config.show_line_numbers);
        setShowLineNumbers(config.show_line_numbers);
      }

      // 自动首字母大写：只在值变化时更新
      if (config.auto_capitalize !== undefined && config.auto_capitalize !== currentConfig.autoCapitalize) {
        logger.log('Setting auto capitalize:', config.auto_capitalize);
        setAutoCapitalize(config.auto_capitalize);
      }

      // 字数统计：只在值变化时更新
      if (config.show_word_count !== undefined && config.show_word_count !== currentConfig.showWordCount) {
        logger.log('Setting show word count:', config.show_word_count);
        setShowWordCount(config.show_word_count);
      }

      // 工具栏显示：只在值变化时更新
      if (config.show_editor_toolbar !== undefined && config.show_editor_toolbar !== currentConfig.showEditorToolbar) {
        logger.log('Setting show editor toolbar:', config.show_editor_toolbar);
        setShowEditorToolbar(config.show_editor_toolbar);
      }

      // 悬浮格式工具栏显示：只在值变化时更新
      if (config.show_inline_format_toolbar !== undefined && config.show_inline_format_toolbar !== currentConfig.showInlineFormatToolbar) {
        logger.log('Setting show inline format toolbar:', config.show_inline_format_toolbar);
        setShowInlineFormatToolbar(config.show_inline_format_toolbar);
      }

      // 打字机模式：全局配置，编辑器通过 prop 同步
      if (config.typewriter_enabled !== undefined && config.typewriter_enabled !== currentConfig.typewriterEnabled) {
        logger.log('Setting typewriter enabled:', config.typewriter_enabled);
        setTypewriterEnabled(config.typewriter_enabled);
      }

      // 可读行宽：全局配置，即时应用到 IR 编辑器容器
      if (config.editor_readable_line_length !== undefined && config.editor_readable_line_length !== currentConfig.readableLineLength) {
        logger.log('Setting readable line length:', config.editor_readable_line_length);
        setReadableLineLength(config.editor_readable_line_length);
      }

      // 大纲样式：全局配置，即时切换右侧大纲面板渲染
      if (config.outline_style !== undefined && config.outline_style !== currentConfig.outlineStyle) {
        logger.log('Setting outline style:', config.outline_style);
        setOutlineStyleRef.current(toOutlineStyle(config.outline_style));
      }

      // 颜色主题：只在值变化时更新
      if (config.color_theme && config.color_theme !== currentConfig.colorTheme) {
        logger.log('Setting color theme:', config.color_theme);
        currentConfig.colorTheme = config.color_theme as ColorTheme;
        setColorTheme(config.color_theme as ColorTheme);
        invoke('sync_theme_menu', { theme: config.color_theme });
      }

      // 外观模式：只在值变化时更新
      if (config.appearance && config.appearance !== currentConfig.appearance) {
        logger.log('Setting appearance:', config.appearance);
        currentConfig.appearance = config.appearance as Appearance;
        setAppearanceState(config.appearance as Appearance);
        setAppearance(config.appearance as Appearance);
        invoke('sync_appearance_menu', { appearance: config.appearance });
      }

      // 编辑器字体大小：只在值变化时更新 CSS 变量并强制重新创建编辑器
      if (config.editor_font_size !== undefined && config.editor_font_size !== currentConfig.editorFontSize) {
        logger.log('Setting editor font size:', config.editor_font_size);
        currentConfig.editorFontSize = config.editor_font_size;
        applyEditorFontSize(config.editor_font_size);
        setEditorKey(prev => prev + 1);
        requestAnimationFrame(() => {
          applyEditorFontSize(config.editor_font_size!);
        });
      }

      // 源码模式字体大小：只在值变化时更新 CSS 变量
      if (config.source_font_size !== undefined && config.source_font_size !== currentConfig.sourceFontSize) {
        logger.log('Setting source font size:', config.source_font_size);
        currentConfig.sourceFontSize = config.source_font_size;
        applySourceFontSize(config.source_font_size);
      }

      // 外部文件修改监听设置
      if (config.watch_external_file_changes !== undefined && config.watch_external_file_changes !== currentConfig.watchExternalChanges) {
        logger.log('Setting watch external file changes:', config.watch_external_file_changes);
        currentConfig.watchExternalChanges = config.watch_external_file_changes;
        setWatchExternalChanges(config.watch_external_file_changes);
      }
      if (config.silent_external_file_changes !== undefined && config.silent_external_file_changes !== currentConfig.silentExternalChanges) {
        logger.log('Setting silent external file changes:', config.silent_external_file_changes);
        currentConfig.silentExternalChanges = config.silent_external_file_changes;
        setSilentExternalChanges(config.silent_external_file_changes);
      }

      // 界面字体：只更新 CSS 变量，不触发重新渲染
      if (config.font_family) {
        logger.log('Setting UI font:', config.font_family);
        const root = document.documentElement;
        const fontValue = getFontFamilyValue(config.font_family as FontFamily);
        root.style.setProperty('--font-sans', fontValue);
        root.style.setProperty('--font-family-base', fontValue);
        if (document.body) {
          document.body.style.fontFamily = fontValue;
        }
      }

      // 编辑器字体：只更新 CSS 变量，不触发重新渲染
      if (config.editor_font_family) {
        logger.log('Setting editor font:', config.editor_font_family);
        const root = document.documentElement;
        const fontValue = getEditorFontFamilyValue(config.editor_font_family as EditorFontFamily);
        root.style.setProperty('--editor-font-family-base', fontValue);
      }

    });
    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    const listenPromise = listen('theme-css-preview', (event) => {
      const css = event.payload as string;
      let styleEl = document.getElementById('texto-theme-style') as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'texto-theme-style';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = css;
      if (typeof applyCodeThemeFromCss === 'function') {
        applyCodeThemeFromCss(css);
      }
    });
    return () => {
      listenPromise.then((fn: () => void) => fn());
    };
  }, []);

  // 监听 .dark 类变化，重新广播 codethemeschanged（供源码视图 CodeMirror 取用）。
  // 代码块高亮主题已由 official-plugins/syntax-highlight 订阅 appearancechange 承担。
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const cssEl = document.getElementById('texto-theme-style') as HTMLStyleElement | null;
      if (cssEl?.textContent) {
        applyCodeThemeFromCss(cssEl.textContent);
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  // 编辑器内部切换打字机模式时保持本地 state 一致（非 Tauri 回退路径；
  // 桌面端全局切换统一走 config-changed）。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setTypewriterEnabled(detail.enabled);
      }
    };
    window.addEventListener('typewriter-changed', handler);
    return () => window.removeEventListener('typewriter-changed', handler);
  }, []);

  // 从持久化配置校准全局编辑器设置（打字机/工具栏）。窗口重新聚焦时兜底刷新，
  // 避免窗口初始化/后台期间漏掉 config-changed 广播后一直停留在旧值。
  const syncGlobalEditorConfigFromStore = useCallback(async () => {
    try {
      // 聚焦兜底必须穿透快照缓存，避免漏掉 config-changed 后仍读到旧值。
      const config = await invoke<{ show_editor_toolbar?: boolean; show_inline_format_toolbar?: boolean; typewriter_enabled?: boolean }>('get_config');
      // 锁定模式下顶部工具栏由锁定逻辑临时隐藏（不落盘），
      // 聚焦校准不能把它覆盖回来；解锁时再由 toggleLock 恢复。
      if (!isLockedRef.current && config.show_editor_toolbar !== undefined) {
        setShowEditorToolbar(config.show_editor_toolbar);
      }
      if (config.show_inline_format_toolbar !== undefined) {
        setShowInlineFormatToolbar(config.show_inline_format_toolbar);
      }
      if (config.typewriter_enabled !== undefined) {
        setTypewriterEnabled(config.typewriter_enabled);
      }
    } catch (err) {
      console.error('Failed to sync global editor config from store:', err);
    }
  }, []);

  return {
    editorMode,
    setEditorMode,
    typewriterEnabled,
    readableLineLength,
    autoSaveEnabled,
    setAutoSaveEnabled,
    saveStatus,
    setSaveStatus,
    lastSavedTime,
    setLastSavedTime,
    codeBlockWordWrap,
    showLineNumbers,
    autoCapitalize,
    showWordCount,
    showEditorToolbar,
    setShowEditorToolbar,
    showInlineFormatToolbar,
    isLocked,
    setIsLocked,
    isLockedRef,
    openableExtensions,
    appearance,
    setAppearanceState,
    configRef,
    toolbarStateController,
    watchExternalChanges,
    setWatchExternalChanges,
    silentExternalChanges,
    setSilentExternalChanges,
    syncGlobalEditorConfigFromStore,
  };
}
