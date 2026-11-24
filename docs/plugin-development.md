# 插件开发注意事项

> 本文描述**旧**的 `@texto/plugin-sdk` 第一方插件体系；新的外置插件运行时（契约包 `vendor/plugin-sdk`（submodule）+ `packages/plugin-build`）见 `docs/plugin-runtime.md`。两套并存，按 `docs/superpowers/specs/2026-11-21-plugin-unification-design.md` 的 P3 波次迁移完成后删除旧体系。

第一方插件（`official-plugins/*`）通过 `@texto/*` 契约包接入编辑器与宿主。
本文记录实现 NodeView / 懒加载视图时容易踩的坑，以及跨引擎验证要求。

## ProseMirror NodeView 与懒加载

编辑器在 WebKit（Tauri macOS 的 WKWebView）下对 DOM 变更的判定比 Chromium
更敏感。以下规则来自真实回归：HTML 支持插件的 `html_block` 视图在挂载后
再创建渲染容器，导致打开任意含 HTML 块的 Markdown 文档时 NodeView 无限重建、
主线程卡死。

### 1. NodeView 的 DOM 结构必须在挂载前就绪

NodeView 工厂返回的 `dom` / `contentDOM` 一旦交给 ProseMirror，就不要再往
`dom` 上 `appendChild` 新的子节点。挂载后再 append 会被 WebKit 的
`MutationObserver` 判为「结构变化」，PM 据此重建 NodeView；新视图再次 append，
形成无限重绘。

- ✅ 在工厂里一次性搭好完整结构（含插件私有的渲染容器），再返回 NodeView。
- ❌ 在动态 `import(...).then()` 里再 `dom.appendChild(...)`。
- 需要懒加载时：**结构 eager，行为 lazy**。外壳先把所有 DOM 节点建好，动态
  模块只负责绑定事件、注册选区监听、执行首次渲染。
- 例外：`contentDOM` 之外的**纯装饰子节点**（例如用 React root 渲染的按钮图标）
  允许由框架在挂载后异步提交，前提是 `ignoreMutation` 对该变更返回 `true`
  （见规则 3）。这类节点不得承载内容或结构语义；改动后仍须按「跨引擎验证」
  做真机冒烟。打开文档时 NodeView 在 React effect 内构造，`flushSync` 不会
  真正同步提交，不要用它来“保证”首帧结构。

### 2. 首次渲染必须在行为实例已就绪之后执行

如果用一个 `impl` 变量持有懒加载的行为句柄，而外壳的
`ignoreMutation(m) { return impl?.ignoreMutation(m) ?? false }` 依赖它，那么
**在 `impl` 被赋值之前**调用渲染函数，会产生一批未被忽略的 DOM 变更，同样触发
上面的重建循环。

- ✅ `impl = createView(...)` 之后再调用 `impl.update(node)` 做首次渲染。
- ❌ 在 `createView(...)` 内部（返回前）就执行首次 `syncRender()`。

### 3. `ignoreMutation` 要覆盖插件自己造成的变更

NodeView 的 `ignoreMutation` 需要放行「由插件管理、不属于 contentDOM 文本内容」
的变更，否则 PM 会把它们当作外部编辑并尝试修复：

- 插件私有渲染容器内部的变更（`renderContainer.contains(m.target)`）；
- 切换显示模式时对 `contentDOM` / 根节点施加的 `style` / `class` 属性变更
  （WebKit 会以 attribute mutation 上报）。

contentDOM 内部的文本/子节点变更必须返回 `false`，否则用户输入不会被 PM 读取。

## 编辑器 DOM 内的定位约束

### 不要在编辑器 DOM 内使用 `position: fixed`

编辑器在 IR ⇄ 源码模式切换时会对整个编辑区做翻页转场（用 `transform` 平移两层）。
`transform` 会成为 `position: fixed` 的包含块，动画期间插件的 fixed 元素会被重新
锚定到滑动层，看起来像"跟着页面甩出去"。

- 骨架自己的两个 fixed 元素（图片查看器、`.floating-toolbar`）都挂在 `document.body`
  上，不在编辑区里，因此不受影响。
- 插件要放悬浮 UI，请挂到 `document.body`（`document.body.appendChild(...)`）；
  必须留在编辑器 DOM 内时用 `position: absolute`，相对编辑区定位。

## 插入块命令贡献

插件若要在光标处插入一个块（表格、图表、公式…），经
`markdown-editor:extension` 贡献 `insert: InsertCommandMeta`（表格插件是首个消费者，
见 `official-plugins/table/src/insert.ts`）。不要自行在骨架里加「插入 X」入口。

### 契约

```ts
export interface InsertCommandMeta {
  /** 裸 slug，须与快捷键 / 原生菜单 action id 一致（如 'table'）。 */
  id: string;
  /** 斜杠菜单关键词（如 'table'）。 */
  keyword: string;
  /** 工具栏 / 斜杠菜单 / 快捷键名共用的完整 i18n key（如 'table.pluginName'）。 */
  labelKey: string;
  /** 快捷键设置页描述 i18n key（缺省回退 labelKey）。 */
  descriptionKey?: string;
  /** 图标：手绘 IconDef（SVG 图元数据）或 lucide 图标名（kebab-case，如 'underline'）。 */
  icon: IconSpec;
  /** 快捷键设置页展示的默认组合键（如 'Cmd+Opt+T'）。 */
  defaultShortcut?: string;
  /** 快捷键分组（缺省 'paragraph'）。 */
  category?: string;
  /** 工具栏排序权重（升序，缺省 0）。 */
  order?: number;
  /** 在当前光标处插入；用 view.state.schema 构造节点。 */
  insert(view: EditorView): void;
  /** 缺省由骨架复用 canInsertBlockAt(state)。 */
  isDisabled?(state: EditorState): boolean;
}
```

要点：

- **`id` 是裸 slug**（不是 `<pluginId>.<name>`），因为骨架会把它同时用作快捷键 id
  与原生菜单 action id。插件 `EditorExtension.id` 可带命名空间，但 `insert.id` 不带。
- **`insert` 是插入动作本身**，用 `view.state.schema` 构造节点；不要依赖
  `EditorContext` 里不存在的东西。
- **`icon` 接受 `IconSpec`**——手绘 `IconDef`（`path` / `line` / `rect` / `circle` 等 7 种图元数组）或 lucide
  图标名（kebab-case，如 `'underline'`）；由骨架统一解析为渲染规格，插件不要直接传 React 组件。
- **便捷构造**：`defineInsertExtension({ id, insert })`（`@texto/markdown-editor-api`）
  等价于手写 `{ id, insert, create: () => ({}) }`；math / mermaid 插件即用它
  （见 `official-plugins/math/src/index.ts`）。
- 贡献间按 `id` 去重：后注册覆盖先注册，并保持首次出现的位置（last-wins + 原位）。

### 唯一读取入口

骨架只从 `editorInsertCommands()`（`src/components/TextoEditor/src/extension/registry.ts`）
读取贡献。消费点：

