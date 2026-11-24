import { applyPatch, diffPatch, GROUP_MS } from "./diff";
import type {
  ChangeMeta,
  CommitInput,
  CursorRange,
  HistoryStep,
  HistoryViewAdapter,
  OpenGroup,
  ScrollAlign,
  TextPatch,
  ViewKey,
} from "./types";

const MAX_STEPS = 200;
const MAX_PATCH_CHARS = 2 * 1024 * 1024;

/** 会话实例代次：每次 new EditorDocumentSession 自增，用于识别跨会话的保存点。 */
let sessionSeq = 0;

export interface EditorSavePoint {
  stateId: number;
  content: string;
  /** 会话实例代次；宿主在 confirm 时回传，防止旧会话的保存点污染新会话 */
  sessionId: number;
  /**
   * 保存动作的单调序号：每次 beginSavePoint 自增。
   * stateId 会随 undo 后退，不能用来判断写盘先后；迟到的旧写盘靠它识别。
   */
  saveSeq: number;
}

function stepChars(step: HistoryStep): number {
  return step.before.insert.length + step.after.insert.length;
}

/** selectionBefore 允许惰性 thunk（见 CommitInput）；只在本处求值一次。 */
function resolveSelection(
  value: CursorRange | (() => CursorRange) | undefined,
): CursorRange | undefined {
  return typeof value === "function" ? value() : value;
}

export interface EditorDocumentSessionOptions {
  onChange: (md: string, meta: ChangeMeta) => void;
  now?: () => number;
}

export class EditorDocumentSession {
  private currentMd: string;
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private group: OpenGroup | null = null;
  private stateId = 0;
  private stateSeq = 0;
  private savedStateId = 0;
  private saveSeq = 0;
  private lastConfirmedSaveSeq = 0;
  private applying = false;
  private views: Partial<Record<ViewKey, HistoryViewAdapter>> = {};
  private pendingCursor: Partial<
    Record<ViewKey, { selection: CursorRange | null; align: ScrollAlign }>
  > = {};
  private patchChars = 0;
  private readonly options: EditorDocumentSessionOptions;
  private readonly sessionId = ++sessionSeq;
  // 会话以初始文档的主导换行风格为规范坐标：IR/source-preserve 可能产 CRLF，
  // 而 SV（CodeMirror）恒为 LF，统一到同一风格后两份文本才可直接比较。
  // 混合行尾按数量取主导风格（同数取 LF），保存时整篇统一；孤立 \r 归一为 \n。
  private readonly eol: "\n" | "\r\n";

  constructor(initialMd: string, options: EditorDocumentSessionOptions) {
    this.options = options;
    const crlfCount = (initialMd.match(/\r\n/g) ?? []).length;
    const lfCount = initialMd.split("\n").length - 1 - crlfCount;
    this.eol = crlfCount > 0 && crlfCount >= lfCount ? "\r\n" : "\n";
    this.currentMd = this.normalize(initialMd);
  }

  get md(): string {
    return this.currentMd;
  }

  get isDirty(): boolean {
    return this.stateId !== this.savedStateId;
  }

  get meta(): ChangeMeta {
    return { stateId: this.stateId, dirty: this.isDirty };
  }

  get isApplying(): boolean {
    return this.applying;
  }

  registerView(key: ViewKey, adapter: HistoryViewAdapter, sync = true): void {
    this.views[key] = adapter;
    if (sync) this.syncView(key, null, false);
  }

  unregisterView(key: ViewKey): void {
    delete this.views[key];
    delete this.pendingCursor[key];
  }

  commit(input: CommitInput): void {
    const md = this.normalize(input.md);
    if (this.applying || md === this.currentMd) return;
    const now = this.options.now?.() ?? Date.now();

    if (this.group && (this.group.source !== input.source || now - this.group.lastAt > GROUP_MS)) {
      this.finalizeGroup();
    }

    if (!this.group) {
      this.group = {
        source: input.source,
        startMd: this.currentMd,
        // 撤销目标光标取事务开始前的选区：事务后的光标可能落在块边界
        // （代码块末尾输入），按行/列回推会跳到块外。惰性 thunk 只在这里求值一次。
        startSelection: resolveSelection(input.selectionBefore) ?? input.selection,
        lastSelection: input.selection,
        startStateId: this.stateId,
        lastStateId: this.stateId,
        startedAt: now,
        lastAt: now,
      };
      this.clearRedo();
    }

    this.stateId = ++this.stateSeq;
    this.currentMd = md;
    this.group.lastSelection = input.selection;
    this.group.lastAt = now;
    this.group.lastStateId = this.stateId;
    this.options.onChange(this.currentMd, this.meta);
  }

  closeGroup(): void {
    this.finalizeGroup();
  }

  undo(active: ViewKey): boolean {
    this.finalizeGroup();
    const step = this.undoStack.pop();
    if (!step) return false;
    const nextMd = this.safeApply(step.before);
    if (nextMd === null) return false;
    this.redoStack.push(step);
    this.currentMd = nextMd;
    this.stateId = step.stateBefore;
    this.applyToActive(active, step.selectionBefore);
    this.options.onChange(this.currentMd, this.meta);
    return true;
  }

  redo(active: ViewKey): boolean {
    this.finalizeGroup();
    const step = this.redoStack.pop();
    if (!step) return false;
    const nextMd = this.safeApply(step.after);
    if (nextMd === null) return false;
    this.undoStack.push(step);
    this.currentMd = nextMd;
    this.stateId = step.stateAfter;
    this.applyToActive(active, step.selectionAfter);
    this.options.onChange(this.currentMd, this.meta);
    return true;
  }

