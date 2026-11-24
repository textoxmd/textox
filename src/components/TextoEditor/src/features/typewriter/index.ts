import { Plugin, PluginKey } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { Schema } from "prosemirror-model";


import type { FeatureSpec } from "../_types.ts";
import { getScrollParent } from "../../scroll-parent.ts";
import { toast } from "sonner";
import i18next from "i18next";

const TARGET_FRACTION = 0.45;
const USER_SCROLL_TIMEOUT = 1500;
const PAD_CLASS = "tw-pad";
const MIN_ANIM_DISTANCE_PX = 120;
const BASE_ANIM_MS = 160;
const MAX_ANIM_MS = 420;
const ANIM_MS_PER_PX = 0.18;
const PAD_TOP_VAR = "--tw-pad-top";
const PAD_BOTTOM_VAR = "--tw-pad-bottom";
const PAD_ANIM_MS = 220;

export type TypewriterMeta = {
  enabled?: boolean;
  userScrolled?: boolean;
};

/** 读取 .ProseMirror 伪元素留白的当前计算高度（px）。 */
function padHeightOf(el: HTMLElement, pseudo: "::before" | "::after"): number {
  try {
    const height = getComputedStyle(el, pseudo).height;
    const px = height ? Number.parseFloat(height) : NaN;
    if (Number.isFinite(px) && px > 0) return px;
  } catch {}
  try {
    const fraction = pseudo === "::before" ? TARGET_FRACTION : 1 - TARGET_FRACTION;
    return window.innerHeight * fraction;
  } catch {
    return 0;
  }
}

function readPadSizes(el: HTMLElement): { top: number; bottom: number } {
  return { top: padHeightOf(el, "::before"), bottom: padHeightOf(el, "::after") };
}

function setPadSizes(el: HTMLElement, top: number, bottom: number): void {
  el.style.setProperty(PAD_TOP_VAR, `${top}px`);
  el.style.setProperty(PAD_BOTTOM_VAR, `${bottom}px`);
}

