// 渲染产物的放大浏览（lightbox）。
//
// 覆盖层挂在 document.body 上，与 ProseMirror 的编辑交互完全隔离：
//   - 缩放：滚轮 / 按钮 / 键盘（+ - 0 1）
//   - 平移：按住左键拖拽 / 方向键
//   - 旋转：按钮 / R
//   - 关闭：Esc / 点击背景 / 关闭按钮
//
// 两类来源：
//   - <img>：图片引用块预览、行内图片。用原始 src 重新加载，缩放百分比按
//     图片原始像素计算（100% = 原始尺寸）。
//   - 渲染节点（mermaid / math / 绘图 的 SVG 或 HTML）：克隆节点，SVG
//     按 viewBox 还原为原始像素尺寸，放大后仍是矢量清晰度。
//
// 触发方式（见 createZoomTrigger / decorations.ts）：
//   - 可编辑态：渲染容器右上角 hover 出现的放大按钮
//   - 锁定模式（阅读模式）：直接点击渲染产物
//   - 行内图片：双击

import i18next from "i18next";
import { toast } from "sonner";

import "./image-viewer.css";
import { getEditorHost, type SaveMediaSource } from "../host.ts";

export type ImageViewerSource =
  | {
      kind: "img";
      src: string;
      alt?: string;
      title?: string;
      naturalWidth?: number;
      naturalHeight?: number;
      /** 编辑器内的原图节点：打开 / 关闭时从它的位置缩放 */
      origin?: Element | null;
      /** 下载时的建议文件名；缺省从 URL 推导 */
      suggestedName?: string;
    }
  | {
      kind: "element";
      element: Element;
      /** 编辑器内的原节点 */
      origin?: Element | null;
      /** 下载时的建议文件名；缺省 diagram.svg */
      suggestedName?: string;
    };

export interface MediaContainerOptions {
  /** 下载时的建议文件名 */
  suggestedName?: string;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const ZOOM_STEP = 1.25;
/** 适应窗口时允许的放大上限：小图不至于被拉成马赛克 */
const MAX_FIT_SCALE = 4;
const FIT_PADDING = 0.94;
const ROTATE_STEP = 90;
const PAN_STEP = 60;
/** 位移超过该像素视为拖拽，随后的 click 不再当作「点击背景」 */
const DRAG_THRESHOLD = 4;
const TRIGGER_CLASS = "media-zoom-trigger";
/**
 * 转场节奏。只用最通用的手段：transform / opacity 过渡 + 标准 cubic-bezier 与
 * ease-in / ease-out 关键字 —— 任何引擎都支持。
 *
 * 之前为了"弹簧手感"用过采样 `linear()`（需 Safari 17.4+ / Chromium 113+），
 * 现在去掉，换成普通曲线；分层保留（内容 / 背景 / 工具栏各自一条），但时长与
 * 曲线各只用一个值，便于维护。
 */
const OPEN_MS = 400;
/** 打开时背景层淡入：只淡背景，副本不受影响（淡整层会让副本跟着透明） */
const OPEN_BG_MS = 250;
const CLOSE_MS = 200;
const BG_MS = 150;
/** 关闭时背景最后才淡出：缩放落位、原图还原之后才收背景 */
const CLOSE_BG_MS = 100;
const CHROME_DELAY_MS = 100;
const CHROME_MS = 200;
/** 内容位移曲线：25% / 50% / 75% 处约 23% / 64% / 91% 位移，不会"前段蹿完" */
const EASE_MOVE = "cubic-bezier(0.3, 0.05, 0.5, 1)";
/** 淡入 / 淡出用关键字，最通用 */
const EASE_FADE_IN = "ease-out";
const EASE_FADE_OUT = "ease-in";

function svgIcon(paths: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    ` stroke-linejoin="round">${paths}</svg>`
  );
}

const ICON_ZOOM = svgIcon(
  '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
);
const ICON_MINUS = svgIcon('<path d="M5 12h14"/>');
const ICON_PLUS = svgIcon('<path d="M12 5v14"/><path d="M5 12h14"/>');
const ICON_ROTATE = svgIcon(
  '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
);
const ICON_DOWNLOAD = svgIcon(
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
);
const ICON_CLOSE = svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

type MediaDownload = {
  suggestedName: string;
  extension: string;
  filterName: string;
};

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "ico",
  "heic",
  "heif",
  "tif",
  "tiff",
  "apng",
  "jxl",
]);

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

