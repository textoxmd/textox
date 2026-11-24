/**
 * Agent（MCP）逐字插入的节奏控制。
 *
 * 不是匀速打字：基础间隔带随机抖动，标点 / 换行处多停一拍，偶发一次小卡顿，
 * 观感更接近真人断续输入。调度表按**真实时间轴**预生成，消费端按真实时间
 * 追进度 —— 窗口被系统降频或切到后台再回来时能一次性补齐，不会把整段文本
 * 拖成几十秒。
 *
 * 时间表上限默认 8s；超长文本等比压缩，保证一次 MCP 插入不会长时间占住界面。
 */

export interface AgentStreamTiming {
  /** 每个字符的基础间隔（毫秒），默认 26 */
  baseDelay?: number;
  /** 标点后的额外停顿（毫秒），默认 110 */
  punctuationPause?: number;
  /** 换行后的额外停顿（毫秒），默认 240 */
  newlinePause?: number;
  /** 总时长上限（毫秒），默认 8000 */
  maxDuration?: number;
  /** 随机源（测试注入用） */
  random?: () => number;
}

export interface AgentStreamStep {
  /** 这一步要插入的文本（一个字素簇） */
  text: string;
  /** 相对流开始的时刻（毫秒） */
  at: number;
}

/** 单步延时上限：保持在历史会话 500ms 的合并窗口内，整段插入只算一步撤销。 */
const MAX_STEP_DELAY = 420;

const PUNCTUATION = new Set([
  '，', '。', '！', '？', '；', '：', '、', '…', '—',
  ',', '.', '!', '?', ';', ':',
]);

const graphemeSegmenter: { segment: (input: string) => Iterable<{ segment: string }> } | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new (Intl as unknown as {
        Segmenter: new (
          locale: string,
          options: { granularity: 'grapheme' },
        ) => { segment: (input: string) => Iterable<{ segment: string }> };
      }).Segmenter('zh', { granularity: 'grapheme' })
    : null;

export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (!graphemeSegmenter) return Array.from(text);
  const out: string[] = [];
  for (const part of graphemeSegmenter.segment(text)) out.push(part.segment);
  return out;
}

export function buildAgentStreamSchedule(
  text: string,
  timing: AgentStreamTiming = {},
): AgentStreamStep[] {
  const graphemes = splitGraphemes(text);
  if (graphemes.length === 0) return [];
  const base = timing.baseDelay ?? 26;
  const punctuation = timing.punctuationPause ?? 110;
  const newline = timing.newlinePause ?? 240;
  const maxDuration = timing.maxDuration ?? 8000;
  const random = timing.random ?? Math.random;

  const steps: AgentStreamStep[] = [];
  let at = 0;
  for (const grapheme of graphemes) {
    let delay = base * (0.55 + random() * 0.9);
    if (grapheme === '\n') {
      delay += newline * (0.7 + random() * 0.6);
    } else if (PUNCTUATION.has(grapheme)) {
      delay += punctuation * (0.6 + random() * 0.8);
    } else if (grapheme === ' ') {
      delay += random() * 18;
    }
    if (random() < 0.04) delay += 30 + random() * 70;
    at += Math.min(delay, MAX_STEP_DELAY);
    steps.push({ text: grapheme, at });
  }

  const total = steps[steps.length - 1].at;
  if (maxDuration > 0 && total > maxDuration) {
    const scale = maxDuration / total;
    for (const step of steps) step.at = Math.round(step.at * scale);
  }
  return steps;
}

export interface AgentStreamHandle {
  /** 立即停止（已插入的内容保留） */
  cancel: () => void;
  /** 自然播完或取消后 resolve */
  done: Promise<void>;
}

const nowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * 按调度表逐字吐字：每个动画帧把「已到时间」的字素合成一片交给 emit。
 * emit 抛错即终止（调用方负责收尾）。
 */
export function runAgentStream(
  text: string,
  emit: (chunk: string) => void,
  timing?: AgentStreamTiming,
): AgentStreamHandle {
  const steps = buildAgentStreamSchedule(text, timing);
  let index = 0;
  let settled = false;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  /** 取消已排的 rAF / 定时器（两者只会有一个真正生效）。 */
  const unschedule = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    unschedule();
    resolveDone();
  };

  /**
   * rAF 与定时器竞争，谁先到用谁：窗口最小化或被完全遮挡时 rAF 会暂停，
   * 只用它会卡住整段插入（输入锁与透明光标都解不掉，done 也永不 resolve）；
   * 后台 rAF 被降频到 1fps 时，间隔还会超过撤销合并窗口。定时器兜底保证
   * 真实时间轴始终有人在追。
   */
  const schedule = () => {
    unschedule();
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      tick();
    });
    timer = setTimeout(() => {
      timer = null;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      tick();
    }, 64);
  };

  if (steps.length === 0) {
    finish();
    return { cancel: finish, done };
  }

  const started = nowMs();
  const tick = () => {
    if (settled) return;
    const elapsed = nowMs() - started;
    let chunk = '';
    while (index < steps.length && steps[index].at <= elapsed) {
      chunk += steps[index].text;
      index += 1;
    }
    if (chunk) {
      try {
        emit(chunk);
      } catch {
        finish();
        return;
      }
    }
    if (index >= steps.length) {
      finish();
      return;
    }
    schedule();
  };
  schedule();

  return {
    cancel: () => {
      if (settled) return;
      settled = true;
      unschedule();
      resolveDone();
    },
    done,
  };
}

/** 键位里会改变文档内容的那些（无修饰键时）。 */
const EDITING_KEYS = new Set([
  'Backspace',
  'Delete',
  'Enter',
  'Tab',
  'Space',
  'Insert',
  'Process',
]);

const BLOCKED_SHORTCUTS = new Set(['v', 'x', 'z', 'y', 'b', 'i', 'u', 'k']);

/**
 * Agent 插入期间锁住人工输入：在捕获阶段拦掉 beforeinput / 粘贴 / 拖放 /
 * 组合输入与编辑类按键，防止用户与逐字插入互相踩。复制、选中、滚动不受影响，
 * Esc 交给调用方终止插入。
 *
 * 返回解除函数（可重复调用）。
 */
export function lockEditorInput(dom: HTMLElement, onEscape: () => void): () => void {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      if (BLOCKED_SHORTCUTS.has(event.key.toLowerCase())) stop(event);
      return;
    }
    if (event.key.length === 1 || EDITING_KEYS.has(event.key)) stop(event);
  };

  const handleBeforeInput = (event: Event) => stop(event);
  const handleComposition = (event: Event) => stop(event);

  const listeners: Array<[string, EventListener]> = [
    ['beforeinput', handleBeforeInput],
    ['keydown', handleKeydown as unknown as EventListener],
    ['paste', stop],
    ['cut', stop],
    ['drop', stop],
    ['compositionstart', handleComposition],
  ];

  for (const [name, listener] of listeners) {
    dom.addEventListener(name, listener, true);
  }

  return () => {
    for (const [name, listener] of listeners) {
      dom.removeEventListener(name, listener, true);
    }
  };
}
