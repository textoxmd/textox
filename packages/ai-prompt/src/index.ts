import type { SelectionContextSnapshot } from '@texto/plugin-sdk';

import { commonPromptMessages } from './locales';

export interface PromptMessages {
  system: string;
  task: string;
  constraints: string;
  sectionLabel: string;
  paragraphLabel: string;
  selectionLabel: string;
}

export interface SelectionPrompt {
  system: string;
  user: string;
}

function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const max = runs.reduce((m, r) => Math.max(m, r.length), 0);
  return '`'.repeat(Math.max(3, max + 1));
}

/**
 * 提示词只负责拼装结构，具体文案由调用方按界面语言与动作注入，
 * 保证 system / user 的骨架在各插件、各语言下一致（围栏、段落顺序、空白分隔）。
 */
export function buildSelectionPrompt(
  ctx: Pick<SelectionContextSnapshot, 'selection' | 'paragraph' | 'headings'>,
  messages: PromptMessages,
): SelectionPrompt {
  const system = [messages.system, messages.task, messages.constraints]
    .filter(Boolean)
    .join('\n');

  const paragraphFence = fenceFor(ctx.paragraph);
  const selectionFence = fenceFor(ctx.selection);

  const user = [
    ctx.headings.length ? `${messages.sectionLabel}${ctx.headings.join(' > ')}` : '',
    ctx.paragraph
      ? `${messages.paragraphLabel}\n${paragraphFence}\n${ctx.paragraph}\n${paragraphFence}`
      : '',
    `${messages.selectionLabel}\n${selectionFence}\n${ctx.selection}\n${selectionFence}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { system, user };
}

export { commonPromptMessages };
export type { CommonPromptMessages } from './locales';
