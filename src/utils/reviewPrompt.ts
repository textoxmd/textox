import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'textox.reviewPrompt.v1';

// 首次请求系统评分：第 3 次启动后
const FIRST_PROMPT_LAUNCH = 3;
// 之后每 30 次启动再请求一次
const NEXT_PROMPT_LAUNCH_GAP = 30;
// 两次请求之间至少间隔 90 天（配合 Apple 每年最多 3 次的系统限制）
const MIN_PROMPT_INTERVAL_DAYS = 90;
// 每年最多主动请求 3 次（超过后系统也会自动忽略）
const MAX_PROMPT_ATTEMPTS = 3;

interface ReviewPromptState {
  launches: number;
  attempts: number;
  lastAttemptAt: number;
}

const DEFAULT_STATE: ReviewPromptState = {
  launches: 0,
  attempts: 0,
  lastAttemptAt: 0,
};

function loadState(): ReviewPromptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state: ReviewPromptState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储失败不影响主流程，最多下次再触发
  }
}

/** 记录一次主窗口启动 */
export function recordAppLaunch() {
  const state = loadState();
  state.launches += 1;
  saveState(state);
}

/** 是否已到请求系统评分的时机 */
function isPromptDue(state: ReviewPromptState): boolean {
  if (state.attempts >= MAX_PROMPT_ATTEMPTS) return false;
  if (state.launches < FIRST_PROMPT_LAUNCH) return false;
  if (state.attempts > 0) {
    const requiredLaunches = FIRST_PROMPT_LAUNCH + state.attempts * NEXT_PROMPT_LAUNCH_GAP;
    if (state.launches < requiredLaunches) return false;
    const elapsedDays = (Date.now() - state.lastAttemptAt) / (24 * 60 * 60 * 1000);
    if (elapsedDays < MIN_PROMPT_INTERVAL_DAYS) return false;
  }
  return true;
}

/**
 * 在自然时机请求系统评分弹窗。
 *
 * macOS App Store 版本会弹出系统星号评分面板；非 App Store 构建或 Windows
 * 会回退打开商店评分页面。系统本身会限制实际展示频率。
 */
export async function maybeRequestAppReview(): Promise<void> {
  const state = loadState();
  if (!isPromptDue(state)) return;

  state.attempts += 1;
  state.lastAttemptAt = Date.now();
  saveState(state);

  try {
    await invoke('request_app_review');
  } catch (error) {
    console.error('Failed to request app review:', error);
  }
}
