import { describe, expect, it } from 'vitest';
import { createEditor } from '../TextoEditor/src/editor-api';

// 大文档打字延迟护栏：每次按键都要走一遍「源保真行号映射 + 整篇序列化」，
// 这里用 ~600KB 文档把这条链路固定下来，防止行号映射再次退化成 O(n²)。
// 断言用宽松预算（真机 WebView 比 happy-dom 慢），目标是抓住数量级的退化。

const KB = 1024;

/** 覆盖标题 / 段落 / 行内标记 / 列表 / 引用 / 围栏代码 / 表格，块密度接近真实长文。 */
function bigDocument(bytes: number): string {
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  while (size < bytes) {
    const section = [
      `## Section ${i}`,
      '',
      'lorem ipsum dolor sit amet, consectetur adipiscing elit. **bold** and *italic* and `code` and [link](https://example.com).',
      '',
      '- item one',
      '- item two with `inline code`',
      '- item three',
      '',
      '> quoted paragraph with **strong** text.',
      '',
      '```ts',
      'const a = 1;',
      'function f() { return a + 1; }',
      '```',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
    ].join('\n');
    parts.push(section);
    size += section.length;
    i += 1;
  }
  return parts.join('\n');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe('大文档打字延迟', () => {
  it('600KB 文档每次按键的同步开销不超过 300ms', () => {
    const content = bigDocument(600 * KB);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host, {
      initialContent: content,
      sourcePreserve: true,
      onChange: () => {},
    });
    const view = editor.view;

    // 在文档中部打字（文档尾部另有专门的整篇渲染护栏）
    const insertAt = Math.floor(view.state.doc.content.size / 2);

    // 预热：首轮包含装饰/NodeView 的一次性构建，不计入按键延迟
    let warmPos = insertAt;
    for (let i = 0; i < 2; i += 1) {
      view.dispatch(view.state.tr.insertText('a', warmPos));
      warmPos += 1;
    }

    const samples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = performance.now();
      view.dispatch(view.state.tr.insertText('a', warmPos));
      samples.push(performance.now() - t0);
      warmPos += 1;
    }

    const perKeystroke = median(samples);
    console.log(
      `[largeDocTypingPerf] 600KB 按键耗时: ${samples.map((s) => s.toFixed(1)).join(' / ')} ms`,
    );

    editor.destroy();
    host.remove();

    expect(perKeystroke).toBeLessThan(300);
  }, 300_000);
});
