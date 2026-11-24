import { describe, it, expect } from 'vitest';
import { registerContributions, declareExtensionPoint } from '@texto/plugin-sdk';
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { resetFeaturesForTests } from '../src/features/index.ts';
import { getSchema, resetSchemaForTests } from '../src/schema.ts';

describe('schema: 惰性构建', () => {
  it('首次 getSchema 能看到此前注册的插件节点', () => {
    resetSchemaForTests();
    resetFeaturesForTests();
    declareExtensionPoint({ id: MARKDOWN_EDITOR_SYNTAX_FEATURE }, 'markdown-editor');
    registerContributions('demo2', {
      [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [
        { name: 'demo2', nodes: { demo2_node: { group: 'block', toDOM: () => ['demo2', 0] } } },
      ],
    });
    expect(getSchema().nodes.demo2_node).toBeTruthy();
  });
});
