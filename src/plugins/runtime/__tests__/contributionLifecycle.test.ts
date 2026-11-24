import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `createHostDeps` 构建期会动态 import 这两个模块：只关心编辑器桥的批处理行为，
// 把宿主侧（i18n / 旧体系 host deps）替换成最小实现。
vi.mock('@/i18n', () => ({
  default: { getFixedT: () => () => '' },
  registerPluginMessages: vi.fn(async () => {}),
}));
vi.mock('@/plugins/host', () => ({
  getInstalledHostDeps: () => null,
  installHostDeps: vi.fn(),
}));

import {
  declareExtensionPoint,
  getContributions,
  MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
  registerContributions,
  resetExtensionPointsForTests,
  unregisterContribution,
  type InsertCommandMeta,
  type SyntaxHighlightContribution,
} from '@texto/plugin-sdk';

import { declareMarkdownEditorExtensionPoint } from '@/components/TextoEditor/src/extension/registry';
import {
  flushPendingSyntaxReload,
  hasPendingSyntaxReload,
  registerSyntaxReloader,
} from '@/editor/syntaxReload';
import { resetEditorInsertSurfacesForTests } from '@/plugins/editorInsertSurfaces';
import { SHORTCUT_IDS } from '@/app/constants';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, type ShortcutAction } from '@/utils/shortcuts';

import {
  createContributionRegistrar,
  createHostDeps,
  resetHostDepsForTests,
  unregisterOwnerContributions,
  withContributionKey,
} from '../deps';

const OWNER = 'app.textox.demo';
const OTHER_OWNER = 'app.textox.other';
const POINT = MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT;

/** 真实的 SDK 注册表（不经 mock）：验证登记与注销走的是同一套键规则。 */
const registrar = createContributionRegistrar({
  registerContributions,
  unregisterContribution,
});

beforeEach(() => {
  resetExtensionPointsForTests();
  declareExtensionPoint({ id: POINT }, 'test');
});

afterEach(() => {
  resetExtensionPointsForTests();
});

function languages(id: string): SyntaxHighlightContribution {
  return { languages: [{ id }] };
}

describe('withContributionKey', () => {
  it('synthesizes an id for keyless contributions and keeps their own fields', () => {
    const keyed = withContributionKey(languages('demo'), POINT, OWNER) as {
      id: string;
      languages: unknown[];
    };

    expect(keyed.languages).toEqual([{ id: 'demo' }]);
    expect(keyed.id).toMatch(
      /^runtime\.keyless\.app\.textox\.demo\.markdown-editor:syntaxHighlight\.\d+$/,
    );
  });

  it('leaves contributions that already have id or name untouched', () => {
    const withId = { id: 'demo', languages: [] };
    const withName = { name: 'demo', languages: [] };

    expect(withContributionKey(withId, POINT, OWNER)).toBe(withId);
    expect(withContributionKey(withName, POINT, OWNER)).toBe(withName);
  });
});

describe('createContributionRegistrar', () => {
  it('makes a keyless syntax highlight contribution removable by one dispose', () => {
    const sub = registrar(POINT, languages('demo'), OWNER);

    const registered = getContributions(POINT) as Array<{ id: string; languages: unknown[] }>;
    expect(registered).toHaveLength(1);
    expect(registered[0]!.languages).toEqual([{ id: 'demo' }]);

    sub.dispose();

    // 旧实现里无键贡献的 dispose 是空操作，贡献会永久留在全局表
    expect(getContributions(POINT)).toEqual([]);
  });

  it('is idempotent: a second dispose does not touch other owners entries', () => {
    const mine = registrar(POINT, languages('demo'), OWNER);
    registrar(POINT, languages('other'), OTHER_OWNER);

    mine.dispose();
    mine.dispose();

    expect(getContributions(POINT)).toHaveLength(1);
  });
});

describe('unregisterOwnerContributions', () => {
  it('clears every contribution of one owner, leaves others, and requests one reload', async () => {
    // 模拟插件忘了在 onunload 里 dispose：贡献仍挂在扩展点上
    registrar(POINT, languages('demo-a'), OWNER);
    registrar(POINT, languages('demo-b'), OWNER);
    registrar(POINT, languages('other'), OTHER_OWNER);
    expect(getContributions(POINT)).toHaveLength(3);

    const reloader = vi.fn(() => true);
    const unregisterReloader = registerSyntaxReloader(reloader);
    try {
      await unregisterOwnerContributions(OWNER);
    } finally {
      unregisterReloader();
    }

    const remaining = getContributions(POINT) as Array<{ languages: Array<{ id: string }> }>;
    expect(remaining.map((entry) => entry.languages[0]!.id)).toEqual(['other']);
    expect(reloader).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate contributions across disable/enable cycles', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      registrar(POINT, languages('demo'), OWNER);
      // 停用：插件没自己 dispose，靠宿主按 owner 兜底清理
      await unregisterOwnerContributions(OWNER);
    }

    expect(getContributions(POINT)).toEqual([]);
  });
});

