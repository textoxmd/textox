import { useCallback, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { isValueField } from '@texto/plugin-sdk';

import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { PluginErrorBoundary } from '@/plugins/PluginErrorBoundary';
import { PluginSettingsFields } from '@/components/settings/PluginSettingsFields';
import { settingsDifferFromDefaults } from '@/components/settings/settingsPatch';
import { runManifestAction } from '@/plugins/runtime/app';
import type { RuntimeEntry } from '@/plugins/runtime/index';

import { PluginIcon } from './pluginIcon';
import { pluginDisplayDescription, pluginDisplayName } from './pluginText';
import type { PluginSettingsApi } from './usePluginSettings';

export interface PluginDetailViewProps {
  entry: RuntimeEntry;
  origin: 'seed' | 'user';
  settings: PluginSettingsApi;
  busy: boolean;
  /** 安全模式下的第三方插件：未启用时不允许在这里打开（与列表行的 locked 判定一致）。 */
  locked?: boolean;
  /** 内置插件被本地版本覆盖时才允许「重装内置版本」。 */
  canReinstall?: boolean;
  onBack(): void;
  onToggle(next: boolean): void;
  /** 重装内置版本（仅被本地覆盖版替换的内置插件，会重写插件目录）。 */
  onRestore(): void;
  /** 把插件配置写回声明默认值；无偏离时调用方应保持按钮禁用。 */
  onResetSettings(): void;
  onUninstall(): void;
}

/**
 * 插件详情视图：返回、图标/名称/来源/版本作者、启用开关、描述、设置卡片、来源相关操作与技术信息。
 *
 * 与列表行同一套判定：开关的勾选态取持久化 `entry.enabled`；操作按钮按来源互斥
 * （内置插件可重装覆盖版，本地插件可卸载），二次确认由容器负责，这里只回调。
 */
export function PluginDetailView({
  entry,
  origin,
  settings,
  busy,
  locked = false,
  canReinstall = false,
  onBack,
  onToggle,
  onRestore,
  onResetSettings,
  onUninstall,
}: PluginDetailViewProps): ReactElement {
  const name = pluginDisplayName(entry);
  const description = pluginDisplayDescription(entry);
  const version = entry.manifest?.version ?? '?';
  const author = entry.manifest?.author?.name;
  const meta = [version ? `v${version}` : '', author ?? ''].filter(Boolean).join(' · ');
  const fields = settings.fields;
  // 任一「重启后生效」字段存在时，整张设置卡片顶部只提示一次（不随字段数量重复）。
  const needsRestart = fields.some((field) => isValueField(field) && field.apply === 'restart');
  // 「恢复默认设置」只在真的有偏离时可点：未改动过配置时按钮保持禁用
  const settingsChanged = settingsDifferFromDefaults(fields, settings.values);

  /** 插件设置文案：插件自带 `plugins` 命名空间优先，回退到调用方缺省文案 / 骨架文案。 */
  const translate = useCallback(
    (key: string, defaultValue?: string): string =>
      String(
        i18n.getFixedT(null, 'plugins')(`${entry.id}.${key}`, defaultValue ?? i18n.t(key)),
      ),
    [entry.id],
  );

  return (
    <section className="flex flex-col gap-4" data-slot="plugin-detail-view" data-plugin-id={entry.id}>
      <Card className="flex-shrink-0 bg-background ring-0">
        <CardContent className="flex flex-col gap-3">
          <div>
            <Button
              variant="ghost"
              size="icon-lg"
              className="-ml-2 rounded-full"
              data-slot="plugin-detail-back"
              aria-label={i18n.t('settings.pluginManager.backToList', '返回已安装插件')}
              title={i18n.t('settings.pluginManager.backToList', '返回已安装插件')}
              onClick={onBack}
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex items-start gap-3">
            <span className="plugin-list-row-icon plugin-detail-icon" aria-hidden="true">
              <PluginIcon icon={entry.manifest?.icon} size={22} pluginId={entry.id} />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span className="truncate">{name}</span>
                <span className="plugin-list-row-badges">
                  <span className="plugin-badge" data-slot="plugin-origin-badge">
                    {origin === 'seed'
                      ? i18n.t('settings.pluginManager.originSeed', '内置')
                      : i18n.t('settings.pluginManager.originUser', '本地')}
                  </span>
                </span>
              </CardTitle>
              <div className="settings-item-description">{meta}</div>

              {entry.errorMessage && (
                <p
                  className="text-destructive mt-2 text-sm"
                  data-slot="plugin-detail-error"
                  role="alert"
                >
                  {i18n.t('settings.pluginManager.loadFailed', '加载失败')}：{entry.errorMessage}
                </p>
              )}

              {description && (
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            <Checkbox
              checked={entry.enabled}
              disabled={busy || (locked && !entry.enabled)}
              title={
                locked && !entry.enabled
                  ? i18n.t(
                      'settings.pluginManager.safeModeDesc',
                      '仅允许 Textox 官方插件运行，第三方插件无法启用',
                    )
                  : undefined
              }
              aria-label={i18n.t('settings.pluginManager.toggle', {
                defaultValue: '启用 {{name}}',
                name,
              })}
              onCheckedChange={(checked) => onToggle(checked === true)}
            />
          </div>
        </CardContent>
      </Card>

      {fields.length > 0 && (
        <Card className="flex-shrink-0 bg-background ring-0">
          <CardHeader>
            <CardTitle>{i18n.t('settings.pluginManager.settings', '设置')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5" data-slot="plugin-detail-settings">
            {needsRestart && (
              <p data-slot="plugin-settings-restart" className="text-xs text-muted-foreground">
                {i18n.t('settings.pluginSettingsRestart', '此插件的设置需重启应用后生效')}
              </p>
            )}
            <PluginErrorBoundary
              title={i18n.t('settings.pluginManager.renderError', '设置渲染出错')}
            >
              <PluginSettingsFields
                fields={fields}
                // 运行时插件是单段渲染，依赖字段与预设求值都在同一份清单里
                allFields={fields}
                values={settings.values}
                onChange={(key, value) => {
                  void settings.setValue(entry.id, key, value);
                }}
                onChangePatch={(patch) => {
                  void settings.setPatch(entry.id, patch);
                }}
                onAction={(field) => {
                  // 与旧面板一致：命令未注册（`ran === false`）或执行抛错都要提示，不静默失败。
                  void runManifestAction(entry.id, field)
                    .then((ran) => {
                      if (!ran) {
                        toast.error('插件未启用或未注册该命令，无法执行该操作');
                      }
                    })
                    .catch((error: unknown) => {
                      toast.error(error instanceof Error ? error.message : String(error));
                    });
                }}
                t={translate}
                disabled={busy}
              />
            </PluginErrorBoundary>
          </CardContent>
        </Card>
      )}

      {/* 与卡片内容同一条左/右内边距：按钮右缘对齐卡内控件，而不是卡片外缘 */}
      <div className="flex items-center justify-end gap-2 px-4" data-slot="plugin-actions">
        {canReinstall && (
          <Button
            variant="ghost"
            disabled={busy}
            data-slot="plugin-reinstall"
            onClick={onRestore}
          >
            {i18n.t('settings.pluginManager.reinstallBuiltin', '重装内置版本')}
          </Button>
        )}
        {fields.length > 0 && (
          <Button
            variant="outline"
            disabled={busy || !settingsChanged}
            data-slot="plugin-reset-defaults"
            onClick={onResetSettings}
          >
            {i18n.t('settings.pluginManager.resetDefaults', '恢复默认设置')}
          </Button>
        )}
        {origin === 'user' && (
          <Button
            variant="outline"
            className="border-destructive/60 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/60 dark:bg-transparent dark:hover:bg-destructive/20"
            disabled={busy}
            data-slot="plugin-uninstall"
            onClick={onUninstall}
          >
            {i18n.t('settings.pluginManager.uninstall', '卸载')}
          </Button>
        )}
      </div>
    </section>
  );
}
