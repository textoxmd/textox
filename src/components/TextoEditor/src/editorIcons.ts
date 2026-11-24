/** 共享图标定义 — 供 React 组件和 ProseMirror 插件统一使用 */

import { createElement, useEffect, useState, type ComponentType } from "react";
import type { IconDef, IconElement, IconSpec } from "@texto/markdown-editor-api";
import { loadIcon, resolveIcon } from "./iconLoader.ts";

export type { IconDef, IconElement };

const iconComponentCache = new WeakMap<IconDef, ComponentType<{ size?: number | string }>>();

/** IconDef → React 组件（供斜杠菜单 / 工具栏等 React 消费端共用；按 def 引用记忆化）。 */
export function iconComponentFromDef(def: IconDef): ComponentType<{ size?: number | string }> {
  const cached = iconComponentCache.get(def);
  if (cached) return cached;

  const comp: ComponentType<{ size?: number | string }> = function ContributedIcon({ size = 15 }: { size?: number | string }) {
    const s = Number(size);
    return createElement(
      "svg",
      { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
      def.map((el, i) => {
        if (el[0] === "path") return createElement("path", { key: i, d: el[1] });
        if (el[0] === "line") return createElement("line", { key: i, x1: el[1], y1: el[2], x2: el[3], y2: el[4] });
        if (el[0] === "rect") return createElement("rect", { key: i, x: el[1], y: el[2], width: el[3], height: el[4], rx: el[5] });
        if (el[0] === "circle") return createElement("circle", { key: i, cx: el[1], cy: el[2], r: el[3] });
        if (el[0] === "ellipse") return createElement("ellipse", { key: i, cx: el[1], cy: el[2], rx: el[3], ry: el[4] });
        if (el[0] === "polyline") return createElement("polyline", { key: i, points: el[1] });
        return createElement("polygon", { key: i, points: el[1] });
      }),
    );
  };
  iconComponentCache.set(def, comp);
  return comp;
}

export const TOOLBAR_ICONS: Record<string, IconDef> = {
  bold: [
    ["path", "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"],
  ],
  italic: [
    ["line", 19, 4, 10, 4],
    ["line", 14, 20, 5, 20],
    ["line", 15, 4, 9, 20],
  ],
  strikethrough: [
    ["path", "M16 4H9a3 3 0 0 0-2.83 4"],
    ["path", "M14 12a4 4 0 0 1 0 8H6"],
    ["line", 4, 12, 20, 12],
  ],
  code: [
    ["path", "m16 18 6-6-6-6"],
    ["path", "m8 6-6 6 6 6"],
  ],
  blockquote: [
    ["path", "M17 5H3"],
    ["path", "M21 12H8"],
    ["path", "M21 19H8"],
    ["path", "M3 12v7"],
  ],
  codeBlock: [
    ["path", "m16 18 6-6-6-6"],
    ["path", "m8 6-6 6 6 6"],
  ],
  list: [
    ["line", 8, 6, 21, 6],
    ["line", 8, 12, 21, 12],
    ["line", 8, 18, 21, 18],
    ["line", 3, 6, 3.01, 6],
    ["line", 3, 12, 3.01, 12],
    ["line", 3, 18, 3.01, 18],
  ],
  listOrdered: [
    ["line", 10, 6, 21, 6],
    ["line", 10, 12, 21, 12],
    ["line", 10, 18, 21, 18],
    ["path", "M4 6h1v4"],
    ["path", "M4 10h2"],
    ["path", "M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"],
  ],
  checkSquare: [
    ["path", "M9 11l3 3L22 4"],
    ["path", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  ],
  link: [
    ["path", "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"],
    ["path", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  ],
  image: [
    ["rect", 3, 3, 18, 18, 2],
    ["circle", 8.5, 8.5, 1.5],
    ["path", "m21 15-5-5L5 21"],
  ],
  horizontalRule: [
    ["line", 3, 12, 21, 12],
  ],
};

/** 将 IconDef 渲染为 DOM SVG 元素（供 ProseMirror 插件使用） */
export function renderIconSvg(def: IconDef, size = 15): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const el of def) {
    if (el[0] === "path") {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", el[1]);
      svg.appendChild(p);
    } else if (el[0] === "line") {
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", String(el[1]));
      l.setAttribute("y1", String(el[2]));
      l.setAttribute("x2", String(el[3]));
      l.setAttribute("y2", String(el[4]));
      svg.appendChild(l);
    } else if (el[0] === "rect") {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(el[1]));
      r.setAttribute("y", String(el[2]));
      r.setAttribute("width", String(el[3]));
      r.setAttribute("height", String(el[4]));
      if (el[5] !== undefined) r.setAttribute("rx", String(el[5]));
      svg.appendChild(r);
    } else if (el[0] === "circle") {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(el[1]));
      c.setAttribute("cy", String(el[2]));
      c.setAttribute("r", String(el[3]));
      svg.appendChild(c);
    } else if (el[0] === "ellipse") {
      const e = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      e.setAttribute("cx", String(el[1]));
      e.setAttribute("cy", String(el[2]));
      e.setAttribute("rx", String(el[3]));
      e.setAttribute("ry", String(el[4]));
      svg.appendChild(e);
    } else if (el[0] === "polyline") {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      p.setAttribute("points", el[1]);
      svg.appendChild(p);
    } else if (el[0] === "polygon") {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      p.setAttribute("points", el[1]);
      svg.appendChild(p);
    }
  }
  return svg;
}

