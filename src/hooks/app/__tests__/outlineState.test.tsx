import { act, createElement, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RefObject } from 'react';

import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';
import { useOutlineState } from '../useOutlineState';

// 稳定的 ref：Harness 每次重渲染都会执行 effect，若每次新建对象会反复触发
// useOutline / useOutlineActiveIndex 的 effect（setHeadings 新数组 → 重渲染循环）。
const editorRef: RefObject<TextoEditorRef | null> = { current: null };

let latest: ReturnType<typeof useOutlineState> | null = null;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function harness(commandInput: string): FunctionComponent {
  return function Harness() {
    latest = useOutlineState({
      editorRef,
      currentFile: 'doc.md',
      editorMode: 'ir',
      currentContent: '',
      commandInput,
    });
    return null;
  };
}

function mount(commandInput: string) {
  latest = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(harness(commandInput)));
  });
}

function setOutline() {
  act(() => {
    latest!.setOutline([
      { level: 1, text: '**Bold**', line: 1, pos: 4 },
    ]);
  });
}

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
});

describe('useOutlineState displayText wiring', () => {
  it('setOutline 后 outline 返回 displayText，同时保留原始 text', () => {
    mount('#bold');
    setOutline();

    expect(latest!.outline).toEqual([
      { level: 1, text: '**Bold**', line: 1, pos: 4, displayText: 'Bold' },
    ]);
    expect(latest!.outline[0]!.text).toBe('**Bold**');
  });

  it('命令面板 # 按可见文本命中，结果仍带原始 text', () => {
    mount('#bold');
    setOutline();

    expect(latest!.filteredHeadings.map((h) => h.text)).toEqual(['**Bold**']);
    expect(latest!.filteredHeadings[0]!.displayText).toBe('Bold');
  });

  it('outlineHeadings 优先使用全文 outline（编辑器窗口读不到时仍列出章节）', () => {
    mount('#bold');
    setOutline();

    expect(latest!.outlineHeadings.map((h) => h.text)).toEqual(['**Bold**']);
    expect(latest!.outlineHeadings[0]!.displayText).toBe('Bold');
  });
});

describe('useOutlineState filter wiring', () => {
  it('命令面板 # 不再按 Markdown 标记命中', () => {
    mount('#**');
    setOutline();

    expect(latest!.filteredHeadings).toEqual([]);
  });
});
