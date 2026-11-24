import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { collectBuiltAgainst, createVersionResolver, fallbackVersion } from './built-against.js';

// 测试文件位于 packages/plugin-build/src，向上三级即仓库根
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const hasReactInstalled = existsSync(path.join(repoRoot, 'node_modules/react'));

describe('fallbackVersion', () => {
  it('keeps semver declarations as a fallback', () => {
    expect(fallbackVersion('^18.3.1')).toBe('18.3.1');
    expect(fallbackVersion('~1.2.3')).toBe('1.2.3');
    expect(fallbackVersion('1.0.0')).toBe('1.0.0');
    expect(fallbackVersion('18.3.1-beta.1')).toBe('18.3.1-beta.1');
  });

  it('drops workspace protocols and unknown specs', () => {
    expect(fallbackVersion('workspace:*')).toBeNull();
    expect(fallbackVersion('latest')).toBeNull();
    expect(fallbackVersion('file:../x')).toBeNull();
    expect(fallbackVersion('>=18.3.1')).toBeNull();
    expect(fallbackVersion('18.3')).toBeNull();
  });

  it('drops disjunctions', () => {
    expect(fallbackVersion('18.3.1 || 19.0.0')).toBeNull();
  });

  it('drops compound comparisons', () => {
    expect(fallbackVersion('18.3.1 <2')).toBeNull();
  });
});

describe('collectBuiltAgainst', () => {
  it('replaces workspace protocol with the resolved version', () => {
    const resolve = vi.fn(() => '0.0.1');

    const builtAgainst = collectBuiltAgainst(
      { '@textox/plugin-sdk': 'workspace:*', react: '^18.3.1' },
      resolve,
    );

    expect(builtAgainst).toEqual({ '@textox/plugin-sdk': '0.0.1', react: '0.0.1' });
    expect(resolve).toHaveBeenCalledWith('@textox/plugin-sdk', 'workspace:*');
  });

  it('drops unresolvable non-semver declarations and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const builtAgainst = collectBuiltAgainst({ react: 'workspace:*' }, () => null);

      expect(builtAgainst).toEqual({});
      expect(warnSpy).toHaveBeenCalledWith(
        '[plugin-build] cannot resolve version for react (workspace:*); skipped',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('ignores dependencies that are not shared modules', () => {
    const resolve = vi.fn(() => '9.9.9');

    const builtAgainst = collectBuiltAgainst({ lodash: '^4.0.0' }, resolve);

    expect(builtAgainst).toEqual({});
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('createVersionResolver', () => {
  it.skipIf(!hasReactInstalled)('resolves an installed package version', () => {
    const resolve = createVersionResolver(repoRoot);

    expect(resolve('react', 'workspace:*')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('falls back to a semver declaration when the package cannot be resolved', () => {
    const resolve = createVersionResolver(repoRoot);

    expect(resolve('@fake/missing-package', '^1.2.3')).toBe('1.2.3');
    expect(resolve('@fake/missing-package', 'workspace:*')).toBeNull();
  });
});
