import { beforeEach, describe, it, expect, vi } from 'vitest';
import { Plugin } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';
import {
  registerContributions,
  declareExtensionPoint,
  resetExtensionPointsForTests,
} from '@texto/plugin-sdk';
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import type { SyntaxFeature } from '@texto/markdown-editor-api';

import {
  allFeatures,
  collectInputRules,
  collectKeymaps,
  collectNodes,
  collectPlugins,
  resetFeaturesForTests,
} from '../../src/features/index.ts';
import { parse, resetParserForTests } from '../../src/parser.ts';
import { parseInline } from '../../src/inline-parse.ts';
import { getSchema, resetSchemaForTests } from '../../src/schema.ts';

describe('features: 插件语法功能合并', () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    declareExtensionPoint({ id: MARKDOWN_EDITOR_SYNTAX_FEATURE }, 'markdown-editor');
  });

  it('插件贡献的节点能被 collectNodes 收集', () => {
    registerContributions('demo', {
      [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [
        { name: 'demo-node', nodes: { demo_node: { group: 'block', toDOM: () => ['demo', 0] } } },
      ],
    });
    expect(collectNodes().demo_node).toBeTruthy();
  });

  it('同名贡献原地覆盖内置功能（保持位置）', () => {
    const before = allFeatures().map((f) => f.name);
    const index = before.indexOf('heading');
    expect(index).toBeGreaterThanOrEqual(0);

    const override: SyntaxFeature = {
      name: 'heading',
      nodes: { heading: { group: 'block', toDOM: () => ['h1', 0] } },
    };
    registerContributions('demo', { [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [override] });
    resetFeaturesForTests();

    const after = allFeatures();
    expect(after.map((f) => f.name)).toEqual(before);
    expect(after[index]).toBe(override);
  });

  it('单个功能在收集期抛错只跳过自己，其它功能照常收集', () => {
    // 隔离路径会经 console.error 记录，测试里静音即可，断言只看收集结果。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const goodPlugin = new Plugin({});
    registerContributions('demo', {
      [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [
        {
          name: 'boom',
          plugins: () => {
            throw new Error('boom');
          },
          keymap: () => {
            throw new Error('boom');
          },
          inputRules: () => {
            throw new Error('boom');
          },
        },
        {
          name: 'good',
          plugins: () => [goodPlugin],
          keymap: () => ({ Enter: () => true }),
          inputRules: () => [{ type: 'demo' } as never],
        },
      ],
    });
    resetFeaturesForTests();

    const schema = {} as Schema;
    expect(collectPlugins(schema)).toContain(goodPlugin);
    expect(Object.keys(collectKeymaps(schema))).toContain('Enter');
    expect(collectInputRules(schema)).toContainEqual({ type: 'demo' });
    errorSpy.mockRestore();
  });
});

describe('features: 执行期错误隔离', () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetParserForTests();
    resetSchemaForTests();
    declareExtensionPoint({ id: MARKDOWN_EDITOR_SYNTAX_FEATURE }, 'markdown-editor');
  });

  it('某个 parserPostProcess 抛错不中断解析，其它后处理器照常执行', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerContributions('demo', {
      [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [
        {
          name: 'pp-boom',
          parserPostProcess: () => {
            throw new Error('boom');
          },
        },
        {
          name: 'pp-good',
          parserPostProcess: (doc) => {
            const schema = getSchema();
            const para = schema.nodes.paragraph.create(null, schema.text('appended'));
            return doc.type.create(doc.attrs, doc.content.addToEnd(para));
          },
        },
      ],
    });
    resetFeaturesForTests();

    const doc = parse('hello');
    expect(doc.childCount).toBe(2);
    expect(doc.lastChild?.textContent).toBe('appended');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('某个 inline feature 的 derive 抛错不影响其它 feature 派生', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const span = {
      type: 'demo_mark',
      from: 0,
      to: 5,
      openFrom: 0,
      openTo: 0,
      closeFrom: 5,
      closeTo: 5,
    };
    registerContributions('demo', {
      [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [
        {
          name: 'inline-boom',
          inline: {
            order: 1,
            derive: () => {
              throw new Error('boom');
            },
            markNames: [],
            extRanges: () => [],
          },
        },
        {
          name: 'inline-good',
          inline: {
            order: 2,
            derive: () => [span],
            markNames: [],
            extRanges: () => [],
          },
        },
      ],
    });
    resetFeaturesForTests();

    const spans = parseInline('hello');
    expect(spans).toContainEqual(span);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