| 入口 | 位置 | 行为 |
|---|---|---|
| 编辑器工具栏 | `src/components/EditorToolbar/registry.ts` | `listToolbarItems()` 把贡献映射为 `group: 'insert'` 的 `ToolbarItem` |
| 斜杠菜单 | `TextoEditor/src/features/slash-menu/SlashMenu.tsx` | 追加 `SlashCommand`（`label` 预解析为 `t(labelKey)`，避免内置 `slash.*` 前缀混淆） |
| 快捷键设置 | `src/components/ShortcutSettings.tsx` | `slashByAction()` 按 `keyword` 派生 `/<keyword>` |
| 快捷键注册 | `src/plugins/editorInsertSurfaces.ts` | 把 `id` / `defaultShortcut` 并入 `SHORTCUT_IDS` / `DEFAULT_SHORTCUTS` / `SHORTCUT_ACTIONS` |
| 命令分发 | `src/hooks/app/useAppCommands.ts` | `switch` 的 `default` 内命中 `id` 时调 `editorRef.runEditorInsert(id)`（**必须放 `default`**，避免与内置 case 双分发，`runEditorInsert` 非幂等） |
| 编辑器 ref | `TextoEditor.tsx` 的 `runEditorInsert(id)` | 查贡献、判 `isDisabled` / `canInsertBlockAt`、调 `insert` |

### 两个易错点

1. **懒加载工具栏要补首帧 `update()`**。PM 不会在 plugin `view()` 创建时回调
   `update`，而动态 `import` 完成前的 `update` 又会因行为句柄为空被吞掉；因此
   懒加载 resolve 后必须显式调用一次 `handle.update()`（见
   `official-plugins/table/src/view/lazy.ts`），否则首次进表格时悬浮工具栏不出现。
2. **菜单 / 快捷键 action id 与 `insert.id` 必须逐字一致**。原生菜单声明、快捷键设置、
   keydown 分发都会按裸 `id` 命中；改名要全局同步。

## 内联语法功能插件

插件经 `markdown-editor:syntaxFeature` 贡献 `SyntaxFeature` 即可完整拥有一种内联语法
（与块级节点对等）。行内数学插件是首个消费者（见
`official-plugins/math/src/syntax/`）。

### 可贡献的缝

| 能力 | 字段 |
|---|---|
| schema mark | `marks` |
| markdown-it 插件 | `mdItPlugins` |
| parser token 处理 | `parserTokens` |
| 行内派生 | `inline.derive`（配 `inline.order` / `inline.tokenAdvance`） |
| 受管的 mark 名 | `inline.markNames` |
| 序列化不转义区间 | `inline.extRanges`（用共享 `markExtRanges`） |
| 序列化分隔符（method-B） | `markDelims`（内联 mark 声明 open/close，如空串） |
| 抑制悬浮格式工具栏 | `inline.suppressFormatToolbar` |
| 声明式行内 widget | `inline.decorationWidgets`（按 `kind` 注册构建器） |
| 其它自有 PM 插件 | `plugins`（逃生舱） |

字段权威定义见 `packages/markdown-editor-runtime/src/syntax-feature.ts`，以减少文档漂移。

### 行内派生（v2）

行内语法统一经 `inline.derive(ctx)` 派生：骨架把 md-it token 定位到源文
（`PositionedToken`：`token` / `pos` / `end` / `exact` / `verified`），插件返回
`InlineSpan[]`。契约包提供 `pairMarks`（成对 token → mark）与
`wholeTokenSpan`（整 token → 原子 / widget）两个 helper。

**成对分隔符 → mark**（参考 `official-plugins/highlight`）：

````ts
inline: {
  order: -1,
  derive: (ctx) => pairMarks(ctx, { open: 'mark_open', close: 'mark_close', mark: 'highlight' }),
  markNames: ['highlight'],
  extRanges: (parent) => markExtRanges(parent, 'highlight', 2),
}
````

**单 token → 原子 / widget**（参考 `official-plugins/emoji`）：

````ts
inline: {
  order: -1,
  tokenAdvance: (text, pos, tok) => {
    if (tok.type !== 'emoji') return null;
    const run = /^\\*/.exec(text.slice(pos))![0].length; // 前导反斜杠串（sub/sup 会反转义内容）
    const source = `:${tok.markup}:`;
    return text.startsWith(source, pos + run) ? run + source.length : null;
  },
  derive: (ctx) => ctx.tokens
    .filter((t) => t.token.type === 'emoji' && t.exact)
    .flatMap((t) => {
      const span = wholeTokenSpan(t, {
        type: 'emoji',
        widget: { kind: 'emoji', attrs: { glyph: t.token.content }, side: -1 },
      });
      return span ? [span] : [];
    }),
  markNames: [],
  extRanges: () => [],
  decorationWidgets: { emoji: emojiWidgetBuilder },
}
````

约束：

- `derive` 必须是纯函数：同一 textblock 会被加载期与编辑期各调用一次。
- `order` 只在 `derive` 特性之间排序；同 `order` 的组内次序由注册序决定。
  `order` 默认 0；需要 escape（0.2）先保护转义时，把 `order` 设为 > 0.2。
- 文本派生特性从 `ctx.consumed` 快照读取已占用字符；整段占用用 `opaque` / `wrap`
  （见 `InlineSpan` 注释）。`ctx.consumed` 是快照、`ctx.isConsumed()` 是实时位图；
  derive 期间二者一致（除非你在自己的 derive 里改过快照）：批量判断用快照，逐点判断用 `isConsumed`。
- mark 类 span 只占用 `openFrom..openTo` / `closeFrom..closeTo`（内容可嵌套其它语法）；
  原子类 span 占用整段；内容不透明的 mark 显式声明 `opaque: true`（如行内公式）：整段检查
  + 整段记账（不能包住已有 span）。包裹式构造（`<u>…</u>` / 脚注引用）声明 `wrap: true`：
  只检查分隔符冲突，但整段记账（`<u>**b**</u>` 依赖这条）。重复占用会被丢弃并 DEV 告警。
  `opaque` / `wrap` 只在派生引擎（冲突检查 + 记账）读取，不影响序列化/渲染。
- 最终 span 顺序由引擎按 `(closeFrom, openFrom)` 归并成闭合序（内层先），插件不要自己排序。
- `tokenAdvance` 必须返回有限正整数；返回 `null` / 非正数 / 非整数 / 推进后越过源文末端
  ⇒ 视为无效，交给下一个声明。

参考实现：`official-plugins/highlight`（成对）、`official-plugins/math` /
`official-plugins/emoji`（原子 + `tokenAdvance`）；文本派生（读 `ctx.consumed` 快照）见骨架的
`src/components/TextoEditor/src/features/escape.ts` 与 `auto-link.ts`。

### 行内 widget 渲染

v2 `derive` 产出的都是 `InlineSpan`；其中 `delimRanges` / `extraDecorations` / `widgetDecorations`
均为**可选**——不提供 `delimRanges` 时，`normalize` 会按 span 的 open/close 默认成对发出分隔符。
编辑器 `normalize` → `decorations` 是唯一渲染管线（不要自建装饰 plugin）。widget 的
`when`（`inside` / `outside` / `always`）按光标相对 span 的位置切换——例如数学用
「`when: "outside"` 出 SVG」表达渲染态；编辑态（光标在公式内）不再用第二个 widget，
而是把公式内容本身当作真实可编辑文本：内容范围声明 `delimRanges: [{ from, to, softInside: true }]`，
光标在外由 `softInside` 隐藏（`syntax-hidden`）、光标在内作为普通文本显示，`$` / `\(` `\)`
等分隔符以内联 `syntax-hint` 显示为灰色提示。这样光标可在公式内逐字符编辑源码。

`inline.decorationWidgets[kind] = (attrs, ctx) => HTMLElement` 负责造 DOM；插件把自己的
builder 注册进来即可，骨架按 `kind` 合并（插件覆盖内置同名 kind）。多插件重叠时
**后注册者覆盖先注册者**（合并按 `Object.assign` 顺序进行）。

