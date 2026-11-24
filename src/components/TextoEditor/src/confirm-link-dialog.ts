import i18next from "i18next";

import { getEditorHost } from "./host.ts";

export function showConfirmLinkDialog(href: string): Promise<boolean> {
  const urlBox = document.createElement("div");
  urlBox.className =
    "rounded-md bg-muted p-3 font-mono text-xs break-all text-muted-foreground";
  urlBox.textContent = href;

  return getEditorHost().showDialog<boolean>({
    title: i18next.t("editor.openLinkTitle"),
    content: urlBox,
    buttons: [
      { text: i18next.t("common.cancel"), variant: "secondary", value: false },
      { text: i18next.t("editor.openLinkVisit"), variant: "primary", value: true },
    ],
    dismissValue: false,
    focusButtonIndex: 1,
  });
}
