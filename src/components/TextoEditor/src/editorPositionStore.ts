// IR/SV 模式切换时的光标位置同步存储。
// 单槽接力：同一 editorKey 只需一份 {line, col}，切换时位置在两种模式间传递。
// key 用 editorKey，换文件时 key 自增，槽自动失效（自动重置）。
// 行号是两种模式间稳定的锚点：不要求行内字符完全一致，但保证不跳行。

interface EditorPosition {
  line: number;
  col: number;
}

let pos: { key: number; value: EditorPosition } | null = null;

export function getEditorPosition(key: number): EditorPosition | undefined {
  return pos && pos.key === key ? pos.value : undefined;
}

export function setEditorPosition(key: number, line: number, col: number): void {
  pos = { key, value: { line, col } };
}
