import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  declareExtensionPoint,
  getContributions,
  getContributionsWithOwner,
  hasExtensionPoint,
  ownerOfExtensionPoint,
  registerContributions,
  resetExtensionPointsForTests,
  subscribeContributions,
  unregisterContribution,
  unregisterOwner,
} from './extension-points';
import * as sdkRoot from './index';
import type { Contributes } from './types';

// 测试用：让 ExtensionPointMap 非空，从而使 Contributes 对未知键触发多余属性检查。
// id 一律用 `demo:` 前缀：本增强对整个包生效，裸 id 会变成生产代码里也合法的扩展点 id。
declare module './types' {
  interface ExtensionPointMap {
    'demo:point': { id: string };
    'demo:a': { id: string };
    'demo:p': { id: string };
    'demo:q': { id: string };
    'demo:z': { id: string };
  }
}

afterEach(() => {
  resetExtensionPointsForTests();
  vi.restoreAllMocks();
});

describe('extension points', () => {
  it('registers and reads contributions by point id', () => {
    declareExtensionPoint({ id: 'demo:point' }, 'demo');
    registerContributions('plugin-a', {
      'demo:point': [{ id: 'a' }, { id: 'b' }],
    } as never);
    expect(getContributions('demo:point').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('ignores contributions to an undeclared point and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerContributions('plugin-a', { 'missing:point': [{ id: 'x' }] } as never);
    expect(getContributions('missing:point')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('不存在的扩展点'));
  });

  it('keeps only the last contribution for a duplicated id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    declareExtensionPoint({ id: 'demo:point' }, 'demo');
    registerContributions('plugin-a', { 'demo:point': [{ id: 'x', n: 1 }] } as never);
    registerContributions('plugin-b', { 'demo:point': [{ id: 'x', n: 2 }] } as never);
    expect(getContributions('demo:point')).toEqual([
      { id: 'x', n: 2 },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('贡献键冲突'));
  });

  it('deduplicates contributions by name when id is absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    declareExtensionPoint({ id: 'demo:tool' }, 'demo');
    registerContributions('plugin-a', { 'demo:tool': [{ name: 'x', n: 1 }] } as never);
    registerContributions('plugin-b', { 'demo:tool': [{ name: 'x', n: 2 }] } as never);
    expect(getContributions('demo:tool')).toEqual([{ name: 'x', n: 2 }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('贡献键冲突'));
  });

  it('deduplicates contribution ids per point, not globally', () => {
    declareExtensionPoint({ id: 'demo:point-a' }, 'demo');
    declareExtensionPoint({ id: 'demo:point-b' }, 'demo');
    registerContributions('plugin-a', {
      'demo:point-a': [{ id: 'shared', n: 1 }],
      'demo:point-b': [{ id: 'shared', n: 2 }],
    } as never);
    expect(getContributions('demo:point-a')).toEqual([
      { id: 'shared', n: 1 },
    ]);
    expect(getContributions('demo:point-b')).toEqual([
      { id: 'shared', n: 2 },
    ]);
  });

  it('warns on duplicate extension point declaration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    declareExtensionPoint({ id: 'demo:point' }, 'owner-a');
    declareExtensionPoint({ id: 'demo:point' }, 'owner-b');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('重复声明'));
    expect(hasExtensionPoint('demo:point')).toBe(true);
  });

  it('lets the last declaration of a point override the owner', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    declareExtensionPoint({ id: 'demo:point' }, 'owner-a');
    declareExtensionPoint({ id: 'demo:point' }, 'owner-b');
    expect(ownerOfExtensionPoint('demo:point')).toBe('owner-b');
  });

  it('binds contribution keys to ExtensionPointMap at the type level', () => {
    const ok: Contributes = { 'demo:point': [{ id: 'x' }] };
    expect(ok).toBeDefined();

    // @ts-expect-error 'nope' 不是 ExtensionPointMap 的键
    const bad: Contributes = { nope: [{ id: 'x' }] };
    expect(bad).toBeDefined();
  });

  it('returns unknown[] for an id outside the type map', () => {
    // @ts-expect-error 未知 id 返回 unknown[]，不能赋给具体类型
    const typed: { id: string }[] = getContributions('not:in-map');
    expect(typed).toEqual([]);
  });
});

