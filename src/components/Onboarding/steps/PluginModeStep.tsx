import { useEffect, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import pluginModeIllustration from '@/assets/onboarding/plugin-mode.svg?raw';
import { listPlugins } from '@/plugins/registry';
import { PluginGlyph, prefetchPluginIcons } from '@/plugins/pluginIcon';
import { floatParams } from '@/plugins/pluginFloat';

/**
 * 「插件模式」步骤：插画揭示 + 插件网格。
 * 纯展示——不写配置、无按钮；插件清单从注册表动态取（骨架不硬编码插件名）。
 * 网格只显示图标，名称仅作为 title / aria-label 供悬停与读屏使用。
 */
export function PluginModeStep() {
  const { t } = useTranslation();

  const plugins = useMemo(
    () => listPlugins().filter((plugin) => !!plugin.displayNameKey),
    [],
  );

  // 网格一次显示多个图标：挂载时预热，避免 20 个格子同时闪占位。
  useEffect(() => {
    prefetchPluginIcons(plugins);
  }, [plugins]);

  return (
    <div className="plugin-mode-stage">
      <div
        className="plugin-mode-illustration"
        data-slot="plugin-mode-illustration"
        role="img"
        aria-label={t('onboarding.pluginMode.title')}
        dangerouslySetInnerHTML={{ __html: pluginModeIllustration }}
      />

      <div className="plugin-mode-right">
        <div className="plugin-mode-right-inner">
          <h2 className="plugin-mode-title">{t('onboarding.pluginMode.title')}</h2>
          <p className="plugin-mode-desc">{t('onboarding.pluginMode.desc')}</p>

          <div className="plugin-mode-warn" role="note">
            <span>
              <strong>{t('onboarding.pluginMode.warnTitle')}</strong>{' '}
              {t('onboarding.pluginMode.warnDesc')}
            </span>
          </div>

          <div className="plugin-mode-grid" data-slot="plugin-mode-grid" role="list">
            {plugins.map((plugin, index) => {
              const name = t(plugin.displayNameKey!);
              const float = floatParams(plugin.id);
              return (
                <div
                  key={plugin.id}
                  className="plugin-mode-tile"
                  data-slot="plugin-tile"
                  role="listitem"
                  aria-label={name}
                  title={name}
                  style={
                    {
                      '--i': index,
                      '--float-delay': `${float.delay}s`,
                      '--float-duration': `${float.duration}s`,
                      '--float-distance': `${float.distance}px`,
                    } as CSSProperties
                  }
                >
                  <span className="plugin-mode-tile-icon" aria-hidden="true">
                    <PluginGlyph id={plugin.id} icon={plugin.icon} size={22} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
