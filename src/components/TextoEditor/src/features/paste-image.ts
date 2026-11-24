import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { getDocumentPath, getIsSingleFileMode } from "../doc-info.ts";
import { arrayBufferToBase64 } from "../array-buffer-to-base64.ts";
import type { FeatureSpec } from "./_types.ts";
import { markUploading, clearImageUploading, UPLOAD_META } from "./image-upload-state.ts";
import { getEditorHost } from "../host.ts";
import { preloadImage } from "../preload-image.ts";
import { toast } from "sonner";
import i18next from "i18next";

function isImageType(type: string): boolean {
  return type.startsWith("image/");
}

type SaveImageResult = {
  path: string;
  filename: string;
  relative_path: string;
};

function replaceImageSrcInView(view: EditorView, oldSrc: string, newSrc: string) {
  const tr = view.state.tr;
  let changed = false;
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text;
    if (!text) return;
    const idx = text.indexOf(`](${oldSrc}`);
    if (idx === -1) return;
    const closeParen = text.indexOf(")", idx);
    if (closeParen === -1) return;
    const from = pos + idx + 2;  // after "]("
    const to = pos + closeParen; // before ")"
    try {
      tr.replaceWith(from, to, view.state.schema.text(newSrc));
      changed = true;
    } catch (e) {
      console.warn("[paste-image] replace failed:", e);
    }
  });
  if (changed) view.dispatch(tr);
}

async function handleImagesPaste(
  files: File[],
  pos: number,
  view: EditorView,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const uploader = await getEditorHost().getImageUploader();
  const insert = (text: string, insertPos: number): number => {
    const docSize = view.state.doc.content.size;
    if (insertPos > docSize) insertPos = docSize;
    const tr = view.state.tr.insertText(text, insertPos);
    tr.setMeta(UPLOAD_META, true);
    view.dispatch(tr);
    return insertPos + text.length;
  };

  if (getIsSingleFileMode(view.state)) {
    toast.info(i18next.t('message.imageInsertNotAllowedSingleFile'));
    return;
  }

  if (uploader) {
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        const docPath = getDocumentPath(view.state);
        const result = await invoke<SaveImageResult>("save_image", {
          base64Data: base64,
          filename: file.name || "image.png",
          documentPath: docPath,
        });
        const alt = file.name ? file.name.replace(/\.[^.]+$/, "") : "image";

        // Set upload state BEFORE insert so the decoration picks it up on first render
        markUploading(result.relative_path);
        pos = insert(`![${alt}](${result.relative_path})`, pos);

        // Upload in background (no await — process concurrently)
        uploader.upload(result.path)
          .then(async (remoteUrl) => {
            await preloadImage(remoteUrl);
            clearImageUploading(result.relative_path, view);
            replaceImageSrcInView(view, result.relative_path, remoteUrl);
            invoke("delete_file", { path: result.path }).catch(() => {});
          })
          .catch((err) => {
            console.error("[paste-image] image upload failed:", err);
            clearImageUploading(result.relative_path, view);
          });
      } catch (err) {
        console.error("[paste-image] failed to handle image:", file.name, err);
      }
    }
  } else {
    // Non-upload mode: batch insert (existing behavior)
    let md = "";
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        const docPath = getDocumentPath(view.state);
        const result = await invoke<SaveImageResult>("save_image", {
          base64Data: base64,
          filename: file.name || "image.png",
          documentPath: docPath,
        });
        const alt = file.name ? file.name.replace(/\.[^.]+$/, "") : "image";
        md += `![${alt}](${result.relative_path})`;
      } catch (err) {
        console.error("[paste-image] failed to handle image:", file.name, err);
      }
    }
    if (md) {
      const docSize = view.state.doc.content.size;
      if (pos > docSize) pos = docSize;
      view.dispatch(view.state.tr.insertText(md, pos));
    }
  }
}

