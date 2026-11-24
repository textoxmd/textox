import { vi, describe, expect, test, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// happy-dom 不会为 <img> 触发 load/error，real preloadImage 会永远挂起，
// 使上传成功后的替换逻辑无法执行。上传契约测试与该副作用无关，故在此隔离。
vi.mock("../../src/preload-image.ts", () => ({
  preloadImage: vi.fn(async () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import { createState } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { feedPaste, createMockFile } from "../../specs/events.ts";
import { fakeView } from "../../specs/sim.ts";
import { getEditorHost, setEditorHost } from "../../src/host";

const mockInvoke = vi.mocked(invoke);

describe("paste-image", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  test("handlePaste inserts image markdown from files", async () => {
    mockInvoke.mockResolvedValue({
      path: "/fake/path/photo.png",
      filename: "photo.png",
      relative_path: "assets/photo.png",
    });
    const doc = parse("hello");
    const state = createState(doc);
    const view = fakeView(state);

    const file = createMockFile("fake-png-data", "photo.png", "image/png");
    const handled = feedPaste(view, { files: [file] });

    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(view.state.doc.textContent).toContain("assets/photo.png");
    });
  });

  test("handlePaste inserts image markdown from items", async () => {
    mockInvoke.mockResolvedValue({
      path: "/fake/path/photo.png",
      filename: "photo.png",
      relative_path: "assets/photo.png",
    });
    const doc = parse("hello");
    const state = createState(doc);
    const view = fakeView(state);

    const file = createMockFile("fake-png-data", "photo.png", "image/png");
    const item = {
      kind: "file",
      type: "image/png",
      getAsFile: () => file,
    } as unknown as DataTransferItem;
    const handled = feedPaste(view, { items: [item] });

    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(view.state.doc.textContent).toContain("assets/photo.png");
    });
  });

  test("handlePaste returns false for non-image content", () => {
    const doc = parse("hello");
    const state = createState(doc);
    const view = fakeView(state);

    const file = createMockFile("text-data", "notes.txt", "text/plain");
    const handled = feedPaste(view, { files: [file] });

    expect(handled).toBe(false);
  });

  test("handlePaste returns false for empty clipboard", () => {
    const doc = parse("hello");
    const state = createState(doc);
    const view = fakeView(state);

    const handled = feedPaste(view, { files: [], items: [] });

    expect(handled).toBe(false);
  });

  test("document unchanged when save_image fails", async () => {
    mockInvoke.mockRejectedValue(new Error("disk full"));
    const doc = parse("hello");
    const state = createState(doc);
    const view = fakeView(state);

    const file = createMockFile("fake-png-data", "photo.png", "image/png");
    const handled = feedPaste(view, { files: [file] });

    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(view.state.doc.textContent).toBe("hello");
    });
  });

  test("handlePaste handles multiple images in files", async () => {
    mockInvoke.mockResolvedValue({
      path: "/fake/path/img.png",
      filename: "img.png",
      relative_path: "assets/img.png",
    });
    const doc = parse("hello");
    const state = createState(doc);
    const view = fakeView(state);

    const file1 = createMockFile("data1", "img1.png", "image/png");
    const file2 = createMockFile("data2", "img2.png", "image/png");
    const handled = feedPaste(view, { files: [file1, file2] });

    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(view.state.doc.textContent).toContain("![img1]");
    });
    expect(view.state.doc.textContent).toContain("![img2]");
  });

  test('uploads via the injected uploader and replaces the local src', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'save_image') {
        return { path: '/fake/path/photo.png', filename: 'photo.png', relative_path: 'assets/photo.png' };
      }
      return undefined;
    });
    const original = getEditorHost();
    const upload = vi.fn(async () => 'https://cdn.example/photo.png');
    setEditorHost({ ...original, getImageUploader: async () => ({ upload }) });
    try {
      const view = fakeView(createState(parse('hello')));
      const file = createMockFile('fake-png-data', 'photo.png', 'image/png');
      expect(feedPaste(view, { files: [file] })).toBe(true);
      await vi.waitFor(() => {
        expect(view.state.doc.textContent).toContain('https://cdn.example/photo.png');
      });
      expect(upload).toHaveBeenCalledWith('/fake/path/photo.png');
    } finally {
      setEditorHost(original);
    }
  });

  test('keeps the local path when the uploader rejects', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'save_image') {
        return { path: '/fake/path/photo.png', filename: 'photo.png', relative_path: 'assets/photo.png' };
      }
      return undefined;
    });
    const original = getEditorHost();
    const upload = vi.fn(async () => {
      throw new Error('upload failed');
    });
    setEditorHost({ ...original, getImageUploader: async () => ({ upload }) });
    try {
      const view = fakeView(createState(parse('hello')));
      const file = createMockFile('fake-png-data', 'photo.png', 'image/png');
      expect(feedPaste(view, { files: [file] })).toBe(true);
      await vi.waitFor(() => {
        expect(upload).toHaveBeenCalled();
      });
      // 失败后：保留本地相对路径，不出现远端 URL
      expect(view.state.doc.textContent).toContain('assets/photo.png');
      expect(view.state.doc.textContent).not.toContain('http');
    } finally {
      setEditorHost(original);
    }
  });
});
