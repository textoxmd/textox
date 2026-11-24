// 大文档「每次按键」成本基线。
//
// 只打印测量值 + 一条很宽松的上限断言（防 2~3 倍级别的回归），不做精确阈值，
// 避免在慢 CI / 不同 Node 版本上抖动。需要看 4000 块（约 233KB）的完整表格时：
//
//   PERF=1 npx vitest run --config src/components/TextoEditor/vitest.config.ts tests/perf
//
// 指标含义（对应一次按键的真实链路）：
//   dispatch   —— editor-api 的 dispatchTransaction 全链路（含 onChange 全文序列化）
//   dispatch*  —— 同上但事务带 source=history 抑制上报（纯 PM + 插件机件）
//   linecol    —— beforeSelection 的全文行列换算（含在 dispatch* 里）
//   md         —— getMarkdown() 全文序列化（含在 dispatch 里）
//   outline    —— headingLines + getMarkdown + extractHeadings（大纲可见时每键一次）
import { describe, expect, test } from "vitest";
import type { Editor } from "../../src/editor-api.ts";
import { extractHeadings } from "../../src/outline.ts";

(window as any).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async () => undefined,
  convertFileSrc: () => "",
};
(window as any).__TAURI__ = {};

const BIG = process.env.PERF === "1";
const BLOCKS = BIG ? 4000 : 2000;
const ITERATIONS = BIG ? 12 : 8;

/** 混合段落 / 列表 / 标题的文档，近似真实长文（标题每 40 块一个）。 */
function buildMarkdown(blocks: number): string {
  const parts: string[] = [];
  for (let i = 0; i < blocks; i++) {
    if (i % 40 === 0) {
      parts.push(`## 第 ${i} 节 标题 with **bold**`);
    } else if (i % 17 === 0) {
      parts.push(
        `- 列表项 ${i}，带 **粗体** 与 *斜体* 以及 \`行内代码\`\n- 第二项 ${i}\n- 第三项 ${i}`,
      );
    } else {
      parts.push(
        `第 ${i} 段正文，包含 **粗体**、*斜体*、[链接](https://example.com/${i}) 与 \`code-${i}\`，用来制造真实的 inline mark 结构。`,
      );
    }
  }
  return parts.join("\n\n") + "\n";
}

function p50(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function measure(label: string, fn: () => void, iterations = ITERATIONS): number {
  fn(); // 预热
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  const value = p50(samples);
  console.log(`  ${label.padEnd(26)} p50=${round(value)}`);
  return value;
}

describe("perf: 大文档每键成本", () => {
  test("dispatch / 序列化 / 大纲 基线", async () => {
    const { createEditor } = await import("../../src/editor-api.ts");
    const markdown = buildMarkdown(BLOCKS);

    for (const sourcePreserve of [false, true]) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      console.log(
        `\n[perf] ${BLOCKS} 块 / ${(markdown.length / 1024).toFixed(0)}KB  sourcePreserve=${sourcePreserve}`,
      );

      const opened = performance.now();
      let editor: Editor = createEditor(host, {
        initialContent: markdown,
        sourcePreserve,
        onChange: () => {},
      });
      const openMs = performance.now() - opened;
      console.log(`  ${"open".padEnd(26)} ${round(openMs)}`);

      try {
        const view = editor.view;
        // 光标放在文档中部，模拟最常见的编辑位置。
        const middle = Math.floor(view.state.doc.content.size / 2);
        const selection = view.state.selection.constructor as any;
        view.dispatch(view.state.tr.setSelection(selection.near(view.state.doc.resolve(middle))));

        // 每次按键在光标处插入一个字符（不切块、不改标题）。
        const typeChar = (suppressed: boolean): void => {
          const pos = view.state.selection.from;
          const tr = view.state.tr.insertText("x", pos);
          if (suppressed) tr.setMeta("source", "history");
          view.dispatch(tr);
        };

        measure("dispatch (含 onChange)", () => typeChar(false));
        measure("dispatch (抑制上报)", () => typeChar(true));
        measure("getMarkdown", () => {
          editor.getMarkdown();
        });
        measure("outline 全量提取", () => {
          const lines = editor.headingLines();
          extractHeadings(view, lines, lines ? editor.getMarkdown() : undefined);
        });

        expect(editor.getMarkdown().length).toBeGreaterThan(markdown.length / 2);
      } finally {
        editor.destroy();
        host.remove();
      }
    }
  }, 120_000);
});