function clipboardHasImageDataType(event: ClipboardEvent): boolean {
  if (!event.clipboardData) return false;
  for (const type of event.clipboardData.types as unknown as string[]) {
    if (isImageType(type)) return true;
  }
  return false;
}

const pasteImageKey = new PluginKey("pasteImage");

function createPasteImagePlugin(): Plugin {
  return new Plugin({
    key: pasteImageKey,
    props: {
      handlePaste(view: EditorView, event: ClipboardEvent) {
        console.log("[paste-image] handlePaste called", {
          hasClipboardData: !!event.clipboardData,
          types: event.clipboardData ? Array.from(event.clipboardData.types as unknown as string[]) : [],
          filesLength: event.clipboardData?.files?.length ?? 0,
          itemsLength: event.clipboardData?.items?.length ?? 0,
        });

        const imageFiles: File[] = [];

        if (event.clipboardData?.files) {
          for (let i = 0; i < event.clipboardData.files.length; i++) {
            const file = event.clipboardData.files[i];
            console.log("[paste-image] checking file:", { name: file?.name, type: file?.type, size: file?.size });
            if (file && isImageType(file.type)) {
              imageFiles.push(file);
            }
          }
        }

        if (imageFiles.length === 0 && event.clipboardData?.items) {
          for (let i = 0; i < event.clipboardData.items.length; i++) {
            const item = event.clipboardData.items[i];
            console.log("[paste-image] checking item:", { kind: item.kind, type: item.type });
            if (isImageType(item.type)) {
              const file = item.getAsFile();
              console.log("[paste-image] getAsFile result:", { hasFile: !!file, fileName: file?.name, fileType: file?.type });
              if (file) imageFiles.push(file);
            }
          }
        }

        console.log("[paste-image] imageFiles found:", imageFiles.length);

        if (imageFiles.length > 0) {
          event.preventDefault();
          const pos = view.state.selection.$from.pos;
          handleImagesPaste(imageFiles, pos, view);
          return true;
        }

        // Fallback
        const hasImageType = clipboardHasImageDataType(event);
        const hasClipboardRead = typeof navigator !== "undefined" && navigator.clipboard?.read;
        console.log("[paste-image] fallback check:", { hasImageType, hasClipboardRead });

        if (hasImageType && hasClipboardRead) {
          console.log("[paste-image] using navigator.clipboard.read() fallback");
          event.preventDefault();
          const pos = view.state.selection.$from.pos;
          navigator.clipboard.read().then(
            (items) => {
              console.log("[paste-image] clipboard.read() succeeded, items:", items.length);
              for (const item of items) {
                console.log("[paste-image] clipboard item types:", item.types);
              }
              processClipboardItems(items, pos, view);
            },
            (err) => {
              console.error("[paste-image] clipboard.read() failed:", err);
            },
          );
          return true;
        }

        return false;
      },
    },
  });
}

async function processClipboardItems(
  items: ClipboardItems,
  pos: number,
  view: EditorView,
): Promise<void> {
  const imageFiles: File[] = [];

  for (const item of items) {
    console.log("[paste-image] processClipboardItems item types:", item.types);
    for (const type of item.types) {
      console.log("[paste-image] checking type:", type);
      if (isImageType(type)) {
        try {
          const blob = await item.getType(type);
          console.log("[paste-image] got blob:", { type, size: blob.size });
          const ext = type.split("/")[1] || "png";
          const file = new File([blob], `image.${ext}`, { type });
          imageFiles.push(file);
        } catch (err) {
          console.error("[paste-image] failed to get blob:", err);
        }
        break;
      }
    }
  }

  console.log("[paste-image] processClipboardItems imageFiles:", imageFiles.length);
  if (imageFiles.length > 0) {
    await handleImagesPaste(imageFiles, pos, view);
  }
}

export const pasteImage: FeatureSpec = {
  name: "paste-image",
  plugins: () => [createPasteImagePlugin()],
};