### 边界

- 插件不得 import 骨架（`@/` 或相对逃逸）；共享逻辑放 `@texto/markdown-editor-runtime`。
- 插件自带 CSS（Vite 随插件模块打包），与 table / html / excalidraw 一致；数学插件自身用
  内联样式（自定义元素），此处 CSS 打包规则为通用说明。

## 行内格式工具栏插件

插件经 `markdown-editor:formatToolbar` 贡献 `FormatToolbarItemMeta`，把自己的行内格式按钮
投放到悬浮格式工具栏与顶部工具栏，并复用共享的开关 / 激活态逻辑。下划线插件是首个消费者
（见 `official-plugins/underline`）；骨架保留通用核心格式项（加粗/斜体/删除线/高亮/行内代码）
与共享动作，插件专属项（如 underline）不再内置。字段权威定义见
`packages/markdown-editor-api/src/types.ts`。

### 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 去重键；重复时后注册覆盖（位置遵循 SDK 注册语义）。 |
| `markName` | `string` | schema mark 名，用于默认激活态（如 `'underline'`）。 |
| `delim` | `string` | 开分隔符文本（`'**'` / `'<u>'`）。 |
| `closeDelim?` | `string` | 闭合分隔符，缺省 = `delim`（如 `'</u>'`）。 |
| `labelKey` | `string` | 按钮文案的完整 i18n key（如 `'underline.pluginName'`）。 |
| `icon` | `IconSpec` | 图标：手绘 `IconDef`（SVG 图元数据）或 lucide 图标名（kebab-case，如 `'underline'`）。名称由骨架运行时解析，渲染规格统一。 |
| `order?` | `number` | 排序权重（升序，缺省 0）。 |
| `surfaces?` | `FormatToolbarSurface[]` | 投放面；缺省同时投悬浮与顶部。 |
| `run?` | `(view: EditorView) => void` | 逃生舱：自定义 toggle；缺省走共享 `toggleInlineDelim`。 |
| `isActive?` | `(state: EditorState) => boolean` | 逃生舱：自定义激活判定；缺省按 `markName` 判选中态。 |

要点：

- **按 `id` last-wins**（位置遵循 SDK 注册语义）；同名项覆盖，不会出现第二个按钮。
- **`surfaces` 缺省 `['floating', 'toolbar']`**；用 `formatToolbarItemIncludesSurface(meta, surface)`
  判定投放面，顶部工具栏把贡献投影为 `group: 'inline'` 的 `ToolbarItem`（`activeMark = markName`，
  `isActive` 优先于 `activeMark`）。
- 核心项（`CORE_FORMAT_ITEMS`）与插件项合并后按 `order` 排序，无需关心注册先后。

### 共享动作与激活态

- **动作**：`runFormatToolbarItem(view, meta)`
  （`src/components/TextoEditor/src/features/inline-format-toolbar/items.ts`）优先调用 `meta.run`，
  否则按 `delim` + `closeDelim` + `markName` 走 `toggleInlineDelim`；顶部工具栏与悬浮工具栏
  共用同一入口。
- **激活态**：顶部工具栏读 `ToolbarActiveState.marks`（经 `activeMark`），悬浮工具栏用
  `selectionHasMark`——两者同源语义。
- **激活用并集、抑制用「完全在 mark 内」**，两个判定刻意分开：`selectionHasMark` 对区间内
  **任一**文本节点带该 mark 即判真（并集），避免选区边界落到隐藏分隔符（`**` / `==` 在主题里
  `font-size:0`）时误判未激活；`selectionFullyInMark` 要求**每个**文本节点都带该 mark，用于
  悬浮工具栏抑制，跨 mark 的部分选区因此不被抑制。

### 边界

- 插件不得 import 骨架（`@/` 或相对逃逸），只依赖 `@texto/*`（`MARKDOWN_EDITOR_FORMAT_TOOLBAR`
  / `FormatToolbarItemMeta` 来自 `@texto/markdown-editor-api`）与 prosemirror。
- `icon` 接受 `IconSpec`——手绘 `IconDef`（`path` / `line` / `rect` / `circle` 等 7 种图元数组）或 lucide 图标名
  （kebab-case，如 `'underline'`）；由骨架统一解析为渲染规格，插件不要直接传 React 组件。
- 按钮文案用完整 i18n key（形如 `<插件id>.<key>`）。**插件文案自带**：在 `src/locales.ts` 声明
  `locales`（语言 → 嵌套 messages）与 `defaultLocale`，骨架在启动时注入 `plugins` 命名空间；
  缺失语言用 `defaultLocale` 补齐。不要再往 `vendor/translations` 添加插件文案。

参考实现：`official-plugins/underline`（`format-item.ts` 声明项，`syntax/feature.ts` 提供 mark）。

图标有三种写法（`IconSpec` 类型定义在 `@texto/plugin-sdk`，`@texto/markdown-editor-api` 转发）：
插件清单的卡片图标 `TextoPlugin.icon` 与本节贡献项图标共用前两种写法，差异见第三条：
- **lucide 名称**（推荐复用）：`icon: 'underline'`。骨架懒加载 `lucide-react` 的图标数据并缓存，
  悬浮工具栏 / 顶部工具栏 / 斜杠菜单共用同一份渲染规格；插件设置页与引导页的卡片图标也走这条线。
- **手绘 `IconDef`**：`icon: [['path', 'M4 6h16'], ['line', 4, 20, 20, 20]]`，`viewBox` 固定 24×24，
  描边渲染。lucide 没有的图标用这种。
- **裸 SVG path 字符串**（**仅**插件清单 `TextoPlugin.icon` 的遗留兼容）：`icon: 'M6 17h3…'`。
  骨架按旧观感以**填充**渲染，并在开发模式下 `console.warn` 提示迁移。编辑器贡献项
  （`InsertCommandMeta.icon` / `FormatToolbarItemMeta.icon`）**不**支持这种写法——那里的字符串一律按
  lucide 名称解析。新代码不要使用。

`IconDef` 支持图元：`path` / `line` / `rect` / `circle` / `ellipse` / `polyline` / `polygon`。

## 正文右键菜单插件

插件经 `markdown-editor:contextMenu` 贡献编辑器正文的右键菜单项，编辑器负责事件接线、场景判定、
命中块定位、原生菜单创建与内置项（首个消费者 `official-plugins/mermaid`，另有 `official-plugins/math`）。

编辑器内右键**永远弹同一个菜单**：内置「复制 / 复制为 HTML」恒列出（有选区时可点、无选区时置灰），
插件项按场景与自身判定参与；非 Tauri 环境（网页演示）跳过弹菜单并只提示一次。

### 契约

```ts
import type { EditorContextMenuItemMeta } from '@texto/markdown-editor-api';

export const myMenuItem: EditorContextMenuItemMeta = {
  id: 'my-plugin.copySource',       // 裸 slug，建议 <插件id>.<name>
  labelKey: 'my-plugin.copySource', // 插件自带 locales 的 i18n key
  requires: ['block'],              // 缺省 = 任何场景都列出；['block'] 只在块场景列出
  order: 10,                        // 组内升序，缺省 0
  when: (ctx) => ctx.block?.node.type.name === 'code_block',
  enabled: (ctx) => ctx.block !== null,
  run: (ctx) => navigator.clipboard.writeText(ctx.block?.node.textContent ?? ''),
};
```

清单位置：