const specComponentCache = new Map<string, ComponentType<{ size?: number | string }>>();

function useResolvedIcon(spec: string): IconDef | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    if (resolveIcon(spec)) return;
    let alive = true;
    loadIcon(spec)
      .then(() => {
        if (alive) force((n) => n + 1);
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn(`[iconLoader] failed to load icon "${spec}"`, error);
      });
    return () => {
      alive = false;
    };
  }, [spec]);
  return resolveIcon(spec);
}

/** IconSpec → React 组件：IconDef 直接渲染；名称走缓存，未就绪渲染同尺寸占位。 */
export function iconComponentFromSpec(spec: IconSpec): ComponentType<{ size?: number | string }> {
  if (Array.isArray(spec)) return iconComponentFromDef(spec);
  const cached = specComponentCache.get(spec);
  if (cached) return cached;
  const comp: ComponentType<{ size?: number | string }> = function SpecIcon({ size = 15 }) {
    const def = useResolvedIcon(spec);
    if (!def) {
      const px = Number(size) || 15;
      return createElement("span", { style: { display: "inline-block", width: px, height: px } });
    }
    return createElement(iconComponentFromDef(def), { size });
  };
  specComponentCache.set(spec, comp);
  return comp;
}

/** 把图标规格挂到 DOM 容器：IconDef 同步；名称未缓存先占位，解析完成替换。
 *  非幂等：每次调用都会向容器追加一个图标，请勿对同一容器重复调用。 */
export function mountIcon(container: HTMLElement, spec: IconSpec, size = 15): void {
  if (Array.isArray(spec)) {
    container.appendChild(renderIconSvg(spec, size));
    return;
  }
  const def = resolveIcon(spec);
  if (def) {
    container.appendChild(renderIconSvg(def, size));
    return;
  }
  const px = Number(size) || 15;
  const placeholder = document.createElement("span");
  placeholder.style.display = "inline-block";
  placeholder.style.width = `${px}px`;
  placeholder.style.height = `${px}px`;
  container.appendChild(placeholder);
  void loadIcon(spec)
    .then((resolved) => {
      if (placeholder.parentNode === container) placeholder.replaceWith(renderIconSvg(resolved, size));
    })
    .catch((error) => {
      if (import.meta.env.DEV) console.warn(`[iconLoader] failed to load icon "${spec}"`, error);
    });
}
