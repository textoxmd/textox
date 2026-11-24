import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { isDisabledFileExtension } from '@/plugins/registry';
import { logger } from '@/utils/logger';

export interface OpenRecentItemDeps {
  t: (key: string) => string;
  openFolder: (path: string) => Promise<boolean>;
  executeOpenFile: (path: string, isDirectory: boolean) => Promise<boolean>;
  addToRecentItems: (path: string) => Promise<void>;
  removeRecentItem: (path: string) => void;
  notifyDisabledFile: (path: string) => void;
  updateWindowFile: (path: string | null) => Promise<void>;
  updateWindowFolder: (path: string | null) => Promise<void>;
  updateWindowMode: (isSingleFile: boolean) => Promise<void>;
}

/**
 * 启动阶段打开「最近项目」。
 *
 * 只把「目标是否真的打开」作为返回值：最近记录、窗口信息等记账失败只记日志，
 * 不能让调用方误以为目标未打开而回退到空白文档。
 */
export async function openRecentItemPath(
  item: string,
  deps: OpenRecentItemDeps,
): Promise<boolean> {
  const {
    t,
    openFolder,
    executeOpenFile,
    addToRecentItems,
    removeRecentItem,
    notifyDisabledFile,
    updateWindowFile,
    updateWindowFolder,
    updateWindowMode,
  } = deps;

  const pathType = await invoke<string>('check_path_type', { path: item }).catch(() => null);
  if (!pathType) {
    logger.log('Pending recent item not found:', item);
    removeRecentItem(item);
    const isDirectory = !item.match(/\.[a-zA-Z0-9]+$/);
    toast.error(isDirectory ? t('message.recentFolderNotFound') : t('message.recentFileNotFound'));
    return false;
  }

  if (pathType !== 'directory' && isDisabledFileExtension(item)) {
    notifyDisabledFile(item);
    return false;
  }

  const warn = (message: string) => (error: unknown) => {
    logger.warn(message, error);
  };

  const openItem = async (target: string, targetType: string) => {
    if (targetType === 'directory') {
      if (!(await openFolder(target))) return false;
      await updateWindowFile(null).catch(warn('Failed to update window file:'));
      await updateWindowFolder(target).catch(warn('Failed to update window folder:'));
      await updateWindowMode(false).catch(warn('Failed to update window mode:'));
      await addToRecentItems(target).catch(warn('Failed to add recent item:'));
      return true;
    }
    if (!(await executeOpenFile(target, false))) return false;
    await updateWindowFile(target).catch(warn('Failed to update window file:'));
    await updateWindowMode(true).catch(warn('Failed to update window mode:'));
    return true;
  };

  const hasBookmark = await invoke<boolean>('has_bookmark', { path: item }).catch(() => false);
  if (hasBookmark) {
    const accessStarted = await invoke('start_access', { path: item })
      .then(() => true)
      .catch(err => {
        logger.warn('Failed to resolve bookmark access for pending recent item:', err);
        return false;
      });
    if (accessStarted) return openItem(item, pathType);
  }

  // 书签缺失/失效：通过系统选择器重新授权
  if (pathType === 'directory') {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: item,
      title: t('dialog.selectFolder'),
    });
    if (selected && typeof selected === 'string') {
      await invoke('create_bookmark', { path: selected }).catch(() => {});
      return openItem(selected, 'directory');
    }
    return false;
  }

  const selected = await open({
    multiple: false,
    defaultPath: item,
    title: t('dialog.selectFile'),
  });
  if (selected && typeof selected === 'string') {
    const selectedType = await invoke<string>('check_path_type', { path: selected });
    if (selectedType !== 'directory' && isDisabledFileExtension(selected)) {
      notifyDisabledFile(selected);
      return false;
    }
    return openItem(selected, selectedType);
  }
  return false;
}