```ts
import { MARKDOWN_EDITOR_CONTEXT_MENU } from '@texto/markdown-editor-api';

contributes: {
  [MARKDOWN_EDITOR_CONTEXT_MENU]: [myMenuItem],
}
```

`ctx` 形态：`{ view, hasSelection, block }`。

- `view`：编辑器视图（读选区 / 派发事务 / 取焦点）。
- `hasSelection`：当前是否有非折叠选区（内置复制项的可用性也由它决定）。
- `block`：右键命中的目标顶层块 `{ pos, node }`；**未命中时为 `null`（插件必须判空）**。
  - `pos`：该顶层块在 doc 中的位置（内部为 `$pos.before(1)`），**可直接用于事务**
    （`tr.delete(pos, pos + node.nodeSize)`、`tr.setNodeMarkup(pos, ...)`）。
  - `node`：目标顶层块节点。

### 场景（`requires`）

场景由「选区 + 命中块」共同决定，**互斥、选区优先**：

| 用户操作 | 可用场景 | `requires: ['selection']` | `requires: ['block']` | 不写 `requires` |
|---|---|---|---|---|
| 有非折叠选区 | `selection` | 列出 | **不列出** | 列出 |
| 无选区 + 命中块 | `block` | **不列出** | 列出 | 列出 |
| 无选区 + 未命中块 | （无） | **不列出** | **不列出** | 列出 |

- `requires` 缺省（或不写）⇒ **任何场景都列出**，可点性交给 `enabled`。
- `requires: ['selection', 'block']` ⇒ 任一场景满足即列出。
- 判定规则：`requires.some(r => available.includes(r))`（契约包的 `contextMenuItemAppliesTo()`）。

> 注意：`requires: []`（显式空数组）与**不写** `requires` 等价——都表示「任何场景都列出」。
> 这与早期草案里 `kinds: []` = 「任何场景都不可见」的语义**相反**，迁移旧代码时注意。

- 场景判定**只看 PM 选区**（`view.state.selection.empty`）与命中块，**不看** `window.getSelection()`：
  右键**不会**折叠 DOM 选区，残留选区会一直「挂着」，据它判定会让块场景的项被静默过滤
  （真机已实测到这一现象——菜单里只剩复制项）。PM 选区是编辑器的权威状态。

内置「复制 / 复制为 HTML」不写 `requires`、用 `enabled: (ctx) => ctx.hasSelection` 表达可点性，
因此**三种场景下都列出**，无选区时置灰。

### 装配与顺序

- 编辑器内置项在前、插件项在后，**组间固定**；两组都非空时插一条分隔符。
- `order` 只在组内生效——插件项即使 `order: 0` 也不会插进内置项之间。
- `when`（可见性：返回 false 或抛错 ⇒ **不列出**）与 `enabled`（可用性：返回 false 或抛错 ⇒ **置灰**）
  **必须同步**（原生菜单构建不能 await）；`run` 可返回 Promise，编辑器不等待。
- `when` / `enabled` / `run` 三者各自被 `try/catch` 隔离：抛错只影响该项（不可见 / 置灰 / 仅日志），
  不打断其它项。因此插件**不需要**在自己的 `run` 里再 `catch`。

### 边界

- 插件不得 import 骨架（`@/` 或相对逃逸），只依赖 `@texto/markdown-editor-api`
  （`MARKDOWN_EDITOR_CONTEXT_MENU` / `EditorContextMenuItemMeta` / `EditorContextMenuCtx` /
  `EditorContextMenuRequirement` / `contextMenuItemAppliesTo`）与 prosemirror。
- **`ctx.block` 必须判空**：无选区且右键落在块之间留白、或命中顶层原子 leaf 块
  （`horizontal_rule`、顶层图片等 `nodeSize === 1`）时 `block === null`。此时 `requires: ['block']`
  的项不会被列出，但**不写 `requires`** 的项仍会带着 `block: null` 进来（用 `when` / `enabled` 处理）。
- **不会注入序列化器**：契约里没有 `serialize`。需要块内文本时读 `ctx.block?.node.textContent`
  （代码块、嵌入引用的源码都在节点文本里）；需要更复杂的行为时用 `ctx.view` 自行派发事务。
- **行内公式（`$…$`）不在块级项覆盖范围**：它位于**段落内部**，`ctx.block` 只能指向所属段落，
  `requires: ['block']` 的项取不到公式节点。math 插件因此只对块级公式投放菜单项；行内公式仅做
  「右键不切回源码」的守卫（widget 的非主键 `mousedown`）。
- 菜单项文案随插件自带 locales（`src/locales.ts` 的 `locales` + `defaultLocale`，key 形如
  `<插件id>.<key>`），不要往 `vendor/translations` 添加插件文案。
- 不支持嵌套子菜单；不支持在菜单项里放图标。
- 平台差异：非 Tauri 环境（网页演示）没有原生菜单，跳过弹菜单并只提示一次（`console.warn`）。

参考实现：`official-plugins/mermaid` 与 `official-plugins/math`（均在 `src/context-menu.ts` 声明
`requires: ['block']` 的项，`src/index.ts` 经 `contributes[MARKDOWN_EDITOR_CONTEXT_MENU]` 投递，
`src/locales.ts` 提供 15 语言 `copySource`；math 的 `when` 匹配 `code_block` 且 `lang ∈ ['latex','math']`，
覆盖 ```latex / ```math 与 `$$…$$` 解析出的块级公式）。

## 选区动作（`markdown-editor:selectionAction`）

插件经 `markdown-editor:selectionAction` 贡献 `SelectionActionMeta`，在悬浮选区工具栏右侧
追加动作按钮（解释 / 翻译这类「读选区、不改 schema」的操作）。字段权威定义见
`packages/markdown-editor-api/src/types.ts`。两个动作拆成两个独立插件：
`official-plugins/ai-explain`（解释）、`ai-translate`（翻译，带目标语言设置，两者 `category: 'llm'`）；
它们共享 `@texto/ai-prompt` 的提示词骨架与公共文案，
各自只声明一个动作（`src/actions.ts` 声明动作，`src/index.ts` 投递贡献）。

### 契约

```ts
import type { SelectionActionMeta } from '@texto/markdown-editor-api';

const explain: SelectionActionMeta = {
  id: 'ai-explain.explain',          // 去重键，建议 <插件id>.<name>
  labelKey: 'ai-explain.explain',    // 插件自带 locales 的 i18n key
  icon: 'book-open-text',           // lucide 名称或手绘 IconDef
  order: 0,                          // 升序，缺省 0；相等按注册序
  when: () => host.agent.available(profileId), // profileId 来自设置段 modelProfile；缺省恒可见；每次显示 / 事务时求值
  run: (view) => {
    const { from, to } = view.state.selection; // 调用时选区仍存在
    const text = view.state.doc.textBetween(from, to, '\n');
    // …拿 text 发起请求或打开自己的 UI
  },
};
```

清单位置：

```ts
import { MARKDOWN_EDITOR_SELECTION_ACTION } from '@texto/markdown-editor-api';

contributes: {
  [MARKDOWN_EDITOR_SELECTION_ACTION]: selectionActions,
}
```

### 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 去重键（建议 `<插件id>.<name>`）；重复时后注册覆盖（last-wins）。 |
| `labelKey` | `string` | 按钮文案的完整 i18n key（插件自带 locales，形如 `<插件id>.<key>`）。 |
| `icon` | `IconSpec` | 图标：lucide 图标名（kebab-case）或手绘 `IconDef`。 |
| `order?` | `number` | 排序权重（升序，缺省 0；相等按注册序）。 |
| `when?` | `() => boolean` | 可见性；缺省恒可见。同步求值，抛错视为不可见。 |
| `run` | `(view: EditorView) => void \| Promise<void>` | 点击执行；允许返回 Promise，编辑器不等待。 |

