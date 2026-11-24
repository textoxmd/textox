import { describe, expect, it } from 'vitest';

import { buildSelectionPrompt, commonPromptMessages, type PromptMessages } from './index';
import { commonLocales } from './locales';

const ctx = {
  selection: 'Markdown',
  paragraph: 'Markdown 是一种轻量标记语言。',
  headings: ['概念', '语法'],
};

const MESSAGES: PromptMessages = {
  system: '你是一个 Markdown 文档助手。',
  task: '任务：解释选中文字的含义。',
  constraints: '只输出结果正文，不要复述原文。',
  sectionLabel: '所在章节：',
  paragraphLabel: '所在段落：',
  selectionLabel: '选中文字：',
};

describe('buildSelectionPrompt', () => {
  it('system 依次拼接 system / task / constraints，且不夹带正文', () => {
    const { system } = buildSelectionPrompt({ ...ctx, selection: '选区正文唯一标记' }, MESSAGES);

    expect(system).toBe(`${MESSAGES.system}\n${MESSAGES.task}\n${MESSAGES.constraints}`);
    expect(system).not.toContain(ctx.paragraph);
    expect(system).not.toContain('选区正文唯一标记');
  });

  it('user 用 ``` 定界章节、段落与选区', () => {
    const { user } = buildSelectionPrompt(ctx, MESSAGES);

    expect(user).toContain('所在章节：概念 > 语法');
    expect(user).toContain(`所在段落：\n\`\`\`\n${ctx.paragraph}\n\`\`\``);
    expect(user).toContain(`选中文字：\n\`\`\`\n${ctx.selection}\n\`\`\``);
    expect(user.match(/```/g)).toHaveLength(4);
  });

  it('没有标题/段落时只保留选区', () => {
    const { user } = buildSelectionPrompt({ selection: 'x', paragraph: '', headings: [] }, MESSAGES);

    expect(user).not.toContain('所在章节');
    expect(user).not.toContain('所在段落');
    expect(user).toBe(`选中文字：\n\`\`\`\nx\n\`\`\``);
  });

  it('内容含代码块时自动加长围栏，避免提前闭合', () => {
    const selection = '```js\nconst a = 1;\n```';
    const { user } = buildSelectionPrompt(
      { selection, paragraph: '示例：', headings: [] },
      MESSAGES,
    );

    expect(user).toContain(`所在段落：\n\`\`\`\n示例：\n\`\`\``);
    expect(user).toContain(`选中文字：\n\`\`\`\`\n${selection}\n\`\`\`\``);
  });
});

describe('commonPromptMessages', () => {
  const LANGS = [
    'zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES',
    'pt-PT', 'it-IT', 'ru-RU', 'ar-SA', 'hi-IN', 'th-TH', 'vi-VN',
  ];
  const FIELDS = [
    'system', 'constraints', 'sectionLabel', 'paragraphLabel', 'selectionLabel', 'languageName',
  ] as const;

  it('covers all 15 languages with every common field', () => {
    expect(Object.keys(commonLocales).sort()).toEqual([...LANGS].sort());
    for (const lang of LANGS) {
      const messages = commonLocales[lang]!;
      for (const field of FIELDS) expect(typeof messages[field], `${lang}.${field}`).toBe('string');
    }
  });

  it('按语言返回公共文案，未知语言回退英文', () => {
    expect(commonPromptMessages('zh-CN').system).toBe('你是一个 Markdown 文档助手。');
    expect(commonPromptMessages('en-US').languageName).toBe('English');
    expect(commonPromptMessages('unknown').languageName).toBe('English');
  });
});
