import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { showGlassDialog } from '@/components/GlassDialog';
import { cn } from '@/lib/utils';
import { IS_WINDOWS } from '@/utils/windowManager';

/** 目录授权数量上限（与后端 MAX_DIRECTORY_BOOKMARKS 保持一致）。 */
const MAX_DIR_BOOKMARKS = 10;

interface BookmarkEntry {
  path: string;
  kind: 'file' | 'directory';
  valid: boolean;
  resolvedPath?: string | null;
}

/** 长路径优先显示尾部（前面的部分用省略号代替）。 */
function truncateTail(path: string, max = 72): string {
  if (path.length <= max) return path;
  return '…' + path.slice(-(max - 1));
}

function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(0, idx) : path;
}

/**
 * 设置窗口的「添加位置」页面。
 *
 * 按「目录授权 / 文件授权」分组，以可删除的标签形式展示用户授权过的位置；
 * 失效标签点击会在系统文件管理器中打开该目录，并弹出重新授权选择器；删除需要二次确认。
 */
export function BookmarkManagerSettings() {
  const { t } = useTranslation();
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBookmarks = useCallback(async () => {
    try {
      const items = await invoke<BookmarkEntry[]>('list_bookmarks');
      setBookmarks(items ?? []);
    } catch (error) {
      console.error('Failed to load bookmarks:', error);
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  const grantFolder = useCallback(async (defaultPath?: string) => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
      title: t('settings.bookmarkAddDirTitle'),
    });
    if (!selected || typeof selected !== 'string') return false;
    // 启动访问与 asset 扩权由后端 create_bookmark 统一处理
    await invoke('create_bookmark', { path: selected });
    return true;
  }, [t]);

  const handleAdd = async () => {
    try {
      if (await grantFolder()) {
        toast.success(t('settings.bookmarkAddSuccess'));
        await loadBookmarks();
      }
    } catch (error) {
      console.error('Failed to add bookmark:', error);
      toast.error(t('settings.bookmarkAddFailed'));
    }
  };

  /** 失效位置：点击先在系统文件管理器中打开该目录，再拉起目录选择器重新授权。 */
  const handleReauthorize = async (entry: BookmarkEntry) => {
    const target = entry.resolvedPath ?? entry.path;
    try {
      // 先在文件管理器中打开对应目录，方便确认位置（失败不阻断重新授权流程）
      await openPath(entry.kind === 'file' ? dirnameOf(target) : target).catch((error) => {
        console.warn('Failed to open directory in file manager:', error);
      });
      if (await grantFolder(entry.kind === 'file' ? dirnameOf(target) : target)) {
        toast.success(t('settings.bookmarkAddSuccess'));
        await loadBookmarks();
      }
    } catch (error) {
      console.error('Failed to re-authorize location:', error);
      toast.error(t('settings.bookmarkAddFailed'));
    }
  };

  const handleRemove = async (path: string) => {
    const result = await showGlassDialog<'cancel' | 'remove'>({
      title: t('settings.bookmarkRemoveTitle'),
      content: t('settings.bookmarkRemoveConfirm'),
      buttons: [
        { text: t('common.cancel'), variant: 'secondary', value: 'cancel' as const },
        { text: t('settings.bookmarkRemove'), variant: 'primary', value: 'remove' as const },
      ],
    });
    if (result !== 'remove') return;
    try {
      await invoke('clear_bookmarks', { paths: [path] });
      toast.success(t('settings.bookmarkRemoveSuccess'));
      await loadBookmarks();
    } catch (error) {
      console.error('Failed to remove bookmark:', error);
      toast.error(t('settings.bookmarkRemoveFailed'));
    }
  };

  const dirs = bookmarks.filter((b) => b.kind === 'directory');
  const files = bookmarks.filter((b) => b.kind === 'file');
  const dirLimitReached = dirs.length >= MAX_DIR_BOOKMARKS;

  if (IS_WINDOWS) return null;

  if (loading) {
    return (
      <Card className="flex-shrink-0 bg-background ring-0">
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('settings.bookmarkLoading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t('settings.bookmarkDirSection')}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {dirs.length}
            </span>
          </CardTitle>
          <p className="settings-item-description">
            {t('settings.bookmarkManagementDesc')}
          </p>
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="w-fit gap-1.5"
              disabled={dirLimitReached}
              title={dirLimitReached ? t('settings.bookmarkDirLimitReached') : undefined}
              onClick={() => void handleAdd()}
            >
              <Plus className="size-4" />
              {t('settings.bookmarkAdd')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {dirs.map((entry) => (
            <BookmarkTag
              key={entry.path}
              entry={entry}
              t={t}
              onReauthorize={handleReauthorize}
              onRemove={handleRemove}
            />
          ))}
        </CardContent>
      </Card>

      <hr className="border-t border-border/60 mx-4" />

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t('settings.bookmarkFileSection')}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {files.length}
            </span>
          </CardTitle>
          <p className="settings-item-description">
            {t('settings.bookmarkFileDesc')}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {files.map((entry) => (
            <BookmarkTag
              key={entry.path}
              entry={entry}
              t={t}
              onReauthorize={handleReauthorize}
              onRemove={handleRemove}
            />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function BookmarkTag({
  entry,
  t,
  onReauthorize,
  onRemove,
}: {
  entry: BookmarkEntry;
  t: (key: string) => string;
  onReauthorize: (entry: BookmarkEntry) => void;
  onRemove: (path: string) => void;
}) {
  const display = entry.resolvedPath ?? entry.path;
  const clickable = !entry.valid;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border py-1 pl-2.5 pr-1.5 text-xs leading-5',
        clickable
          ? 'cursor-pointer border-[var(--settings-error-border)] bg-[var(--settings-error-bg)] text-[var(--settings-error-text)] hover:border-destructive hover:bg-destructive/20 active:bg-destructive/25'
          : 'border-border text-muted-foreground hover:bg-muted/60',
      )}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? t('settings.bookmarkReauthHint') : display}
      onClick={clickable ? () => onReauthorize(entry) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onReauthorize(entry);
              }
            }
          : undefined
      }
    >
      <span className="max-w-[260px] truncate font-mono font-light" title={display}>
        {truncateTail(display, 56)}
      </span>
      <button
        type="button"
        className="p-0.5 leading-none text-muted-foreground hover:text-destructive"
        title={t('settings.bookmarkRemove')}
        aria-label={t('settings.bookmarkRemove')}
        onClick={(e) => {
          e.stopPropagation();
          void onRemove(entry.path);
        }}
      >
        ×
      </button>
    </span>
  );
}