function safeFileNameBase(value: string): string {
  const cleaned = value
    .replace(INVALID_FILENAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  return cleaned.slice(0, 120) || "image";
}

function imageExtension(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /\.([a-z0-9]+)$/i.exec(value);
  if (!match) return null;
  const extension = match[1]!.toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

function fileNameFromUrl(url: string): string | null {
  if (!url || /^data:/i.test(url)) return null;
  try {
    const parsed = new URL(url, "https://invalid.local");
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (!last) return null;
    const decoded = decodeURIComponent(last);
    const base = decoded.split(/[\\/]/).filter(Boolean).pop();
    return base || null;
  } catch {
    return null;
  }
}

function extensionFromDataUrl(url: string): string | null {
  const match = /^data:image\/([a-z0-9.+-]+)[;,]/i.exec(url);
  if (!match) return null;
  const mime = match[1]!.toLowerCase();
  if (mime === "jpeg") return "jpg";
  if (mime === "svg+xml") return "svg";
  return IMAGE_EXTENSIONS.has(mime) ? mime : null;
}

function filterNameForExtension(extension: string): string {
  return extension === "svg" ? "SVG" : "Image";
}

function downloadFromSuggestedName(
  suggestedName: string,
  extension: string,
): MediaDownload {
  const base = safeFileNameBase(suggestedName.replace(/\.[^.]+$/, ""));
  return {
    suggestedName: `${base}.${extension}`,
    extension,
    filterName: filterNameForExtension(extension),
  };
}

function downloadForImage(
  source: Extract<ImageViewerSource, { kind: "img" }>,
): MediaDownload {
  const fromUrl = fileNameFromUrl(source.src);
  // 扩展名永远从实际 URL / data MIME 推导：suggestedName 只提供基名，
  // 否则传了 flow.svg 却存 PNG 字节会写坏文件。
  const extension =
    imageExtension(fromUrl) ?? extensionFromDataUrl(source.src) ?? "png";
  if (source.suggestedName) {
    return downloadFromSuggestedName(source.suggestedName, extension);
  }
  // URL 末段没有已知图片扩展名（/800/600、download?file=cat.png）时不当文件名
  const baseFromUrl =
    fromUrl && imageExtension(fromUrl)
      ? fromUrl.replace(/\.[^.]+$/, "")
      : "";
  const base = safeFileNameBase(
    baseFromUrl || source.alt || source.title || "image",
  );
  return {
    suggestedName: `${base}.${extension}`,
    extension,
    filterName: filterNameForExtension(extension),
  };
}

function downloadForSvg(
  source: Extract<ImageViewerSource, { kind: "element" }>,
): MediaDownload {
  return downloadFromSuggestedName(
    source.suggestedName?.trim() || "diagram.svg",
    "svg",
  );
}

/** 嵌入预览的下载名：沿用源文件名，把扩展名换成 .svg。 */
export function svgDownloadNameFromSource(
  src: string | undefined,
): string | undefined {
  if (!src) return undefined;
  const fileName = fileNameFromUrl(src);
  if (!fileName) return undefined;
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base ? `${safeFileNameBase(base)}.svg` : undefined;
}

function svgElementOf(element: Element): SVGElement | null {
  if (element.tagName.toLowerCase() === "svg") {
    return element as SVGElement;
  }
  return element.querySelector("svg");
}

/** 序列化 lightbox 内的 SVG 副本：保留 mermaid 的 id / 内部 style。 */
function serializeSvg(svg: SVGElement): string {
  const clone = svg.cloneNode(true) as SVGElement;
  // 副本上带着 lightbox 按原始像素写死的尺寸（见 cloneRenderedElement）；
  // 导出文件按 width/height 属性还原，不需要这些内联样式
  clone.style.width = "";
  clone.style.height = "";
  clone.style.maxWidth = "";
  clone.style.maxHeight = "";
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (
    clone.outerHTML.includes("xlink:") &&
    !clone.getAttribute("xmlns:xlink")
  ) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

type ViewerState = {
  overlay: HTMLElement;
  /** 背景层：单独淡入淡出，避免连副本一起透明 */
  backdrop: HTMLElement;
  stage: HTMLElement;
  content: HTMLElement;
  media: HTMLElement;
  toolbar: HTMLElement;
  zoomLabel: HTMLButtonElement;
  /** 编辑器内原图节点与打开时的位置（缩放动画的起点 / 终点） */
  origin: Element | null;
  originRect: { left: number; top: number; width: number; height: number } | null;
  /** 转场期间被本浮层隐藏的原图节点（关闭后按引用计数还原） */
  originHidden: Element | null;
  /** 打开前持有焦点的元素：关闭时归还，避免编辑器收不到键盘输入 */
  returnFocusTo: HTMLElement | null;
  scale: number;
  tx: number;
  ty: number;
  rotation: number;
  fitScale: number;
  /** 拖动中才显示贴边细描边（静止时完全融入背景） */
  ringOn: boolean;
  natural: { w: number; h: number };
  drag: {
    pointerId: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    tx: number;
    ty: number;
  } | null;
  /** 拖拽刚结束：吞掉浏览器补发的 click，避免误关闭 */
  suppressClick: boolean;
  downloadButton: HTMLButtonElement | null;
  download: MediaDownload | null;
  downloading: boolean;
};

let activeViewer: ViewerState | null = null;
let activeCleanups: Array<() => void> = [];

async function downloadMedia(state: ViewerState): Promise<void> {
  const download = state.download;
  if (state.downloading || !download) return;
  state.downloading = true;
  if (state.downloadButton) state.downloadButton.disabled = true;

  try {
    let source: SaveMediaSource;
    if (state.media instanceof HTMLImageElement) {
      source = { kind: "url", url: state.media.currentSrc || state.media.src };
    } else {
      const svg = svgElementOf(state.media);
      if (!svg) throw new Error("No SVG content to download");
      source = {
        kind: "text",
        text: serializeSvg(svg),
        mimeType: "image/svg+xml",
      };
    }

    const result = await getEditorHost().saveMedia({
      source,
      suggestedName: download.suggestedName,
      filterName: download.filterName,
      extension: download.extension,
    });
    if (result.saved) {
      toast.success(i18next.t("common.exportSuccess"));
    }
  } catch (error) {
    console.error("[editor] Failed to save media:", error);
    toast.error(i18next.t("common.exportFailed"));
  } finally {
    state.downloading = false;
    // 保存期间用户可能已经关闭 lightbox：不要再操作已移除的按钮
    if (activeViewer === state && state.downloadButton) {
      state.downloadButton.disabled = false;
    }
  }
}

export function isImageViewerOpen(): boolean {
  return activeViewer !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stageSize(state: ViewerState): { w: number; h: number } {
  const rect = state.stage.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { w: rect.width, h: rect.height };
  }
  // 布局不可用（测试环境）时退到覆盖层自身尺寸，再退到窗口尺寸
  const w = Number.parseFloat(state.overlay.style.width) || window.innerWidth || 0;
  const h =
    Number.parseFloat(state.overlay.style.height) || window.innerHeight || 0;
  return { w, h };
}

function fontSizePx(ref: Element): number {
  const raw = getComputedStyle(ref).fontSize;
  const px = Number.parseFloat(raw ?? "");
  return Number.isFinite(px) && px > 0 ? px : 16;
}

/** 1ex 的实际像素值（x-height 与字体相关）；测不到时按 CSS 常用近似 0.5em */
function exPx(ref: Element): number {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    `position:absolute;width:1ex;height:0;visibility:hidden;pointer-events:none;` +
    `font-size:${fontSizePx(ref)}px;font-family:${getComputedStyle(ref).fontFamily || "serif"}`;
  const host = document.body ?? document.documentElement;
  host.appendChild(probe);
  const measured = probe.getBoundingClientRect().width;
  probe.remove();
  return measured > 0 ? measured : fontSizePx(ref) * 0.5;
}

/** 把 SVG 的 width/height 写法换算成像素；百分比等相对单位返回 null */
function svgLengthToPx(raw: string | null, ref: Element): number | null {
  if (!raw) return null;
  const m = /^\s*([\d.]+)\s*(px|em|rem|ex|pt)?\s*$/i.exec(raw);
  if (!m) return null;
  const value = Number.parseFloat(m[1]!);
  if (!Number.isFinite(value) || value <= 0) return null;
  switch ((m[2] ?? "").toLowerCase()) {
    case "":
    case "px":
      return value;
    case "em":
    case "rem":
      return value * fontSizePx(ref);
    case "ex":
      return value * exPx(ref);
    case "pt":
      return value * (96 / 72);
    default:
      return null;
  }
}

function svgViewBox(svg: Element): { w: number; h: number } | null {
  const raw = (svg.getAttribute("viewBox") ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !(parts[2]! > 0) || !(parts[3]! > 0)) return null;
  return { w: parts[2]!, h: parts[3]! };
}

/**
 * SVG 的原始像素尺寸。单位不能想当然：
 *   - 绘图导出：width/height 就是 px → 直接用
 *   - MathJax/index 公式：width/height 是 `ex`，viewBox 是内部单位（比真实尺寸大
 *     两个数量级）→ 必须先按 ex 换算，否则公式会被当成几千像素宽
 *   - mermaid：`width="100%"` + `style="max-width: Npx"` + viewBox → 用 max-width
 *     配合 viewBox 比例还原
 */
function svgIntrinsicSize(svg: Element): { w: number; h: number } | null {
  const w = svgLengthToPx(svg.getAttribute("width"), svg);
  const h = svgLengthToPx(svg.getAttribute("height"), svg);
  if (w && h) return { w, h };

  const viewBox = svgViewBox(svg);
  const maxWidth = svgLengthToPx(
    (svg as SVGElement).style?.maxWidth ?? null,
    svg,
  );
  if (maxWidth && viewBox) {
    return { w: maxWidth, h: (maxWidth * viewBox.h) / viewBox.w };
  }
  if (viewBox) return viewBox;

  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { w: rect.width, h: rect.height };
  }
  return null;
}

/** 渲染节点的原始像素尺寸：SVG 取 viewBox，其余取布局尺寸 */
function intrinsicSizeOf(element: Element): { w: number; h: number } {
  const svg =
    element.tagName.toLowerCase() === "svg"
      ? element
      : element.querySelector("svg");
  if (svg) {
    const size = svgIntrinsicSize(svg);
    if (size) return size;
  }
  const el = element as HTMLElement;
  const rect = element.getBoundingClientRect();
  return {
    w: el.scrollWidth || rect.width || 0,
    h: el.scrollHeight || rect.height || 0,
  };
}

/**
 * 覆盖层的顶部内边距：应用自绘的标题栏（`.title-bar`，含 macOS 红绿灯与窗口
 * 按钮）在 webview 顶部占一条，放大会覆盖它 —— 挡住标题栏会丢掉窗口拖动与
 * 关闭入口。这里按实际布局量出标题栏底边，覆盖层从它下面开始。
 */
function topInset(): number {
  let inset = 0;
  for (const el of document.querySelectorAll<HTMLElement>(".title-bar")) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.top > 1) continue; // 只认贴在窗口顶部的标题栏
    inset = Math.max(inset, rect.bottom);
  }
  // 极端布局下不要把整屏顶掉
  return Math.max(0, Math.min(inset, window.innerHeight * 0.25));
}

type ViewerBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * 覆盖层边界：只盖编辑区（`.editor-area`），侧边栏与标题栏都不遮 —— 看大图时
 * 仍能翻目录、开关侧边栏、拖动/关闭窗口。找不到编辑区（网站 demo、设置窗口）
 * 时退化为「整窗减去标题栏」。
 */
function viewerBounds(): ViewerBounds {
  const inset = topInset();
  const pane = document.querySelector<HTMLElement>(".editor-area");
  const rect = pane?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return {
      left: 0,
      top: inset,
      width: window.innerWidth || 0,
      height: Math.max(0, (window.innerHeight || 0) - inset),
    };
  }
  const top = Math.max(rect.top, inset);
  return {
    left: rect.left,
    top,
    width: rect.width,
    height: Math.max(0, rect.bottom - top),
  };
}

/**
 * 克隆渲染节点。SVG 保留自身 id —— mermaid 生成的 SVG 内部 `<style>` 用
 * `#mermaid-xxxx` 做选择器，改 id 会丢样式；重复 id 只影响文本校验，不影响
 * CSS 匹配。
 */
function cloneRenderedElement(element: Element): HTMLElement {
  const source =
    element.tagName.toLowerCase() === "svg"
      ? element
      : element.querySelector("svg") ?? element;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll?.(`.${TRIGGER_CLASS}`).forEach((node) => node.remove());
  if (source.tagName.toLowerCase() === "svg") {
    const size = svgIntrinsicSize(source);
    if (size) {
      clone.setAttribute("width", String(size.w));
      clone.setAttribute("height", String(size.h));
      // 渲染器给 SVG 打的样式（max-width / max-height / height:auto）是相对
      // 编辑器容器的，覆盖层里按原始像素显示
      const styled = clone as unknown as SVGElement;
      styled.style.width = `${size.w}px`;
      styled.style.height = `${size.h}px`;
      styled.style.maxWidth = "none";
      styled.style.maxHeight = "none";
    }
  }
  return clone;
}

