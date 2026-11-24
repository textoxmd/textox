import i18n from "@/i18n";
import { showGlassDialog } from "@/components/GlassDialog";

export type SaveConflictAction = "overwrite" | "reload" | "cancel";

export function showSaveConflictDialog(fileName: string): Promise<SaveConflictAction> {
  const description = document.createElement("div");
  description.className = "text-sm text-muted-foreground";

  const nameSpan = document.createElement("span");
  nameSpan.className = "font-medium text-foreground";
  nameSpan.textContent = fileName;

  const descSpan = document.createElement("span");
  descSpan.className = "block mt-1";
  descSpan.textContent = i18n.t("dialog.saveConflictDesc", {
    defaultValue:
      "该文件已在磁盘上被外部修改。你可以覆盖保存（丢弃外部修改）、重新加载最新内容（丢弃当前未保存的修改）或取消保存。",
  });

  description.appendChild(nameSpan);
  description.appendChild(descSpan);

  return showGlassDialog<SaveConflictAction>({
    title: i18n.t("dialog.fileModifiedTitle"),
    content: description,
    buttons: [
      { text: i18n.t("common.cancel"), variant: "secondary", value: "cancel" },
      { text: i18n.t("dialog.fileModifiedReload"), variant: "secondary", value: "reload" },
      {
        text: i18n.t("dialog.saveConflictOverwrite", { defaultValue: "覆盖保存" }),
        variant: "primary",
        value: "overwrite",
      },
    ],
    focusButtonIndex: 2,
  });
}
