import { describe, expect, it, vi } from "vitest";
import { EditorDocumentSession } from "../../src/history/session";
import type { ChangeMeta, HistoryStep, HistoryViewAdapter } from "../../src/history/types";

function fakeView(initial: string) {
  let md = initial;
  let sel = { anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } };
  const applied: string[] = [];
  const adapter: HistoryViewAdapter = {
    getMarkdown: () => md,
    getSelection: () => sel,
    applyMarkdown(next, selection) {
      md = next;
      if (selection) sel = selection;
      applied.push(next);
    },
    focus: () => {},
  };
  return { adapter, applied, set: (v: string) => { md = v; }, setSel: (v: typeof sel) => { sel = v; } };
}

function create(initial = "abc") {
  let now = 0;
  const changes: Array<{ md: string; meta: ChangeMeta }> = [];
  const session = new EditorDocumentSession(initial, {
    now: () => now,
    onChange: (md, meta) => changes.push({ md, meta }),
  });
  return { session, changes, advance: (ms: number) => { now += ms; } };
}

describe("EditorDocumentSession", () => {
  it("500ms 内同源提交合并为一步", () => {
    const { session, advance } = create("a");
    session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    advance(100);
    session.commit({ md: "abc", selection: { anchor: { line: 1, col: 3 }, head: { line: 1, col: 3 } }, source: "ir" });
    session.undo("ir");
    expect(session.md).toBe("a");
  });

  it("超过 500ms 分成两步", () => {
    const { session, advance } = create("a");
    session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    advance(600);
    session.commit({ md: "abc", selection: { anchor: { line: 1, col: 3 }, head: { line: 1, col: 3 } }, source: "ir" });
    session.undo("ir");
    expect(session.md).toBe("ab");
    session.undo("ir");
    expect(session.md).toBe("a");
  });

  it("模式切换断开合并", () => {
    const { session, advance } = create("a");
    session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    advance(100);
    session.commit({ md: "abc", selection: { anchor: { line: 1, col: 3 }, head: { line: 1, col: 3 } }, source: "sv" });
    session.undo("sv");
    expect(session.md).toBe("ab");
  });

  it("撤销后新编辑清空 redo", () => {
    const { session, advance } = create("a");
    session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    advance(600);
    session.undo("ir");
    expect(session.redo("ir")).toBe(true);
    session.undo("ir");
    advance(600);
    session.commit({ md: "x", selection: { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } }, source: "ir" });
    expect(session.redo("ir")).toBe(false);
  });

  it("输入后删回原样仍推进 stateId；撤销回保存点才 dirty=false", () => {
    const { session, advance } = create("a");
    expect(session.isDirty).toBe(false);
    session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    advance(100);
    session.commit({ md: "a", selection: { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } }, source: "ir" });
    expect(session.isDirty).toBe(true);
    session.undo("ir");
    expect(session.md).toBe("a");
    expect(session.isDirty).toBe(false);
  });

  it("撤销/重做恢复视图与脏标记", () => {
    const { session } = create("a");
    const ir = fakeView("a");
    session.registerView("ir", ir.adapter, false);
    session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    session.undo("ir");
    expect(ir.applied[ir.applied.length - 1]).toBe("a");
  });

  it("外部 reset 清空历史但保留 dirty", () => {
    const { session } = create("a");
    session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    session.reset("xyz", "ir");
    expect(session.md).toBe("xyz");
    expect(session.undo("ir")).toBe(false);
    expect(session.isDirty).toBe(true);
    session.markSaved();
    expect(session.isDirty).toBe(false);
  });

  it("undo 补丁越界时清空历史且不改变状态", () => {
    const { session, changes } = create("abc");
    const internals = session as unknown as { undoStack: HistoryStep[] };
    internals.undoStack.push({
      before: { from: 99, to: 99, insert: "x" },
      after: { from: 0, to: 0, insert: "" },
      selectionBefore: { anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } },
      selectionAfter: { anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } },
      stateBefore: 1,
      stateAfter: 2,
      source: "ir",
      at: 0,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = changes.length;
    expect(session.undo("ir")).toBe(false);
    expect(session.md).toBe("abc");
    expect(session.isDirty).toBe(false);
    expect(changes.length).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(session.undo("ir")).toBe(false);
    warn.mockRestore();
  });

  it("redo 补丁越界时清空历史且不改变状态", () => {
    const { session, changes } = create("abc");
    const internals = session as unknown as { redoStack: HistoryStep[] };
    internals.redoStack.push({
      before: { from: 0, to: 0, insert: "" },
      after: { from: 99, to: 99, insert: "x" },
      selectionBefore: { anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } },
      selectionAfter: { anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } },
      stateBefore: 1,
      stateAfter: 2,
      source: "ir",
      at: 0,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = changes.length;
    expect(session.redo("ir")).toBe(false);
    expect(session.md).toBe("abc");
    expect(session.isDirty).toBe(false);
    expect(changes.length).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(session.redo("ir")).toBe(false);
    warn.mockRestore();
  });

  it("晚注册视图恢复 pendingCursor", () => {
    const { session } = create("a");
    const pending = { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } };
    session.syncView("sv", pending, false); // 未注册 → 暂存
    const sv = fakeView("a");
    session.registerView("sv", sv.adapter, true);
    expect(sv.adapter.getSelection()).toEqual(pending);
  });

  it("reset 清空 pendingCursor", () => {
    const { session } = create("a");
    const stale = { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } };
    session.syncView("sv", stale, false); // 未注册 → 暂存
    session.reset("xyz", "ir");
    const sv = fakeView("a");
    session.registerView("sv", sv.adapter, true);
    // 旧光标属于上一份文本，不能再套到新文档上
    expect(sv.adapter.getSelection()).toEqual({
      anchor: { line: 1, col: 0 },
      head: { line: 1, col: 0 },
    });
  });

  it("保留最近 200 步", () => {
    const { session, advance } = create("a");
    for (let i = 0; i < 205; i += 1) {
      advance(600);
      const md = "a".repeat(i + 2);
      session.commit({
        md,
        selection: { anchor: { line: 1, col: md.length }, head: { line: 1, col: md.length } },
        source: "ir",
      });
    }
    let count = 0;
    while (session.undo("ir")) count += 1;
    expect(count).toBe(200);
  });

  it("syncView 把 center 对齐传给已注册视图", () => {
    const { session } = create("abc");
    const aligns: Array<string | undefined> = [];
    const adapter: HistoryViewAdapter = {
      getMarkdown: () => "abc",
      getSelection: () => ({ anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } }),
      applyMarkdown: (_md, _sel, align) => {
        aligns.push(align);
      },
      focus: () => {},
    };
    session.registerView("sv", adapter, false);
    session.syncView(
      "sv",
      { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } },
      true,
      "center",
    );
    expect(aligns).toEqual(["center"]);
  });

  it("syncView 的 center 对齐随 pending 光标保留到视图注册", () => {
    const { session } = create("abc");
    const aligns: Array<string | undefined> = [];
    const pending = { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } };
    const adapter: HistoryViewAdapter = {
      getMarkdown: () => "abc",
      getSelection: () => pending,
      applyMarkdown: (_md, _sel, align) => {
        aligns.push(align);
      },
      focus: () => {},
    };
    // 源码视图懒加载：切换发生时适配器还不存在，居中意图必须与光标一起暂存，
    // 否则视图就绪后按默认 nearest 对齐，目标行会贴在视口底边。
    session.syncView("sv", pending, true, "center");
    session.registerView("sv", adapter, true);
    expect(aligns).toEqual(["center"]);
  });

  it("syncView 默认按 nearest 对齐（注册视图不改变视口）", () => {
    const { session } = create("abc");
    const aligns: Array<string | undefined> = [];
    const adapter: HistoryViewAdapter = {
      getMarkdown: () => "abc",
      getSelection: () => ({ anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } }),
      applyMarkdown: (_md, _sel, align) => {
        aligns.push(align);
      },
      focus: () => {},
    };
    session.registerView("sv", adapter, false);
    session.syncView(
      "sv",
      { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } },
      true,
    );
    expect(aligns).toEqual(["nearest"]);
  });

  it("syncView 应用期间忽略适配器回调", () => {
    const { session, changes } = create("a");
    let applied = 0;
    const adapter: HistoryViewAdapter = {
      getMarkdown: () => "a",
      getSelection: () => ({ anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } }),
      applyMarkdown: () => {
        applied += 1;
        session.commit({
          md: "changed",
          selection: { anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } },
          source: "sv",
        });
      },
      focus: () => {},
    };
    session.registerView("sv", adapter, true);
    // 文本相等时也走 applyMarkdown（恢复选区），期间适配器回调必须被忽略。
    session.syncView("sv", { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } }, false);
    expect(applied).toBe(1);
    expect(session.md).toBe("a");
    expect(changes.length).toBe(0);
  });

  it("undo/redo 恢复选区", () => {
    const { session } = create("a");
    const ir = fakeView("a");
    session.registerView("ir", ir.adapter, false);
    const first = { anchor: { line: 1, col: 1 }, head: { line: 1, col: 1 } };
    const second = { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } };
    session.commit({ md: "ab", selection: first, source: "ir" });
    session.commit({ md: "abc", selection: second, source: "ir" });
    session.undo("ir");
    expect(ir.adapter.getSelection()).toEqual(first);
    session.redo("ir");
    expect(ir.adapter.getSelection()).toEqual(second);
  });

  it("CRLF 文档以 CRLF 为规范坐标", () => {
    const { session, changes } = create("a\r\nb");
    expect(session.md).toBe("a\r\nb");

    const sv = fakeView("a\nbX");
    session.registerView("sv", sv.adapter, false);
    session.commit({
      md: "a\nbX",
      selection: { anchor: { line: 2, col: 2 }, head: { line: 2, col: 2 } },
      source: "sv",
    });
    expect(session.md).toBe("a\r\nbX");
    expect(changes[changes.length - 1]?.md).toBe("a\r\nbX");
  });

  it("CRLF 会话把 LF 视图文本视为相等（不写回）", () => {
    const { session } = create("a\r\nb");
    const sv = fakeView("a\nb");
    session.registerView("sv", sv.adapter, true);
    expect(sv.applied).toEqual([]);
  });

  it("reset 按会话风格规范化外部文本", () => {
    const { session } = create("a\r\nb");
    session.reset("x\ny", "ir");
    expect(session.md).toBe("x\r\ny");
  });

  it("LF 文档不接受 CRLF 提交（归一化后比较）", () => {
    const { session, changes } = create("a\nb");
    expect(session.md).toBe("a\nb");
    session.commit({
      md: "a\r\nb",
      selection: { anchor: { line: 1, col: 0 }, head: { line: 1, col: 0 } },
      source: "ir",
    });
    // 归一化后与当前文本相同 ⇒ 不推进 stateId、不触发 onChange。
    expect(session.md).toBe("a\nb");
    expect(changes).toEqual([]);
  });

  it("500ms 边界：等于阈值合并，超过分裂", () => {
    const merged = create("a");
    merged.session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    merged.advance(500);
    merged.session.commit({ md: "abc", selection: { anchor: { line: 1, col: 3 }, head: { line: 1, col: 3 } }, source: "ir" });
    merged.session.undo("ir");
    expect(merged.session.md).toBe("a");

    const split = create("a");
    split.session.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    split.advance(501);
    split.session.commit({ md: "abc", selection: { anchor: { line: 1, col: 3 }, head: { line: 1, col: 3 } }, source: "ir" });
    split.session.undo("ir");
    expect(split.session.md).toBe("ab");
  });

  it("beginSavePoint 会断开 undo 组，undo 回到保存点而不是组起点", () => {
    const s = new EditorDocumentSession("a", { onChange: () => {} });
    s.commit({ md: "ab", selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } }, source: "ir" });
    const point = s.beginSavePoint(); // "ab"
    s.commit({ md: "abc", selection: { anchor: { line: 1, col: 3 }, head: { line: 1, col: 3 } }, source: "ir" });
    s.undo("ir");
    expect(s.md).toBe("ab");
    expect(point.content).toBe("ab");
  });
});
