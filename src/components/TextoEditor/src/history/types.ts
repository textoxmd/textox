export type ViewKey = "ir" | "sv";

export interface TextPatch {
  from: number;
  to: number;
  insert: string;
}

export interface CursorPoint {
  line: number;
  col: number;
}

export interface CursorRange {
  anchor: CursorPoint;
  head: CursorPoint;
}

export interface HistoryStep {
  before: TextPatch;
  after: TextPatch;
  selectionBefore: CursorRange;
  selectionAfter: CursorRange;
  stateBefore: number;
  stateAfter: number;
  source: ViewKey;
  at: number;
}

export interface OpenGroup {
  source: ViewKey;
  startMd: string;
  startSelection: CursorRange;
  lastSelection: CursorRange;
  startStateId: number;
  lastStateId: number;
  startedAt: number;
  lastAt: number;
}

export interface CommitInput {
  md: string;
  selection: CursorRange;
  /** 本次事务开始前（startState）的选区；组首次提交时作为撤销目标光标。
   *  用事务后的选区会把「在代码块末尾输入」的光标记在块边界上，撤销时按行/列
   *  回推会跳到下一段。
   *
   *  允许传 thunk：行列换算在大文档下很贵，而只有组合起点那次提交真正消费它
   *  （组内后续提交直接丢弃），因此由会话在需要时求值。 */
  selectionBefore?: CursorRange | (() => CursorRange);
  source: ViewKey;
}

export interface ChangeMeta {
  stateId: number;
  dirty: boolean;
}

/** 恢复光标时的滚动对齐方式：nearest = 最小滚动（贴边），center = 目标行居中。 */
export type ScrollAlign = "nearest" | "center";

export interface HistoryViewAdapter {
  getMarkdown(): string;
  getSelection(): CursorRange;
  applyMarkdown(
    md: string,
    selection: CursorRange | null,
    align?: ScrollAlign,
  ): void;
  focus(): void;
}
