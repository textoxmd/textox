import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_PRESETS,
  applyHighlightColorStyle,
  highlightColorCss,
  highlightSettings,
} from './settings';

describe('highlightSettings', () => {
  it('declares a single color field with preset swatches', () => {
    expect(highlightSettings.id).toBe('highlight.settings');
    const field = highlightSettings.fields[0]!;
    expect(field.type).toBe('color');
    if (field.type !== 'color') throw new Error('unreachable');
    expect(field.key).toBe('highlightColor');
    expect(field.default).toBe(DEFAULT_HIGHLIGHT_COLOR);
    expect(field.presets).toHaveLength(6);
    expect(field.presets!.map((p) => p.value)).toEqual([...HIGHLIGHT_PRESETS]);
  });
});

describe('highlightColorCss', () => {
  it('derives light/dark alpha from a single color', () => {
    expect(highlightColorCss('#ffd700')).toBe(
      ':root{--highlight-color:color-mix(in oklab, #ffd700 35%, transparent)}' +
        ':root.dark{--highlight-color:color-mix(in oklab, #ffd700 50%, transparent)}',
    );
  });
});

describe('applyHighlightColorStyle', () => {
  it('injects a style element and falls back to the default color', () => {
    applyHighlightColorStyle({});
    const el = document.getElementById('texto-plugin-highlight-color') as HTMLStyleElement | null;
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe(highlightColorCss(DEFAULT_HIGHLIGHT_COLOR));

    applyHighlightColorStyle({ highlightColor: '#a3e07a' });
    expect(el!.textContent).toBe(highlightColorCss('#a3e07a'));

    for (const invalid of [
      123,
      '',
      '  ',
      'red; } :root{display:none} :root{--highlight-color:red',
    ]) {
      applyHighlightColorStyle({ highlightColor: invalid });
      expect(el!.textContent).toBe(highlightColorCss(DEFAULT_HIGHLIGHT_COLOR));
    }

    expect(document.querySelectorAll('#texto-plugin-highlight-color')).toHaveLength(1);
    el!.remove();
  });
});
