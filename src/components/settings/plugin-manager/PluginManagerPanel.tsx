import { useCallback, useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';

import i18n from '@/i18n';
import {
  disablePlugin,
  enablePlugin,
  installPluginFromFile,
  isBuiltinPluginId,
  pluginState,
  refreshPlugins,
  stopPlugin,
  uninstallPlugin,
  type RuntimeEntry,
} from '@/plugins/runtime/index';
import { pluginIpc, type PluginStateDto } from '@/plugins/runtime/ipc';

import { PluginDetailView } from './PluginDetailView';
import { PluginListView } from './PluginListView';
import { usePluginSettings } from './usePluginSettings';

/** 稳定引用：空列表必须复用同一常量，否则 `useSyncExternalStore` 会无限重渲染。 */
const EMPTY_ENTRIES: readonly RuntimeEntry[] = [];

function subscribeState(callback: () => void): () => void {
  return pluginState.subscribe(callback);
}

/**
 * 插件管理（设置 → 插件）的容器：持有「列表 / 详情」两态与全部数据访问。
 *
 * 列表与详情是两个纯展示组件：查询串、来源筛选、二次确认、启停/导入/卸载请求
 * 都在这里，展示组件只回调。设置值走 `usePluginSettings`（读盘序号防过期、
 * `plugin:data-changed` 只重读当前详情）。
 *
 * 开关的勾选态取**持久化字段** `entry.enabled`（不是 `status`）：持久化已启用但加载失败的
 * 插件必须显示为「开」，否则用户点按时会再次写 `enabled: true`，永远关不掉它。
 *
 * 每行的「来源」来自 `plugins.json` 的 `seeded[id].origin`：`seed` 是应用出厂播种
 * （可「恢复出厂」），`user` 是本地导入（可卸载）。
 */
export function PluginManagerPanel(): ReactElement {
  const entries = useSyncExternalStore(
    subscribeState,
    () => pluginState.list(),
    () => EMPTY_ENTRIES,
  );
  const initialized = useSyncExternalStore(
    subscribeState,
    () => pluginState.isInitialized(),
    () => false,
  );
  const storedSafeMode = useSyncExternalStore(
    subscribeState,
    () => pluginState.isSafeMode(),
    () => true,
  );
  /** `plugins.json` 全量状态（安全模式 + 播种/卸载记录）；读取失败时为 null。 */
  const [state, setState] = useState<PluginStateDto | null>(null);
  const safeMode = state?.safe_mode ?? storedSafeMode;

  useEffect(() => {
    void pluginIpc
      .getState()
      .then((next) => setState(next))
      .catch(() => {});
  }, []);

  /** 面板层防并发：同一个插件在启停/卸载/恢复请求返回前禁用其行内操作。 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<'all' | 'seed' | 'user'>('all');

  const settings = usePluginSettings(entries, view === 'detail' ? selectedId : null);

  // 选中的插件被卸载 / 重扫掉（本窗口或其它窗口触发）：自动回列表，不停在空详情页。
  useEffect(() => {
    if (view !== 'detail') return;
    if (entries.some((entry) => entry.id === selectedId)) return;
    setView('list');
    setSelectedId(null);
  }, [entries, selectedId, view]);

  const originOf = useCallback(
    (entry: RuntimeEntry): 'seed' | 'user' =>
      state?.seeded?.[entry.id]?.origin === 'seed' ? 'seed' : 'user',
    [state],
  );

  /**
   * 「重装内置版本」只在**内置插件被本地版本覆盖**时出现：`seeded[id]` 存在说明该 id
   * 出厂时随应用提供，`origin: user` 说明当前磁盘上是用户导入的覆盖版。纯出厂插件
   * 没有「重装」的语义（版本已与资源目录一致），重新播种也不会改变任何东西。
   */
  const canReinstall = useCallback(
    (entry: RuntimeEntry): boolean =>
      Boolean(state?.seeded?.[entry.id]) && state?.seeded?.[entry.id]?.origin === 'user',
    [state],
  );

  async function handleImport(): Promise<void> {
    setImporting(true);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Plugin package', extensions: ['zip'] }],
      });
      const path = typeof selected === 'string' ? selected : selected?.[0];
      if (!path) return;
      await installPluginFromFile(path);
      toast.success('已导入插件');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  /** 启停单个插件：成功后运行时自己同步快照，失败只提示（勾选态仍取 `entry.enabled`）。 */
  async function handleToggle(id: string, next: boolean): Promise<void> {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    setBusyId(id);
    try {
      if (next) await enablePlugin(entry);
      else await disablePlugin(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * 关闭安全模式：第三方插件从此可以运行任意代码，必须二次确认。
   * 后端返回的状态做防御性合并（即便将来裁剪返回体，也不丢已有的来源记录）。
   */
  async function handleDisableSafeMode(): Promise<void> {
    if (
      !window.confirm('关闭安全模式？关闭后第三方插件可以运行任意代码，请只安装你信任的插件。')
    ) {
      return;
    }
    setBusyId('__safe-mode__');
    try {
      const nextState = await pluginIpc.setSafeMode(false);
      setState((prev) => ({ ...(prev ?? { safe_mode: false, enabled: [] }), ...nextState }));
      await refreshPlugins();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  /** 恢复出厂插件：清墓碑后重新播种，再刷新扫描与状态（来源可能变回 seed）。 */
  async function handleRestore(entry: RuntimeEntry): Promise<void> {
    if (!window.confirm(`重装内置版本 ${entry.id}？插件目录会被重新写入`)) return;
    setBusyId(entry.id);
    try {
      // 目录会被重写：先停掉运行中的实例，否则面板显示「已启用」但跑的是旧模块，
      // 恢复后也要重启应用才会重新加载新内容。
      await stopPlugin(entry.id);
      await pluginIpc.restoreBuiltin(entry.id);
      await refreshPlugins();
      setState(await pluginIpc.getState());
      toast.success(`已重装内置版本 ${entry.id}`);
      toast.info('编辑器窗口需重启 Textox 后加载该插件');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  /** 卸载本地插件：确认后停实例 + 删目录 + 重扫，然后回到列表（详情已不存在）。 */
  async function handleUninstall(entry: RuntimeEntry): Promise<void> {
    if (!window.confirm(`卸载 ${entry.id}？插件目录会被删除`)) return;
    setBusyId(entry.id);
    try {
      await uninstallPlugin(entry.id);
      toast.success(`已卸载 ${entry.id}`);
      setSelectedId(null);
      setView('list');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  function openDetail(id: string): void {
    setSelectedId(id);
    setView('detail');
  }

  function backToList(): void {
    setSelectedId(null);
    setView('list');
  }

  if (view === 'detail') {
    const entry = entries.find((candidate) => candidate.id === selectedId) ?? null;
    // 选中的插件已被卸载 / 重扫掉：上面的 effect 会把视图切回列表，这里不渲染过期的详情。
    if (!entry) return <></>;
    return (
      <PluginDetailView
        entry={entry}
        origin={originOf(entry)}
        settings={settings}
        busy={busyId === entry.id}
        locked={safeMode && !isBuiltinPluginId(entry.id)}
        canReinstall={canReinstall(entry)}
        onBack={backToList}
        onToggle={(next) => void handleToggle(entry.id, next)}
        onRestore={() => void handleRestore(entry)}
        onResetSettings={() => {
          void settings.resetToDefaults(entry.id).then((done) => {
            if (done) {
              toast.success(
                i18n.t('settings.pluginManager.resetDefaultsDone', '已恢复默认设置'),
              );
            }
          });
        }}
        onUninstall={() => void handleUninstall(entry)}
      />
    );
  }

  if (!initialized) {
    return (
      <p className="text-sm text-muted-foreground" data-slot="plugin-runtime-loading">
        {i18n.t('settings.pluginManager.loading', '插件运行时加载中…')}
      </p>
    );
  }

  return (
    <PluginListView
      entries={entries}
      seeded={state?.seeded}
      safeMode={safeMode}
      busyId={busyId}
      query={query}
      origin={origin}
      importing={importing}
      onQueryChange={setQuery}
      onOriginChange={setOrigin}
      onOpen={openDetail}
      onToggle={(id, next) => void handleToggle(id, next)}
      onDisableSafeMode={() => void handleDisableSafeMode()}
      onImport={() => void handleImport()}
    />
  );
}
