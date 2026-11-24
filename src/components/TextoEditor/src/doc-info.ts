import { EditorState, Plugin, PluginKey } from "prosemirror-state";

export type DocInfoState = {
  documentDir: string | null;
  documentPath: string | null;
  isSingleFileMode: boolean;
  openableExtensions: string[];
  onOpenFileLink?: (path: string) => void;
};

const docInfoKey = new PluginKey<DocInfoState>("docInfo");

export function docInfoPlugin(
  documentPath: string | undefined,
  isSingleFileMode = false,
  openableExtensions: string[] = [],
  onOpenFileLink?: (path: string) => void,
): Plugin<DocInfoState> {
  const documentDir = !documentPath
    ? null
    : (() => {
        const lastSlash = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
        return lastSlash >= 0 ? documentPath.substring(0, lastSlash) : null;
      })();

  return new Plugin<DocInfoState>({
    key: docInfoKey,
    state: {
      init: () => ({ documentDir, documentPath: documentPath ?? null, isSingleFileMode, openableExtensions, onOpenFileLink }),
      apply: (_tr, value) => value,
    },
  });
}

export function getDocumentDir(state: EditorState): string | null {
  const pluginState = docInfoKey.getState(state);
  return pluginState?.documentDir ?? null;
}

export function getDocumentPath(state: EditorState): string | null {
  const pluginState = docInfoKey.getState(state);
  return pluginState?.documentPath ?? null;
}

export function getIsSingleFileMode(state: EditorState): boolean {
  const pluginState = docInfoKey.getState(state);
  return pluginState?.isSingleFileMode ?? false;
}

export function getOpenableExtensions(state: EditorState): string[] {
  return docInfoKey.getState(state)?.openableExtensions ?? [];
}

export function getOnOpenFileLink(state: EditorState): ((path: string) => void) | undefined {
  return docInfoKey.getState(state)?.onOpenFileLink;
}