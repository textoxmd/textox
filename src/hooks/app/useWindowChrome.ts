import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '@/utils/logger';
import { OPENED_FOLDER_KEY } from '@/app/constants';
import {
  updateWindowFile,
  updateWindowFolder,
  updateWindowMode,
  updateImageMenu,
  updateWindowSidebarCollapsed,
  updateWindowSidebarView,
} from '@/utils/windowManager';
import type { FileHandle } from '@/app/types';

interface UseWindowChromeParams {
  currentFile: string | null;
  isModified: boolean;
  saveStatus: 'saved' | 'saving' | 'modified';
  lastSavedTime: string | null;
  isInitializing: boolean;
  openedFolderPath: string | null;
  isSingleFileMode: boolean;
  sidebarCollapsed: boolean;
  outlineVisible: boolean;
  showOutline: boolean;
  fileHandleKind: FileHandle['kind'];
}

/**
 * 窗口标题与原生窗口状态同步：文件名/保存状态、文件夹、模式、菜单、侧边栏。
 * 另在侧边栏/大纲布局变化后派发一次 window resize，供白板重新校准。
 */
export function useWindowChrome({
  currentFile,
  isModified,
  saveStatus,
  lastSavedTime,
  isInitializing,
  openedFolderPath,
  isSingleFileMode,
  sidebarCollapsed,
  outlineVisible,
  showOutline,
  fileHandleKind,
}: UseWindowChromeParams) {
  const { t } = useTranslation();

  // 更新窗口标题
  useEffect(() => {
    const updateTitle = async () => {
      logger.log('Updating title, currentFile:', currentFile, 'isModified:', isModified, 'saveStatus:', saveStatus);
      if (currentFile) {
        const fileName = currentFile.split(/[/\\]/).pop() || currentFile;
        let statusIndicator = '';
        if (saveStatus === 'saving') {
          statusIndicator = '    自动保存中...';
        } else if (saveStatus === 'modified' || isModified) {
          statusIndicator = ' *';
        } else if (saveStatus === 'saved' && lastSavedTime) {
          // 使用圆形对勾符号表示保存完成
          statusIndicator = `    自动保存于 ${lastSavedTime}`;
        }
        const title = `${fileName}${statusIndicator}`;
        logger.log('Setting title to:', title);
        // await appWindow.setTitle(title);
      } else {
        logger.log('Setting title to: Textox');
        // await appWindow.setTitle('Textox');
      }
    };
    updateTitle();
  }, [currentFile, isModified, saveStatus, lastSavedTime]);

  // 同步窗口状态到后端（仅在初始化完成后）
  useEffect(() => {
    if (!isInitializing) {
      updateWindowFile(currentFile);
    }
  }, [currentFile, isInitializing]);

  useEffect(() => {
    if (!isInitializing) {
      updateWindowFolder(openedFolderPath);
      localStorage.setItem(OPENED_FOLDER_KEY, JSON.stringify(openedFolderPath));
    }
  }, [openedFolderPath, isInitializing]);

  useEffect(() => {
    if (!isInitializing) {
      updateWindowMode(isSingleFileMode);
      updateImageMenu(!isSingleFileMode);
      localStorage.setItem(OPENED_FOLDER_KEY, isSingleFileMode ? 'null' : JSON.stringify(openedFolderPath));
    }
  }, [isSingleFileMode, openedFolderPath, isInitializing]);

  useEffect(() => {
    if (!isInitializing) {
      updateWindowSidebarCollapsed(sidebarCollapsed);
    }
  }, [sidebarCollapsed, isInitializing]);

  // 侧边栏/大纲面板展开收起会改变编辑器区域布局，
  // 白板依赖 window resize 事件重新校准画布偏移（激光笔/指针坐标）。
  // 布局稳定后派发一次 resize，避免坐标停留在旧位置。
  useEffect(() => {
    if (isInitializing) return;
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [sidebarCollapsed, outlineVisible, isInitializing]);

  // 同步侧边栏视图状态到后端
  useEffect(() => {
    if (!isInitializing) {
      updateWindowSidebarView(showOutline);
    }
  }, [showOutline, isInitializing]);

  // 计算当前标题
  const currentTitle = (fileHandleKind === 'temp' && (fileHandleKind === 'temp' ? 'Untitled.md' : (currentFile ? currentFile.split(/[/\\]/).pop() || '' : '')))
    ? (fileHandleKind === 'temp' ? 'Untitled.md' : (currentFile ? currentFile.split(/[/\\]/).pop() || '' : ''))
    : (currentFile ? currentFile.split(/[/\\]/).pop() || t('file.untitledMd') : '');

  return { currentTitle };
}
