import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_GATES,
  compareVersions,
  loadOnboardingState,
  markOnboardingSeen,
  matchUnseenGate,
  setOnboardingMuted,
  shouldAutoShowOnboarding,
  type OnboardingGate,
} from './onboardingStore';

function createStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

const KEY = 'textox.onboarding.v2';
const GATE_KEY = ONBOARDING_GATES[0]!.key;

describe('compareVersions', () => {
  it('按数字段比较', () => {
    expect(compareVersions('2.0.0', '1.8.28')).toBe(1);
    expect(compareVersions('1.8.28', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.1', '2.0.0')).toBe(1);
  });

  it('段数不同时缺失段按 0（2.0 与 2.0.0 等价）', () => {
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '2.0')).toBe(0);
  });

  it('非数字段按 0 处理，不抛错', () => {
    expect(compareVersions('abc', '0')).toBe(0);
    expect(compareVersions('2.x.0', '2.0.0')).toBe(0);
    expect(compareVersions('', '0.0.1')).toBe(-1);
  });
});

describe('matchUnseenGate', () => {
  const empty = { lastSeenVersion: null, seenGateKeys: [], muted: false };

  it('更新前版本落在区间内且未看过 → 命中', () => {
    const gate = matchUnseenGate('1.8.28', empty);
    expect(gate?.key).toBe(GATE_KEY);
  });

  it('区间为左闭右开：等于上限不命中，等于下限命中', () => {
    const gate: OnboardingGate = {
      key: 'g',
      previousVersionIn: [{ minInclusive: '1.9.0', maxExclusive: '2.0.0' }],
    };
    expect(matchUnseenGate('1.9.0', empty, [gate])?.key).toBe('g');
    expect(matchUnseenGate('1.9.5', empty, [gate])?.key).toBe('g');
    expect(matchUnseenGate('2.0.0', empty, [gate])).toBeNull();
    expect(matchUnseenGate('1.8.28', empty, [gate])).toBeNull();
  });

  it('缺省边界表示该侧不限', () => {
    const onlyMax: OnboardingGate = { key: 'g', previousVersionIn: [{ maxExclusive: '2.0.0' }] };
    const onlyMin: OnboardingGate = { key: 'g', previousVersionIn: [{ minInclusive: '1.9.0' }] };
    expect(matchUnseenGate('0.1.0', empty, [onlyMax])?.key).toBe('g');
    expect(matchUnseenGate('99.0.0', empty, [onlyMax])).toBeNull();
    expect(matchUnseenGate('99.0.0', empty, [onlyMin])?.key).toBe('g');
    expect(matchUnseenGate('1.0.0', empty, [onlyMin])).toBeNull();
  });

  it('区间为空数组 = 不限历史版本（任何更新前版本都命中）', () => {
    const gate: OnboardingGate = { key: 'announce', previousVersionIn: [] };
    expect(matchUnseenGate('1.0.0', empty, [gate])?.key).toBe('announce');
    expect(matchUnseenGate('9.9.9', empty, [gate])?.key).toBe('announce');
  });

  it('更新前版本未知（全新安装）→ 含区间的门控不命中', () => {
    expect(matchUnseenGate(null, empty)).toBeNull();
    expect(matchUnseenGate('', empty)).toBeNull();
  });

  it('已看过的 key 不再命中', () => {
    expect(matchUnseenGate('1.8.28', { ...empty, seenGateKeys: [GATE_KEY] })).toBeNull();
  });

  it('多条门控时按声明顺序取第一条未看过的', () => {
    const a: OnboardingGate = { key: 'a', previousVersionIn: [{ maxExclusive: '2.0.0' }] };
    const b: OnboardingGate = { key: 'b', previousVersionIn: [{ maxExclusive: '2.0.0' }] };
    expect(matchUnseenGate('1.5.0', empty, [a, b])?.key).toBe('a');
    expect(matchUnseenGate('1.5.0', { ...empty, seenGateKeys: ['a'] }, [a, b])?.key).toBe('b');
  });
});

describe('shouldAutoShowOnboarding', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('首次安装（无记录、无更新前版本）→ 弹出', () => {
    expect(shouldAutoShowOnboarding('1.8.28', null)).toBe(true);
  });

  it('从 2.0.0 之前升上来 → 强制弹出（覆盖静音）', () => {
    setOnboardingMuted(true);
    expect(shouldAutoShowOnboarding('2.0.1', '1.8.28')).toBe(true);
  });

  it('从 2.0.0（含）之后升上来 → 门控不命中；静音时不弹', () => {
    setOnboardingMuted(true);
    expect(shouldAutoShowOnboarding('2.0.1', '2.0.0')).toBe(false);
  });

  it('从 2.0.0 之后升上来且未静音、版本号变了 → 仍会弹（旧行为保留）', () => {
    expect(shouldAutoShowOnboarding('2.0.2', '2.0.1')).toBe(true);
  });

  it('看过当前版本后，同版本 + 命中区间也不再弹', () => {
    markOnboardingSeen('2.0.1');
    expect(shouldAutoShowOnboarding('2.0.1', '1.8.28')).toBe(false);
  });

  it('空版本号不弹出', () => {
    expect(shouldAutoShowOnboarding('', '1.8.28')).toBe(false);
    expect(shouldAutoShowOnboarding(undefined as unknown as string, '1.8.28')).toBe(false);
  });

  it('标记已看过后，更新前版本落在新门控区间内仍会强制（新增 key 生效）', () => {
    markOnboardingSeen('2.0.1');
    expect(shouldAutoShowOnboarding('2.0.1', '1.8.28')).toBe(false);
    // 模拟"追加了一条新门控"：注入自定义表验证 key 未看过即命中
    const extra: OnboardingGate = { key: '2.1-rework', previousVersionIn: [{ maxExclusive: '2.1.0' }] };
    expect(matchUnseenGate('2.0.1', loadOnboardingState(), [extra])?.key).toBe('2.1-rework');
  });
});

describe('onboardingStore 状态持久化', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('markOnboardingSeen 记录版本号与全部门控 key', () => {
    markOnboardingSeen('2.0.1');
    const state = loadOnboardingState();
    expect(state.lastSeenVersion).toBe('2.0.1');
    expect(state.seenGateKeys).toEqual(ONBOARDING_GATES.map((g) => g.key));
  });

  it('兼容旧状态：lastSeenRevision 视为已看过该门控（不重复强弹）', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ lastSeenVersion: '2.0.1', lastSeenRevision: GATE_KEY, muted: false }),
    );
    const state = loadOnboardingState();
    expect(state.seenGateKeys).toEqual([GATE_KEY]);
    expect(shouldAutoShowOnboarding('2.0.1', '1.8.28')).toBe(false);
  });

  it('静音标记可读写', () => {
    setOnboardingMuted(true);
    expect(loadOnboardingState().muted).toBe(true);
  });

  it('损坏的本地数据回退默认状态', () => {
    localStorage.setItem(KEY, '{broken');
    expect(loadOnboardingState()).toEqual({
      lastSeenVersion: null,
      seenGateKeys: [],
      muted: false,
    });
    expect(shouldAutoShowOnboarding('2.0.1', null)).toBe(true);
  });

  it('默认状态的数组不被共享（多次读取互不影响）', () => {
    const a = loadOnboardingState();
    a.seenGateKeys.push('x');
    const b = loadOnboardingState();
    expect(b.seenGateKeys).toEqual([]);
  });
});
