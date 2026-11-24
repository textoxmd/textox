import { type EditorView } from "prosemirror-view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { showConfirmLinkDialog } from "./confirm-link-dialog.ts";
import { getDocumentDir, getOpenableExtensions, getOnOpenFileLink } from "./doc-info.ts";

export type UrlType = "external" | "anchor" | "safe-scheme" | "unknown";

export function isFileLink(href: string, openableExtensions: string[]): boolean {
  if (!href || openableExtensions.length === 0) return false;
  if (/^(https?:|mailto:|tel:|file:)/i.test(href)) return false;
  if (href.startsWith("#")) return false;
  const pathPart = href.split(/[?#]/)[0]!;
  const dotIdx = pathPart.lastIndexOf(".");
  if (dotIdx < 0 || dotIdx === pathPart.length - 1) return false;
  const ext = pathPart.slice(dotIdx + 1).toLowerCase();
  return openableExtensions.includes(ext);
}

function normalizeSegments(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export function resolveFileLink(href: string, documentDir: string): string {
  const pathPart = href.split(/[?#]/)[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }

  if (/^[A-Za-z]:[\\/]/.test(decoded)) {
    return normalizeSegments(decoded.replace(/\\/g, "/"));
  }

  const candidate = decoded.startsWith("/")
    ? decoded
    : documentDir.replace(/\\/g, "/") + "/" + decoded;
  const wasAbs = candidate.startsWith("/");
  const normalized = normalizeSegments(candidate);
  return wasAbs ? "/" + normalized : normalized;
}

export function classifyUrl(href: string): UrlType {
  if (href.startsWith("http://") || href.startsWith("https://")) return "external";
  if (href.startsWith("#")) return "anchor";
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return "safe-scheme";
  return "unknown";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function scrollToHeading(view: EditorView, fragment: string): void {
  const decoded = decodeURIComponent(fragment);
  const targetSlug = slugify(fragment);

  let foundPos: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (foundPos !== null) return false;
    if (node.type.name !== "heading") return true;
    const text = node.textContent;
    if (text === decoded) {
      foundPos = pos;
      return false;
    }
    if (targetSlug && slugify(text) === targetSlug) {
      foundPos = pos;
      return false;
    }
    return true;
  });

  if (foundPos !== null) {
    const dom = view.domAtPos(foundPos + 1);
    const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
}

async function openExternally(href: string): Promise<void> {
  const confirmed = await showConfirmLinkDialog(href);
  if (!confirmed) return;
  try {
    await openUrl(href);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

export async function navigateLink(href: string, view: EditorView): Promise<void> {
  const exts = getOpenableExtensions(view.state);
  if (exts.length > 0 && isFileLink(href, exts)) {
    const dir = getDocumentDir(view.state);
    const onOpenFileLink = getOnOpenFileLink(view.state);
    if (dir && onOpenFileLink) {
      onOpenFileLink(resolveFileLink(href, dir));
      return;
    }
    return;
  }
  const type = classifyUrl(href);
  switch (type) {
    case "external":
    case "unknown":
      await openExternally(href);
      break;
    case "anchor":
      scrollToHeading(view, href.slice(1));
      break;
    case "safe-scheme":
      // mailto: / tel: 也会交给系统（邮件/电话应用），同样先二次确认，
      // 避免一次误点就直接唤起外部应用。
      await openExternally(href);
      break;
  }
}
