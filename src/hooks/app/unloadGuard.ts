import { invoke } from '@tauri-apps/api/core';

import type { FileEditorHandle } from '@/plugins/types';

export interface UnloadGuardDeps {
  file: string | null;
  content: string;
  isModified: boolean;
  isTemp: boolean;
  /** 该文件由文件类型编辑器自行保存（customSave）。 */
  isCustomSave: boolean;
  editor: FileEditorHandle | null;
  t: (key: string) => string;
}

export interface UnloadPreparation {
  /** 是否可安全卸载（重载/关闭）。 */
  proceed: boolean;
  /** 临时文件另存为后的新路径；重载时用于把窗口指向新文件。 */
  savedPath?: string;
  /** 是否需要删除原临时文件。 */
  deleteTemp?: boolean;
  /** 用户明确选择「不保存」（丢弃未保存内容）；重载时应删除临时文件并清空窗口当前文件。 */
  discard?: boolean;
}

/**
 * 卸载前未保存守卫：窗口关闭（check-close）与窗口重载共用。
 * 只做判定与落盘，不销毁窗口、不删除临时文件（由调用方按返回值处理）。
 */
export async function prepareWindowUnload(
  deps: UnloadGuardDeps,
): Promise<UnloadPreparation> {
  const { file, content, isModified, isTemp, isCustomSave, editor, t } = deps;

  if (!file) return { proceed: true };

  const buttons = () => ({
    yes: t('unsavedChanges.save'),
    no: t('unsavedChanges.dontSave'),
    cancel: t('unsavedChanges.cancel'),
  });

  // 由文件类型编辑器自行保存的文件
  if (isCustomSave) {
    if (!isModified) return { proceed: true, deleteTemp: isTemp };
    const { message } = await import('@tauri-apps/plugin-dialog');
    const choice = await message(t('unsavedChanges.closeUnsavedMessage'), {
      title: t('unsavedChanges.closeUnsavedTitle'),
      kind: 'warning',
      buttons: buttons(),
    });
    if (choice === t('unsavedChanges.save')) {
      const saved = await editor?.save();
      if (!saved?.ok) return { proceed: false };
      return { proceed: true };
    }
    if (choice === t('unsavedChanges.dontSave')) {
      return { proceed: true, deleteTemp: isTemp, discard: true };
    }
    return { proceed: false };
  }

  // 临时（未命名）文件
  if (isTemp) {
    if (!content.trim()) return { proceed: true, deleteTemp: true };
    const { message, save: saveDialog } = await import('@tauri-apps/plugin-dialog');
    const choice = await message(t('unsavedChanges.closeUnsavedMessage'), {
      title: t('unsavedChanges.closeUnsavedTitle'),
      kind: 'warning',
      buttons: buttons(),
    });
    if (choice === t('unsavedChanges.save')) {
      const filePath = await saveDialog({
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        defaultPath: 'Untitled.md',
      });
      if (typeof filePath !== 'string' || !filePath) return { proceed: false };
      await invoke('write_file', { path: filePath, content });
      return { proceed: true, savedPath: filePath, deleteTemp: true };
    }
    if (choice === t('unsavedChanges.dontSave')) {
      return { proceed: true, deleteTemp: true, discard: true };
    }
    return { proceed: false };
  }

  // 普通文件
  if (isModified && content.trim()) {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(t('unsavedChanges.confirmClose'), {
      title: t('unsavedChanges.title'),
      kind: 'warning',
    });
    return ok ? { proceed: true } : { proceed: false };
  }

  return { proceed: true };
}

export interface UnloadApplyIO {
  updateWindowFile: (path: string | null) => Promise<void>;
  deleteTempFile: (path: string) => Promise<void>;
}

/**
 * 把守卫结果应用到「窗口重载」场景（不销毁窗口）：
 * - savedPath：窗口指向已保存文件，并删除原临时文件；
 * - 明确丢弃且为临时文件（discard + deleteTemp）：删除临时文件并清空窗口当前文件；
 * - 持久文件（含明确丢弃）与其余无未保存场景：保持窗口当前文件不变，
 *   重载后重新读取原文档（持久文件丢弃仅重新加载磁盘内容）。
 */
export async function applyUnloadPreparation(
  prep: UnloadPreparation,
  file: string | null,
  io: UnloadApplyIO,
): Promise<void> {
  if (prep.savedPath) {
    await io.updateWindowFile(prep.savedPath).catch(() => {});
    if (prep.deleteTemp && file) await io.deleteTempFile(file).catch(() => {});
    return;
  }
  if (prep.discard && prep.deleteTemp) {
    if (file) await io.deleteTempFile(file).catch(() => {});
    await io.updateWindowFile(null).catch(() => {});
  }
}
