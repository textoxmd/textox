import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ArrowLeft, Copy, LayoutGrid, List, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PluginSettingsFields } from '@/components/settings/PluginSettingsFields';
import { createPluginHost, NOOP_HOST_DEPS } from '@/plugins/host';
import { writePluginConfig } from '@/plugins/configSync';
import { floatParams } from '@/plugins/pluginFloat';
import { PluginGlyph, prefetchPluginIcons } from '@/plugins/pluginIcon';
import type { TextoPlugin } from '@/plugins/types';
import {
  getContributionsWithOwner,
  isKnownCategory,
  isOfficialPlugin,
  PLUGIN_CATEGORIES,
  type PluginCategory,
} from '@texto/plugin-sdk';
import {
  APP_SETTINGS_SECTION,
  applySettingsDefaults,
  type SettingsActionField,
  type SettingsField,
  type SettingsSection,
} from '@texto/app-api';

export interface PluginSettingsPanelProps {
  plugins: TextoPlugin[];
  /** 启用状态（由父组件持久化） */
  enabled: Record<string, boolean>;
  /** 切换启用；父组件负责重启提示等副作用 */
  onToggle(pluginId: string, next: boolean): void;
}

/** 未声明分类的插件归入的默认分组。 */
const DEFAULT_GROUP = '__default__';

/** 插件中心视图模式；纯 UI 偏好，仅存 localStorage（不带版本前缀）。 */
const VIEW_MODE_STORAGE_KEY = 'texto:plugins-view-mode';
type PluginViewMode = 'list' | 'grid';

