import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { AgentAnchorRect, AgentPresentSize } from '@texto/plugin-sdk';
import { AgentResultView, useAgentSession, useAgentSurface } from './ResultView';
import { getAgentSettings, subscribeAgentSettings } from './config';
import type { AgentSurface } from './config';
import { getAgentSession } from './session';

let hostEl: HTMLDivElement | null = null;
let root: Root | null = null;
let unsubscribeSettings: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
/** 最近一次展示的锚点；从侧栏浮回时用它重新定位（否则会停在旧位置）。 */
let lastAnchor: AgentAnchorRect | null = null;
/** 锚点时间戳：视口坐标会随窗口尺寸/编辑器滚动失效，超过保鲜期就不再用它定位。 */
let lastAnchorAt = 0;
/** 上一次同步时的承载面：仅在 sidebar → floating 跃迁时才重算位置。 */
let lastSurface: AgentSurface | null = null;
/** 最近一次 `present()` 给的尺寸偏好；重定位（浮回 / 内容变高）沿用同一份。 */
let preferredSize: AgentPresentSize | null = null;
/** 正在按算出的坐标写样式：此时尺寸变化由我们引起，不必再定位。 */
let positioning = false;
/** 滚动/尺寸变化导致卡片被隐藏：只有新的 present() 或显式浮回才解除。 */
let hidden = false;

const VIEWPORT_MARGIN = 12;
const DEFAULT_WIDTH = 420;
/** 极窄窗口下的最小可用宽度（再窄就退化为夹取左边缘）。 */
const MIN_WIDTH = 280;
/** 卡片与锚点的间距。 */
const ANCHOR_GAP = 8;
/** 锚点保鲜期：超过这么久未更新就不再尝试浮回原位（期间可能已滚动/改窗口）。 */
const ANCHOR_FRESH_MS = 10_000;

function clamp(value: number, min: number, max: number): number {
  // 窗口过窄时 max 可能小于 min，以 min 为准，保证至少能看到左/上边缘。
  return Math.max(min, Math.min(value, max));
}

/**
 * 按真实尺寸定位悬浮卡：
 *
 * 1. 宽度 / 最大高度先按视口夹取，写下样式后量出实际高度（流式输出会持续变高）；
 * 2. 优先放锚点下方；下方放不下且上方空间足够时翻到上方；两侧都不够则选空间更大的一侧；
 * 3. 最后把 left / top 四边夹取到视口内，避免贴近屏幕边缘时被裁掉。
 *
 * `anchor` 为 null（锚点过期 / 无选区）时落在左上角 margin。
 */
function position(el: HTMLDivElement, anchor: AgentAnchorRect | null): void {
  const margin = VIEWPORT_MARGIN;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxViewportWidth = Math.max(MIN_WIDTH, viewportWidth - 2 * margin);
  const maxViewportHeight = Math.max(0, viewportHeight - 2 * margin);

  const width = clamp(preferredSize?.width ?? DEFAULT_WIDTH, MIN_WIDTH, maxViewportWidth);
  const maxHeight = Math.max(
    0,
    Math.min(preferredSize?.maxHeight ?? viewportHeight * 0.6, maxViewportHeight),
  );

  // 先落尺寸再量高度：容器高度由内容撑开，无内容时回退到 maxHeight。
  el.style.width = `${width}px`;
  el.style.maxHeight = `${maxHeight}px`;
  const card = el.firstElementChild;
  if (card instanceof HTMLElement) card.style.maxHeight = `${maxHeight}px`;
  const measured = el.getBoundingClientRect().height;
  const height = clamp(measured > 0 ? measured : maxHeight, 0, maxViewportHeight);

  let left = margin;
  let top = margin;
  if (anchor) {
    left = clamp(anchor.left, margin, viewportWidth - width - margin);

    const below = anchor.bottom + ANCHOR_GAP;
    const above = anchor.top - ANCHOR_GAP - height;
    const spaceBelow = viewportHeight - margin - below;
    const spaceAbove = anchor.top - ANCHOR_GAP - margin;
    if (spaceBelow >= height) top = below;
    else if (spaceAbove >= height) top = above;
    else top = spaceBelow >= spaceAbove ? below : above;
    top = clamp(top, margin, viewportHeight - height - margin);
  }

  // 只在坐标真的变化时写样式：避免尺寸变化与重新定位互相触发（ResizeObserver 回环）。
  positioning = true;
  try {
    const nextLeft = `${left}px`;
    const nextTop = `${top}px`;
    if (el.style.left !== nextLeft) el.style.left = nextLeft;
    if (el.style.top !== nextTop) el.style.top = nextTop;
  } finally {
    positioning = false;
  }
}

/**
 * 内容高度变化（流式输出逐段变高）后重新定位。
 * 侧栏承载面 / 卡片隐藏时内容尺寸与悬浮位置无关，直接跳过。
 */
function observeResize(): void {
  if (!hostEl || resizeObserver || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    if (!hostEl || positioning) return;
    if (hostEl.style.display === 'none') return;
    if (getAgentSettings().surface !== 'floating') return;
    position(hostEl, lastAnchor);
  });
  resizeObserver.observe(hostEl);
}

