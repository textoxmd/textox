import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type EditorPaneMode = 'ir' | 'sv';
/** idle = 稳态（display 切换）；warm = 两层就位但未换位；run = 正在滑动。 */
export type PanePhase = 'idle' | 'warm' | 'run';

/**
 * 转场时长（ms）。**必须**与 `editor.css` 中 `.editor-pane` 在 run 相位的
 * transition 时长一致（`editorPaneCss.test.ts` 会交叉校验两者）。
 */
export const PANE_TRANSITION_MS = 340;
/** 收敛余量：计时器比动画稍晚触发，确保过渡已结束。 */
export const PANE_SETTLE_MS = 60;

export interface UsePaneTransitionOptions {
  /** 返回 false 时本次切换走瞬时路径（典型场景：懒加载的编辑器还没就绪）。 */
  canAnimate?: () => boolean;
  /** 用于强制样式/布局提交的容器（见设计文档 2.3）。 */
  containerRef?: { current: HTMLElement | null };
}

export interface UsePaneTransitionResult {
  visualMode: EditorPaneMode;
  phase: PanePhase;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * 把 `mode` 的变化投影成"晚一帧才换位"的三相位转场。
 *
 * 为什么需要它：两个编辑器常驻挂载、靠 display 切换。要让它们同时滑动，
 * 必须先在"还没开始动"的帧让两层都参与布局（warm），下一帧才翻目标位（run）——
 * 否则浏览器会把"从 display:none 到可布局"和"transform 变化"合并成一次样式
 * 变更，拿不到变更前样式，过渡不会触发。
 */
export function usePaneTransition(
  mode: EditorPaneMode,
  options: UsePaneTransitionOptions = {},
): UsePaneTransitionResult {
  const [visualMode, setVisualMode] = useState<EditorPaneMode>(mode);
  const [phase, setPhase] = useState<PanePhase>('idle');

  const visualRef = useRef(visualMode);
  visualRef.current = visualMode;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const canAnimateRef = useRef(options.canAnimate);
  canAnimateRef.current = options.canAnimate;
  const { containerRef } = options;

  const rafRef = useRef<number | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancelSettle = useCallback(() => {
    if (settleRef.current !== null) {
      clearTimeout(settleRef.current);
      settleRef.current = null;
    }
  }, []);

  const settle = useCallback((delay = PANE_TRANSITION_MS + PANE_SETTLE_MS) => {
    if (settleRef.current !== null) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      settleRef.current = null;
      setPhase('idle');
    }, delay);
  }, []);

  useEffect(() => {
    if (mode === visualRef.current) {
      // warm 期间"反悔"回到当前视觉模式：撤销待执行的换位，回到稳态。
      // phase === 'run' 时什么都不做 —— 动画正朝 mode 收敛，让它自然结束。
      if (phaseRef.current === 'warm') {
        cancelRaf();
        cancelSettle();
        setPhase('idle');
      }
      return;
    }

    const animate = canAnimateRef.current?.() !== false && !prefersReducedMotion();

    if (!animate) {
      cancelRaf();
      cancelSettle();
      setVisualMode(mode);
      setPhase('idle');
      return;
    }

    if (phaseRef.current === 'run') {
      // 中途反向：不回 warm（那会摘掉过渡属性、画面跳变），直接翻目标位；
      // CSS 过渡从当前计算值反向插值，无需额外处理。
      setVisualMode(mode);
      settle();
      return;
    }

    // ① warm：两层都参与布局、各自在起止位置就位，但尚未换位。
    setPhase('warm');
    // 兜底：rAF 因故未跑（如窗口被隐藏）时也要收敛回稳态。
    settle(PANE_TRANSITION_MS + PANE_SETTLE_MS + 100);
  }, [mode, settle, cancelRaf, cancelSettle, containerRef]);

  // ①→②：等 warm 真正落到 DOM 之后再强制一次样式/布局提交，下一帧才翻到 run。
  //
  // 为什么回流必须放在 layout effect 里：`void container.offsetWidth` 只有在
  // warm 已经提交到 DOM 时，才会把"入场层已参与布局 + 处于起点 transform"这一
  // 计算值固化为过渡的"变更前样式"。若把它写在 `setPhase('warm')` 之后的同一段
  // 同步代码里（本轮之前就是如此），读到的仍是 warm 之前的稳态 DOM，等于没有回流
  // ——run 的变更前样式会退化成稳态（入场层 display:none），入场页因此不平移、
  // 只有出场页在动，表现为"两页不同步"。
  //
  // layout effect 在 commit 之后同步运行、早于绘制，因此这里读到的容器已经带上
  // `data-pane-transition="warm"`；强制回流后浏览器即持有 warm 的计算值，run 无论
  // 是否与 warm 落在同一帧都能拿到正确的"变更前样式"，过渡稳定触发。
  useLayoutEffect(() => {
    if (phase !== 'warm') return;
    if (containerRef?.current) void containerRef.current.offsetWidth;

    // ② run：下一帧才翻目标位，过渡只在此相位生效。
    cancelRaf();
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setVisualMode(mode);
      setPhase('run');
      settle();
    });
    return cancelRaf;
  }, [phase, mode, settle, cancelRaf, containerRef]);

  useEffect(
    () => () => {
      cancelRaf();
      cancelSettle();
    },
    [cancelRaf, cancelSettle],
  );

  return { visualMode, phase };
}
