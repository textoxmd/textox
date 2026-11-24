import { registerContributions, resetExtensionPointsForTests } from '@texto/plugin-sdk';
import { MARKDOWN_EDITOR_EXTENSION } from '@texto/markdown-editor-api';
import type { EditorExtension } from '@texto/markdown-editor-api';
import { declareMarkdownEditorExtensionPoint } from '../../src/extension/registry';

/** 仅测试：清空并登记一组编辑器扩展贡献。 */
export function setEditorExtensions(exts: EditorExtension[]): void {
  resetExtensionPointsForTests();
  declareMarkdownEditorExtensionPoint();
  for (const ext of exts) {
    registerContributions(ext.id, { [MARKDOWN_EDITOR_EXTENSION]: [ext] });
  }
}