### 要点

- **唯一读取入口** `editorSelectionActions()`
  （`src/components/TextoEditor/src/extension/registry.ts`）直接返回注册序；SDK 在注册期按
  `id` last-wins——被覆盖的项从原位置移除、新项落到注册序末尾，消费端再按 `order` 做稳定排序。
  因此覆盖同名动作会同时改变它的注册序（仅在 `order` 相等时可见），不要依赖「覆盖后原位保留」。
- **`when()` 每次显示 / 事务都重新求值**：悬浮栏在每次编辑器更新（如选区变化）与
  每次显示前调用 `availableSelectionActions()`
  （`src/components/TextoEditor/src/features/inline-format-toolbar/index.ts`），因此启动期晚到的
  配置会在下一次更新 / 下次显示时被感知（AI 插件就是用它跟随 `host.agent.available(profileId)`，
  `profileId` 取自插件设置里的 `modelProfile` 字段）。
  抛错只跳过该项并记录 `[selection-action] when failed`，不影响其它动作。空选区时不会调用 `when()`。
- **`run(view)` 执行时选区仍存在**：动作按钮的 `mousedown` 已 `preventDefault()`，点击不会折叠
  选区，可直接读 `view.state.selection` / `view.state.doc`。同步 `throw` 与返回 Promise 的
  `reject` 都由编辑器隔离并记录 `[selection-action] run failed`，不会冒泡成未捕获异常；
  需要给用户反馈时在插件内自行 `host.toast`。
- **可见性独立于格式栏**：`show_inline_format_toolbar` 开关、只读模式、代码块内、标题内、
  跨块选区、被抑制 mark、选区首尾空白，全都只约束**格式按钮**（`formatConditionsOk()`）。
  动作按钮只要求「非空选区 + 编辑器聚焦 + `when()` 为 true」；因此上述场景下动作仍会显示，
  只有同时没有任何可见动作、格式按钮也不显示时整条悬浮栏才不出现。
- 动作区只在**动作 id 集合变化**时重建按钮；滚动 / 窗口 resize 只按缓存重新定位，不会重新
  求值 `when()`，插件不要把昂贵逻辑放进 `when()`。

### 边界

- 插件不得 import 骨架（`@/` 或相对逃逸），只依赖 `@texto/markdown-editor-api`
  （`MARKDOWN_EDITOR_SELECTION_ACTION` / `SelectionActionMeta`）与 prosemirror。
- 不动 schema：选区动作是纯读 + 外部副作用，不要在这里派发改文档的事务。
- 文案与图标规则同行内格式工具栏：`labelKey` 用插件自带 locales 的完整 key，
  `icon` 传 `IconSpec`（lucide 名或 `IconDef`），不要传 React 组件。

参考实现：`official-plugins/ai-explain/src/actions.ts`（`when` 跟随 `host.agent.available(profileId)`，
`profileId` 取自插件设置里的 `modelProfile`；
`run(view)` 把编辑器视图交给 `host.agent.tools.call('core.read-selection-context', { view })`
取上下文、经 `@texto/ai-prompt` 的 `buildSelectionPrompt` 拼 prompt、调
`host.agent.present(request, { profileId, anchor })`，
锚点直接用工具返回的 `anchor`）。`ai-translate` 结构相同，只换任务句、
图标与本地化动作名；`ai-translate` 另外从 `host.config` 读目标语言（默认 `auto`，跟随界面语言）。

## 代码块语法高亮插件

插件经 `markdown-editor:syntaxHighlight` 贡献 highlight.js 语法，核心代码块高亮与语言
下拉均由注册表驱动（首个消费者 `official-plugins/syntax-highlight`）。核心只保留
`highlight.js/lib/core`，不得硬编码 `highlight.js/lib/languages/*`。

贡献形状 `{ languages: [{ id, label?, aliases?, grammar }] }`：`id` 为规范语言名
（写入 `code_block.attrs.lang`，如 `javascript`），`label?` 缺省回退 `id`，`aliases?`
（如 `js` / `jsx`）用于 hljs 别名注册与下拉过滤，`grammar` 为 highlight.js `LanguageFn`。
最小示例：

```ts
import java from "highlight.js/lib/languages/java";
import { MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT } from "@texto/markdown-editor-api";

// contributes: {
//   [MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT]: [
//     { languages: [{ id: "java", label: "Java", grammar: java }] },
//   ],
// }
```

- 唯一读取入口 `editorHighlightLanguages()`（`src/components/TextoEditor/src/extension/registry.ts`）。
- 同一 `id` last-wins、保持首次出现位置；下拉合并自定义视图语言后按 value 去重。
- 语法在首次高亮时惰性注册（幂等）；无贡献时退化为纯文本。
- 插件开关影响语法与下拉，需**重启**后生效。

## 启动激活钩子 `activate(host)`

清单可选声明 `activate(host)`：应用启动时，框架对每个**启用**插件调用一次
（`src/plugins/runtime.ts`）；启用 / 禁用插件需**重启**后生效。

- 只放**幂等的启动期副作用**：读取自己的 `host.config` 并应用设置、注册全局监听等。
  框架不提供 `deactivate`，因此不要放需要配对清理的逻辑。
- 激活早于编辑器就绪：此处的 `host.documents` / `host.editor` 为 no-op，只用
  `config` / `theme` / `events` / `log` / `toast`。
- 单个插件 `activate` 抛错由框架隔离：记录日志并继续执行其余插件，不阻断启动。
- 参考实现 `official-plugins/syntax-highlight`：读取 config（缺省时用
  `host.theme.codeHighlightThemeDefaults()` 迁移旧值并写回），经
  `host.theme.applyCodeHighlightTheme(light, dark)` 应用亮 / 暗高亮主题，并
  `host.theme.subscribe(...)` 在明暗切换时重应用。

## Agent 能力（`PluginHost.agent`）

宿主把 LLM 能力收敛成 `PluginHost.agent`（`AgentCapability`，契约在
`packages/plugin-sdk/src/types.ts`）。插件只用 `host.agent`：不读 API Key、不自己发 HTTP、
不 import 骨架实现。宿主侧装配在 `src/agent/`：`capability.ts`（能力实现）、`config.ts`
（设置读写）、`run.ts` / `runtime.ts`（运行与事件映射）、`session.ts`（共享会话）、
`presenter.tsx` + `AgentPanel.tsx`（悬浮块 / 侧栏 AI 视图）。两个消费者：
`official-plugins/ai-explain` / `ai-translate`。

### 能力

