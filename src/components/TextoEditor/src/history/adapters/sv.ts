import type { SourceViewApi } from "../../source-view";
import type { HistoryViewAdapter } from "../types";

/** 把源码视图（CodeMirror）接到统一历史会话上。 */
export function createSvAdapter(api: SourceViewApi): HistoryViewAdapter {
  return {
    getMarkdown: () => api.getMarkdown(),
    getSelection: () => api.getSelection(),
    applyMarkdown: (md, selection, align) => api.applyMarkdown(md, selection, align),
    focus: () => api.focus(),
  };
}