function syncVisibility(): void {
  if (!hostEl) return;
  const surface = getAgentSettings().surface;
  const floating = surface === 'floating';
  const returning = lastSurface === 'sidebar' && surface === 'floating';
  lastSurface = surface;
  // sidebar → floating 是用户显式「浮回」：解除滚动造成的隐藏。
  if (returning) hidden = false;
  // 只在 sidebar → floating 跃迁时重定位：最佳努力，不做文档位置重解析
  // （锚点不是文档坐标，侧栏期间编辑区滚动/窗口尺寸变化都无法追踪），
  // 过期就回落到左上角默认位。已处于 floating 时的设置变更不移动卡片。
  if (floating && returning) {
    const fresh = lastAnchor !== null && Date.now() - lastAnchorAt <= ANCHOR_FRESH_MS;
    position(hostEl, fresh ? lastAnchor : null);
  }
  // 滚动隐藏后不因设置变更（config 通知）自己弹回来：需要新的 present() 或显式浮回。
  hostEl.style.display = floating && !hidden ? '' : 'none';
}

function hide(): void {
  if (!hostEl) return;
  hidden = true;
  // 锚点已随滚动失效；浮回时回落到默认位，而不是旧坐标。
  lastAnchor = null;
  lastAnchorAt = 0;
  hostEl.style.display = 'none';
}

const RESULT_SURFACE_SELECTOR = '.agent-result-body, .agent-sidebar-panel, .agent-presenter-root';
const EDITOR_SCROLL_SELECTOR = '.editor-area, .cm-scroller, .ProseMirror';

/**
 * 锚点是视口坐标，编辑器滚动或窗口尺寸变化后立即失效：
 * 只隐藏悬浮卡，避免结果块停在错误位置。
 *
 * 会话与结果保留：释义结果留在「释义」tab 里，X 是唯一清除入口，
 * 滚动不应中止运行或清空内容。
 *
 * 只对悬浮模式生效：侧栏面板不是锚定在选区上的，滚动/尺寸变化与它无关。
 */
function closeOnViewportChange(event: Event): void {
  if (getAgentSettings().surface !== 'floating') return;
  // idle 时没有内容可隐藏，直接跳过。
  if (getAgentSession().status === 'idle') return;
  // 结果正文与侧栏面板自身可滚动（overflow: auto），不要因此关掉卡片。
  if (
    event.type === 'scroll' &&
    event.target instanceof Element &&
    event.target.closest(RESULT_SURFACE_SELECTOR)
  ) {
    return;
  }
  // 只有编辑器区域（或其滚动容器）内的 scroll 才让锚点失效；
  // 侧栏文件树/大纲等其它容器滚动与选区位置无关，不关闭卡片。
  if (
    event.type === 'scroll' &&
    event.target instanceof Element &&
    !event.target.closest(EDITOR_SCROLL_SELECTOR)
  ) {
    return;
  }
  // 锚点失效：只隐藏悬浮卡，会话与结果都保留。
  hide();
}

function ensureMounted(): void {
  if (hostEl) return;
  // 结构在挂载前一次建好；挂载后不再往容器追加层级（WebKit 对后续 DOM 变更更敏感）。
  const el = document.createElement('div');
  el.className = 'agent-presenter-root';
  document.body.appendChild(el);
  hostEl = el;
  root = createRoot(el);
  root.render(<FloatingCard />);
  observeResize();
  unsubscribeSettings = subscribeAgentSettings(syncVisibility);
  window.addEventListener('resize', closeOnViewportChange);
  window.addEventListener('scroll', closeOnViewportChange, true);
}

export function attachFloatingCard(anchor: AgentAnchorRect | null, size?: AgentPresentSize): void {
  ensureMounted();
  // 新的 present() 一定显示：解除滚动造成的隐藏。
  hidden = false;
  lastAnchor = anchor;
  lastAnchorAt = Date.now();
  // 缺省尺寸：宽度 420、最大高度视口 60%（position 内按视口夹取）。
  preferredSize = size ?? null;
  // 首次定位（后续只在 sidebar → floating 跃迁 / 内容尺寸变化时重定位）。
  if (hostEl) position(hostEl, anchor);
  syncVisibility();
}

export function detachFloatingCard(): void {
  lastAnchor = null;
  lastAnchorAt = 0;
  lastSurface = null;
  preferredSize = null;
  hidden = false;
  resizeObserver?.disconnect();
  resizeObserver = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  window.removeEventListener('resize', closeOnViewportChange);
  window.removeEventListener('scroll', closeOnViewportChange, true);
  if (!hostEl) return;
  root?.unmount();
  hostEl.remove();
  hostEl = null;
  root = null;
}

function FloatingCard() {
  const session = useAgentSession();
  const surface = useAgentSurface();
  // 侧栏模式/空闲时不渲染结果树，避免隐藏容器继续解析 Markdown。
  if (surface !== 'floating' || session.status === 'idle') return null;
  return <AgentResultView variant="floating" />;
}