| 方法 | 行为 |
|---|---|
| `available(profileId: string): boolean` | 是否可用：**同步、廉价、无副作用**。`profileId` 必须显式传入——**空串或未知 id 一律返回 `false`，不抛错**。配置未加载（含非 Tauri 环境读不到配置）时为 false；缺 `apiKey` / `model` 时为 false；`custom` provider 还要求非空 `baseUrl`。适合直接放进选区动作的 `when()`。 |
| `run(request, handlers, options: AgentRunOptions): AgentRunHandle` | 只经 `handlers.onEvent` 流式回调，**不产生任何 UI、不写共享会话**；不会中止别的请求。适合后台任务或插件自绘 UI。`options.profileId` 必填。 |
| `present(request, options: AgentPresentOptions): AgentRunHandle` | 写入共享 session（标题 / 锚点 / 请求）并开跑；**会先中止上一条 `present` 请求**（同一时刻只有一条在跑）。按宿主配置 `agent_result_surface` 显示悬浮块（`floating`）或侧栏 AI tab（`sidebar`，宿主自动展开侧栏并切 tab）。`options.profileId` 必填。 |
| `profiles.list(): AgentProfileInfo[]` | 宿主侧的模型配置**只读摘要**：`id` / `name` / `provider` / `model` / `enabled`，**不含 Key 与 baseUrl**。每次调用返回**新数组**，且**不通知变更**——需要新鲜数据就在展示前重新读取。`enabled` 只表示是否出现在配置下拉里，**不代表可用**；可用性一律用 `available(id)` 判定。 |

- `present()` 的两个承载面共用同一份 session；切换显示位置不会中断流式输出。
- `options.anchor` 是**视口坐标**（与 CSS `position: fixed` 一致），宿主会按真实尺寸
  定位并夹取到窗口内；一般直接用核心工具 `core.read-selection-context` 返回的 `anchor`
  （选区矩形并集，取不到坐标时回退编辑器 DOM 矩形）。`options.title` 缺省由宿主决定。
- `options.size`（`{ width?, maxHeight? }`，缺省 `420` / 视口高度 60%）只约束悬浮块：
  `width` 不小于 280，`width` / `maxHeight` 都会被视口夹取；侧栏承载面忽略它。
- 悬浮块定位顺序：**下方优先**（`anchor.bottom + 8`）→ 下方放不下且上方空间足够则翻到
  上方（`anchor.top - height - 8`）→ 两侧都放不下时选空间更大的一侧，最后**四边夹取**到
  `[12, 视口 - 卡片尺寸 - 12]`，保证整张卡片留在视口内。卡片尺寸按内容实测
  （`ResizeObserver` 跟随流式输出变高后重算），锚点为 `null`（无选区 / 过期）时落左上角。
- `run()` 的 `onEvent` 抛错只记录日志，不中断运行；`abort()` 幂等。

### 模型配置（profile）与插件接入

「用哪个模型 / 服务商 / API Key」由**宿主的模型配置**决定，插件只持有配置 **id**：

1. **设置段声明绑定字段**：插件必须在 `app:settingsSection` 的设置段里声明
   `type: 'modelProfile'`、`key: 'modelProfile'` 的字段（宿主渲染成配置下拉，只列已启用的
   配置，并处理「已停用 / 已删除 / 无可选项」的提示）：

   ```ts
   {
     type: 'modelProfile',
     key: 'modelProfile',
     labelKey: 'demo.modelProfile',
     descriptionKey: 'demo.modelProfileDesc',
     default: '',
   }
   ```

2. **清单声明实时生效**：插件清单必须有 `settingsApply: 'immediate'`，否则宿主不会在配置
   变更时通知 `host.config.subscribe`。
3. **默认关闭**：AI 插件一律 `defaultEnabled: false`（启用即代表用户愿意把内容发给第三方）。
4. **启动时读取一次 + 订阅变更**：`when()` 是同步的，不能在回调里 await，所以把 id 缓存
   在模块变量里：

   ```ts
   let profileId = '';
   let synced = false;
   let unsubscribe: (() => void) | null = null;

   export function bindHost(host: PluginHost): void {
     unsubscribe?.();
     unsubscribe = host.config.subscribe((config) => {
       const next = config.modelProfile;
       profileId = typeof next === 'string' ? next : '';
       synced = true;
     });
     void host.config.get<unknown>('modelProfile').then((stored) => {
       // 初次读取可能比订阅推送晚到：仅在尚未收到推送时采用。
       if (!synced) profileId = typeof stored === 'string' ? stored : '';
     });
   }
   ```

5. **`when` 用缓存的 id 调 `available(id)`**；**`run` 入口先快照 id 再复查可用性**
   （运行期间用户可能改配置）：

   ```ts
   when: () => host?.agent.available(profileId) ?? false,
   async run(view) {
     const profile = profileId;                  // 快照
     if (!host || !host.agent.available(profile)) return;   // 复查
     host.agent.present(request, { profileId: profile, anchor });
   }
   ```

参考实现：`official-plugins/ai-explain` / `ai-translate` 的 `actions.ts`（绑定 + 订阅）与
`settings.ts`（`modelProfile` 字段）。

### 工具（`host.agent.tools`）

宿主维护一份**工具注册表**（`src/agent/tools.ts`）：核心内置工具 + 插件经
`app:agentTool` 的贡献。插件之间同名 last-wins（贡献键 `name`）；`core.*` 属核心
命名空间，插件的同名贡献会被忽略（DEV 告警），核心实现永远生效。**v1 只支持插件
手动调用**，宿主不会把工具注册给 pi Agent（模型自主调用是后续版本的接入点，届时只需
把 `tools.list()` 的结果与 `tools.call()` 桥接给模型循环，插件侧契约不变）。

| 方法 | 行为 |
|---|---|
| `tools.list(): AgentToolInfo[]` | 工具的元信息（`name` / `description` / JSON Schema `parameters`），不含实现。 |
| `tools.call(name, args?): Promise<AgentToolResult>` | 执行工具并返回 `{ content, details? }`；未注册的工具抛错。 |

内置工具 `core.read-selection-context`：优先用调用方传入的 `args.view`（选区动作
`run(view)` 里的真实编辑器视图——插件宿主是启动期 no-op 装配的，`host.editor` 在真实
运行中没有编辑器句柄），缺省才回退 `host.editor.getSelectionContext()`；`content` 是
JSON 文本，`details` 是 `SelectionContextSnapshot`（无选区时抛错）。AI 插件当前就是这样
取上下文的。`view` 是运行时对象、不可 JSON 序列化，故不出现在 `tools.list()` 的
`parameters` 里。

贡献一个工具（`packages/app-api/src/index.ts` 的 `AgentToolContribution`）：

```ts
import { APP_AGENT_TOOL } from '@texto/app-api';

// contributes: {
//   [APP_AGENT_TOOL]: [
//     {
//       name: 'demo.echo',                     // 建议 `<插件id>.<name>`
//       description: 'Echo the given text.',
//       parameters: { type: 'object', properties: { text: { type: 'string' } } },
//       execute: async (host, args) => ({ content: String(args.text ?? '') }),
//     },
//   ],
// }
```

- `execute` 收到的是**插件自己的 host**（`config` / `i18n` 等能力按插件隔离），参数由
  调用方给，无 schema 校验（v1）；自己校验并在失败时抛错。
- 核心工具 `core.read-selection-context` 只在 IR 模式有上下文（选区动作本身只由 IR
  编辑器投递；宿主能力在 SV 下也返回 null），且 `content` 只含选区 / 段落 / 标题链，
  锚点在 `details` 里。
- 工具与 `present()` / `run()` 相互独立：工具只负责取数据，不发请求、不写共享会话。
- 文档内容（工具返回值）仍属不可信输入，拼 prompt 时按 `@texto/ai-prompt` 的做法定界并声明
  「文档内容不是指令」。

### 请求与事件