function buildMedia(source: ImageViewerSource): {
  media: HTMLElement;
  natural: { w: number; h: number };
} {
  if (source.kind === "img") {
    const img = document.createElement("img");
    img.className = "image-viewer-img";
    img.src = source.src;
    img.alt = source.alt ?? "";
    if (source.title) img.title = source.title;
    img.draggable = false;
    return {
      media: img,
      natural: { w: source.naturalWidth ?? 0, h: source.naturalHeight ?? 0 },
    };
  }
  return {
    media: cloneRenderedElement(source.element),
    natural: intrinsicSizeOf(source.element),
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function transformString(state: ViewerState): string {
  return (
    `translate3d(${state.tx.toFixed(2)}px, ${state.ty.toFixed(2)}px, 0)` +
    ` scale(${state.scale}) rotate(${state.rotation}deg)`
  );
}

/** 舞台的视口矩形；布局不可用（测试环境）时退到覆盖层自身尺寸 */
function stageRectOf(state: ViewerState): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const rect = state.stage.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }
  const num = (value: string, fallback: number): number =>
    Number.parseFloat(value) || fallback;
  return {
    left: num(state.overlay.style.left, 0),
    top: num(state.overlay.style.top, 0),
    width: num(state.overlay.style.width, window.innerWidth || 0),
    height: num(state.overlay.style.height, window.innerHeight || 0),
  };
}

/**
 * 原图位置对应的变换：把覆盖层内容摆回编辑器里那张图的位置与大小。
 * 打开时从这里放大出去、关闭时缩回这里（连续的缩放动画）。
 */
function originTransformString(state: ViewerState): string | null {
  const { natural } = state;
  if (natural.w <= 0 || natural.h <= 0) return null;
  let rect = state.originRect;
  if (state.origin?.isConnected) {
    const live = state.origin.getBoundingClientRect();
    if (live.width > 0 && live.height > 0) {
      rect = {
        left: live.left,
        top: live.top,
        width: live.width,
        height: live.height,
      };
    }
  }
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const stageRect = stageRectOf(state);
  if (stageRect.width <= 0 || stageRect.height <= 0) return null;

  // 源图在编辑器里的显示比例（两边取小，避免宽高比不一致时超出）
  const originScale = Math.min(
    rect.width / natural.w,
    rect.height / natural.h,
  );
  // 关键：转场比例不超过当前比例。竖长图在编辑器里可能按原始尺寸显示（比视口还高），
  // 而放大层是按高度适应 —— 不夹住的话，关闭时会先"涨大"到编辑器里的尺寸再消失。
  // 打开方向同理：起点不会比目标更大。
  const scale = Math.min(originScale, state.scale);

  // 竖长图的源图大半在视口外，落点夹回可视区内，动画不会甩出边界
  const cx = clamp(
    rect.left + rect.width / 2,
    stageRect.left,
    stageRect.left + stageRect.width,
  );
  const cy = clamp(
    rect.top + rect.height / 2,
    stageRect.top,
    stageRect.top + stageRect.height,
  );
  const tx = cx - (stageRect.left + stageRect.width / 2);
  const ty = cy - (stageRect.top + stageRect.height / 2);
  // 带上当前旋转：关闭时不会突然"摆正"回 0° 再缩
  return (
    `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)` +
    ` scale(${scale.toFixed(4)}) rotate(${state.rotation}deg)`
  );
}

let transformHintTimer: number | undefined;
let hintedOverlay: HTMLElement | null = null;

/** 只设置/延长提示的保留时间，不改动 class（中途改 class 会重建图层） */
function holdTransformHint(holdMs: number): void {
  if (transformHintTimer !== undefined) {
    window.clearTimeout(transformHintTimer);
  }
  transformHintTimer = window.setTimeout(() => {
    transformHintTimer = undefined;
    hintedOverlay?.classList.remove("is-transforming");
    hintedOverlay = null;
  }, holdMs);
}

/**
 * 操作期间把内容提升为合成层（拖动 / 滚轮 / 动画更跟手），操作停下来后撤掉
 * 提示 —— 常驻 `will-change: transform` 会让浏览器一直复用旧分辨率的栅格缓存，
 * 放大后看起来发虚；撤掉后会在最终比例上重新栅格化，图 / 公式恢复锐利。
 */
function markTransforming(state: ViewerState, holdMs = 200): void {
  hintedOverlay = state.overlay;
  state.overlay.classList.add("is-transforming");
  holdTransformHint(holdMs);
}

function applyTransform(state: ViewerState, animate = false): void {
  const animated = animate && !prefersReducedMotion();
  if (animated) {
    // 帧 A：挂合成层 + 让过渡属性先落地；帧 B 只改值。同帧里改 transition
    // （或 will-change）与值，个别引擎会跳过过渡直接跳到终点。
    hintedOverlay = state.overlay;
    state.overlay.classList.add("is-transforming");
    state.content.style.transition = `transform ${CLOSE_MS}ms ${EASE_MOVE}`;
    state.content.getBoundingClientRect();
    holdTransformHint(CLOSE_MS + 150);
  } else {
    markTransforming(state);
    state.content.style.transition = "none";
    state.content.style.transform = transformString(state);
  }
  if (state.ringOn) updateRing(state);
  state.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  // 供测试与调试观察当前状态（不影响渲染）
  state.overlay.dataset.scale = state.scale.toFixed(3);
  state.overlay.dataset.rotation = String(state.rotation);
  if (animated) {
    const target = transformString(state);
    const apply = (): void => {
      if (activeViewer === state) state.content.style.transform = target;
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(apply);
    } else {
      apply();
    }
  }
}

