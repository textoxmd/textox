import { describe, expect, it } from 'vitest';

import { isKnownCategory, isOfficialPlugin, OFFICIAL_AUTHOR, PLUGIN_CATEGORIES } from './meta';

describe('isOfficialPlugin', () => {
  it('recognizes the official author', () => {
    expect(isOfficialPlugin({ author: OFFICIAL_AUTHOR })).toBe(true);
  });

  it('rejects third-party authors and missing author', () => {
    expect(isOfficialPlugin({ author: 'Acme' })).toBe(false);
    expect(isOfficialPlugin({})).toBe(false);
  });
});

describe('PLUGIN_CATEGORIES', () => {
  it('defines the display order', () => {
    expect(PLUGIN_CATEGORIES).toEqual(['llm', 'editor', 'export', 'image-hosting']);
  });
});

describe('isKnownCategory', () => {
  it('recognizes built-in categories only', () => {
    expect(isKnownCategory('llm')).toBe(true);
    expect(isKnownCategory('editor')).toBe(true);
    expect(isKnownCategory('image-hosting')).toBe(true);
    expect(isKnownCategory('sync')).toBe(false);
  });
});
