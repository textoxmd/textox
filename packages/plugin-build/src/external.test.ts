import { describe, expect, it } from 'vitest';
import { SHARED_MODULES } from '@textox/plugin-sdk';

import { isExternal } from './external.js';

describe('isExternal', () => {
  it.each([
    ['react', true],
    ['react-dom/client', true],
    ['@textox/plugin-sdk', true],
    ['@tauri-apps/api/core', true],
    ['lodash', false],
    ['react-dom/server', false],
    ['prosemirror-model/x', false],
  ] as const)('%s => %s', (specifier, expected) => {
    expect(isExternal(specifier)).toBe(expected);
  });

  it('treats every shared module as external', () => {
    for (const specifier of SHARED_MODULES) {
      expect(isExternal(specifier)).toBe(true);
    }
  });
});
