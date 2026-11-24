import type { AgentAnchorRect, AgentRequest } from '@texto/plugin-sdk';

export type AgentSessionStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface AgentSessionSnapshot {
  id: number;
  title: string;
  tabLabel: string;
  sourceText: string;
  status: AgentSessionStatus;
  text: string;
  error: string | null;
  anchor: AgentAnchorRect | null;
  request: AgentRequest | null;
  /** 本轮运行使用的模型配置 id；空串表示未指定。 */
  profileId: string;
}

/** 增量文本合并窗口：流式 token 很密，逐条通知会让结果视图重渲染过频。 */
const TEXT_FLUSH_MS = 80;

let seq = 0;
let snapshot: AgentSessionSnapshot = {
  id: 0,
  title: '',
  tabLabel: '',
  sourceText: '',
  status: 'idle',
  text: '',
  error: null,
  anchor: null,
  request: null,
  profileId: '',
};

const listeners = new Set<() => void>();
let pendingText = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

function replace(next: AgentSessionSnapshot) {
  snapshot = next;
  notify();
}

function clearFlushTimer() {
  if (!flushTimer) return;
  clearTimeout(flushTimer);
  flushTimer = null;
}

export function subscribeAgentSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAgentSession(): AgentSessionSnapshot {
  return snapshot;
}

/** 开始一轮新会话：递增 id、进入 streaming、清空文本与错误。 */
export function setAgentSession(input: {
  title: string;
  tabLabel?: string;
  sourceText?: string;
  anchor: AgentAnchorRect | null;
  request: AgentRequest;
  profileId?: string;
}): void {
  seq += 1;
  clearFlushTimer();
  pendingText = '';
  replace({
    id: seq,
    title: input.title,
    tabLabel: input.tabLabel ?? '',
    sourceText: input.sourceText ?? '',
    status: 'streaming',
    text: '',
    error: null,
    anchor: input.anchor,
    request: input.request,
    profileId: input.profileId ?? '',
  });
}

/** 追加流式文本；只在 streaming 时生效，按 80ms 窗口合并通知。 */
export function appendAgentText(delta: string): void {
  if (snapshot.status !== 'streaming') return;
  pendingText += delta;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!pendingText) return;
    const merged = snapshot.text + pendingText;
    pendingText = '';
    replace({ ...snapshot, text: merged });
  }, TEXT_FLUSH_MS);
}

/** 结束会话：`text` 缺省时合并已达文本与未冲刷的增量。 */
export function finishAgentSession(text?: string): void {
  if (snapshot.status !== 'streaming') return;
  clearFlushTimer();
  const merged = text ?? snapshot.text + pendingText;
  pendingText = '';
  replace({ ...snapshot, status: 'done', text: merged, error: null });
}

export function failAgentSession(message: string): void {
  if (snapshot.status !== 'streaming') return;
  clearFlushTimer();
  const merged = snapshot.text + pendingText;
  pendingText = '';
  replace({ ...snapshot, status: 'error', text: merged, error: message });
}

/** 回到空闲：清空内容与请求，保留 id/anchor 供视图过渡使用。 */
export function resetAgentSession(): void {
  clearFlushTimer();
  pendingText = '';
  replace({
    ...snapshot,
    status: 'idle',
    title: '',
    tabLabel: '',
    sourceText: '',
    text: '',
    error: null,
    request: null,
    profileId: '',
  });
}

/** 测试用：立即冲刷待合并的增量文本。 */
export function flushAgentTextForTests(): void {
  clearFlushTimer();
  if (!pendingText) return;
  const merged = snapshot.text + pendingText;
  pendingText = '';
  replace({ ...snapshot, text: merged });
}

export function resetAgentSessionForTests(): void {
  clearFlushTimer();
  pendingText = '';
  seq = 0;
  snapshot = {
    id: 0,
    title: '',
    tabLabel: '',
    sourceText: '',
    status: 'idle',
    text: '',
    error: null,
    anchor: null,
    request: null,
    profileId: '',
  };
  listeners.clear();
}
