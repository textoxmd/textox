import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  APP_COMMAND,
  declareAppExtensionPoints,
  getContributions,
  MARKDOWN_EDITOR_EXTENSION,
  registerContributions,
  resetExtensionPointsForTests,
  unregisterContribution,
  type InsertCommandMeta,
} from '@texto/plugin-sdk';

import {
  declareMarkdownEditorExtensionPoint,
  editorInsertCommands,
} from '@/components/TextoEditor/src/extension/registry';

import { listCommandsWithOwner } from '../registry';
import { createContributionRegistrar } from '../runtime/deps';
import { createEditorBridge } from '../runtime/editorBridge';

const OWNER = 'app.textox.demo';

const INSERT_COMMAND: InsertCommandMeta = {
  id: 'demo.insert',
  keyword: 'demo',
  labelKey: 'demo.insert.label',
  icon: 'table',
  insert: () => {},
};

/** 真实注册实现（与宿主 `deps.ts` 共用）：真实 SDK 注册表 + 可逆注销。 */
function createBridge() {
  return createEditorBridge({
    register: createContributionRegistrar({ registerContributions, unregisterContribution }),
    requestReload: () => {},
  });
}

beforeEach(() => {
  resetExtensionPointsForTests();
  declareMarkdownEditorExtensionPoint();
  declareAppExtensionPoints();
});

afterEach(() => {
  resetExtensionPointsForTests();
});

describe('registerInsertCommand 的注册通道', () => {
  it('改为进编辑器扩展点：注册后 editorInsertCommands() 能查到，dispose 后查不到', () => {
    const bridge = createBridge();
    expect(editorInsertCommands()).toEqual([]);

    const sub = bridge.registerInsertCommand(INSERT_COMMAND, OWNER);
    expect(editorInsertCommands().map((command) => command.id)).toEqual(['demo.insert']);

    sub.dispose();
    expect(editorInsertCommands()).toEqual([]);
  });

  it('不再污染 app:command：listCommandsWithOwner() 不含插入命令', () => {
    registerContributions(OWNER, {
      [APP_COMMAND]: [
        { id: 'demo.command', titleKey: 'demo.command.title', category: 'plugin', run: () => {} },
      ],
    });
    const bridge = createBridge();

    const sub = bridge.registerInsertCommand(INSERT_COMMAND, OWNER);

    // 命令面板只该看到真正的 app 命令（有 titleKey + run 的那种）
    expect(listCommandsWithOwner().map(({ command }) => command.id)).toEqual(['demo.command']);

    sub.dispose();
    expect(listCommandsWithOwner().map(({ command }) => command.id)).toEqual(['demo.command']);
  });

  it('贡献 id 带前缀与 owner，但命令 id 仍是裸 slug', () => {
    const bridge = createBridge();
    bridge.registerInsertCommand(INSERT_COMMAND, OWNER);

    const registered = getContributions(MARKDOWN_EDITOR_EXTENSION).map((ext) => ext.id);
    // 贡献 id 必须带 owner：SDK 的去重键不区分 owner
    expect(registered).toEqual([`runtime.insert.${OWNER}.demo.insert`]);
    // 工具栏 / 斜杠 / 快捷键共用裸 slug（`demo.insert`），贡献 id 不泄漏给消费方
    expect(editorInsertCommands().map((command) => command.id)).toEqual(['demo.insert']);
  });

  it('同一 slug 在两个插件间互不覆盖：卸载后注册者不吞掉先注册者', () => {
    const bridge = createBridge();
    const first = bridge.registerInsertCommand(INSERT_COMMAND, 'app.textox.a');
    const second = bridge.registerInsertCommand(INSERT_COMMAND, 'app.textox.b');

    expect(getContributions(MARKDOWN_EDITOR_EXTENSION).map((ext) => ext.id)).toEqual([
      'runtime.insert.app.textox.a.demo.insert',
      'runtime.insert.app.textox.b.demo.insert',
    ]);

    // 后注册者卸载：先注册者的命令必须恢复（旧 id 下这里会变成空）
    second.dispose();
    expect(editorInsertCommands().map((command) => command.id)).toEqual(['demo.insert']);

    first.dispose();
    expect(editorInsertCommands()).toEqual([]);
  });
});
