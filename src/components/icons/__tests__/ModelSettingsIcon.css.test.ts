import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = path.resolve(__dirname, '../../styles/components/settings.css');
const css = readFileSync(cssPath, 'utf8');

describe('模型设置图标的样式契约', () => {
  it('设置页图标保持静态，不声明动画', () => {
    expect(css).toContain('.model-settings-icon__bar');
    expect(css).not.toContain('.settings-nav-item.active .model-settings-icon__bar');
    expect(css).not.toContain('@keyframes model-settings-icon');
  });
});
