const STORAGE_KEY = 'textox.onboarding.v2';

/** 版本区间（左闭右开）；缺省边界表示该侧不限。 */
export interface VersionRange {
  minInclusive?: string;
  maxExclusive?: string;
}

/** 向导门控：命中「更新前版本所在区间」且未看过该 key 时，强制弹一次向导。 */
export interface OnboardingGate {
  /** 幂等标记；向导内容大改时换成新 key 即可再次强制。 */
  key: string;
  /** 命中的「更新前版本」区间；**空数组 = 不限历史版本**（任何升级都弹，适合强制公告）。 */
  previousVersionIn: VersionRange[];
}

/**
 * 门控表（可配）。当前一条：从 2.0.0 之前升上来的用户强制看一次——
 * 这正是「插件模式」这次内容变更要覆盖的人群。
 *
 * 以后要分版本引导，在此追加条目即可（例：`<1.9` 看 A、`1.9–2.0` 看 B），
 * 多条命中时按声明顺序取第一条未看过的。
 */
export const ONBOARDING_GATES: OnboardingGate[] = [
  { key: '2.0-plugin-mode', previousVersionIn: [{ maxExclusive: '2.0.0' }] },
];

export interface OnboardingState {
  /** 最近一次完成/跳过向导的版本号 */
  lastSeenVersion: string | null;
  /** 已看过的门控 key（表里新增的 key 仍会强制弹出） */
  seenGateKeys: string[];
  /** 不再自动提示（帮助菜单手动打开不受影响） */
  muted: boolean;
}

/** 每次返回全新对象，避免默认值里的数组被共享修改。 */
function defaultState(): OnboardingState {
  return { lastSeenVersion: null, seenGateKeys: [], muted: false };
}

export function loadOnboardingState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<OnboardingState> & { lastSeenRevision?: string };
    const seenGateKeys = Array.isArray(parsed.seenGateKeys) ? [...parsed.seenGateKeys] : [];
    // 旧状态兼容：曾记录 lastSeenRevision 的用户视为已看过该门控，避免重复强制弹出。
    if (seenGateKeys.length === 0 && typeof parsed.lastSeenRevision === 'string' && parsed.lastSeenRevision) {
      seenGateKeys.push(parsed.lastSeenRevision);
    }
    return {
      lastSeenVersion: parsed.lastSeenVersion ?? null,
      seenGateKeys,
      muted: parsed.muted === true,
    };
  } catch {
    return defaultState();
  }
}

function saveOnboardingState(state: OnboardingState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储失败不影响主流程，最多下次再触发
  }
}

/** 按数字段比较版本号；段数不同时缺失段按 0，非数字段按 0（不抛错）。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = Number.parseInt(pa[i] ?? '', 10);
    const nb = Number.parseInt(pb[i] ?? '', 10);
    const va = Number.isFinite(na) ? na : 0;
    const vb = Number.isFinite(nb) ? nb : 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

/** 「更新前版本」是否落在任一区间内；区间为空数组表示不限历史版本。 */
function inRanges(previousVersion: string, ranges: VersionRange[]): boolean {
  if (ranges.length === 0) return true;
  return ranges.some((range) => {
    const afterMin =
      range.minInclusive === undefined || compareVersions(previousVersion, range.minInclusive) >= 0;
    const beforeMax =
      range.maxExclusive === undefined || compareVersions(previousVersion, range.maxExclusive) < 0;
    return afterMin && beforeMax;
  });
}

/**
 * 返回第一个「未看过且命中」的门控；没有则返回 null。
 * `gates` 可注入（测试用），缺省取 {@link ONBOARDING_GATES}。
 */
export function matchUnseenGate(
  previousVersion: string | null,
  state: OnboardingState,
  gates: OnboardingGate[] = ONBOARDING_GATES,
): OnboardingGate | null {
  for (const gate of gates) {
    if (state.seenGateKeys.includes(gate.key)) continue;
    // 区间为空的「不限历史版本」门控不受未知旧版本限制；含区间的必须有已知旧版本。
    if (gate.previousVersionIn.length > 0 && !previousVersion) continue;
    if (inRanges(previousVersion ?? '', gate.previousVersionIn)) return gate;
  }
  return null;
}

/**
 * 是否应该在本次启动自动弹出向导。判定顺序：
 * ① 拿不到当前版本 → 不弹；
 * ② 命中未看过的**版本区间门控** → 必弹（覆盖 muted）；
 * ③ 静音 → 不弹；
 * ④ 版本号与上次看过时不同 → 弹。
 *
 * @param version         当前应用版本
 * @param previousVersion 「更新前版本」（AppConfig.last_run_version；全新安装为 null）
 */
export function shouldAutoShowOnboarding(
  version: string,
  previousVersion: string | null,
): boolean {
  if (!version) return false;
  const state = loadOnboardingState();
  if (matchUnseenGate(previousVersion, state)) return true;
  if (state.muted) return false;
  return state.lastSeenVersion !== version;
}

/** 记录当前版本已看过向导（完成、跳过、Esc 关闭都会调用），并把全部门控记为已看过。 */
export function markOnboardingSeen(version: string): void {
  if (!version) return;
  const state = loadOnboardingState();
  state.lastSeenVersion = version;
  state.seenGateKeys = Array.from(
    new Set([...state.seenGateKeys, ...ONBOARDING_GATES.map((gate) => gate.key)]),
  );
  saveOnboardingState(state);
}

export function setOnboardingMuted(muted: boolean): void {
  const state = loadOnboardingState();
  state.muted = muted;
  saveOnboardingState(state);
}