  reset(md: string, active: ViewKey): void {
    this.finalizeGroup();
    this.undoStack = [];
    this.redoStack = [];
    this.patchChars = 0;
    this.group = null;
    this.currentMd = this.normalize(md);
    // 换文档后旧视图的光标属于上一份文本，不能再套到新文档上。
    this.pendingCursor = {};
    this.applyToActive(active, null);
  }

  /** 结算编辑组并把保存点设为当前状态。 */
  markSaved(): void {
    this.finalizeGroup();
    this.savedStateId = this.stateId;
    // 更早发起、尚未回传的在途写盘一律失效（当前序号仍可确认）。
    this.lastConfirmedSaveSeq = this.saveSeq;
  }

  /** 结算编辑组，返回写盘应使用的状态与内容。 */
  beginSavePoint(): EditorSavePoint {
    this.finalizeGroup();
    return {
      stateId: this.stateId,
      content: this.currentMd,
      sessionId: this.sessionId,
      saveSeq: ++this.saveSeq,
    };
  }

  /**
   * 确认一次写盘完成。stateId 允许回退（保存 → 撤销越过保存点 → 再保存），
   * 写盘先后用 saveSeq 判断：乱序完成的旧写盘不能覆盖更新的保存点。
   */
  confirmSavePoint(stateId: number, sessionId?: number, saveSeq?: number): boolean {
    if (sessionId !== undefined && sessionId !== this.sessionId) return false;
    if (stateId < 0 || stateId > this.stateId) return false;
    if (saveSeq !== undefined && saveSeq < this.lastConfirmedSaveSeq) return false;
    this.savedStateId = stateId;
    if (saveSeq !== undefined) this.lastConfirmedSaveSeq = saveSeq;
    return true;
  }

  /**
   * 把会话内容/光标同步到指定视图。
   *
   * `align` 决定恢复光标时的滚动对齐：默认 `nearest`（最小滚动，撤销等路径沿用）；
   * 模式切换传 `center`，否则目标行在视口外时会被贴到底边。视图尚未注册（懒加载）
   * 时对齐意图与光标一起暂存，注册时按暂存的意图应用。
   */
  syncView(
    key: ViewKey,
    fallback: CursorRange | null,
    focus: boolean,
    align: ScrollAlign = "nearest",
  ): void {
    const adapter = this.views[key];
    if (!adapter) {
      this.pendingCursor[key] = { selection: fallback, align };
      return;
    }
    const pending = this.pendingCursor[key];
    const selection = pending ? pending.selection : fallback;
    const resolvedAlign = pending ? pending.align : align;
    const sameDoc = this.normalize(adapter.getMarkdown()) === this.currentMd;
    this.applying = true;
    try {
      // 文本相同只恢复选区/焦点，不产生整篇替换。
      if (sameDoc && !selection) {
        delete this.pendingCursor[key];
        if (focus) this.focusSafely(adapter);
        return;
      }
      this.applySafely(adapter, selection, resolvedAlign);
      if (focus) this.focusSafely(adapter);
      delete this.pendingCursor[key];
    } finally {
      this.applying = false;
    }
  }

  /** 适配器失败不应中断模式切换/撤销：DEV 下告警，其余交给视图自身兜底。 */
  private applySafely(
    adapter: HistoryViewAdapter,
    selection: CursorRange | null,
    align: ScrollAlign = "nearest",
  ): void {
    try {
      adapter.applyMarkdown(this.currentMd, selection, align);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[editor] applyMarkdown failed", err);
      }
    }
  }

  private focusSafely(adapter: HistoryViewAdapter): void {
    try {
      adapter.focus();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[editor] focus failed", err);
      }
    }
  }

  /** 把任意换行风格统一到会话的规范风格。 */
  private normalize(md: string): string {
    const lf = md.replace(/\r\n?/g, "\n");
    return this.eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
  }

  private safeApply(patch: TextPatch): string | null {
    if (
      patch.from < 0 ||
      patch.to < patch.from ||
      patch.to > this.currentMd.length
    ) {
      this.undoStack = [];
      this.redoStack = [];
      this.patchChars = 0;
      this.group = null;
      console.warn("[editor] history patch out of bounds, history cleared");
      return null;
    }
    return applyPatch(this.currentMd, patch);
  }

  private applyToActive(key: ViewKey, selection: CursorRange | null): void {
    const adapter = this.views[key];
    if (!adapter) {
      this.pendingCursor[key] = { selection, align: "nearest" };
      return;
    }
    this.applying = true;
    try {
      this.applySafely(adapter, selection, "nearest");
      this.focusSafely(adapter);
    } finally {
      this.applying = false;
      delete this.pendingCursor[key];
    }
  }

  private finalizeGroup(): void {
    const group = this.group;
    if (!group) return;
    const step: HistoryStep = {
      before: diffPatch(this.currentMd, group.startMd),
      after: diffPatch(group.startMd, this.currentMd),
      selectionBefore: group.startSelection,
      selectionAfter: group.lastSelection,
      stateBefore: group.startStateId,
      stateAfter: group.lastStateId,
      source: group.source,
      at: group.lastAt,
    };
    this.pushUndo(step);
    this.group = null;
  }

  private pushUndo(step: HistoryStep): void {
    this.undoStack.push(step);
    this.patchChars += stepChars(step);
    this.trim();
  }

  private clearRedo(): void {
    for (const step of this.redoStack) this.patchChars -= stepChars(step);
    this.redoStack = [];
  }

  private trim(): void {
    while (this.undoStack.length > MAX_STEPS || this.patchChars > MAX_PATCH_CHARS) {
      const removed = this.undoStack.shift();
      if (!removed) break;
      this.patchChars -= stepChars(removed);
    }
  }
}
