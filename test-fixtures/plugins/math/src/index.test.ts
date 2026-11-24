import { describe, expect, it } from 'vitest';

import plugin from './index';

describe('math plugin manifest', () => {
  it('contributes a code block extension for latex/math', () => {
    const ext = plugin.contributes?.['markdown-editor:extension']?.[0];
    expect(ext?.id).toBe('math.renderer');
    expect(ext?.languages).toEqual(['latex', 'math']);
  });

  it('follows the first-party plugin manifest conventions', () => {
    expect(plugin.displayNameKey).toBe('math.pluginName');
    expect(plugin.descriptionKey).toBe('math.pluginDescription');
    expect(plugin.defaultEnabled).toBe(true);
  });

  it('contributes the inline math syntax feature', () => {
    const features = plugin.contributes?.['markdown-editor:syntaxFeature'];
    expect(features?.[0]?.name).toBe('inline-math');
  });

  it('contributes a math block insert command', () => {
    const ext = plugin.contributes?.['markdown-editor:extension']?.find(
      (e) => e.id === 'math.insert',
    );
    expect(ext?.id).toBe('math.insert');
    expect(ext?.insert?.id).toBe('math_block');
    expect(ext?.insert?.keyword).toBe('math');
  });

  it('contributes a context menu item for copying the source', () => {
    const items = plugin.contributes?.['markdown-editor:contextMenu'];
    expect(items).toHaveLength(1);
    expect(items?.[0]?.id).toBe('math.copySource');
  });
});