/**
 * 贴边细描边：只在拖动时显示 —— 拖动中需要看清图的边界（尤其是同色背景下
 * 的白底图），静止时完全融入编辑区背景。描边宽度按缩放反向补偿，屏幕上恒为
 * 1px，且不用模糊投影。
 */
function updateRing(state: ViewerState): void {
  state.content.style.boxShadow = state.ringOn
    ? `0 0 0 ${(1 / state.scale).toFixed(3)}px color-mix(in srgb, var(--foreground, #18181b) 9%, transparent)`
    : "none";
}

function setRing(state: ViewerState, on: boolean): void {
  state.ringOn = on;
  updateRing(state);
}

function sizeContent(state: ViewerState): void {
  const { w, h } = state.natural;
  if (w > 0 && h > 0) {
    state.content.style.width = `${w}px`;
    state.content.style.height = `${h}px`;
  }
}

function fitToStage(state: ViewerState, animate = false): void {
  const { w: stageW, h: stageH } = stageSize(state);
  const rotateSwap = Math.abs(state.rotation % 180) === 90;
  const naturalW = rotateSwap ? state.natural.h : state.natural.w;
  const naturalH = rotateSwap ? state.natural.w : state.natural.h;
  let scale = 1;
  if (naturalW > 0 && naturalH > 0 && stageW > 0 && stageH > 0) {
    scale = clamp(
      Math.min(
        (stageW * FIT_PADDING) / naturalW,
        (stageH * FIT_PADDING) / naturalH,
      ),
      MIN_SCALE,
      MAX_FIT_SCALE,
    );
  }
  state.fitScale = scale;
  state.scale = scale;
  state.tx = 0;
  state.ty = 0;
  applyTransform(state, animate);
}

function setScale(
  state: ViewerState,
  next: number,
  anchor?: { x: number; y: number },
  animate = false,
): void {
  const scale = clamp(next, MIN_SCALE, MAX_SCALE);
  if (scale === state.scale) return;
  if (anchor) {
    // 缩放锚定在指针位置：指针下的点在缩放前后保持不动
    const rect = state.stage.getBoundingClientRect();
    const cx = anchor.x - (rect.left + rect.width / 2);
    const cy = anchor.y - (rect.top + rect.height / 2);
    const k = scale / state.scale;
    state.tx = cx - (cx - state.tx) * k;
    state.ty = cy - (cy - state.ty) * k;
  }
  state.scale = scale;
  applyTransform(state, animate);
}

function zoomBy(state: ViewerState, factor: number, animate = true): void {
  setScale(state, state.scale * factor, undefined, animate);
}

function resetToActualSize(state: ViewerState, animate = true): void {
  state.scale = 1;
  state.tx = 0;
  state.ty = 0;
  applyTransform(state, animate);
}

function rotateBy(state: ViewerState, deg: number): void {
  state.rotation = (state.rotation + deg + 360) % 360;
  fitToStage(state, true);
}

function panBy(state: ViewerState, dx: number, dy: number): void {
  state.tx += dx;
  state.ty += dy;
  applyTransform(state);
}

