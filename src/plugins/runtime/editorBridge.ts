import { toDisposable, type Disposable } from '@textox/plugin-sdk';
import {
  defineInsertExtension,
  MARKDOWN_EDITOR_CONTEXT_MENU,
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_SELECTION_ACTION,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
  MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
  type InsertCommandMeta,
} from '@texto/plugin-sdk';

/**
 * 编辑器贡献桥的宿主依赖：
 * - `register` 把一条贡献登记到扩展点（`ownerId` 用于按插件整体释放 / 单条注销）
 * - `requestReload` 请求编辑器按最新贡献重建（登记前后都要调，见下）
 */
export interface EditorBridgeDeps {
  register: (pointId: string, value: unknown, ownerId: string) => Disposable;
  requestReload: () => void;
}

/**
 * 把插件 `app.editor.register*` 的 7 个入口适配到扩展点注册表。
 *
 * 注册与注销**都**请求一次重建：编辑器只在重建时读取贡献，不重建就看不到新能力 /
 * 仍会显示已注销的能力。返回的句柄用 `toDisposable` 包装，重复 `dispose` 只重建一次。
 */
/**
 * 插件贡献里的文案 key 是**裸 key**（相对于插件自己的 locales），
 * 而编辑器消费方直接 `i18next.t(labelKey)`（靠 `fallbackNS: 'plugins'` 命中插件文案）。
 * 所以在桥这一层补插件 id 前缀，作者不用关心命名空间。
 *
 * 导出给其它桥复用（导出器 / 设置动作等同样只写裸 key）。
 */
export function scopeLocalizedKeys<T>(value: T, ownerId: string): T {
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const scoped: Record<string, unknown> = { ...source };
  for (const key of ['labelKey', 'descriptionKey'] as const) {
    const current = source[key];
    if (typeof current === 'string' && current.length > 0 && !current.startsWith(`${ownerId}.`)) {
      scoped[key] = `${ownerId}.${current}`;
    }
  }
  return scoped as T;
}

export function createEditorBridge(deps: EditorBridgeDeps) {
  /** 登记一条贡献并请求重建；返回的释放句柄注销后同样请求一次重建。 */
  const registerWithReload = (
    pointId: string,
    value: unknown,
    ownerId: string,
  ): Disposable => {
    const sub = deps.register(pointId, value, ownerId);
    deps.requestReload();
    return toDisposable(() => {
      sub.dispose();
      deps.requestReload();
    });
  };

  const add =
    (pointId: string) =>
    (value: unknown, ownerId: string): Disposable =>
      registerWithReload(pointId, scopeLocalizedKeys(value, ownerId), ownerId);

  return {
    registerSyntaxFeature: add(MARKDOWN_EDITOR_SYNTAX_FEATURE),
    registerExtension: add(MARKDOWN_EDITOR_EXTENSION),
    registerFormatToolbarItem: add(MARKDOWN_EDITOR_FORMAT_TOOLBAR),
    registerContextMenuItem: add(MARKDOWN_EDITOR_CONTEXT_MENU),
    registerSelectionAction: add(MARKDOWN_EDITOR_SELECTION_ACTION),
    registerSyntaxHighlight: add(MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT),
    /**
     * 插入命令走**编辑器扩展点**的 `insert` 字段（`editorInsertCommands()` 的读取路径），
     * 不进 `app:command`：`CommandContribution` 要求 `titleKey` + `run`，
     * `InsertCommandMeta` 没有这两项，混进去只会得到空标签 / 点不动的条目。
     *
     * 每条命令单独一条贡献，贡献 id 带上 owner：SDK 的去重键不区分 owner，
     * 只用裸 slug 时两个插件同 slug 会互撞，后注册者卸载后前者也不会恢复。
     * 贡献 id 仅供注销定位；`insert.id` 仍是裸 slug（工具栏 / 斜杠 / 快捷键靠它）。
     */
    registerInsertCommand: (command: InsertCommandMeta, ownerId: string): Disposable =>
      registerWithReload(
        MARKDOWN_EDITOR_EXTENSION,
        defineInsertExtension({
          id: `runtime.insert.${ownerId}.${command.id}`,
          insert: scopeLocalizedKeys(command, ownerId),
        }),
        ownerId,
      ),
  };
}

export type EditorBridge = ReturnType<typeof createEditorBridge>;