function readStoredViewMode(): PluginViewMode {
  try {
    // 默认网格视图；仅当用户显式选择过「列表」时才回退为列表。
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** 列表行的错峰入场延迟：每项 +20ms，封顶 140ms。 */
function rowAnimationDelay(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index * 20, 140)}ms` };
}

/** 紧凑方块的错峰入场延迟：每项 +28ms（与引导页一致，不封顶）。 */
function tileAnimationDelay(index: number): { animationDelay: string } {
  return { animationDelay: `${index * 28}ms` };
}

/**
 * 当前有效配置是否已偏离字段默认值——用于决定是否展示「恢复默认值」。
 * 按已声明默认值的字段逐项比较（跳过 `preset` / `action`）。
 */
function isConfigChangedFromDefaults(
  fields: SettingsField[],
  stored: Record<string, unknown>,
): boolean {
  const effective = applySettingsDefaults(fields, stored);
  const defaults = applySettingsDefaults(fields, {});
  return fields.some(
    (field) =>
      field.type !== 'action' &&
      field.type !== 'preset' &&
      field.default !== undefined &&
      effective[field.key] !== defaults[field.key],
  );
}

/**
 * 从节点向上找到第一个可滚动的祖先。插件列表与二级页共用 SettingsWindow 的
 * 内容区滚动容器（`.settings-content`），切换视图时需手动管理其滚动位置。
 */
function findScrollParent(el: Element | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** 固定分类 → i18n key（app 命名空间）。 */
const CATEGORY_LABEL_KEYS: Record<PluginCategory, string> = {
  llm: 'settings.categoryLlm',
  editor: 'settings.categoryEditor',
  export: 'settings.categoryExport',
  'image-hosting': 'settings.categoryImageHosting',
};

/**
 * 「插件」设置分类的 UI：按 categoryKey 分组的卡片列表 + 二级设置页。
 *
 * 独立于 SettingsWindow（窗口壳/分类导航），便于聚焦测试。插件配置读写与
 * `app:settingsSection` 字段渲染都在此组件内完成；启用状态由父组件持有并
 * 通过 `onToggle` 回调（重启提示等副作用留在父组件）。
 */
export function PluginSettingsPanel({
  plugins,
  enabled,
  onToggle,
}: PluginSettingsPanelProps): ReactElement {
  const { t } = useTranslation();
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<PluginViewMode>(readStoredViewMode);
  // 逐项入场动画只在插件中心「内部切换」（视图切换 / 进出二级页）时播放。
  // 从侧边栏首次进入插件页不播放，避免每次点开都闪一下。
  const [animateItems, setAnimateItems] = useState(false);
  // 待二次确认「恢复默认值」的插件；非空时展示确认弹窗。
  const [confirmResetPlugin, setConfirmResetPlugin] = useState<TextoPlugin | null>(null);
  const [actionDetail, setActionDetail] = useState<string | null>(null);
  const [pluginConfigs, setPluginConfigs] = useState<Record<string, Record<string, unknown>>>({});
  // 列表 / 二级页各自的锚点节点：切换视图时据此定位共享滚动容器并回到顶部。
  const listAnchorRef = useRef<HTMLDivElement>(null);
  const detailAnchorRef = useRef<HTMLDivElement>(null);
  // 进入二级页前插件中心的滚动位置，返回列表时用于恢复。
  const listScrollTopRef = useRef<number | null>(null);

  // 列表与二级页共用 `.settings-content` 这一滚动容器：进入二级页从顶部开始，
  // 返回列表时恢复到进入前的位置（首次挂载无记录则回到顶部）。
  useLayoutEffect(() => {
    const scroller = findScrollParent(detailAnchorRef.current ?? listAnchorRef.current);
    if (!scroller) return;
    if (activePluginId) {
      scroller.scrollTop = 0;
      return;
    }
    scroller.scrollTop = listScrollTopRef.current ?? 0;
    listScrollTopRef.current = null;
  }, [activePluginId]);

  // 打开二级页前记住插件中心当前滚动位置。
  const openPluginDetail = (pluginId: string) => {
    listScrollTopRef.current = findScrollParent(listAnchorRef.current)?.scrollTop ?? null;
    setAnimateItems(true);
    setActivePluginId(pluginId);
  };

  const changeViewMode = (next: PluginViewMode) => {
    setAnimateItems(true);
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch (error) {
      console.error('Failed to persist plugin view mode:', error);
    }
  };
  const loadPluginConfig = useCallback(async (pluginId: string) => {
    try {
      const cfg = await invoke<Record<string, unknown>>('get_plugin_config', { pluginId });
      setPluginConfigs((prev) => ({ ...prev, [pluginId]: cfg ?? {} }));
    } catch (error) {
      console.error('Failed to load plugin config:', error);
      setPluginConfigs((prev) => ({ ...prev, [pluginId]: {} }));
    }
  }, []);
  // 依赖用拼接的 id 串：plugins 数组每次父渲染是新引用，直接依赖会重复拉取配置。
  const pluginIds = plugins.map((plugin) => plugin.id).join('|');
  // 进入面板时预取全部插件配置；选中插件时确保其配置已加载。
  useEffect(() => {
    if (activePluginId) {
      loadPluginConfig(activePluginId);
      return;
    }
    for (const plugin of plugins) loadPluginConfig(plugin.id);
  }, [activePluginId, pluginIds, loadPluginConfig]);

  // 卡片图标走 lucide 名称：本页挂载时预热，避免首次进入时的占位闪烁。
  useEffect(() => {
    prefetchPluginIcons(plugins);
  }, [plugins]);

  const persistPluginConfig = async (pluginId: string, next: Record<string, unknown>) => {
    setPluginConfigs((prev) => ({ ...prev, [pluginId]: next }));
    try {
      await writePluginConfig(pluginId, next);
    } catch (error) {
      console.error('Failed to save plugin config:', error);
      toast.error(t('common.failed'));
    }
  };

  const updatePluginConfig = (pluginId: string, key: string, value: unknown) => {
    void persistPluginConfig(pluginId, { ...(pluginConfigs[pluginId] ?? {}), [key]: value });
  };

  const updatePluginConfigPatch = (pluginId: string, patch: Record<string, unknown>) => {
    void persistPluginConfig(pluginId, { ...(pluginConfigs[pluginId] ?? {}), ...patch });
  };

  const handlePluginAction = async (plugin: TextoPlugin, field: SettingsActionField) => {
    try {
      // 清单动作（`command`）没有行内实现，由运行时面板按命令 id 分派；旧体系只处理行内 `run`
      if (!field.run) {
        console.warn('[plugin] action field without inline run', plugin.id, field.id);
        toast.error(t('common.failed'));
        return;
      }
      const host = createPluginHost(NOOP_HOST_DEPS, plugin.id);
      const res = await field.run(host, pluginConfigs[plugin.id] ?? {});
      const msg = res.messageKey ? t(res.messageKey) : undefined;
      if (res.ok) {
        if (msg) toast.success(msg);
      } else if (msg) {
        toast.error(msg);
      }
      if (res.ok && res.set) {
        await persistPluginConfig(plugin.id, res.set);
      }
      setActionDetail(res.detail ?? null);
    } catch (error) {
      console.error('Failed to run plugin action:', error);
      toast.error(t('common.failed'));
    }
  };

  const renderPluginIcon = (plugin: TextoPlugin, large = false) => (
    <span
      className={large ? 'plugin-icon plugin-icon-lg' : 'plugin-icon'}
      data-slot="plugin-icon"
      aria-hidden="true"
    >
      <PluginGlyph id={plugin.id} icon={plugin.icon} size={large ? 32 : 24} />
    </span>
  );

  const pluginSectionsOf = (plugin: TextoPlugin): SettingsSection[] =>
    getContributionsWithOwner(APP_SETTINGS_SECTION)
      .filter((c) => c.ownerId === plugin.id)
      .map((c) => c.value);

  /** 设置字段渲染统一交给受控组件（运行时插件面板复用同一份实现）。 */
  const renderPluginFields = (plugin: TextoPlugin, fields: SettingsField[]) => (
    <PluginSettingsFields
      fields={fields}
      // 依赖项可能声明在另一个 section：求值范围必须是该插件的全部字段。
      allFields={pluginSectionsOf(plugin).flatMap((section) => section.fields)}
      values={pluginConfigs[plugin.id] ?? {}}
      onChange={(key, value) => updatePluginConfig(plugin.id, key, value)}
      onChangePatch={(patch) => updatePluginConfigPatch(plugin.id, patch)}
      onAction={(field) => handlePluginAction(plugin, field)}
      t={(key, defaultValue) => (defaultValue === undefined ? t(key) : t(key, defaultValue))}
    />
  );

  // 官方徽标；第三方作者交由「作者 · 版本」元信息行展示，避免重复。
  const renderPluginBadge = (plugin: TextoPlugin) => {
    if (!isOfficialPlugin(plugin)) return null;
    return (
      <span className="plugin-badge plugin-badge-official">
        {t('settings.pluginBundled')}
      </span>
    );
  };

  const renderListActions = (plugin: TextoPlugin) => {
    const isEnabled = enabled[plugin.id] ?? plugin.defaultEnabled ?? true;
    // 「卸载」仅对显式声明为第三方的插件开放；内置（含未声明作者）只能启用/禁用。
    // 真正的插件目录安装/卸载能力落地后，这里改为按「来源」判断。
    const canUninstall = plugin.author !== undefined && !isOfficialPlugin(plugin);
    return (
      <span className="plugin-actions" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="plugin-actions-trigger"
            aria-label={t('common.settings')}
          >
            <Settings className="size-[15px]" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onToggle(plugin.id, !isEnabled)}>
              {isEnabled ? t('settings.pluginDisable') : t('settings.pluginEnable')}
            </DropdownMenuItem>
            {canUninstall && (
              <DropdownMenuItem className="text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive">
                {t('settings.pluginUninstall')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    );
  };

  const resetPluginSettings = async (plugin: TextoPlugin) => {
    const fields = pluginSectionsOf(plugin).flatMap((section) => section.fields);
    const defaults = applySettingsDefaults(fields, {});
    setPluginConfigs((prev) => ({ ...prev, [plugin.id]: defaults }));
    try {
      await writePluginConfig(plugin.id, defaults);
      toast.success(t('settings.pluginResetDone'));
    } catch (error) {
      console.error('Failed to reset plugin settings:', error);
      toast.error(t('common.failed'));
    }
  };

  const handleConfirmReset = async () => {
    const plugin = confirmResetPlugin;
    if (!plugin) return;
    setConfirmResetPlugin(null);
    await resetPluginSettings(plugin);
  };

  const renderDetailActions = (plugin: TextoPlugin) => {
    const isEnabled = enabled[plugin.id] ?? plugin.defaultEnabled ?? true;
    const canUninstall = plugin.author !== undefined && !isOfficialPlugin(plugin);
    // 框架内建的「恢复默认值」：仅当插件已启用且当前配置已偏离默认值时展示。
    const fields = pluginSectionsOf(plugin).flatMap((section) => section.fields);
    const canReset = isConfigChangedFromDefaults(fields, pluginConfigs[plugin.id] ?? {});
    return (
      <div className="flex justify-end gap-2">
        {isEnabled && canReset && (
          <Button
            variant="outline"
            title={t('settings.pluginResetDesc')}
            onClick={() => setConfirmResetPlugin(plugin)}
          >
            {t('settings.pluginReset')}
          </Button>
        )}
        <Button variant="outline" onClick={() => onToggle(plugin.id, !isEnabled)}>
          {isEnabled ? t('settings.pluginDisable') : t('settings.pluginEnable')}
        </Button>
        {canUninstall && (
          <Button variant="outline" className="text-destructive">
            {t('settings.pluginUninstall')}
          </Button>
        )}
      </div>
    );
  };

  const renderViewToggle = () => (
    <div className="flex justify-end">
      <Tabs
        value={viewMode}
        onValueChange={(value) => {
          if (value === 'list' || value === 'grid') changeViewMode(value);
        }}
      >
        <TabsList aria-label={t('settings.plugins')}>
          <TabsTrigger
            value="list"
            data-plugin-view="list"
            className="cursor-pointer"
            aria-label={t('settings.pluginViewList')}
            title={t('settings.pluginViewList')}
          >
            <List aria-hidden="true" />
          </TabsTrigger>
          <TabsTrigger
            value="grid"
            data-plugin-view="grid"
            className="cursor-pointer"
            aria-label={t('settings.pluginViewGrid')}
            title={t('settings.pluginViewGrid')}
          >
            <LayoutGrid aria-hidden="true" />
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );

  const pluginItemProps = (plugin: TextoPlugin) => ({
    role: 'button' as const,
    tabIndex: 0,
    'data-disabled': !(enabled[plugin.id] ?? plugin.defaultEnabled ?? true),
    onClick: () => openPluginDetail(plugin.id),
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPluginDetail(plugin.id);
      }
    },
  });

  const renderPluginRow = (plugin: TextoPlugin, index: number) => {
    const name = plugin.displayNameKey ? t(plugin.displayNameKey) : plugin.id;
    const description = plugin.descriptionKey ? t(plugin.descriptionKey) : '';
    const isEnabled = enabled[plugin.id] ?? plugin.defaultEnabled ?? true;
    return (
      <div
        key={plugin.id}
        {...pluginItemProps(plugin)}
        data-slot="plugin-row"
        className="plugin-row"
        style={rowAnimationDelay(index)}
      >
        {renderPluginIcon(plugin)}
        <div className="plugin-row-main">
          <span className="plugin-row-name">{name}</span>
          {description && <span className="plugin-row-desc">{description}</span>}
          <span className="plugin-row-meta">
            <span className="plugin-row-author">
              {plugin.author ? `${plugin.author} · v${plugin.version}` : `v${plugin.version}`}
            </span>
            {renderPluginBadge(plugin)}
            {!isEnabled && (
              <span className="plugin-badge">{t('settings.pluginDisabledHint')}</span>
            )}
          </span>
        </div>
        {renderListActions(plugin)}
      </div>
    );
  };

  const renderPluginTile = (plugin: TextoPlugin, index: number) => {
    const name = plugin.displayNameKey ? t(plugin.displayNameKey) : plugin.id;
    const float = floatParams(plugin.id);
    return (
      <Tooltip key={plugin.id}>
        <TooltipTrigger
          render={
            <div
              {...pluginItemProps(plugin)}
              data-slot="plugin-tile"
              className="plugin-tile"
              aria-label={name}
              style={tileAnimationDelay(index)}
            >
              <span
                className="plugin-tile-icon"
                data-slot="plugin-icon"
                aria-hidden="true"
                style={
                  {
                    '--float-delay': `${float.delay}s`,
                    '--float-duration': `${float.duration}s`,
                    '--float-distance': `${float.distance}px`,
                  } as CSSProperties
                }
              >
                <PluginGlyph id={plugin.id} icon={plugin.icon} size={22} />
              </span>
            </div>
          }
        />
        <TooltipContent side="bottom">{name}</TooltipContent>
      </Tooltip>
    );
  };

  const renderPluginList = () => {
    const grouped = new Map<string, TextoPlugin[]>();
    for (const plugin of plugins) {
      const key = plugin.category ?? DEFAULT_GROUP;
      const list = grouped.get(key) ?? [];
      list.push(plugin);
      grouped.set(key, list);
    }

    // 按固定分类顺序排列，自定义分类按出现顺序跟随，未分类归入默认组并排最后。
    const unknownKeys = [...grouped.keys()].filter(
      (key) => key !== DEFAULT_GROUP && !isKnownCategory(key),
    );
    const orderedKeys: string[] = [
      ...PLUGIN_CATEGORIES.filter((category) => grouped.has(category)),
      ...unknownKeys,
      ...(grouped.has(DEFAULT_GROUP) ? [DEFAULT_GROUP] : []),
    ];
    // 只有一个默认分组时，分组标题「插件」与页面标题重复，省略。
    const onlyDefaultGroup = orderedKeys.length === 1 && orderedKeys[0] === DEFAULT_GROUP;
    const slot = viewMode === 'grid' ? 'plugin-grid' : 'plugin-list';

    return (
      <TooltipProvider delay={200}>
        <div
          className={`plugin-center${animateItems ? ' plugin-center--animated' : ''}`}
          ref={listAnchorRef}
        >
          {renderViewToggle()}
          {orderedKeys.map((categoryKey) => {
            const groupPlugins = grouped.get(categoryKey) ?? [];
            return (
              <div key={categoryKey} className="plugin-group">
                {!onlyDefaultGroup && (
                  <div className="plugin-group-title" data-slot="plugin-group-title">
                    {categoryKey === DEFAULT_GROUP
                      ? t('settings.plugins')
                      : isKnownCategory(categoryKey)
                        ? t(CATEGORY_LABEL_KEYS[categoryKey])
                        : categoryKey}
                  </div>
                )}
                <div key={viewMode} data-slot={slot} className={slot}>
                  {groupPlugins.map((plugin, index) =>
                    viewMode === 'grid'
                      ? renderPluginTile(plugin, index)
                      : renderPluginRow(plugin, index),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    );
  };

  const renderPluginDetail = (plugin: TextoPlugin) => {
    const name = plugin.displayNameKey ? t(plugin.displayNameKey) : plugin.id;
    const description = plugin.descriptionKey ? t(plugin.descriptionKey) : '';
    const sections: SettingsSection[] = pluginSectionsOf(plugin);
    // 未启用插件不展示其配置项，需先启用后才能配置。
    const isEnabled = enabled[plugin.id] ?? plugin.defaultEnabled ?? true;

    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="ml-4 self-start rounded-full ring-1 ring-border"
          aria-label={t('settings.plugins')}
          title={t('settings.plugins')}
          onClick={() => setActivePluginId(null)}
        >
          <ArrowLeft className="size-5" />
        </Button>

        <Card className="flex-shrink-0 bg-background ring-0">
          <CardContent className="space-y-5">
            <div ref={detailAnchorRef} className="flex min-w-0 items-center gap-3">
              {renderPluginIcon(plugin, true)}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="plugin-row-name">{name}</span>
                {description && <span className="plugin-detail-desc">{description}</span>}
                <span className="plugin-row-meta">
                  <span className="plugin-row-author">
                    {plugin.author
                      ? `${plugin.author} · v${plugin.version}`
                      : `v${plugin.version}`}
                  </span>
                  {renderPluginBadge(plugin)}
                  {(enabled[plugin.id] ?? plugin.defaultEnabled ?? true) === false && (
                    <span className="plugin-badge">
                      {t('settings.pluginDisabledHint')}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex-shrink-0 bg-background ring-0">
          <CardContent>{renderDetailActions(plugin)}</CardContent>
        </Card>

        {isEnabled && plugin.settingsApply !== 'immediate' && sections.length > 0 && (
          <p
            data-slot="plugin-settings-restart"
            className="px-1 text-xs text-muted-foreground"
          >
            {t('settings.pluginSettingsRestart')}
          </p>
        )}

        {isEnabled &&
          sections.map((section) => (
            <Card key={section.id} className="flex-shrink-0 bg-background ring-0">
              <CardHeader>
                <CardTitle>{t(section.titleKey)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {renderPluginFields(plugin, section.fields)}
              </CardContent>
            </Card>
          ))}
      </>
    );
  };

  const activePlugin = activePluginId
    ? plugins.find((plugin) => plugin.id === activePluginId)
    : undefined;

  return (
    <>
      {activePlugin ? renderPluginDetail(activePlugin) : renderPluginList()}

      <Dialog
        open={actionDetail !== null}
        onOpenChange={(open) => {
          if (!open) setActionDetail(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">{t('common.settings')}</DialogTitle>
          <DialogDescription className="sr-only">{t('common.settings')}</DialogDescription>
          <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-xs break-all">
            <span className="flex-1 select-all">{actionDetail}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('common.copy')}
              onClick={() => {
                if (!actionDetail) return;
                void navigator.clipboard
                  .writeText(actionDetail)
                  .then(() => toast.success(t('common.copied')))
                  .catch((error) => console.error('Failed to copy action detail:', error));
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmResetPlugin !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmResetPlugin(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>{t('settings.pluginReset')}</DialogTitle>
          <DialogDescription>{t('settings.pluginResetDesc')}</DialogDescription>
          <div className="mt-4 flex justify-end gap-2" data-slot="plugin-reset-confirm">
            <Button variant="outline" onClick={() => setConfirmResetPlugin(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleConfirmReset()}>
              {t('settings.pluginReset')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