function makeToolbarButton(
  className: string,
  label: string,
  icon: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `image-viewer-btn ${className}`;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = icon;
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function installListeners(state: ViewerState): void {
  const { overlay, stage, content } = state;

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const factor = Math.exp(-e.deltaY * 0.0022);
    setScale(state, state.scale * factor, { x: e.clientX, y: e.clientY }, false);
  };
  overlay.addEventListener("wheel", onWheel, { passive: false });
  activeCleanups.push(() => overlay.removeEventListener("wheel", onWheel));

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest(".image-viewer-toolbar")) {
      return;
    }
    e.preventDefault();
    state.drag = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      tx: state.tx,
      ty: state.ty,
    };
    setRing(state, true);
    overlay.classList.add("is-panning");
  };
  const onPointerMove = (e: PointerEvent): void => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    state.tx = drag.tx + (e.clientX - drag.x);
    state.ty = drag.ty + (e.clientY - drag.y);
    applyTransform(state);
  };
  const endDrag = (x: number, y: number): void => {
    const drag = state.drag;
    if (!drag) return;
    state.drag = null;
    overlay.classList.remove("is-panning");
    setRing(state, false);
    // 拖拽（而非点击）结束后浏览器仍会补发 click —— 否则一拖动就退出查看
    if (
      Math.abs(x - drag.startX) > DRAG_THRESHOLD ||
      Math.abs(y - drag.startY) > DRAG_THRESHOLD
    ) {
      state.suppressClick = true;
      setTimeout(() => {
        state.suppressClick = false;
      }, 0);
    }
  };
  const onPointerUp = (e: PointerEvent): void => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    endDrag(e.clientX, e.clientY);
  };
  // 指针移出窗口（拖到别的应用上再松手）时也要结束拖拽，避免状态卡住
  const onWindowBlur = (): void => {
    const drag = state.drag;
    if (!drag) return;
    endDrag(drag.startX, drag.startY);
  };
  overlay.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("blur", onWindowBlur);
  activeCleanups.push(() => {
    overlay.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", onWindowBlur);
  });

  // 点击背景（不含工具栏与画布内容）关闭
  const onOverlayClick = (e: MouseEvent): void => {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    const target = e.target as Node | null;
    if (!target) return;
    if (e.target instanceof Element && e.target.closest(".image-viewer-toolbar")) {
      return;
    }
    if (target !== overlay && target !== stage) return;
    // 图本身设了 pointer-events: none，点在图上时目标也是舞台 —— 用内容包围盒
    // 区分「点图」与「点图外的暗色背景」：点图不关闭，点背景才关闭。
    const rect = content.getBoundingClientRect();
    const hasLayout = rect.width > 0 && rect.height > 0;
    const onMedia =
      hasLayout &&
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (onMedia) return;
    closeImageViewer();
  };
  overlay.addEventListener("click", onOverlayClick);
  activeCleanups.push(() => overlay.removeEventListener("click", onOverlayClick));

  // 双击：在「适应窗口」与「100%」之间切换
  const onDblClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (Math.abs(state.scale - state.fitScale) < 0.01) resetToActualSize(state);
    else fitToStage(state);
  };
  stage.addEventListener("dblclick", onDblClick);
  activeCleanups.push(() => stage.removeEventListener("dblclick", onDblClick));

  // 覆盖层内吞掉键盘事件，避免触发编辑器的全局快捷键
  const onKeyDown = (e: KeyboardEvent): void => {
    let handled = true;
    switch (e.key) {
      case "Escape":
        closeImageViewer();
        break;
      case "+":
      case "=":
        zoomBy(state, ZOOM_STEP);
        break;
      case "-":
      case "_":
        zoomBy(state, 1 / ZOOM_STEP);
        break;
      case "0":
        fitToStage(state);
        break;
      case "1":
        resetToActualSize(state);
        break;
      case "r":
      case "R":
        rotateBy(state, ROTATE_STEP);
        break;
      case "ArrowLeft":
        panBy(state, PAN_STEP, 0);
        break;
      case "ArrowRight":
        panBy(state, -PAN_STEP, 0);
        break;
      case "ArrowUp":
        panBy(state, 0, PAN_STEP);
        break;
      case "ArrowDown":
        panBy(state, 0, -PAN_STEP);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener("keydown", onKeyDown, true);
  activeCleanups.push(() =>
    document.removeEventListener("keydown", onKeyDown, true),
  );
}

export function openImageViewer(source: ImageViewerSource): void {
  closeImageViewerNow();

  const built = buildMedia(source);
  const downloadableSvg =
    built.media instanceof HTMLImageElement ? null : svgElementOf(built.media);
  const download =
    source.kind === "img"
      ? downloadForImage(source)
      : downloadableSvg
        ? downloadForSvg(source)
        : null;

  const overlay = document.createElement("div");
  overlay.className = "image-viewer-overlay";
  // 只标 dialog，不标 aria-modal：浮层只覆盖编辑区，侧边栏与标题栏仍可交互，
  // 也没有做焦点陷阱 —— 标成 modal 会让屏幕阅读器把其余界面当成 inert。
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Image viewer");
  overlay.tabIndex = -1;

  // 背景单独一层：浮层本身不再动 opacity，淡入淡出只影响背景，副本全程不透明
  const backdrop = document.createElement("div");
  backdrop.className = "image-viewer-backdrop";

  const stage = document.createElement("div");
  stage.className = "image-viewer-stage";

  const content = document.createElement("div");
  content.className = "image-viewer-content";
  content.appendChild(built.media);
  stage.appendChild(content);

  const toolbar = document.createElement("div");
  toolbar.className = "image-viewer-toolbar";
  toolbar.setAttribute("contenteditable", "false");

  const zoomLabel = document.createElement("button");
  zoomLabel.type = "button";
  zoomLabel.className = "image-viewer-zoom-label";
  zoomLabel.title = "Reset to 100%";
  zoomLabel.setAttribute("aria-label", "Reset zoom to 100%");

  const state: ViewerState = {
    overlay,
    backdrop,
    stage,
    content,
    media: built.media,
    toolbar,
    zoomLabel,
    origin: source.origin ?? null,
    originRect: measureOrigin(source.origin),
    originHidden: null,
    returnFocusTo:
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    scale: 1,
    tx: 0,
    ty: 0,
    rotation: 0,
    fitScale: 1,
    ringOn: false,
    natural: built.natural,
    drag: null,
    suppressClick: false,
    downloadButton: null,
    download,
    downloading: false,
  };

  zoomLabel.addEventListener("pointerdown", (e) => e.stopPropagation());
  zoomLabel.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetToActualSize(state);
  });

  toolbar.appendChild(
    makeToolbarButton("image-viewer-zoom-out", "Zoom out", ICON_MINUS, () =>
      zoomBy(state, 1 / ZOOM_STEP),
    ),
  );
  toolbar.appendChild(zoomLabel);
  toolbar.appendChild(
    makeToolbarButton("image-viewer-zoom-in", "Zoom in", ICON_PLUS, () =>
      zoomBy(state, ZOOM_STEP),
    ),
  );
  // 「适应窗口」不放工具栏：浮层打开时本来就是适应窗口的状态，已适应时点它
  // 没有任何反馈，容易被当成失效。需要回到适应窗口时双击图（在适应窗口与
  // 100% 之间切换），百分比读数点一下回到 100%。
  toolbar.appendChild(
    makeToolbarButton("image-viewer-rotate", "Rotate 90°", ICON_ROTATE, () =>
      rotateBy(state, ROTATE_STEP),
    ),
  );
  if (state.download) {
    const downloadButton = makeToolbarButton(
      "image-viewer-download",
      "Download",
      ICON_DOWNLOAD,
      () => void downloadMedia(state),
    );
    state.downloadButton = downloadButton;
    toolbar.appendChild(downloadButton);
  }
  toolbar.appendChild(
    makeToolbarButton("image-viewer-close", "Close", ICON_CLOSE, () =>
      closeImageViewer(),
    ),
  );

  overlay.append(backdrop, stage, toolbar);
  sizeContent(state);
  updateRing(state); // 静止态：无描边

  const applyBounds = (): void => {
    const bounds = viewerBounds();
    overlay.style.left = `${bounds.left}px`;
    overlay.style.top = `${bounds.top}px`;
    overlay.style.width = `${bounds.width}px`;
    overlay.style.height = `${bounds.height}px`;
    overlay.style.right = "auto";
    overlay.style.bottom = "auto";
    // 遮罩与编辑器同色（读编辑区实际背景，主题 / 自定义主题都能贴合）
    const pane = document.querySelector<HTMLElement>(".editor-area");
    const bg = pane ? getComputedStyle(pane).backgroundColor : "";
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      backdrop.style.backgroundColor = bg;
    }
  };
  applyBounds();
  // 窗口尺寸变化（含全屏切换、侧边栏展开/折叠）：边界重算；用户没手动缩放过时
  // 同步重新适应
  const onBoundsChange = (): void => {
    applyBounds();
    if (Math.abs(state.scale - state.fitScale) < 0.001) fitToStage(state);
  };

  document.body.appendChild(overlay);

  activeViewer = state;
  activeCleanups = [];
  installListeners(state);
  window.addEventListener("resize", onBoundsChange);
  activeCleanups.push(() =>
    window.removeEventListener("resize", onBoundsChange),
  );
  // 侧边栏折叠 / 切换左右并不改窗口尺寸，只改编辑区尺寸 → 观察编辑区自身
  const pane = document.querySelector<HTMLElement>(".editor-area");
  if (pane && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => onBoundsChange());
    observer.observe(pane);
    activeCleanups.push(() => observer.disconnect());
  }
  fitToStage(state);
  animateOpen(state);

  // 图片原始尺寸在 load 之后才知道 → 载入完成再按真实像素适应窗口
  if (built.media instanceof HTMLImageElement) {
    const img = built.media;
    const onLoad = (): void => {
      if (activeViewer !== state) return;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w <= 0 || h <= 0) return;
      state.natural = { w, h };
      sizeContent(state);
      fitToStage(state);
    };
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      onLoad();
    } else {
      img.addEventListener("load", onLoad);
      activeCleanups.push(() => img.removeEventListener("load", onLoad));
    }
  } else if (state.natural.w <= 0 || state.natural.h <= 0) {
    // 无 viewBox 的渲染节点：布局完成后测量一次
    const measure = (): void => {
      if (activeViewer !== state) return;
      const el = state.media as HTMLElement;
      const rect = el.getBoundingClientRect();
      const w = el.scrollWidth || rect.width || 0;
      const h = el.scrollHeight || rect.height || 0;
      if (w <= 0 || h <= 0) return;
      state.natural = { w, h };
      sizeContent(state);
      fitToStage(state);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(measure);
    } else {
      measure();
    }
  }

  overlay.focus({ preventScroll: true });
}