describe('ownerOfExtensionPoint', () => {
  it('returns null for an unknown point', () => {
    expect(ownerOfExtensionPoint('unknown')).toBeNull();
  });
});

describe('getContributionsWithOwner', () => {
  it('returns contributions with their owner plugin id', () => {
    declareExtensionPoint({ id: 'demo:z' }, 'owner-z');
    registerContributions('plugin-a', { 'demo:z': [{ id: 'x' }] } as never);
    expect(getContributionsWithOwner('demo:z')).toEqual([{ ownerId: 'plugin-a', value: { id: 'x' } }]);
  });

  it('returns empty for unknown points', () => {
    expect(getContributionsWithOwner('nope')).toEqual([]);
  });
});

describe('unregisterContribution', () => {
  it('removes one contribution and notifies', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:a' }, 'owner');
    registerContributions('owner', { 'demo:a': [{ id: 'a' }, { id: 'b' }] });
    const seen: string[] = [];
    const sub = subscribeContributions((pointId) => seen.push(pointId));
    unregisterContribution('demo:a', 'owner', 'a');
    expect(getContributions('demo:a')).toEqual([{ id: 'b' }]);
    expect(seen).toEqual(['demo:a']);
    sub.dispose();
  });

  it('stays silent when nothing matches', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:a' }, 'owner');
    registerContributions('owner', { 'demo:a': [{ id: 'a' }] });
    const seen: string[] = [];
    const sub = subscribeContributions((pointId) => seen.push(pointId));

    unregisterContribution('demo:a', 'owner', 'missing'); // 贡献键不存在
    unregisterContribution('demo:a', 'other', 'a'); // owner 不匹配
    unregisterContribution('nope:point', 'owner', 'a'); // 扩展点不存在

    expect(seen).toEqual([]);
    expect(getContributions('demo:a')).toEqual([{ id: 'a' }]);
    sub.dispose();
  });

  it('does not notify twice for a repeated call', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:a' }, 'owner');
    registerContributions('owner', { 'demo:a': [{ id: 'a' }] });
    const seen: string[] = [];
    const sub = subscribeContributions((pointId) => seen.push(pointId));

    unregisterContribution('demo:a', 'owner', 'a');
    unregisterContribution('demo:a', 'owner', 'a');
    unregisterContribution('demo:a', 'owner', 'a');

    expect(seen).toEqual(['demo:a']);
    expect(getContributions('demo:a')).toEqual([]);
    sub.dispose();
  });

  it('matches contributions registered by name', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:q' }, 'owner');
    registerContributions('owner', {
      'demo:q': [
        { name: 'tool-x', n: 1 },
        { name: 'tool-y', n: 2 },
      ],
    } as never);
    unregisterContribution('demo:q', 'owner', 'tool-x');
    expect(getContributions('demo:q')).toEqual([{ name: 'tool-y', n: 2 }]);
  });
});

