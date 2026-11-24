import type { ReactElement } from 'react';
import { Search, ShieldAlert } from 'lucide-react';

import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { isBuiltinPluginId, type RuntimeEntry } from '@/plugins/runtime/index';

import { PluginRow } from './PluginRow';
import { pluginDisplayDescription, pluginDisplayName } from './pluginText';

export interface PluginListViewProps {
  entries: readonly RuntimeEntry[];
  /** `plugins.json` 的来源记录；读取失败（或尚未加载）时为 undefined，全部按本地处理。 */
  seeded: Record<string, { version: string; origin: string }> | undefined;
  safeMode: boolean;
  /** 有请求在途的插件 id（行内开关禁用）。 */
  busyId: string | null;
  query: string;
  origin: 'all' | 'seed' | 'user';
  importing: boolean;
  onQueryChange(next: string): void;
  onOriginChange(next: 'all' | 'seed' | 'user'): void;
  onOpen(id: string): void;
  onToggle(id: string, next: boolean): void;
  onDisableSafeMode(): void;
  onImport(): void;
}

const ORIGIN_FILTERS: ReadonlyArray<{ value: 'all' | 'seed' | 'user'; label: string }> = [
  { value: 'all', label: 'filterAll' },
  { value: 'seed', label: 'filterSeed' },
  { value: 'user', label: 'filterUser' },
];

const FILTER_LABELS: Record<'all' | 'seed' | 'user', string> = {
  all: '全部',
  seed: '内置',
  user: '本地',
};

/** 来源判定与旧面板一致：播种记录里 origin 为 `seed` 才算内置，其余都是本地。 */
function originOf(
  entry: RuntimeEntry,
  seeded: PluginListViewProps['seeded'],
): 'seed' | 'user' {
  return seeded?.[entry.id]?.origin === 'seed' ? 'seed' : 'user';
}

/** 搜索匹配：id / 名称 / 描述，大小写不敏感（描述可为空）。 */
function matchesQuery(entry: RuntimeEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.id,
    pluginDisplayName(entry),
    pluginDisplayDescription(entry),
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * 插件管理的列表视图：标题/计数、搜索、导入入口、来源筛选、安全模式横幅与插件行列表。
 *
 * 纯展示组件：状态（查询串、来源筛选、安全模式开关、导入/启停请求）都由容器持有，
 * 二次确认也在容器侧做，这里只回调。
 */
export function PluginListView({
  entries,
  seeded,
  safeMode,
  busyId,
  query,
  origin,
  importing,
  onQueryChange,
  onOriginChange,
  onOpen,
  onToggle,
  onDisableSafeMode,
  onImport,
}: PluginListViewProps): ReactElement {
  const enabledCount = entries.reduce((count, entry) => count + (entry.enabled ? 1 : 0), 0);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = entries.filter(
    (entry) => (origin === 'all' || originOf(entry, seeded) === origin) && matchesQuery(entry, normalizedQuery),
  );

  return (
    <section className="flex flex-col gap-4" data-slot="plugin-list-view">
      {safeMode && (
        <div
          data-slot="plugin-safe-mode-banner"
          className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3"
          role="status"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-warning">
              {i18n.t('settings.pluginManager.safeModeTitle', '安全模式已开启')}
            </div>
            <div className="settings-item-description">
              {i18n.t(
                'settings.pluginManager.safeModeDesc',
                '仅允许 Textox 官方插件运行，第三方插件无法启用',
              )}
            </div>
          </div>
          <Button variant="outline" onClick={onDisableSafeMode}>
            {i18n.t('settings.pluginManager.disableSafeMode', '关闭安全模式')}
          </Button>
        </div>
      )}

      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>
            {i18n.t('settings.pluginManager.installedTitle', '已安装插件')}
          </CardTitle>
          <CardAction>
            <span className="text-muted-foreground text-xs" data-slot="plugin-enabled-count">
              {i18n.t('settings.pluginManager.enabledCount', {
                defaultValue: '已启用 {{enabled}} / {{total}}',
                enabled: enabledCount,
                total: entries.length,
              })}
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                type="search"
                data-slot="plugin-search-input"
                className="pl-8"
                value={query}
                placeholder={i18n.t('settings.pluginManager.searchPlaceholder', '搜索插件')}
                aria-label={i18n.t('settings.pluginManager.searchPlaceholder', '搜索插件')}
                onChange={(event) => onQueryChange(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={importing}
              aria-busy={importing}
              data-slot="plugin-import"
              onClick={onImport}
            >
              {i18n.t('settings.pluginManager.import', '导入插件')}
            </Button>
          </div>

          <div className="flex items-center gap-1" data-slot="plugin-origin-filter">
            {ORIGIN_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={origin === filter.value}
                className={`h-6 rounded-full px-2.5 text-xs transition-colors ${
                  origin === filter.value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                onClick={() => onOriginChange(filter.value)}
              >
                {i18n.t(`settings.pluginManager.${filter.label}`, FILTER_LABELS[filter.value])}
              </button>
            ))}
          </div>

          {visible.length > 0 ? (
            <div className="plugin-card-grid" data-slot="plugin-list">
              {visible.map((entry) => (
                <PluginRow
                  key={entry.id}
                  entry={entry}
                  origin={originOf(entry, seeded)}
                  enabled={entry.enabled}
                  locked={safeMode && !isBuiltinPluginId(entry.id)}
                  busy={busyId === entry.id}
                  onOpen={() => onOpen(entry.id)}
                  onToggle={(next) => onToggle(entry.id, next)}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm" data-slot="plugin-list-empty">
              {entries.length === 0
                ? i18n.t(
                    'settings.pluginManager.emptyInstalled',
                    '尚未安装任何插件，点击「导入插件」添加。',
                  )
                : i18n.t('settings.pluginManager.emptySearch', '没有匹配的插件')}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
