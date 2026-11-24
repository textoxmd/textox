import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { loadIcon, resetIconLoaderForTests } from "../src/iconLoader.ts";
import { iconComponentFromDef, iconComponentFromSpec, mountIcon, renderIconSvg } from "../src/editorIcons.ts";

// React 18 的 act 需要显式标记测试环境
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("renderIconSvg", () => {
  it("renders ellipse / polyline / polygon", () => {
    const svg = renderIconSvg([
      ["ellipse", 12, 12, 6, 4],
      ["polyline", "1,2 3,4"],
      ["polygon", "5,6 7,8"],
    ]);
    expect(svg.querySelector("ellipse")?.getAttribute("rx")).toBe("6");
    expect(svg.querySelector("polyline")?.getAttribute("points")).toBe("1,2 3,4");
    expect(svg.querySelector("polygon")?.getAttribute("points")).toBe("5,6 7,8");
  });
});

describe("mountIcon", () => {
  beforeEach(() => resetIconLoaderForTests());

  it("renders IconDef synchronously", () => {
    const el = document.createElement("div");
    mountIcon(el, [["path", "M0 0h1"]]);
    expect(el.querySelector("svg")).toBeTruthy();
  });

  it("renders a placeholder then resolves a lucide name", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    mountIcon(el, "bold");
    expect(el.querySelector("svg")).toBeNull();
    expect(el.firstElementChild).toBeTruthy();
    await vi.waitFor(() => expect(el.querySelector("svg")).toBeTruthy());
    document.body.removeChild(el);
  });

  it("resolves even when the container is detached from the document", async () => {
    const el = document.createElement("div"); // 未挂载到 document
    mountIcon(el, "bold");
    expect(el.querySelector("span")).toBeTruthy();
    await vi.waitFor(() => expect(el.querySelector("svg")).toBeTruthy());
  });

  it("does not replace after the placeholder is removed (unmount race guard)", async () => {
    const el = document.createElement("div");
    mountIcon(el, "bold");
    expect(el.querySelector("span")).toBeTruthy();
    el.innerHTML = ""; // 容器被清空 / 卸载
    await loadIcon("bold");
    expect(el.querySelector("svg")).toBeNull();
  });
});

describe("iconComponentFromDef", () => {
  it("renders ellipse / polyline / polygon", () => {
    const markup = renderToStaticMarkup(
      createElement(
        iconComponentFromDef([
          ["ellipse", 12, 12, 6, 4],
          ["polyline", "1,2 3,4"],
          ["polygon", "5,6 7,8"],
        ]),
      ),
    );
    expect(markup).toContain("<ellipse");
    expect(markup).toContain('points="1,2 3,4"');
    expect(markup).toContain("<polygon");
  });
});

describe("iconComponentFromSpec", () => {
  beforeEach(() => resetIconLoaderForTests());

  it("returns a component for IconDef and for a lucide name", () => {
    expect(typeof iconComponentFromSpec([["path", "M0 0h1"]])).toBe("function");
    expect(typeof iconComponentFromSpec("bold")).toBe("function");
  });

  it("memoizes by spec string", () => {
    expect(iconComponentFromSpec("bold")).toBe(iconComponentFromSpec("bold"));
  });

  it("renders a same-size placeholder before the icon resolves", () => {
    const markup = renderToStaticMarkup(createElement(iconComponentFromSpec("bold")));
    expect(markup).toContain("<span");
    expect(markup).not.toContain("<svg");
  });

  it("re-renders to the resolved svg once the lucide icon loads", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(iconComponentFromSpec("bold"), { size: 15 }));
    });
    expect(container.querySelector("svg")).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });
});