describe('unregisterOwner', () => {
  it('removes contributions across points regardless of who declared them', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:p' }, 'owner');
    declareExtensionPoint({ id: 'demo:q' }, 'other');
    registerContributions('owner', { 'demo:p': [{ id: '1' }], 'demo:q': [{ id: '2' }] });
    unregisterOwner('owner');
    expect(getContributions('demo:p')).toEqual([]);
    expect(getContributions('demo:q')).toEqual([]);
    // 只清贡献，不删点：点仍由声明者持有。
    expect(hasExtensionPoint('demo:p')).toBe(true);
    expect(hasExtensionPoint('demo:q')).toBe(true);
  });

  it('keeps other owners untouched and stays silent for an owner without contributions', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:p' }, 'owner');
    registerContributions('owner', { 'demo:p': [{ id: 'mine' }] });
    registerContributions('other', { 'demo:p': [{ id: 'theirs' }] });
    const seen: string[] = [];
    const sub = subscribeContributions((pointId) => seen.push(pointId));

    unregisterOwner('ghost');
    expect(seen).toEqual([]);
    expect(getContributions('demo:p')).toEqual([{ id: 'mine' }, { id: 'theirs' }]);

    unregisterOwner('owner');
    expect(seen).toEqual(['demo:p']);
    expect(getContributions('demo:p')).toEqual([{ id: 'theirs' }]);

    unregisterOwner('owner'); // 重复调用安静退出
    expect(seen).toEqual(['demo:p']);
    sub.dispose();
  });

  it('notifies each affected point exactly once', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:p' }, 'owner');
    declareExtensionPoint({ id: 'demo:q' }, 'owner');
    registerContributions('owner', { 'demo:p': [{ id: '1' }, { id: '2' }], 'demo:q': [{ id: '3' }] });
    const seen: string[] = [];
    const sub = subscribeContributions((pointId) => seen.push(pointId));

    unregisterOwner('owner');

    expect(seen).toEqual(['demo:p', 'demo:q']);
    expect(getContributionsWithOwner('demo:p')).toEqual([]);
    expect(getContributionsWithOwner('demo:q')).toEqual([]);
    sub.dispose();
  });

  it('dispatches after every affected point is cleared', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:p' }, 'owner');
    declareExtensionPoint({ id: 'demo:q' }, 'owner');
    registerContributions('owner', { 'demo:p': [{ id: '1' }], 'demo:q': [{ id: '2' }] });
    // 每次通知都重读两个点：任何一次回调看到残留贡献，都说明派发早于全部清除。
    const snapshots: unknown[][] = [];
    const sub = subscribeContributions(() => {
      snapshots.push([...getContributions('demo:p'), ...getContributions('demo:q')]);
    });

    unregisterOwner('owner');

    expect(snapshots).toEqual([[], []]);
    sub.dispose();
  });
});

describe('package root exports', () => {
  it('re-exports the registry subscribe/unregister API', () => {
    expect(sdkRoot.subscribeContributions).toBe(subscribeContributions);
    expect(sdkRoot.unregisterContribution).toBe(unregisterContribution);
    expect(sdkRoot.unregisterOwner).toBe(unregisterOwner);
  });

  it('package-root API operates on the same registry instance', () => {
    resetExtensionPointsForTests();
    sdkRoot.declareExtensionPoint({ id: 'demo:a' }, 'owner');
    sdkRoot.registerContributions('owner', { 'demo:a': [{ id: 'a' }] });
    const seen: string[] = [];
    const sub = sdkRoot.subscribeContributions((pointId) => seen.push(pointId));

    sdkRoot.unregisterOwner('owner');

    expect(sdkRoot.getContributions('demo:a')).toEqual([]);
    expect(seen).toEqual(['demo:a']);
    sub.dispose();
  });
});

describe('subscribeContributions', () => {
  it('honours dispose', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:a' }, 'owner');
    registerContributions('owner', { 'demo:a': [{ id: 'a' }, { id: 'b' }] });
    const seen: string[] = [];
    subscribeContributions((pointId) => seen.push(pointId)).dispose();
    unregisterContribution('demo:a', 'owner', 'a');
    expect(seen).toEqual([]);
  });

  it('isolates a throwing listener', () => {
    resetExtensionPointsForTests();
    declareExtensionPoint({ id: 'demo:a' }, 'owner');
    registerContributions('owner', { 'demo:a': [{ id: 'a' }] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    const bad = subscribeContributions(() => {
      throw new Error('boom');
    });
    const good = subscribeContributions((pointId) => seen.push(pointId));

    expect(() => unregisterContribution('demo:a', 'owner', 'a')).not.toThrow();

    expect(seen).toEqual(['demo:a']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[plugin-sdk]'), expect.any(Error));
    expect(getContributions('demo:a')).toEqual([]);
    bad.dispose();
    good.dispose();
  });
});