function clearPadVars(el: HTMLElement): void {
  el.style.removeProperty(PAD_TOP_VAR);
  el.style.removeProperty(PAD_BOTTOM_VAR);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export const typewriterPluginKey = new PluginKey<{
  enabled: boolean;
  userScrolled: boolean;
}>("typewriter");

export function typewriterPlugin(): Plugin {
  let userScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;

  function markUserScroll(view: import("prosemirror-view").EditorView) {
    if (!view.dom.isConnected) return;
    const s = typewriterPluginKey.getState(view.state);
    if (!s?.enabled) return;
    try {
      view.dispatch(view.state.tr.setMeta(typewriterPluginKey, { userScrolled: true }));
    } catch {}
  }

  return new Plugin({
    key: typewriterPluginKey,
    state: {
      init: () => ({ enabled: false, userScrolled: false }),
      apply: (tr, prev) => {
        const meta: TypewriterMeta | null = tr.getMeta(typewriterPluginKey);
        if (meta?.enabled !== undefined) {
          // 开启模式时清掉“用户手动滚动”标记，让进入模式立即回到跟随状态
          return {
            ...prev,
            enabled: meta.enabled,
            userScrolled: meta.enabled ? false : prev.userScrolled,
          };
        }
        if (meta?.userScrolled !== undefined) {
          return { ...prev, userScrolled: meta.userScrolled };
        }
        if (tr.selectionSet || tr.docChanged) {
          return { ...prev, userScrolled: false };
        }
        return prev;
      },
    },
    view: (view) => {
      const scrollParent = getScrollParent(view);
      const wrap = view.dom.parentElement as HTMLElement;
      let paddingOn = typewriterPluginKey.getState(view.state)?.enabled ?? false;
      let animating = false;
      let animRaf: number | null = null;
      let padAnimating = false;
      let padRaf: number | null = null;

      function setPad(on: boolean) {
        wrap.classList.toggle(PAD_CLASS, on);
        // 同时给 ProseMirror 元素添加/移除类名（CSS 样式在 widgets.css 中定义）
        view.dom.classList.toggle(PAD_CLASS, on);
      }
      setPad(paddingOn);

      function cancelScrollAnimation(): void {
        if (animRaf !== null) cancelAnimationFrame(animRaf);
        animRaf = null;
        animating = false;
      }

      function cancelPadAnimation(): void {
        if (padRaf !== null) cancelAnimationFrame(padRaf);
        padRaf = null;
        padAnimating = false;
      }

      /** 立即移除虚拟留白；按当前顶部留白高度补偿 scrollTop，尽量保持内容不动。 */
      function removePadInstantly(): void {
        cancelPadAnimation();
        if (paddingOn) {
          const top = padHeightOf(view.dom, "::before");
          paddingOn = false;
          setPad(false);
          scrollParent.scrollTop = Math.max(0, scrollParent.scrollTop - top);
        }
        clearPadVars(view.dom);
      }

      /** 取消打字机模式：在 220ms 内把虚拟留白平滑收为 0。
       *  顶部留白每缩小一点，scrollTop 同步回退，让内容自然过渡到
       *  不带留白的阅读位置；文档开头/结尾无法完全补偿时，
       *  残余位移也随留白渐变，而不是瞬间弹跳。 */
      function collapsePad(): void {
        cancelPadAnimation();
        if (prefersReducedMotion()) {
          removePadInstantly();
          return;
        }
        const start = readPadSizes(view.dom);
        if (start.top <= 0.5 && start.bottom <= 0.5) {
          removePadInstantly();
          return;
        }
        const fromScroll = scrollParent.scrollTop;
        padAnimating = true;
        const startTime = performance.now();
        let lastWritten = fromScroll;
        const step = (now: number) => {
          const progress = Math.min(1, (now - startTime) / PAD_ANIM_MS);
          const eased = 1 - Math.pow(1 - progress, 3);
          const top = start.top * (1 - eased);
          const bottom = start.bottom * (1 - eased);
          if (Math.abs(scrollParent.scrollTop - lastWritten) > 1.5) {
            // 用户中途接管滚动：直接完成收起
            cancelPadAnimation();
            removePadInstantly();
            return;
          }
          setPadSizes(view.dom, top, bottom);
          // 留白高度变化会同步改变可滚动范围，按当前最大值收敛后再写入
          const max = Math.max(
            0,
            scrollParent.scrollHeight - scrollParent.clientHeight,
          );
          lastWritten = Math.max(
            0,
            Math.min(fromScroll - start.top * eased, max),
          );
          scrollParent.scrollTop = lastWritten;
          if (progress < 1) {
            padRaf = requestAnimationFrame(step);
          } else {
            padRaf = null;
            padAnimating = false;
            removePadInstantly();
          }
        };
        padRaf = requestAnimationFrame(step);
      }

      function handleUserScroll(): void {
        if (!view.dom.isConnected) return;
        const s = typewriterPluginKey.getState(view.state);
        if (!s?.enabled || s.userScrolled) return;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => markUserScroll(view));
        if (userScrollTimer) clearTimeout(userScrollTimer);
        userScrollTimer = setTimeout(() => {
          if (!view.dom.isConnected) return;
          try {
            const s = typewriterPluginKey.getState(view.state);
            if (s?.userScrolled) {
              view.dispatch(view.state.tr.setMeta(typewriterPluginKey, { userScrolled: false }));
            }
          } catch {}
        }, USER_SCROLL_TIMEOUT);
      }

      const onScroll = () => {
        if (!view.dom.isConnected || animating || padAnimating) return;
        handleUserScroll();
      };
      scrollParent.addEventListener("scroll", onScroll, { passive: true });

      /** 平滑滚动到 target：ease-out。动画期间忽略自身滚动事件；
       *  若检测到用户手动滚动（滚轮/触控板/滚动条），立即交还控制权。 */
      function smoothScrollTo(target: number): void {
        cancelScrollAnimation();
        const from = scrollParent.scrollTop;
        const distance = target - from;
        if (Math.abs(distance) <= 1 || prefersReducedMotion()) {
          scrollParent.scrollTop = target;
          return;
        }
        animating = true;
        const duration = Math.min(
          MAX_ANIM_MS,
          BASE_ANIM_MS + Math.abs(distance) * ANIM_MS_PER_PX,
        );
        const start = performance.now();
        let lastWritten = from;
        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          const next = from + distance * eased;
          if (Math.abs(scrollParent.scrollTop - lastWritten) > 1.5) {
            cancelScrollAnimation();
            handleUserScroll();
            return;
          }
          lastWritten = next;
          scrollParent.scrollTop = next;
          if (progress < 1) {
            animRaf = requestAnimationFrame(step);
          } else {
            animRaf = null;
            animating = false;
          }
        };
        animRaf = requestAnimationFrame(step);
      }

      /** 将光标行滚动到目标位置。距离较大时用动画过渡，避免生硬跳变；
       *  打字等小幅跟随仍即时定位，保证跟手。 */
      function centerCursor(): void {
        const target = computeCursorTarget(view);
        if (target === null) return;
        const distance = Math.abs(target - scrollParent.scrollTop);
        if (distance <= 1) return;
        if (distance >= MIN_ANIM_DISTANCE_PX && !prefersReducedMotion()) {
          smoothScrollTo(target);
        } else {
          cancelScrollAnimation();
          scrollParent.scrollTop = target;
        }
      }

      function ensureFocus() {
        setTimeout(() => {
          try {
            if (view.dom.isConnected) {
              (view.dom as HTMLElement).focus();
            }
          } catch {}
        }, 50);
      }

      return {
        update: (view, prevState) => {
          if (!view.dom.isConnected) return;
          const state = typewriterPluginKey.getState(view.state);
          if (!state) return;

          const prevTypewriterState = typewriterPluginKey.getState(prevState);
          const turningOn = state.enabled && !prevTypewriterState?.enabled;
          const turningOff = !state.enabled && prevTypewriterState?.enabled;

          if (turningOn) {
            // 开启：先归一（若上一次收起动画未完成），补上留白并同帧滚动补偿，
            // 让可见内容保持原位，再由 centerCursor 平滑过渡到目标位置。
            removePadInstantly();
            ensureFocus();
            paddingOn = true;
            setPad(true);
            scrollParent.scrollTop =
              scrollParent.scrollTop + padHeightOf(view.dom, "::before");
            centerCursor();
            return;
          }

          if (turningOff) {
            // 取消：平滑收起虚拟留白（内容随留白渐变到自然位置）
            cancelScrollAnimation();
            collapsePad();
            return;
          }

          if (!state.enabled || state.userScrolled) {
            cancelScrollAnimation();
            if (!state.enabled) removePadInstantly();
            return;
          }
          cancelScrollAnimation();
          centerCursor();
        },
        destroy: () => {
          cancelScrollAnimation();
          removePadInstantly();
          scrollParent.removeEventListener("scroll", onScroll);
          if (userScrollTimer) clearTimeout(userScrollTimer);
          if (rafId) cancelAnimationFrame(rafId);
        },
      };
    },
  });
}

