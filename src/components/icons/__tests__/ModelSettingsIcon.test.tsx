import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelSettingsIcon } from '../ModelSettingsIcon';

function render(): string {
  return renderToStaticMarkup(
    createElement(ModelSettingsIcon, { className: 'settings-nav-icon' }),
  );
}

describe('ModelSettingsIcon', () => {
  it('渲染 5 根声波条', () => {
    const markup = render();

    expect(markup.match(/class="model-settings-icon__bar"/g)).toHaveLength(5);
  });

  it('图标对屏幕阅读器隐藏，并保留调用方的尺寸类名', () => {
    const markup = render();

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('class="settings-nav-icon"');
    expect(markup).toContain('data-icon="model-settings"');
  });
});