describe('编辑器贡献的批量重建', () => {
  /**
   * 外部插件的装载是同步批处理（mkdext 一次装 12 个语法特性）。逐次重建会让
   * 编辑器反复 destroy + 重建全文，故同一同步批次内的重建请求要合并成一次。
   *
   * 计数桩走的是真实的 `registerSyntaxReloader`：`deps` 经
   * `syncInsertSurfacesAndReload` → `requestSyntaxReload()` 打到它，因此既能验证
   * 「合并」，也能验证「pending（逐字插入中）语义没被改掉」。
   */
  const command = (id: string): InsertCommandMeta => ({
    id,
    keyword: id,
    labelKey: `${id}.label`,
    icon: 'table',
    insert: () => {},
  });

  // 快捷键三张表是模块级可变状态：快照 → 还原，避免污染其它用例
  let idsSnapshot: string[] = [];
  let defaultsSnapshot: Record<string, string> = {};
  let actionsSnapshot: ShortcutAction[] = [];

  beforeEach(() => {
    // 外层 beforeEach 只声明了 syntaxHighlight 点，这里补编辑器扩展点
    declareMarkdownEditorExtensionPoint();
    resetEditorInsertSurfacesForTests();
    resetHostDepsForTests();

    idsSnapshot = [...SHORTCUT_IDS];
    defaultsSnapshot = { ...DEFAULT_SHORTCUTS };
    actionsSnapshot = SHORTCUT_ACTIONS.map((action) => ({ ...action }));
  });

  afterEach(() => {
    SHORTCUT_IDS.splice(0, SHORTCUT_IDS.length, ...idsSnapshot);
    for (const key of Object.keys(DEFAULT_SHORTCUTS)) delete DEFAULT_SHORTCUTS[key];
    Object.assign(DEFAULT_SHORTCUTS, defaultsSnapshot);
    SHORTCUT_ACTIONS.splice(0, SHORTCUT_ACTIONS.length, ...actionsSnapshot);
    resetEditorInsertSurfacesForTests();
    resetHostDepsForTests();
  });

  it('同一同步批次内登记 5 条插入命令只重建一次', async () => {
    const deps = await createHostDeps();
    const reloader = vi.fn(() => true);
    const unregisterReloader = registerSyntaxReloader(reloader);
    try {
      for (let index = 0; index < 5; index += 1) {
        deps.registerInsertCommand(command(`demo.insert.${index}`), OWNER);
      }

      // 批处理还没结束：一条都还没重建（推迟到微任务）
      expect(reloader).not.toHaveBeenCalled();

      await Promise.resolve();
      expect(reloader).toHaveBeenCalledTimes(1);
    } finally {
      unregisterReloader();
    }
  });

  it('上一批重建完成后，下一批会再重建一次', async () => {
    const deps = await createHostDeps();
    const reloader = vi.fn(() => true);
    const unregisterReloader = registerSyntaxReloader(reloader);
    try {
      deps.registerInsertCommand(command('demo.first'), OWNER);
      await Promise.resolve();
      expect(reloader).toHaveBeenCalledTimes(1);

      // 新一批（上一批已 flush）必须再排一次，否则取消订阅后永远不重建
      deps.registerInsertCommand(command('demo.second'), OWNER);
      await Promise.resolve();
      expect(reloader).toHaveBeenCalledTimes(2);
    } finally {
      unregisterReloader();
    }
  });

  it('逐字插入中重建被推迟时只重试一次，flush 后 pending 清空', async () => {
    const deps = await createHostDeps();
    const reloader = vi.fn(() => false); // 模拟 reloader 暂时不能重建
    const unregisterReloader = registerSyntaxReloader(reloader);
    try {
      expect(() => deps.registerInsertCommand(command('demo.first'), OWNER)).not.toThrow();

      await Promise.resolve();
      expect(reloader).toHaveBeenCalledTimes(1);
      // 重建没做成 → 记入 pending，等条件解除后由编辑器 flush
      expect(hasPendingSyntaxReload()).toBe(true);

      deps.registerInsertCommand(command('demo.second'), OWNER);
      await Promise.resolve();
      // 只多了一次「重试」，不是每条命令各一次
      expect(reloader).toHaveBeenCalledTimes(2);
      expect(hasPendingSyntaxReload()).toBe(true);

      // 逐字插入结束：编辑器 flush 挂起的重载
      reloader.mockReturnValue(true);
      flushPendingSyntaxReload();
      expect(reloader).toHaveBeenCalledTimes(3);
      expect(hasPendingSyntaxReload()).toBe(false);
    } finally {
      unregisterReloader();
    }
  });
});
