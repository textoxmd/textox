import { describe, expect, it } from 'vitest';

import { defaultLocale, locales } from './locales';

const codeKeys = ['testSuccess', 'testFailed']; // settings.ts 的 messageKey 在 run() 内返回，静态收集不到

describe('picgo locales', () => {
  it('defaults to en-US and covers the code-only keys', () => {
    expect(defaultLocale).toBe('en-US');
    for (const key of codeKeys) {
      expect(typeof locales[defaultLocale]![key]).toBe('string');
    }
  });
});