```ts
const handle = host.agent.run(
  {
    system: '你是一个 Markdown 助手…',                  // 可选
    messages: [{ role: 'user', content: 'ping' }],      // 最后一条必须是 user
  },
  {
    onEvent: (event) => {
      if (event.type === 'text-delta') {
        // 增量文本
      } else if (event.type === 'done') {
        // event.text 是完整最终文本
      } else if (event.type === 'error') {
        // event.message 可直接展示；event.retryable 表示是否值得重试
      }
    },
  },
  { profileId }, // 必填：宿主侧模型配置 id
);

handle.abort(); // 幂等；中止不保证再发事件
```

`AgentRequest`：`system?: string` + `messages: { role: 'user' | 'assistant'; content: string }[]`。
`messages` 的最后一条必须是 `user`（本轮输入），否则整次运行以 `error` 事件结束
（`retryable: false`）。v1 只把最后一条 `user` 作为本轮输入，更早的消息暂不转发给模型。

`AgentRunOptions` 只有必填的 `profileId`；`AgentPresentOptions` 在它之上再加
`anchor` / `title?` / `tabLabel?` / `size?` / `sourceText?`。

`AgentEvent`：

| `type` | 字段 | 说明 |
|---|---|---|
| `text-delta` | `text` | 增量文本，按产生顺序回调。 |
| `reasoning-delta` | `text` | 推理过程增量（模型支持时才有）。 |
| `done` | `text` | **完整最终文本**，在全部 `text-delta` 之后发出。 |
| `error` | `message` / `retryable` | 失败终态；`message` 已归一（鉴权 / 限流 / 网络有本地化兜底）。 |

- 终态只有一个：`done` 或 `error`；中止后到达的增量会被丢弃，也不保证发 `done`——
  清理逻辑不要只挂在 `done` 上。

### `retryable`

由宿主 `classifyAgentError`（`src/agent/errors.ts`）判定：

- `false`：请求构造 / 参数错误（如最后一条不是 `user`），改参数才能继续；
- `true`：鉴权（401 / 403）、限流（429）、网络 / CORS，以及其它 provider 侧错误——
  改 key 或稍后重试有意义。

插件只需展示 `message`；自绘 UI 可在 `retryable` 为 true 时提供「重试」，重发同样的请求即可。

### 宿主配置

Agent 的 provider / model / API Key / base URL / 结果承载面属于**宿主设置**，不是插件配置：
应用设置页的「模型设置」分类（`settings.ai.*` / `settings.aiConsent.*`，入口组件
`src/components/settings/AiModelSettings.tsx`，由 `src/components/SettingsWindow.tsx` 挂载）
写入 `agent_enabled` / `agent_profiles`（每条含 `api_key` 明文）/ `agent_consent` /
`agent_result_surface`，经 `config-changed` 广播实时生效。插件不要自己存 key，也不要经
`host.config` 覆盖这些值；只读摘要走 `host.agent.profiles.list()`，绑定某个配置走插件自己的
`modelProfile` 字段（见上文「模型配置（profile）与插件接入」）。

### 边界

- 插件只依赖契约包：`PluginHost` / `AgentCapability` / `AgentRequest` / `AgentEvent` /
  `AgentPresentOptions` 均来自 `@texto/plugin-sdk`；`src/agent/*` 是宿主内部实现，插件不得 import。
- `present()` 已负责共享会话与结果显示，不要再自绘一套并行状态去驱动同一结果。
- 一次请求就是一次「`system` + 最后一条 `user`」的补全，不要假设会话内会累积上下文。

## 源保真协调器

源文本保真（未编辑的行原样输出、保持对齐空格与分隔行原文）过去写死在核心。
现在顶层块的**子单元**保真抽成 `SyntaxFeature.sourcePreserve`，插件自行实现行级 /
格级拼接（表格插件是首个消费者，见 `official-plugins/table/src/source-preserve.ts`）。

### 契约（`@texto/markdown-editor-runtime`）

```ts
export interface SourcePreserveReconciler {
  /** 我负责的节点类型名（如 ['table']）。 */
  nodeTypes: readonly string[];
  /** 从 token 流收集本功能各顶层块的子单元行区间；返回数组与 matches 一一对应。 */
  collect(
    tokens: readonly Token[],
    rootSpans: readonly BlockSpan[],
    matches: readonly number[],
  ): Array<SourcePreserveCollected | null>;
  /** 新节点对应的 canonical 子单元文本（顺序与 sigs 对齐）。 */
  canonicalUnits(node: PMNode, renderBlockCanon: (n: PMNode) => string): string[];
  /** 生成脏顶层块的替换文本；返回 null 回退整块 canonical。 */
  splice(
    src: string,
    eol: '\n' | '\r\n',
    old: SourcePreserveUnitSet,
    newNode: PMNode,
    renderBlockCanon: (n: PMNode) => string,
  ): string | null;
}
```

### 核心侧行为（务必对齐）

- **按新节点类型校验分发**：`source-preserve.ts` 用 `nNode`（编辑后的新 doc 节点）
  的 `type.name` 去匹配协调器的 `nodeTypes`，命中才调 `splice`。插件不能假设自己
  的 `collect` 一定被调用——只有文档里存在对应顶层块时才会。
- **`renderBlockCanon` 由核心注入**：插件不得 import 编辑器的序列化器（会破坏
  「编辑器不得 import 骨架」的边界）。核心把走 `SerializerState` 的块级 canonical
  渲染函数作为参数传入，`canonicalUnits` 与 `splice` 共用同一份。
- **调用需 `runFeatureStep` 隔离**：协调器是插件代码，`collect` / `canonicalUnits` /
  `splice` 三类调用都包在 `runFeatureStep(label, fn)` 里，单个抛错只跳过该协调器，
  不中断整篇解析（`label` 形如 `sourcePreserve(table)`）。
- **`collect` 只处理顶层块**：`matches` 是命中本功能 `nodeTypes` 的顶层 root 序号
  （文档顺序），返回值与之一一对应，无法处理的位置返回 `null`。子单元（如表格的
  header + body 行）的行区间由插件自己从 token 流切分；核心随后用
  `canonicalUnits(oldNode)` 填 `sigs`。
- **长度不变量**：核心要求 `canonicalUnits` 返回的 `sigs.length === collect.spans.length`，
  否则丢弃该块（回退整块 canonical）。插件要保证两侧顺序严格对齐。

## verbatim 顶层节点协调器

有一类顶层节点**没有对应的 root span**、且被解析器重定位（最典型：`markdown-it-footnote`
把脚注定义重定位到文档末尾，定义块 token 无 `map`、内层段落 token 在 depth 2）。位置式
子单元 reconciler 假设「子单元在某个顶层 root 的行区间内」，覆盖不到它们。这类节点用
`SyntaxFeature.sourceVerbatim` 声明；核心把它们排除出位置对齐，改为按**源区域**原位保留 /
按 key 写回（脚注插件是首个消费者，见
`official-plugins/footnote/src/syntax/source-verbatim.ts`）。

### 契约（`@texto/markdown-editor-runtime`）

```ts
export interface SourceVerbatimRegion {
  /** 绝对字符偏移 */
  start: number;
  end: number;
  /** 新旧文档配对用的稳定 key（脚注：label）。 */
  key: string;
  /** 原文。 */
  raw: string;
}

export interface SourceVerbatimReconciler {
  /** 该顶层节点是否按 verbatim 处理（从位置对齐中排除）。 */
  matches(node: PMNode): boolean;
  /** 新文档中某 verbatim 节点的稳定 key。 */
  keyOf(node: PMNode): string;
  /** 从原文收集全部 verbatim 区域（key 与 keyOf 对齐）。 */
  collect(src: string, doc: PMNode): SourceVerbatimRegion[];
  /** 新节点的 canonical 文本（写回 / 新增）；renderBlockCanon 由核心注入。 */
  render(node: PMNode, renderBlockCanon: (n: PMNode) => string): string;
}
```

