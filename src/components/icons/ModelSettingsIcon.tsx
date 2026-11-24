import type { SVGProps } from 'react';

/**
 * 模型设置图标：五根声波条。
 *
 * 设置页里只作为静态图标使用；侧栏加载态的动画由 `agent.css` 单独驱动。
 */
export function ModelSettingsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      data-icon="model-settings"
      className={className}
      {...props}
    >
      <rect className="model-settings-icon__bar" x="2.9" y="9" width="2.2" height="6" rx="1.1" />
      <rect className="model-settings-icon__bar" x="6.9" y="5.5" width="2.2" height="13" rx="1.1" />
      <rect className="model-settings-icon__bar" x="10.9" y="7" width="2.2" height="10" rx="1.1" />
      <rect className="model-settings-icon__bar" x="14.9" y="4" width="2.2" height="16" rx="1.1" />
      <rect className="model-settings-icon__bar" x="18.9" y="10" width="2.2" height="4" rx="1.1" />
    </svg>
  );
}
