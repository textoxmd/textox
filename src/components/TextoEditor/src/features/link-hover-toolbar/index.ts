import { Plugin } from "prosemirror-state";
import type { FeatureSpec } from "../_types.ts";
import { navigateLink } from "../../link-navigation.ts";
const HOVER_DELAY = 300;
const GRACE_PERIOD = 100;

function buildToolbar(): HTMLElement {
  const root = document.createElement("div");
  root.className = "link-hover-toolbar";
  root.style.display = "none";

  const urlSpan = document.createElement("span");
  urlSpan.className = "link-hover-toolbar-url";
  root.appendChild(urlSpan);

  return root;
}

export function linkHoverToolbarPlugin(): Plugin {
  let toolbar: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let currentHref: string | null = null;

  const ensureMounted = (): HTMLElement => {
    if (!toolbar) toolbar = buildToolbar();
    if (!toolbar.isConnected) document.body.appendChild(toolbar);
    return toolbar;
  };

  const showToolbar = (a: HTMLElement) => {
    const href = a.getAttribute("data-href") || a.getAttribute("href");
    if (!href) return;
    currentHref = href;

    const tb = ensureMounted();
    const urlEl = tb.querySelector(".link-hover-toolbar-url")!;
    urlEl.textContent = href;

    const linkRect = a.getBoundingClientRect();
    const tbWidth = tb.offsetWidth || 200;
    const tbHeight = tb.offsetHeight || 34;
    const gap = 6;

    let top = linkRect.top - tbHeight - gap;
    if (top < 4) top = linkRect.bottom + gap;

    const left = linkRect.left + linkRect.width / 2 - tbWidth / 2;

    tb.style.display = "flex";
    tb.style.top = `${Math.max(4, top)}px`;
    tb.style.left = `${Math.max(4, left)}px`;
  };

  const hideToolbar = () => {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (toolbar) {
      toolbar.style.display = "none";
    }
    currentHref = null;
  };

  const scheduleHide = () => {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideToolbar, GRACE_PERIOD);
  };

  const cancelHide = () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  };

  return new Plugin({
    props: {
      handleDOMEvents: {
        mouseover: (_view, event) => {
          const target = event.target as Element | null;
          const a = target?.closest?.("a");
          const href = a?.getAttribute("data-href") || a?.getAttribute("href");
          if (!a || !href) {
            scheduleHide();
            return false;
          }
          cancelHide();
          if (showTimer) clearTimeout(showTimer);
          showTimer = setTimeout(() => showToolbar(a as HTMLElement), HOVER_DELAY);
          return false;
        },
        mouseout: (_view, event) => {
          const target = event.target as Element | null;
          const related = event.relatedTarget as Element | null;
          if (target?.closest?.("a") && !related?.closest?.("a") && !related?.closest?.(".link-hover-toolbar")) {
            scheduleHide();
          }
          return false;
        },
      },
    },
    view(view) {
      const onLockedLinkPointer = (e: PointerEvent) => {
        if (view.editable) return;
        const a = (e.target as Element | null)?.closest?.("a");
        if (!a) return;
        const href = a.getAttribute("data-href");
        if (!href) return;
        e.preventDefault();
        navigateLink(href, view);
      };
      view.dom.addEventListener("pointerdown", onLockedLinkPointer, { capture: true });

      const tb = ensureMounted();

      const onToolbarMouseOver = () => cancelHide();
      const onToolbarMouseOut = (e: MouseEvent) => {
        const related = e.relatedTarget as Element | null;
        if (!related?.closest?.(".link-hover-toolbar") && !related?.closest?.("a")) {
          scheduleHide();
        }
      };
      const onToolbarClick = async () => {
        if (!currentHref) return;
        await navigateLink(currentHref, view);
        hideToolbar();
      };

      tb.addEventListener("mouseover", onToolbarMouseOver);
      tb.addEventListener("mouseout", onToolbarMouseOut);
      tb.addEventListener("click", onToolbarClick);

      return {
        update() {},
        destroy() {
          view.dom.removeEventListener("pointerdown", onLockedLinkPointer, { capture: true });
          if (showTimer) { clearTimeout(showTimer); showTimer = null; }
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          if (toolbar?.isConnected) toolbar.remove();
          toolbar = null;
        },
      };
    },
  });
}

export const linkHoverToolbar: FeatureSpec = {
  name: "link-hover-toolbar",
  plugins: () => [linkHoverToolbarPlugin()],
};
