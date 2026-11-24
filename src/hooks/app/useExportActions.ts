import { useCallback, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { readAppConfig, writeAppConfig } from '@/utils/appConfig';
import { confirm } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';
import { IS_MAC } from '@/utils/windowManager';
import { isFreeVersion } from '@/app/constants';
import { resolveFileEditor } from '@/plugins/registry';
import { getExporter, runExport, saveExport, type ExporterId } from '@/utils/export';
import type { FileHandle } from '@/app/types';

interface UseExportActionsParams {
  currentFile: string | null;
  fileHandle: FileHandle;
  fileHandleRef: MutableRefObject<FileHandle>;
  currentFileRef: MutableRefObject<string | null>;
  isModified: boolean;
  handleSave: () => Promise<string | null>;
  setShowEditorToolbar: (value: boolean) => void;
}

/**
 * 导出与打印：PDF / PNG / HTML / EPUB、原生打印，以及工具栏关闭。
 * 所有导出入口共享同一套守卫（temp / 白板 / Lite 版 / 未保存先落盘）。
 */
export function useExportActions({
  currentFile,
  fileHandle,
  fileHandleRef,
  currentFileRef,
  isModified,
  handleSave,
  setShowEditorToolbar,
}: UseExportActionsParams) {
  const { t } = useTranslation();

  const handleCloseToolbar = useCallback(async () => {
    setShowEditorToolbar(false);
    try {
      const config = await readAppConfig<any>();
      await writeAppConfig({ ...config, show_editor_toolbar: false });
    } catch (error) {
      console.error('Failed to save toolbar config:', error);
    }
  }, [setShowEditorToolbar]);

  // 导出 PDF
  const handleExportPdf = useCallback(async () => {
    if (fileHandle.kind === 'temp') return;
    // 白板在任意版本都不支持导出 PDF，所有入口（菜单/工具栏/
    // 快捷键）统一在此静默拦截，避免走到 exportPdfToFile 导出白板文件。
    if (resolveFileEditor(currentFile)?.capabilities?.exportable === false) return;
    if (isFreeVersion) {
      import('@/utils/upgradePrompt').then(m => m.showUpgradePrompt('upgrade.features.pdfExport'));
      return;
    }
    // 用 ref 取最新路径：菜单事件可能经由较早注册的回调进来，
    // 直接用 state 闭包里的 currentFile 会拿到旧值（导出面板默认名退化成 Untitled.pdf）。
    // fileHandle 的 persistent 路径是最终兜底：导出菜单本身就只在 persistent 时可用。
    const activeHandle = fileHandleRef.current;
    let exportPath = currentFileRef.current
      ?? (activeHandle.kind === 'persistent' ? activeHandle.path : null)
      ?? currentFile;
    if (isModified) {
      const shouldSave = await confirm(t('menu.saveBeforeExportPrompt'));
      if (!shouldSave) return;
      // 未保存文档在这里才落盘并拿到真实路径，保存后不能再用保存前的值
      const savedPath = await handleSave();
      if (savedPath) exportPath = savedPath;
    }
    try {
      const savePath = await import('@/utils/export/native/pdf').then(m => m.exportPdfToFile(exportPath));
      if (!savePath) return;
      toast.success(t('common.pdfExportSuccess'), {
        position: 'bottom-right',
        duration: 10000,
        action: {
          label: t('common.revealInFinder'),
          onClick: () => {
            revealItemInDir(savePath).catch(err => {
              console.error('Failed to reveal exported PDF:', err);
              toast.error(t('common.pdfRevealFailed'));
            });
          },
        },
      });
    } catch (error) {
      console.error('Failed to export PDF:', error);
      toast.error(t('common.pdfExportFailed'));
    }
  }, [fileHandle.kind === 'temp', currentFile, isModified, handleSave, t, fileHandleRef, currentFileRef]);

  // 原生 PNG 导出（仅 macOS）。守卫与 handleExportPdf 一致；额外在非 macOS 直接返回
  // （菜单/工具栏已置灰，这里做纵深防御）。
  const handleExportPng = useCallback(async () => {
    if (!IS_MAC) return;
    if (fileHandle.kind === 'temp') return;
    if (resolveFileEditor(currentFile)?.capabilities?.exportable === false) return;
    if (isFreeVersion) {
      import('@/utils/upgradePrompt').then(m => m.showUpgradePrompt('upgrade.features.export'));
      return;
    }
    const activeHandle = fileHandleRef.current;
    let exportPath = currentFileRef.current
      ?? (activeHandle.kind === 'persistent' ? activeHandle.path : null)
      ?? currentFile;
    if (isModified) {
      const shouldSave = await confirm(t('menu.saveBeforeExportPrompt'));
      if (!shouldSave) return;
      const savedPath = await handleSave();
      if (savedPath) exportPath = savedPath;
    }
    try {
      const savePath = await import('@/utils/export/native/png').then(m => m.exportPngToFile(exportPath));
      if (!savePath) return;
      toast.success(t('common.exportSuccess'), {
        position: 'bottom-right',
        duration: 10000,
        action: {
          label: t('common.revealInFinder'),
          onClick: () => {
            revealItemInDir(savePath).catch(err => {
              console.error('Failed to reveal exported file:', err);
              toast.error(t('common.pdfRevealFailed'));
            });
          },
        },
      });
    } catch (error) {
      console.error('Failed to export png:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (/too tall/i.test(message)) {
        toast.error(t('common.exportImageTooLarge'));
      } else {
        toast.error(t('common.exportFailed'));
      }
    }
  }, [fileHandle.kind === 'temp', currentFile, isModified, handleSave, t, fileHandleRef, currentFileRef]);

  // 导出为 HTML / EPUB / PNG。与 PDF 一致：temp 与白板文件不支持，
  // Lite 版弹升级提示，未保存先落盘（克隆依赖已挂载的编辑器与确定的文档目录）。
  const handleExport = useCallback(async (id: ExporterId) => {
    if (fileHandle.kind === 'temp') return;
    if (resolveFileEditor(currentFile)?.capabilities?.exportable === false) return;
    if (isFreeVersion) {
      import('@/utils/upgradePrompt').then(m => m.showUpgradePrompt('upgrade.features.export'));
      return;
    }
    const exporter = getExporter(id);
    if (!exporter) return;

    const activeHandle = fileHandleRef.current;
    let exportPath = currentFileRef.current
      ?? (activeHandle.kind === 'persistent' ? activeHandle.path : null)
      ?? currentFile;
    if (isModified) {
      const shouldSave = await confirm(t('menu.saveBeforeExportPrompt'));
      if (!shouldSave) return;
      const savedPath = await handleSave();
      if (savedPath) exportPath = savedPath;
    }

    const documentDir = exportPath && /[/\\]/.test(exportPath)
      ? exportPath.replace(/[/\\][^/\\]*$/, '')
      : null;
    try {
      // 唯一的导出入口：runExport 内部已包单飞锁（并发导出会互相拆除对方的
      // #texto-print-overlay，导致其中一次捕获到空内容）。锁必须包住整个 run ——
      // overlay 要活到 HTML/EPUB 产物生成结束（见 overlay.ts 的注释）。
      const outcome = await runExport(id, { currentFile: exportPath, documentDir });
      if (!outcome.ran) return;
      const savePath = await saveExport(exporter, outcome.value);
      if (!savePath) return;
      toast.success(t('common.exportSuccess'), {
        position: 'bottom-right',
        duration: 10000,
        action: {
          label: t('common.revealInFinder'),
          onClick: () => {
            revealItemInDir(savePath).catch(err => {
              console.error('Failed to reveal exported file:', err);
              toast.error(t('common.pdfRevealFailed'));
            });
          },
        },
      });
    } catch (error) {
      console.error(`Failed to export ${id}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      if (/too tall/i.test(message)) {
        toast.error(t('common.exportImageTooLarge'));
      } else {
        toast.error(t('common.exportFailed'));
      }
    }
  }, [fileHandle.kind, currentFile, isModified, handleSave, t, fileHandleRef, currentFileRef]);

  // 打印（原生打印面板；仅 macOS 支持，其他平台不注册 print_webview）
  const handlePrint = useCallback(async () => {
    if (!IS_MAC) return;
    if (fileHandle.kind === 'temp') return;
    // 白板在任意版本都不支持打印，与导出 PDF 一样统一在此静默拦截
    if (resolveFileEditor(currentFile)?.capabilities?.exportable === false) return;
    if (isFreeVersion) {
      import('@/utils/upgradePrompt').then(m => m.showUpgradePrompt('upgrade.features.pdfExport'));
      return;
    }
    // 用 ref 取最新路径：菜单事件可能经由较早注册的回调进来，闭包里的
    // currentFile 可能是旧值，打印作业名会退化成上一个文档名。
    const activeHandle = fileHandleRef.current;
    const printPath = currentFileRef.current
      ?? (activeHandle.kind === 'persistent' ? activeHandle.path : null)
      ?? currentFile;
    try {
      // 打印的是当前 DOM 内容（含未保存的修改），因此无需先保存文件
      logger.log('[App] Print requested:', printPath);
      await import('@/utils/export/native/print').then(m => m.printDocument(printPath));
    } catch (error) {
      console.error('Failed to print:', error);
      toast.error(t('common.printFailed'));
    }
  }, [fileHandle.kind === 'temp', currentFile, t, fileHandleRef, currentFileRef]);

  return { handleCloseToolbar, handleExportPdf, handleExportPng, handleExport, handlePrint };
}
