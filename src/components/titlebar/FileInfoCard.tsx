import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import { Copy, FolderSearch } from 'lucide-react';

import type { FileMetadata } from '@/utils/externalChange';
import { useWordCount } from '@/hooks/useWordCount';
import { detectNewline, formatFileSize, formatModifiedAt } from './format';

export interface FileInfoCardProps {
  /** 完整文件名（含扩展名），标题栏的 displayTitle */
  fileName: string;
  /** 文档绝对路径；临时文件为 null */
  filePath: string | null;
  isTemp: boolean;
  /** 用于行数 / 字数 / 换行符统计的全文 */
  content: string;
}

/**
 * 标题栏文件信息卡片的内部内容。
 *
 * 只在 Popup 展开时挂载（Base UI 关闭即卸载），因此这里的
 * `get_file_metadata` 与字数统计都是惰性的，不影响编辑路径。
 */
export function FileInfoCard({ fileName, filePath, isTemp, content }: FileInfoCardProps) {
  const { t, i18n } = useTranslation();
  const [meta, setMeta] = useState<FileMetadata | null>(null);
  const stats = useWordCount(content);

  const unavailable = t('titlebar.fileInfo.unavailable', '—');

  useEffect(() => {
    // 切换文档时先清空，避免 stat 未返回前显示上一个文件的大小与时间。
    setMeta(null);
    if (isTemp || !filePath) return;
    let cancelled = false;
    invoke<FileMetadata>('get_file_metadata', { path: filePath })
      .then((value) => {
        if (!cancelled) setMeta(value);
      })
      .catch(() => {
        // 文件可能已被外部删除：静默降级为破折号，不打扰用户。
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, isTemp]);

  const lineCount = useMemo(() => (content ? content.split('\n').length : 0), [content]);
  const newline = useMemo(() => detectNewline(content), [content]);

  const sizeText = formatFileSize(meta?.size) ?? unavailable;
  const modifiedText = formatModifiedAt(meta?.mtimeMs, i18n.language) ?? unavailable;

  const lineCountText = t('titlebar.fileInfo.lineCount', {
    count: lineCount,
    defaultValue: '{{count, number}} 行',
  });
  const wordCountText = t('titlebar.fileInfo.wordCount', {
    count: stats.wordCount,
    defaultValue: '{{count, number}} 字',
  });
  const charCountText = t('titlebar.fileInfo.charCount', {
    count: stats.charWithSpaces,
    defaultValue: '{{count, number}} 字符',
  });

  const copyPath = async () => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      toast.success(t('titlebar.fileInfo.pathCopied', '已复制路径'));
    } catch {
      toast.error(t('titlebar.fileInfo.copyFailed', '复制失败'));
    }
  };

  const revealInFileManager = () => {
    if (!filePath) return;
    void revealItemInDir(filePath).catch((error: unknown) => {
      console.warn('[FileInfoCard] revealItemInDir failed', error);
    });
  };

  const copyLabel = t('titlebar.fileInfo.copyPath', '复制路径');
  const revealLabel = t('common.revealInFinder');

  return (
    <div className="titlebar-file-info">
      <div className="titlebar-file-info-name">{fileName}</div>

      {isTemp ? (
        <div className="titlebar-file-info-path-row">
          <span className="titlebar-file-info-path titlebar-file-info-path-temp">
            {t('titlebar.fileInfo.unsaved', '未保存')}
          </span>
        </div>
      ) : (
        <div className="titlebar-file-info-path-row">
          {/* direction: rtl 让溢出发生在左侧（从尾部省略），bdi 保证路径本身不被重排 */}
          <span className="titlebar-file-info-path" title={filePath ?? ''}>
            <bdi>{filePath}</bdi>
          </span>
          <button
            type="button"
            className="titlebar-file-info-action"
            onClick={copyPath}
            aria-label={copyLabel}
            title={copyLabel}
          >
            <Copy size={15} strokeWidth={1.4} aria-hidden />
          </button>
          <button
            type="button"
            className="titlebar-file-info-action"
            onClick={revealInFileManager}
            aria-label={revealLabel}
            title={revealLabel}
          >
            <FolderSearch size={15} strokeWidth={1.4} aria-hidden />
          </button>
        </div>
      )}

      <div className="titlebar-file-info-divider" />

      <dl className="titlebar-file-info-rows">
        <div className="titlebar-file-info-row">
          {isTemp ? (
            <dt aria-hidden="true" />
          ) : (
            <dt>{t('titlebar.fileInfo.size', '大小')}</dt>
          )}
          <dd>{isTemp ? lineCountText : `${sizeText} · ${lineCountText}`}</dd>
        </div>
        <div className="titlebar-file-info-row">
          <dt aria-hidden="true" />
          <dd>{`${wordCountText} · ${charCountText}`}</dd>
        </div>
        <div className="titlebar-file-info-row">
          <dt>{t('titlebar.fileInfo.modified', '修改时间')}</dt>
          <dd>{modifiedText}</dd>
        </div>
        <div className="titlebar-file-info-row">
          <dt>{t('titlebar.fileInfo.encoding', '编码')}</dt>
          <dd>{`UTF-8 · ${newline}`}</dd>
        </div>
      </dl>
    </div>
  );
}
