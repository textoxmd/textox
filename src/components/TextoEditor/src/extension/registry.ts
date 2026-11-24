// 本模块只依赖 @texto/* 契约包。骨架入口会 import 它（声明扩展点 / 投影插入项），
// 因此不要在此引入编辑器内部重型模块（React / ProseMirror view / 各 feature），
// 以免被骨架入口间接加载。
import {
  declareExtensionPoint,
  getContributions,
  getContributionsWithOwner,
  getPluginConfigSnapshot,
  hasExtensionPoint,
} from '@texto/plugin-sdk';
import {
  MARKDOWN_EDITOR_CONTEXT_MENU,
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_OWNER,
  MARKDOWN_EDITOR_SELECTION_ACTION,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
  MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
} from '@texto/markdown-editor-api';
import type {
  EditorContext,
  EditorContextMenuItemMeta,
  EditorExtension,
  EditorExtensionResult,
  EmbedInsert,
  EmbedInsertMeta,
  FormatToolbarItemMeta,
  HighlightLanguage,
  InsertCommandMeta,
  NodeViewFactory,
  PluginConfigReader,
  SelectionActionMeta,
} from '@texto/markdown-editor-api';

import { getEditorHost } from '../host';

/** 声明编辑器扩展点。宿主启动时、登记插件贡献之前调用一次。 */
export function declareMarkdownEditorExtensionPoint(): void {
  const ids = [
    MARKDOWN_EDITOR_EXTENSION,
    MARKDOWN_EDITOR_CONTEXT_MENU,
    MARKDOWN_EDITOR_SYNTAX_FEATURE,
    MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
    MARKDOWN_EDITOR_FORMAT_TOOLBAR,
    MARKDOWN_EDITOR_SELECTION_ACTION,
  ];
  for (const id of ids) {
    if (!hasExtensionPoint(id)) declareExtensionPoint({ id }, MARKDOWN_EDITOR_OWNER);
  }
}

/** 某节点类型下的贡献工厂；后注册靠后（分发时倒序取）。 */
export type NodeViewContributions = Record<string, NodeViewFactory[]>;

export interface CollectedEditorExtensions {
  plugins: NonNullable<EditorExtensionResult['plugins']>;
  nodeViews: NodeViewContributions;
}

function configReaderFor(pluginId: string): PluginConfigReader {
  // 运行时插件（`@textox/plugin-sdk`）的设置由宿主经 `EditorHost` 注入；
  // 编辑器不得直接依赖插件运行时，所以只认这一个入口。
  const injected = getEditorHost().readPluginConfig?.(pluginId);
  if (injected) return injected;
  return {
    get: <T,>(key: string) => getPluginConfigSnapshot(pluginId)[key] as T | undefined,
    all: <T,>() => getPluginConfigSnapshot(pluginId) as T,
  };
}

/**
 * 收集全部编辑器扩展并求值。单个 `create` 抛错被隔离，不影响其它扩展。
 * 每个扩展的 `ctx.config` 绑定到其 owner 插件的实时配置快照。
 */
export function collectEditorExtensions(ctx: EditorContext): CollectedEditorExtensions {
  const plugins: NonNullable<EditorExtensionResult['plugins']> = [];
  const nodeViews: NodeViewContributions = {};
  for (const { ownerId, value: ext } of getContributionsWithOwner(MARKDOWN_EDITOR_EXTENSION)) {
    try {
      const result = ext.create({ ...ctx, config: configReaderFor(ownerId) }) ?? {};
      if (result.plugins) plugins.push(...result.plugins);
      if (result.nodeViews) {
        for (const [type, factory] of Object.entries(result.nodeViews)) {
          if (!factory) continue;
          (nodeViews[type] ??= []).push(factory);
        }
      }
    } catch (err) {
      console.error(`[plugins] 编辑器扩展 create 失败：${ext.id}`, err);
    }
  }
  return { plugins, nodeViews };
}

/** 插件声明的代码块语言（供语言下拉框合并）。 */
export function editorExtensionLanguages(): string[] {
  const out = new Set<string>();
  for (const ext of getContributions(MARKDOWN_EDITOR_EXTENSION)) {
    for (const lang of ext.languages ?? []) out.add(lang);
  }
  return [...out];
}

/**
 * 插件贡献的 highlight.js 语法。
 * 按 id last-wins，保留首次出现位置（与其它扩展点合并语义一致）。
 */
export function editorHighlightLanguages(): HighlightLanguage[] {
  const byId = new Map<string, HighlightLanguage>();
  for (const contribution of getContributions(MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT)) {
    for (const lang of contribution.languages ?? []) byId.set(lang.id, lang);
  }
  return [...byId.values()];
}

/** 嵌入插入项：从编辑器扩展贡献的 embed 元数据派生，供斜杠菜单使用。 */
export function editorEmbedInserts(): EmbedInsert[] {
  return getContributions(MARKDOWN_EDITOR_EXTENSION)
    .filter((e): e is EditorExtension & { embed: EmbedInsertMeta } => !!e.embed)
    .map((e) => ({
      id: e.id,
      extensions: [...e.embed.extensions],
      insertLabelKey: e.embed.insertLabelKey,
    }));
}

/**
 * 插件贡献的「插入块命令」（工具栏 / 斜杠 / 快捷键共用）。
 * 按 id 去重：后注册覆盖先注册，并保持首次出现的位置
 * （与工具栏 `listToolbarItems` 的 last-wins + 原位语义一致）。
 */
export function editorInsertCommands(): InsertCommandMeta[] {
  const byId = new Map<string, InsertCommandMeta>();
  for (const ext of getContributions(MARKDOWN_EDITOR_EXTENSION)) {
    const ins = ext.insert;
    if (ins) byId.set(ins.id, ins);
  }
  return [...byId.values()];
}

/**
 * 插件贡献的「正文右键菜单项」。
 * 返回注册序；id 去重由 SDK 注册期完成（冲突时后注册覆盖、覆盖项落到注册序末尾）。
 */
export function editorContextMenuItems(): EditorContextMenuItemMeta[] {
  return getContributions(MARKDOWN_EDITOR_CONTEXT_MENU);
}

/**
 * 插件贡献的「行内格式按钮」（悬浮工具栏 / 顶部工具栏 / 激活态共用）。
 * 去重由 SDK 按贡献体顶层 `id` 在注册期完成；读取结果直接交给消费端
 * （悬浮 mergeFormatItems / 顶部 listToolbarItems 各自再按 id 合并）。
 */
export function editorFormatToolbarItems(): FormatToolbarItemMeta[] {
  return getContributions(MARKDOWN_EDITOR_FORMAT_TOOLBAR);
}

/**
 * 插件贡献的「选区动作」（释义等）。
 * SDK 已按贡献 id last-wins 去重，直接返回注册序即可。
 */
export function editorSelectionActions(): SelectionActionMeta[] {
  return getContributions(MARKDOWN_EDITOR_SELECTION_ACTION);
}