export function closeImageViewer(): void {
  const state = activeViewer;
  if (!state) return;
  activeViewer = null;
  for (const cleanup of activeCleanups) cleanup();
  activeCleanups = [];
  const overlay = state.overlay;
  // 关闭：缩回编辑器里原图的位置并淡出（与打开对称）
  overlay.classList.add("is-closing");
  // 合成层提示与过渡属性都在帧 A 落地，值留到帧 B（见 animateOpen 的说明）：
  // 三者同帧会让引擎跳过过渡、直接跳到终点，看起来就是"闪一下"
  hintedOverlay = overlay;
  overlay.classList.add("is-transforming");
  holdTransformHint(CLOSE_MS + CLOSE_BG_MS + 260);
  // 工具栏先撤：关闭时控件不该和内容一起慢慢缩
  state.toolbar.style.transition = `opacity ${CHROME_MS}ms ${EASE_FADE_OUT}`;
  const from = prefersReducedMotion() ? null : originTransformString(state);
  // 只淡背景层：缩放期间背景保持不透明（源图此刻是隐藏的，背景提前淡出会露出
  // 空洞），缩放落位后再淡出，副本因此全程不变透明
  state.backdrop.style.transition =
    `opacity ${from ? CLOSE_BG_MS : BG_MS}ms ${EASE_FADE_OUT}`;
  state.content.style.transition = from
    ? `transform ${CLOSE_MS}ms ${EASE_MOVE}`
    : "none";
  state.content.getBoundingClientRect(); // 过渡属性（值未变）落地

  // 帧 B：只改值
  const applyValues = (): void => {
    if (from) state.content.style.transform = from;
    state.toolbar.style.opacity = "0";
    // 没有源图几何 → 没有缩放，背景直接开始淡出
    if (!from) state.backdrop.style.opacity = "0";
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(applyValues);
  } else {
    applyValues();
  }

  if (from) {
    // 缩放落位后：副本与编辑器里的原图重合，先还原原图（此时完全不可见），
    // 再让背景淡出 —— 全程没有"空洞"，也没有突然出现的跳变
    window.setTimeout(() => {
      restoreOrigin(state);
      state.backdrop.style.opacity = "0";
    }, CLOSE_MS + 40);
    window.setTimeout(
      () => {
        overlay.remove();
        restoreFocus(state);
      },
      CLOSE_MS + CLOSE_BG_MS + 90,
    );
  } else {
    window.setTimeout(() => {
      overlay.remove();
      restoreOrigin(state);
      restoreFocus(state);
    }, BG_MS + 40);
  }
}

/** 立即移除当前覆盖层（打开新图时用，避免两层过渡叠在一起） */
function closeImageViewerNow(): void {
  const state = activeViewer;
  if (!state) return;
  activeViewer = null;
  for (const cleanup of activeCleanups) cleanup();
  activeCleanups = [];
  state.overlay.remove();
  restoreOrigin(state);
  restoreFocus(state);
}

function measureOrigin(
  origin: Element | null | undefined,
): ViewerState["originRect"] {
  if (!origin || !origin.isConnected) return null;
  const rect = origin.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * 转场期间把编辑器里的原图藏起来：否则浮层背景淡入的这段时间里，原图与正在
 * 变大的副本会同时可见（叠影），看上去就是"不顺滑"。用 visibility 而不是
 * display，避免改变布局导致终点位置漂移；关闭后再还原。
 *
 * 原值按元素一次性记账 + 引用计数：关闭动画还没跑完就再次打开同一张图时，
 * 第二个浮层读到的会是被上一个浮层改成 `hidden` 的值，直接写回就会把原图
 * 永久隐藏 —— 只有真正把计数减到 0 的那次还原才写原值。
 */
const hiddenOrigins = new WeakMap<Element, { prev: string; count: number }>();

function hideOrigin(state: ViewerState): void {
  const el = state.origin as HTMLElement | null;
  if (!el?.style) return;
  const entry = hiddenOrigins.get(el);
  if (entry) entry.count += 1;
  else hiddenOrigins.set(el, { prev: el.style.visibility, count: 1 });
  el.style.visibility = "hidden";
  state.originHidden = el;
}

function restoreOrigin(state: ViewerState): void {
  const el = state.originHidden as HTMLElement | null;
  state.originHidden = null;
  if (!el?.style) return;
  const entry = hiddenOrigins.get(el);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count > 0) return; // 还有别的浮层在用这张图
  hiddenOrigins.delete(el);
  el.style.visibility = entry.prev;
}

