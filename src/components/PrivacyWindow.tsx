import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { TextoEditor } from './TextoEditor/TextoEditor';
import { toast } from 'sonner';
import { RotateCcw, X } from 'lucide-react';
import { getDefaultPrivacy } from './defaultPrivacy';
interface AppConfig {
  language?: string;
}

export function PrivacyWindow() {
  const { t, i18n: i18nInstance } = useTranslation();
  const [content, setContent] = useState(() => getDefaultPrivacy(i18nInstance.language));
  const [isLoading, setIsLoading] = useState(true);
  const originalContentRef = useRef(getDefaultPrivacy(i18nInstance.language));

  // 组件挂载时等待 i18n 初始化完成
  useEffect(() => {
    const initLanguage = async () => {
      // 等待 i18n 初始化完成
      await i18nInstance.init();
      // 使用初始化后的语言设置内容
      const defaultContent = getDefaultPrivacy(i18nInstance.language);
      setContent(defaultContent);
      originalContentRef.current = defaultContent;
      setIsLoading(false);
    };

    initLanguage();
  }, []);

  // 与编辑器窗口一致的启动时序：内容就绪后再显示，避免暗色模式白屏
  useEffect(() => {
    if (!isLoading) {
      getCurrentWindow().show();
    }
  }, [isLoading]);

  // 监听语言变化，切换到对应语言的默认隐私政策内容
  useEffect(() => {
    if (!isLoading) {
      const defaultContent = getDefaultPrivacy(i18nInstance.language);
      setContent(defaultContent);
      originalContentRef.current = defaultContent;
    }
  }, [i18nInstance.language, isLoading]);

  // 监听配置变化事件（从其他窗口广播）
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<AppConfig>('config-changed', (event) => {
        const config = event.payload;
        if (config.language && config.language !== i18nInstance.language) {
          // 切换语言
          i18nInstance.changeLanguage(config.language);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [i18nInstance]);

  // 处理内容变化
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  // 处理保存
  const handleSave = useCallback(() => {
    // 隐私窗口仅更新内存中的内容引用，不保存到文件
    originalContentRef.current = content;
    toast.success(t('privacy.contentUpdated', '内容已更新'));
  }, [content, t]);

  // 恢复默认内容
  const handleReset = useCallback(() => {
    const defaultContent = getDefaultPrivacy(i18nInstance.language);
    setContent(defaultContent);
    originalContentRef.current = defaultContent;
    toast.success(t('privacy.resetSuccess', '已恢复默认内容'));
  }, [t, i18nInstance.language]);

  // 关闭窗口
  const handleClose = useCallback(async () => {
    try {
      const currentWindow = getCurrentWindow();
      await invoke('unregister_window', { window: currentWindow });
      await currentWindow.destroy();
    } catch (error) {
      console.error('Failed to close window:', error);
      toast.error(t('privacy.closeFailed', '关闭窗口失败'));
    }
  }, [t]);

  if (isLoading) {
    return (
      <div className="window-loading">
        <div className="window-spinner" />
      </div>
    );
  }

  return (
    <div className="window-container">
      {/* 自定义标题栏 */}
      <div className="window-titlebar" data-tauri-drag-region>
        {/* 左侧占位，保持标题居中 */}
        <div className="window-titlebar-spacer" data-tauri-drag-region />

        {/* 中间标题 - 可拖动区域 */}
        <div className="window-titlebar-title" data-tauri-drag-region>
          {t('privacy.title')}
        </div>

        {/* 右侧按钮区域 */}
        <div className="window-titlebar-buttons">
          <button
            className="window-titlebar-btn"
            onClick={handleReset}
            title={t('privacy.reset', '恢复默认')}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            className="window-titlebar-btn"
            onClick={handleClose}
            title={t('common.close', '关闭')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 编辑器区域 */}
      <div className="window-content">
        <TextoEditor
          content={content}
          onChange={handleContentChange}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