/** 计算让光标行落在目标位置的 scrollTop；容器不可见（高度为 0）时返回 null。 */
function computeCursorTarget(
  view: import("prosemirror-view").EditorView,
): number | null {
  const scrollParent = getScrollParent(view);
  if (scrollParent.clientHeight === 0) return null;

  const { from } = view.state.selection;
  let coords = view.coordsAtPos(from);

  // 如果获取不到坐标（如空文档），使用编辑器顶部作为参考
  if (!coords || coords.top === 0 && coords.bottom === 0) {
    const domRect = view.dom.getBoundingClientRect();
    const padHeight = scrollParent.clientHeight * TARGET_FRACTION;
    coords = {
      top: domRect.top + padHeight,
      bottom: domRect.top + padHeight,
      left: domRect.left,
      right: domRect.left
    };
  }

  const viewH = scrollParent.getBoundingClientRect().height;
  const curY = coords.top - scrollParent.getBoundingClientRect().top;
  const target = scrollParent.scrollTop + curY - TARGET_FRACTION * viewH;
  const max = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight);
  const clamped = Math.max(0, Math.min(target, max));

  return clamped;
}

// 打字机已收进 AppConfig（typewriter_enabled），为单一数据源。PM keymap 会在
// 编辑器内先拦截 Mod-Shift-t 并 preventDefault，App/原生菜单拿不到该按键，
// 因此这里本地切换后要把结果同步回配置，其他窗口通过 config-changed 广播收敛。
async function syncTypewriterPreference(enabled: boolean): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const config = await invoke<{ typewriter_enabled?: boolean }>("get_config");
    if (config.typewriter_enabled === enabled) return;
    await invoke("set_config", {
      config: { ...config, typewriter_enabled: enabled },
    });
  } catch (err) {
    // 非 Tauri 环境（网页演示）没有配置后端，切换仅在本会话内生效
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      console.error("Failed to persist typewriter preference:", err);
    }
  }
}

export const toggleTypewriterCommand: Command = (state, dispatch) => {
  const pluginState = typewriterPluginKey.getState(state);
  const next = !pluginState?.enabled;
  if (dispatch) {
    dispatch(state.tr.setMeta(typewriterPluginKey, { enabled: next }));
  }
  try {
    window.dispatchEvent(new CustomEvent("typewriter-changed", { detail: { enabled: next } }));
  } catch {}
  void syncTypewriterPreference(next);
  toast(next ? i18next.t("message.typewriterEnabled") : i18next.t("message.typewriterDisabled"), { duration: 1500 });
  return true;
};

export const typewriter: FeatureSpec = {
  name: "typewriter",
  plugins: () => [typewriterPlugin()],
  keymap: (_schema: Schema) => ({
    "Mod-Shift-t": toggleTypewriterCommand,
  }),
};
