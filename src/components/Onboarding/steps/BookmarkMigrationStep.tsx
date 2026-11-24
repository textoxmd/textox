import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showGlassDialog } from '@/components/GlassDialog';
import { cn } from '@/lib/utils';

const MAX_DIR_BOOKMARKS = 10;
const MAX_SUGGESTIONS = 5;
const RECENT_ITEMS_KEY = 'texto:recent-items';

interface BookmarkEntry {
  path: string;
  kind: 'file' | 'directory';
  valid: boolean;
  resolvedPath?: string | null;
}

interface Suggestion {
  path: string;
  status: 'pending' | 'error';
}

function truncateTail(path: string, max = 56): string {
  if (path.length <= max) return path;
  return '…' + path.slice(-(max - 1));
}

function isCoveredBy(path: string, dirBookmarks: string[]): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '');
  const p = norm(path);
  return dirBookmarks.some((d) => {
    const dd = norm(d);
    return p === dd || p.startsWith(dd + '/') || p.startsWith(dd + '\\');
  });
}

function loadRecentItems(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function BookmarkMigrationStep() {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [authorizedDirs, setAuthorizedDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bookmarks = await invoke<BookmarkEntry[]>('list_bookmarks');
        const dirBookmarks = bookmarks.filter((b) => b.kind === 'directory').map((b) => b.path);
        if (cancelled) return;
        setAuthorizedDirs(dirBookmarks);

        const candidates: Suggestion[] = [];
        for (const item of loadRecentItems()) {
          if (candidates.length >= MAX_SUGGESTIONS) break;
          if (isCoveredBy(item, dirBookmarks)) continue;
          let isDirectory = false;
          try {
            const type = await invoke<string>('check_path_type', { path: item });
            isDirectory = type === 'directory';
          } catch {
            // 沙盒下未授权目录无法 stat：仍作为候选，
            // 授权时系统选择器会做最终确认
            isDirectory = true;
          }
          if (!isDirectory) continue;
          candidates.push({ path: item, status: 'pending' });
        }
        if (!cancelled) setSuggestions(candidates);
      } catch {
        // 读取失败时保持空建议，用户仍可手动添加
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const authorize = async (path: string) => {
    if (busyPath) return;
    setBusyPath(path);
    try {
      // macOS 沙盒要求：先通过系统目录选择器确认授权（获得临时访问权），
      // 再创建 security-scoped bookmark，否则直接对历史路径建书签会失败。
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: path,
      });
      if (!selected || typeof selected !== 'string') return; // 用户取消：保持待授权
      await invoke('create_bookmark', { path: selected });
      setAuthorizedDirs((prev) =>
        prev.includes(selected) ? prev : [...prev, selected],
      );
      setSuggestions((prev) => prev.filter((s) => s.path !== path));
    } catch {
      setSuggestions((prev) =>
        prev.map((s) => (s.path === path ? { ...s, status: 'error' as const } : s)),
      );
    } finally {
      setBusyPath(null);
    }
  };

  const addFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== 'string') return;
      await invoke('create_bookmark', { path: selected });
      setAuthorizedDirs((prev) => (prev.includes(selected) ? prev : [...prev, selected]));
    } catch {
      // 用户取消或授权失败，保持现状
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
      setAuthorizedDirs((prev) => prev.filter((p) => p !== path));
    } catch (error) {
      console.error('Failed to remove bookmark:', error);
    }
  };

  const dirLimitReached = authorizedDirs.length >= MAX_DIR_BOOKMARKS;
  const pending = suggestions;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{t('settings.bookmarkManagement')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.bookmarks.desc')}</p>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {t('onboarding.bookmarks.existingCount', {
            count: authorizedDirs.length,
          })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="w-fit gap-1.5"
            onClick={addFolder}
            disabled={dirLimitReached}
            title={dirLimitReached ? t('settings.bookmarkDirLimitReached') : undefined}
          >
            <Plus className="size-4" />
            {t('settings.bookmarkAdd')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <>
          {authorizedDirs.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t('settings.bookmarkDirSection')}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {authorizedDirs.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {authorizedDirs.map((path) => (
                  <span
                    key={path}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-border py-1 pl-2.5 pr-1.5 text-xs leading-5 text-muted-foreground hover:bg-muted/60"
                    title={path}
                  >
                    <span className="max-w-[260px] truncate font-mono font-light" dir="ltr">
                      {truncateTail(path)}
                    </span>
                    <button
                      type="button"
                      className="p-0.5 leading-none text-muted-foreground hover:text-destructive"
                      title={t('settings.bookmarkRemove')}
                      aria-label={t('settings.bookmarkRemove')}
                      onClick={() => void handleRemove(path)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t('onboarding.bookmarks.suggest')}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {pending.length}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {pending.map((s) => (
                  <span
                    key={s.path}
                    className={cn(
                      'inline-flex max-w-full items-center gap-1 rounded-md border py-1 pl-2.5 pr-1.5 text-xs leading-5 text-muted-foreground hover:bg-muted/60',
                      s.status === 'error'
                        ? 'border-[var(--settings-error-border)] bg-[var(--settings-error-bg)] text-[var(--settings-error-text)]'
                        : 'border-border',
                    )}
                    title={s.path}
                  >
                    <span className="max-w-[240px] truncate font-mono font-light" dir="ltr">
                      {truncateTail(s.path)}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        'p-0.5 leading-none',
                        s.status === 'error'
                          ? 'text-[var(--settings-error-text)] hover:text-destructive'
                          : 'text-primary hover:text-primary/80',
                      )}
                      title={t('onboarding.bookmarks.authorize')}
                      aria-label={t('onboarding.bookmarks.authorize')}
                      disabled={dirLimitReached || !!busyPath}
                      onClick={() => void authorize(s.path)}
                    >
                      +
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {pending.length === 0 && authorizedDirs.length === 0 && (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border px-4 py-5">
              <p className="text-sm text-muted-foreground">{t('onboarding.bookmarks.empty')}</p>
            </div>
          )}

          {authorizedDirs.length > 0 && pending.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t('onboarding.bookmarks.addFolderDesc')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
