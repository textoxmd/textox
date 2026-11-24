import { describe, expect, it } from "vitest";
import { EditorDocumentSession } from "../../src/history/session";

function setup() {
  return new EditorDocumentSession("abc", { onChange: () => {} });
}

const sel = (col: number) => ({
  anchor: { line: 1, col },
  head: { line: 1, col },
});

describe("保存点", () => {
  it("beginSavePoint 返回内容、stateId、会话代次与保存序号", () => {
    const s = setup();
    s.commit({ md: "abcd", selection: sel(4), source: "ir" });
    const point = s.beginSavePoint();
    expect(point.content).toBe("abcd");
    expect(point.stateId).toBeGreaterThan(0);
    expect(point.sessionId).toBeGreaterThan(0);
    expect(point.saveSeq).toBeGreaterThan(0);
    expect(s.confirmSavePoint(point.stateId, point.sessionId, point.saveSeq)).toBe(true);
    expect(s.isDirty).toBe(false);
  });

  it("写盘期间继续输入仍为 dirty", () => {
    const s = setup();
    s.commit({ md: "abcd", selection: sel(4), source: "ir" });
    const point = s.beginSavePoint();
    s.commit({ md: "abcde", selection: sel(5), source: "ir" });
    s.confirmSavePoint(point.stateId, point.sessionId, point.saveSeq);
    expect(s.isDirty).toBe(true);
  });

  it("markSaved 把保存点设为当前状态并让更早的在途写盘失效", () => {
    const s = setup();
    const older = s.beginSavePoint(); // saveSeq 1
    s.beginSavePoint(); // saveSeq 2（更新的在途写盘）
    s.commit({ md: "abcd", selection: sel(4), source: "ir" });
    s.markSaved();
    expect(s.isDirty).toBe(false);
    expect(s.confirmSavePoint(older.stateId, older.sessionId, older.saveSeq)).toBe(false);
    expect(s.isDirty).toBe(false);
  });

  it("撤销越过保存点后再保存，允许回退并清 dirty", () => {
    const s = new EditorDocumentSession("a", { onChange: () => {} });
    s.commit({ md: "ab", selection: sel(2), source: "ir" }); // state 1
    const p1 = s.beginSavePoint();
    s.confirmSavePoint(p1.stateId, p1.sessionId, p1.saveSeq);
    expect(s.isDirty).toBe(false);

    s.commit({ md: "abc", selection: sel(3), source: "ir" }); // state 2
    s.undo("ir"); // state 1
    s.undo("ir"); // state 0
    expect(s.isDirty).toBe(true);

    const p2 = s.beginSavePoint(); // stateId 0，saveSeq 2
    expect(p2.stateId).toBe(0);
    expect(s.confirmSavePoint(p2.stateId, p2.sessionId, p2.saveSeq)).toBe(true);
    expect(s.isDirty).toBe(false);
  });

  it("旧写盘迟到不会覆盖新保存点", () => {
    const s = new EditorDocumentSession("a", { onChange: () => {} });
    const p1 = s.beginSavePoint(); // saveSeq 1，stateId 0
    s.commit({ md: "ab", selection: sel(2), source: "ir" }); // state 1
    const p2 = s.beginSavePoint(); // saveSeq 2，stateId 1
    expect(s.confirmSavePoint(p2.stateId, p2.sessionId, p2.saveSeq)).toBe(true);
    expect(s.isDirty).toBe(false);

    // 先开始的写盘后完成：拒绝，且不能把保存点拉回 p1 的 stateId
    expect(s.confirmSavePoint(p1.stateId, p1.sessionId, p1.saveSeq)).toBe(false);
    expect(s.isDirty).toBe(false);
  });

  it("旧会话的保存点不能确认到新会话", () => {
    const a = new EditorDocumentSession("a", { onChange: () => {} });
    const pa = a.beginSavePoint();
    const b = new EditorDocumentSession("b", { onChange: () => {} });
    expect(b.confirmSavePoint(pa.stateId, pa.sessionId, pa.saveSeq)).toBe(false);
    expect(b.isDirty).toBe(false);
  });

  it("stateId 晚于当前状态或为负时拒绝确认", () => {
    const s = setup();
    s.commit({ md: "abcd", selection: sel(4), source: "ir" });
    expect(s.confirmSavePoint(-1, s.beginSavePoint().sessionId)).toBe(false);
    expect(s.confirmSavePoint(9999)).toBe(false);
    expect(s.isDirty).toBe(true);
  });

  it("不传 sessionId / saveSeq 时只校验 stateId（兼容调用方）", () => {
    const s = setup();
    s.commit({ md: "abcd", selection: sel(4), source: "ir" });
    expect(s.confirmSavePoint(1)).toBe(true);
    expect(s.isDirty).toBe(false);
  });
});