### 核心侧行为（务必对齐）

- **声明式排除**：核心 `source-preserve.ts` 用 `isVerbatimRoot(node)`（任一 feature 的
  `sourceVerbatim.matches`）把这些顶层节点排除出位置对齐（`canonicalUnits` / 子节点计数 /
  `preservedParts` 的 nodes 等），与位置式协调器互不干扰。
- **区域裁槽**：`parseWithSource` 调 `collect(src, doc)` 得绝对源区域，映射到所属 free 残段；
  输出时按 key 与**新文档**配对——未编辑（`render(old) === render(new)`）复制 `raw`、
  编辑写 `render(new)`、删除置空、新节点追加到文末。
- **`renderBlockCanon` 由核心注入**：同位置式协调器，插件不得 import 序列化器。
- **调用需 `runFeatureStep` 隔离**：`collect` / `render` / `matches` 均包在
  `runFeatureStep` 里，单个插件抛错只跳过自身。
- **只动 free 层**：位置对齐主流程不变；单个区域解析失败回退 `raw`（不丢内容）。

### 已知限制

脚注定义仍以「`[^N]:` 前缀的 paragraph」表示（不新增节点类型）。多段定义在
`markdown-it-footnote` 解析时会被压平为单个段落，因此**编辑**多段定义时写回的是压平后的
canonical 文本（与非保真 `serialize(doc)` 的既有行为一致）；未编辑时原文逐字保留。若将来
需要多段定义编辑保真，需改用一等容器节点。

## 跨引擎验证

`happy-dom`（Vitest）与 Chromium 都不会复现上述 WebKit 行为，**单元测试通过
不代表真机通过**。涉及编辑器 DOM / NodeView / 懒加载的改动，提交前至少做一次
真实 WebKit 冒烟：

- 打开一个含 HTML 块（如 `<div>…</div>`、`<p align="center">…</p>`）的
  Markdown 文档；
- 确认光标移出块（进入渲染态）后 UI 不卡死；
- 在 macOS 上可用 `bun tauri dev` 走 WKWebView，或用一个最小的
  `WKWebView` 驱动脚本加载开发服务器页面。

## 回归测试建议

无法用 happy-dom 复现的 WebKit 时序问题，至少补齐两层守卫：

1. **结构守卫**：断言 NodeView 挂载后同步即可看到私有渲染容器（证明它是
   eager 创建，而不是懒加载后 append）。见
   `src/components/TextoEditor/tests/features/html-block.test.ts`
   的 `html-block: node view DOM shape`。
2. **契约守卫**：直接对视图句柄断言 `ignoreMutation` 的放行/拦截规则。见
   `official-plugins/html/src/view/html-block-view.test.ts`。

新增编辑器 NodeView 插件时，请沿用同样的两层测试。

## 插件设置与实时配置

### 声明式设置字段（`app:settingsSection`）

在既有 `text` / `password` / `number` / `boolean` / `select` / `action` 基础上扩展：

- `number`：新增可选 `min` / `max` / `step`；
- `color`：颜色选择器（新增），可选 `presets?: Array<{ value: string; labelKey?: string; label?: string }>`——存在时设置面板渲染「预设色板圆点 + 自定义取色器」，缺省回退单个取色器；highlight 插件为首个消费者；
- `preset`：派生选择（新增）——`value(values)` 按当前配置算显示项，`apply(value, values)` 返回整组配置补丁；
- `visibleWhen: { key, equals }`：条件显示（新增）；
- `action.run` 新增 `set`：用整组配置替换（恢复默认）。

设置面板与实时快照（`EditorContext.config`）共用 `applySettingsDefaults(fields, stored)` 计算
「有效配置」（已存值 ⊕ 字段 default；跳过不承载存储值的 `preset` / `action`）。
注意：`PluginHost.config.get` / `getAll` 返回磁盘原值，不补默认值。

### 配置何时生效：`settingsApply`

清单声明 `settingsApply: 'immediate' | 'restart'`（缺省 `'restart'`）：

- `immediate`：写入配置即由骨架 `src/plugins/configSync.ts` 广播 `plugin-config-changed` 并更新实时快照；
- `restart`：重启后生效，设置页显示提示。

### 读取实时配置（编辑器扩展）

编辑器扩展经 `EditorContext.config` 读取，插件无需订阅事件：

```ts
create(ctx) {
  return { plugins: [pluginThatReads(ctx.config)] };
}
// 使用处： ctx.config.get('count') / ctx.config.all()
```

快照由骨架在启动时预热（`primePluginConfigs`），并在 `immediate` 插件配置变更时更新。

### 读取实时配置（应用级插件）

编辑器之外的插件（`activate` / 上传器 / 设置 action 等）用 `host.config.subscribe(listener)`
订阅本插件「有效配置」的变更，回调收到含字段默认值的对象：

```ts
host.config.subscribe((config) => {
  // config 已合并字段 default；重新据此应用，无需重启
});
```

只有声明 `settingsApply: 'immediate'` 的插件才会收到通知（缺省 `restart` 不触发），回调在
骨架刷新实时快照时同步调用。第一方（official）插件统一声明 `immediate`——它们按需读取配置
或不缓存状态，无需重启；若某插件确实需要重启才能生效，应保留 `restart`。

字段权威定义见 `packages/app-api/src/index.ts`；广播与实时快照实现见 `src/plugins/configSync.ts`。

## 插件多语言

插件文案随插件走，不再集中到 `vendor/translations`。

- 插件资源注入 i18next 的 `plugins` 命名空间，顶层 key 为插件 id；key 引用形式为
  `<插件id>.<key>`（如 `underline.pluginName`）。
- **自带资源**：在插件 `src/locales.ts` 导出 `locales`（语言 → 嵌套 messages）与
  `defaultLocale`，并在清单里引用（`TextoPlugin.locales` / `defaultLocale`，见
  `packages/plugin-sdk/src/types.ts`）。骨架启动时由 `src/i18n/plugin-messages.ts`
  把它们注入 i18next 的 `plugins` 命名空间；`fallbackNS: 'plugins'` 则由
  `src/i18n/index.ts` 设置，因此 `t('<插件id>.<key>')` 可解析。
- **可只声明语言子集**：缺失语言用 `defaultLocale` 补齐（对每个受支持语言取
  `locales[lng] ?? locales[defaultLocale]`）；建议至少同时提供 `zh-CN` / `en-US`。
- **两种调用姿势**：
  - `host.i18n.t('serverUrl')` 接收**裸 key**——宿主已按插件绑定 id，会自动补
    `<插件id>.` 前缀（`src/plugins/host.ts`）；
  - 直接用 `i18next.t` / `useTranslation` 时写**完整 key** `<插件id>.<key>`（命名空间经
    `fallbackNS` 落到 `plugins`）。
- **key 必须自包含**：不得引用骨架命名空间（`common.*` / `editor.*` / `shortcuts.*` /
  `menu.*` / `settings.*` 等），插件只用自己的命名空间。
- **例外**：导出插件占用的原生菜单标签（`menu.export_html` / `menu.export_epub`）由骨架持有——
  Rust 编译期嵌入核心 bundle，前端注入对其不可见。

参考实现：`official-plugins/underline/src/locales.ts`；注入逻辑 `src/i18n/plugin-messages.ts`。
