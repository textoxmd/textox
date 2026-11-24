import { describe, expect, it } from 'vitest';

import { defaultLocale, locales } from './locales';

const codeKeys = ['editTable', 'alignLeft', 'alignCenter', 'alignRight', 'deleteTable'];
const containerKeys = ['pluginName', 'pluginDescription'];

describe('table locales', () => {
  it('covers code-only and container keys in defaultLocale', () => {
    expect(defaultLocale).toBe('en-US');
    const messages = locales[defaultLocale]!;
    for (const key of [...codeKeys, ...containerKeys, 'tableDesc']) {
      expect(typeof messages[key], key).toBe('string');
    }
  });
});