/**
 * 关闭时把焦点还给打开前的元素：浮层移除后焦点会落到 body，编辑器（ProseMirror）
 * 不再持有焦点 —— 用户按 Esc 关闭后直接打字会没有任何反应。
 */
function restoreFocus(state: ViewerState): void {
  const el = state.returnFocusTo;
  state.returnFocusTo = null;
  if (!el?.isConnected) return;
  // 关闭动画期间用户已经点到别处（侧边栏等）时不要抢焦点
  const active = document.activeElement;
  const insideOverlay = active !== null && state.overlay.contains(active);
  if (active !== null && active !== document.body && !insideOverlay) return;
  el.focus({ preventScroll: true });
}

/**
 * 打开动画：内容先摆在编辑器里原图的位置，再过渡到适应窗口的大小与位置，
 * 遮罩同步淡入 —— 缩放动画给出「这张图从哪里放大出来」的空间连续感。
 * 尊重「减弱动态效果」：跳过缩放，只做淡入。
 */
function animateOpen(state: ViewerState): void {
  const target = transformString(state);
  const from = prefersReducedMotion() ? null : originTransformString(state);

  // ── 帧 A：只摆起始状态 / 只改过渡属性，中间强制样式落地 ──────────────
  // 同一个 style change 里同时改 transition 属性与属性值，个别引擎会跳过过渡
  // 直接跳到终点（表现就是"闪一下"），所以两者必须分帧。
  hintedOverlay = state.overlay;
  state.overlay.classList.add("is-transforming");
  // 背景层从透明淡入：只淡背景，副本全程不透明（整层淡入会让副本跟着透明，
  // 而原图已隐藏 → 看上去就是"图闪没了再淡回来"）
  state.backdrop.style.transition = "none";
  state.backdrop.style.opacity = "0";
  state.content.style.transition = "none";
  state.content.style.transform = from ?? target;
  // 工具栏错后出现：起始先退到下方一点点、透明
  state.toolbar.style.transition = "none";
  state.toolbar.style.opacity = "0";
  state.toolbar.style.transform = "translateY(6px)";
  state.overlay.getBoundingClientRect(); // 起始帧（无过渡）落地

  if (from) {
    state.content.style.transition = `transform ${OPEN_MS}ms ${EASE_MOVE}`;
  }
  state.backdrop.style.transition = `opacity ${OPEN_BG_MS}ms ${EASE_FADE_IN}`;
  state.toolbar.style.transition =
    `opacity ${CHROME_MS}ms ${EASE_FADE_IN} ${CHROME_DELAY_MS}ms,` +
    ` transform ${CHROME_MS}ms ${EASE_FADE_IN} ${CHROME_DELAY_MS}ms`;
  state.overlay.getBoundingClientRect(); // 过渡属性（值未变）落地
  holdTransformHint(OPEN_MS + 200);

  // ── 帧 B：只改值 ────────────────────────────────────────────────
  const apply = (): void => {
    if (activeViewer !== state) return;
    state.content.style.transform = target;
    state.backdrop.style.opacity = "1";
    state.toolbar.style.opacity = "1";
    state.toolbar.style.transform = "translateY(0)";
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(apply);
  } else {
    apply();
  }

  // 源图等背景不透明之后再隐藏：此刻副本可能已经从原位放大走开，提前隐藏会
  // 露出一块空洞；背景已经挡住，隐藏原图不可见，也不会出现叠影。
  if (from) {
    window.setTimeout(() => {
      if (activeViewer === state) hideOrigin(state);
    }, OPEN_BG_MS + 60);
  }
}

/**
 * 渲染容器上的放大按钮。点击时再读取容器内容，因此容器重新渲染（mermaid
 * 异步出图、图片换 src）后仍然取到最新的图。
 */
export function createZoomTrigger(
  container: HTMLElement,
  options: MediaContainerOptions = {},
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = TRIGGER_CLASS;
  btn.setAttribute("contenteditable", "false");
  btn.setAttribute("aria-label", "Zoom in");
  btn.title = "Zoom in";
  btn.innerHTML = ICON_ZOOM;
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  // 渲染容器自身监听 mousedown（点击进入源码态）；按钮必须拦截，
  // 否则点按钮会先切走预览。
  btn.addEventListener("mousedown", swallow);
  btn.addEventListener("pointerdown", swallow);
  btn.addEventListener("click", (e) => {
    swallow(e);
    openMediaContainer(container, options);
  });
  return btn;
}

/** 打开容器内的图：优先 <img>，其次 svg，最后整个容器 */
export function openMediaContainer(
  target: HTMLElement,
  options: MediaContainerOptions = {},
): void {
  const img =
    target instanceof HTMLImageElement ? target : target.querySelector("img");
  if (img) {
    openImageViewer({
      kind: "img",
      src: img.currentSrc || img.src,
      alt: img.alt || undefined,
      title: img.title || undefined,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      origin: img,
      suggestedName: options.suggestedName,
    });
    return;
  }
  const element =
    target.tagName.toLowerCase() === "svg"
      ? target
      : target.querySelector("svg") ?? target;
  openImageViewer({
    kind: "element",
    element,
    origin: element,
    suggestedName: options.suggestedName,
  });
}
