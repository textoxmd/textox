import type { KeyboardEvent, ReactElement } from 'react';

import i18n from '@/i18n';
import { Switch } from '@/components/ui/switch';
import type { RuntimeEntry } from '@/plugins/runtime/index';

import { PluginIcon } from './pluginIcon';
import { pluginDisplayDescription, pluginDisplayName } from './pluginText';

export interface PluginRowProps {
  entry: RuntimeEntry;
  /** `seed` = 随应用播种的内置版本，`user` = 用户导入的本地版本。 */
  origin: 'seed' | 'user';
  /** 持久化启用态（`entry.enabled`，不是派生的 `status`）。 */
  enabled: boolean;
  /** 安全模式 + 非 `app.textox.*`：不允许启用，但已启用的仍允许关闭。 */
  locked: boolean;
  /** 该插件有请求在途：开关禁用，避免双击重复提交。 */
  busy: boolean;
  onOpen(): void;
  onToggle(next: boolean): void;
}

/**
 * 插件列表的一张卡片（App Store 风格）：48px 图标 + 名称/版本作者（顶部对齐），
 * 两行描述，底部「内置/本地」标签 + 右侧胶囊按钮。
 *
 * 整卡是详情入口（`role="button"` + Enter/Space），胶囊按钮独立可点：
 * 点击与键盘事件都在按钮上 `stopPropagation`，否则点按钮会同时打开详情页。
 * 按钮的状态取持久化字段 `entry.enabled`：持久化已启用但加载失败的插件必须显示为
 * 「已启用」，否则用户点按时会再次写 `enabled: true`，永远关不掉它。
 */
export function PluginRow({
  entry,
  origin,
  enabled,
  locked,
  busy,
  onOpen,
  onToggle,
}: PluginRowProps): ReactElement {
  const name = pluginDisplayName(entry);
  const description = pluginDisplayDescription(entry);
  const version = entry.manifest?.version ?? '?';
  const author = entry.manifest?.author?.name;
  const meta = [version ? `v${version}` : '', author ?? ''].filter(Boolean).join(' · ');
  // 安全模式下第三方插件不可启用，但已经启用的仍必须能关掉。
  const toggleDisabled = busy || (locked && !enabled);
  const toggleLabel = i18n.t('settings.pluginManager.toggle', {
    defaultValue: '启用 {{name}}',
    name,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-slot="plugin-list-row"
      data-plugin-id={entry.id}
      aria-label={name}
      className="plugin-card"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <div className="plugin-card-top">
        <span className="plugin-card-icon" aria-hidden="true">
          <PluginIcon icon={entry.manifest?.icon} size={16} pluginId={entry.id} />
        </span>
        <div className="plugin-card-heading">
          <span className="plugin-card-name" data-slot="plugin-list-name">
            {name}
          </span>
          <span className="plugin-card-meta" data-slot="plugin-list-meta">
            {meta}
          </span>
        </div>
      </div>

      {description && <p className="plugin-card-desc">{description}</p>}

      <div className="plugin-card-foot">
        <span className="plugin-badge" data-slot="plugin-origin-badge">
          {origin === 'seed'
            ? i18n.t('settings.pluginManager.originSeed', '内置')
            : i18n.t('settings.pluginManager.originUser', '本地')}
        </span>
        {entry.errorMessage && (
          <span className="plugin-badge plugin-badge-error" data-slot="plugin-load-failed-badge">
            {i18n.t('settings.pluginManager.loadFailed', '加载失败')}
          </span>
        )}
        {/* 开关的点击/键盘事件不冒泡到卡片：否则点开关同时会跳到详情页。 */}
        <span
          className="plugin-card-switch"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Switch
            data-slot="plugin-toggle"
            checked={enabled}
            disabled={toggleDisabled}
            aria-label={toggleLabel}
            title={
              toggleDisabled && locked
                ? i18n.t(
                    'settings.pluginManager.safeModeDesc',
                    '仅允许 Textox 官方插件运行，第三方插件无法启用',
                  )
                : undefined
            }
            onCheckedChange={(next) => onToggle(next)}
          />
        </span>
      </div>
    </div>
  );
}
