# 插件运行时 v1 —— 插件作者指南

本文面向**外部/运行时插件**（`manifest.json` + `main.js` 的 `.zip` 包，或随应用出厂的预装插件）。
加载根只有一个：`<appData>/plugins`。

仓库里还有一套**第一方插件**体系（`official-plugins/*`，`definePlugin` + 宿主内部契约包），
见 `docs/plugin-development.md`。它正在按 P3 波次迁到本运行时；两套实现共享编辑器扩展点，
但**作者 API 不同**——本文只描述外部插件用的那一套。

## 目录结构

```
my-plugin/
├── plugin.config.ts       # 构建期元数据（id / 名称 / 版本 / 兼容性 / 设置）
├── package.json           # 依赖声明（用于 builtAgainst 与类型提示）
├── tsconfig.json
└── src/
    ├── index.ts           # default export：继承 Plugin 的类
    └── styles.css         # 可选，会被打包为 styles.css
```

插件 id 采用 Java 包式命名：3–8 段、每段小写字母开头、段内仅 `[a-z0-9-]`、总长 8–96。
`app` 与 `markdown-editor` 为保留字，不能作为 id。

## 依赖：两个 SDK 包不要混用

这是本仓最容易踩的坑。两个包名字只差一个字母，职责完全不同：

| 包 | 位置 | 谁用 | 内容 |
|---|---|---|---|
| **`@textox/plugin-sdk`** | `vendor/plugin-sdk`（git submodule，v0.2.0） | **外部插件作者** | `Plugin` 基类、`PluginManifest`、`PluginApp` / `PluginEditorApi`、`SettingsField` / `SettingsSnapshot`、`SHARED_MODULES` |
| `@texto/plugin-sdk` | `packages/plugin-sdk`（workspace 包） | **宿主内部**（`src/` 与 `official-plugins/*`） | 编辑器/应用契约聚合：`MARKDOWN_EDITOR_*` / `APP_*` 扩展点常量、`defineInsertExtension`、`PluginHost`、`declareExtensionPoint` |

- 你的插件只依赖 `@textox/plugin-sdk`（+ 宿主共享的 `prosemirror-*`）。
- **不要**依赖 `@texto/plugin-sdk`：它不是为第三方发布的，且会把你绑到宿主的内部扩展点模型上。
  宿主内部的那套包在 P1 里已把 `packages/app-api`、`packages/markdown-editor-api` 合并进来
  （旧包只做 re-export，P3 删除），与作者契约无关。
- 编辑器贡献的**形状**由 `@textox/plugin-sdk` 0.3.0 起自带：`@textox/plugin-sdk/editor`
  （`SyntaxFeature`、`EditorExtension`、`InsertCommandMeta`、`FormatToolbarItemMeta`、
  `EditorContextMenuItemMeta`、`SelectionActionMeta`、`IconSpec` 等）与
  `@textox/plugin-sdk/markdown`（语法引擎：`markExtRanges`、`pairMarks`、`markConsumed`、
  `wholeTokenSpan`、`renderFormulaToSVG`、`InlineSpan`、`InlineDeriveContext` 等）。
  根导出同时包含两者，`app.editor.register*` 的入参已是强类型，不需要自己声明本地类型。

## `plugin.config.ts`

```ts
export default {
  id: 'com.example.my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  minAppVersion: '2.3.8',
  description: '可选',
  author: { name: 'Acme', id: 'acme' },
  category: 'editor',
  icon: 'sparkles', // lucide 名称；有官方 Logo 时改成 icon.svg / icon.png，见 docs/plugin-icon-spec.md
  defaultEnabled: false,
  isDesktopOnly: false,
};
```

构建时会用 `validateManifest` 校验；非法 id / 缺字段会直接构建失败并给出原因
（例如 `invalid plugin config: invalid-id (too-few-segments)`）。

> 字段语义提醒：`minAppVersion` 当前只做格式校验，**不参与**加载判定；`defaultEnabled`
> 只在**首次播种**时用于自动启用（升级重播不会重新启用，见「出厂预装」）。
> `builtAgainst` 由构建工具自动填：它从插件目录解析 `@textox/plugin-sdk`、`react` 等共享模块
> **实际安装**的版本（不会写入 `workspace:*` 这类无意义值）。

## `src/index.ts` 与生命周期

```ts
import { Plugin } from '@textox/plugin-sdk';

import './styles.css';

export default class MyPlugin extends Plugin {
  onload(): void {
    this.addMessages(
      {
        'zh-CN': { greeting: '你好', say: '打个招呼' },
        'en-US': { greeting: 'Hello', say: 'Say greeting' },
      },
      'zh-CN',
    );

    this.addCommand({
      id: 'com.example.my-plugin.say',
      name: 'Say greeting',
      callback: () => {
        this.app.toast.success(this.settings.get<string>('greeting') ?? 'Hello');
      },
    });
  }

  onunload(): void | Promise<void> {
    // 可选：自己的异步收尾（宿主会 await 后再 dispose）
  }
}
```

- 生命周期：宿主 `new Plugin(app, manifest)` → `await onload()`；停用时先 `await onunload()`，
  再 `dispose()`。`dispose()` **不会**调用 `onunload()`，两者职责不重叠。
- `onload` 有 10s 超时；抛错或超时都会回滚该插件已注册的贡献并标记为「加载失败」。
- 插件基类提供：`addCommand`、`registerEmbed`、`registerFileEditor`、`addMessages`、
  `settings` getter、`t(key, vars?)`，以及 `protected disposables: DisposableStore`。
- **所有注册都必须经 `disposables`（或基类方法的返回值）登记**：宿主在停用 / `onload` 失败回滚时
  按 owner 清理；插件自己提前 `dispose()` 的项也必须幂等（`toDisposable` 已保证）。
  基类的 `dispose()` 会逆序释放整个 store；`onunload` 里的异步工作请 `await` 完再返回。
- 命令 id 建议以插件 id 为前缀，面板据此把命令归到插件行内。

## 设置：声明在 `plugin.config.ts` 的 `settings`

设置字段声明写在 **`plugin.config.ts` 的 `settings`**，由构建工具写进 `manifest.json` 的
`settings`。宿主只从清单读字段（0.2.0 起**不再读插件类的静态字段**）。

```ts
export default {
  id: 'app.textox.mkdext',
  name: 'Markdown Extensions',
  version: '1.0.0',
  minAppVersion: '2.4.0',
  author: { name: 'Textox' },
  settings: [
    {
      key: 'frontMatter.viewMode',
      type: 'select',
      labelKey: 'frontMatter.viewMode',
      default: 'panel',
      group: 'front-matter',
      groupLabelKey: 'group.frontMatter',
      apply: 'immediate',
      options: [
        { value: 'panel', labelKey: 'frontMatter.viewMode.panel' },
        { value: 'source', labelKey: 'frontMatter.viewMode.source' },
      ],
    },
    {
      key: 'inline.underline',
      type: 'boolean',
      labelKey: 'features.underline',
      default: true,
      group: 'inline',
      groupLabelKey: 'group.inline',
      apply: 'restart',
    },
  ],
};
```

字段形状（与宿主 `SettingsField` 一致）：

| `type` | 额外字段 | `default` 类型 |
|---|---|---|
| `text` / `password` | `placeholderKey?` | `string` |
| `number` | `min?` / `max?` / `step?` | `number` |
| `boolean` | — | `boolean` |
| `select` | `options: { value, labelKey }[]` | `string` |
| `color` | `presets?: { value, labelKey? }[]` | `string`（`#rgb` / `#rrggbb`） |
| `modelProfile` | — | `string`（agent profile id，空串 = 未选择） |
| `action` | `command: '<命令 id>'`（点击即执行本插件注册的同名命令，不落盘） | — |

所有承载值的字段都支持：`group`（分组键，同组渲染在一起）、`groupLabelKey`（分组标题 i18n key）、
`visibleWhen: { key, equals }`（依赖项在**整份字段集**里求值，可跨分组）、
`apply: 'immediate' | 'restart'`（生效策略，缺省 `immediate`）。

`labelKey` / `placeholderKey` / `groupLabelKey` 都经 `plugins` 命名空间解析成
`<插件 id>.<key>`，文案由插件 `addMessages` 提供（语言码用 `en-US` / `zh-CN` 这种形态，
写 `en` 不会被识别）。

存储与语义：

- 值存在插件目录的 `data.json` 的 `settings` 键（与 `plugin` 命名空间并列）。
- 宿主读取时用**字段默认值回填**，得到「生效配置」；`settings.all()` / `onDidChange` 给的都是
  回填后的快照，但默认值不会主动写回磁盘（只在你改过某项后随整份设置落盘）。
- **未声明的键原样保留**：版本回退 / 前向兼容时不丢配置，不要手动清空 `settings`。
- 面板写入会按字段校验（`coerceSettingsValue`），非法值直接拒绝并保留原值，同时提示
  「设置值无效，已保留原值」：
  - `color` 只接受 `#rgb` / `#rrggbb`（大小写不限），落盘归一化为小写 `#rrggbb`；
  - `number` 必须是有限数，且受 `min` / `max` 约束；
  - `text` / `password` / `modelProfile` 最长 8192 个字符（UTF-16 code unit）；
  - `select` 的值必须在 `options` 内；`boolean` 必须是真正的布尔值。
  - 清单里 `key` 缺失或 `type` 未知的字段会被**丢弃并告警**（不会让默认值回填抛错）。
- 插件自己调用 `settings.set(key, value)` 时宿主不做字段校验（校验只发生在设置面板写入路径），
  请自行保证类型；写入失败会回滚内存值并 reject。
- 设置面板与编辑器是两个 WebView：面板写盘后 Rust 广播 `plugin:data-changed`，插件实例经
  `settings.onDidChange` 收到新快照（同一窗口内 `set()` 也会通知一次）。
- 生效策略 `apply`：
  - `immediate`（缺省）：`settings.set()` / 面板写入后立即更新运行期配置并通知 `onDidChange`。
  - `restart`：写入**立即落盘**，但运行期内存值保持不变、不触发 `onDidChange`；新值在
    **下次启动**时生效（宿主启动用磁盘值初始化）。跨窗口热更新同样不会用磁盘上的新值覆盖
    运行中的值。设置面板会在该字段旁标注「重启后生效」。
  - 插件若强依赖 `restart` 语义，应在 `onload` 里读一次该键，运行期不把它纳入订阅。

`static settingsFields` 是 0.1.x 的遗留写法（已废弃，宿主不再从它推默认值），仅为老插件保留
一个版本，后续会移除；新插件一律写 `settings`。

## 宿主能力（`this.app` / `PluginApp`）

- `version` / `edition`：宿主版本与版本类型（`full` / `lite`）。
- `register(kind, id, value)`：登记贡献（v1 只有 `'command'`），返回 `Disposable`；
  一般用 `addCommand` 更方便。
- `workspace`：`getActiveFilePath()` / `getDocumentDir()` / `openFile(path)` /
  `registerFileEditor(options)`（新增一种文件类型的编辑器）。
- `documents.createNewDocument({ content, extension? })`：以给定内容新建临时（未保存）文档并打开。
- `editor`：见下一节。
- `settings`：`get<T>(key)` / `set(key, value)` / `all()`（只读快照，含默认值回填）/
  `onDidChange(listener)`（返回 `Disposable`）。
- `exporters` / `imageUploader` / `agent`：导出器、图片上传器与宿主 Agent 能力，见
  「[导出 / 图片上传 / Agent](#导出--图片上传--agent)」。
- `i18n.t(key, vars?)`：自动加插件命名空间前缀（`plugins` ns）；
  `i18n.addMessages(locales, defaultLocale?)` 注文案；`i18n.language()` 读当前界面语言
  （宿主语言码，如 `zh-CN`；i18next 未就绪时为 `en`）。
- `theme`：代码块高亮配色与当前外观，见「[主题 / 对话框](#主题--对话框)」。
- `dialogs`：原生选文件 / 二次确认，见同一节。
- `toast.info(message)` / `toast.success(message)` / `toast.error(message)`。
- `log.info/warn/error(...)`：输出带 `[plugin:<id>]` 前缀。

## 编辑器能力（`app.editor`）

七个注册点，全部返回 `Disposable`。**注册与注销都会请求编辑器重建语法管线**
（`requestReload()`）：注销后能力立即消失，注册后立即可用；编辑器按最新贡献重建并保留光标与滚动
位置（逐字插入进行中会排队到该段结束后再重建）。

| 方法 | 用途 | 注销语义 |
|---|---|---|
| `registerSyntaxFeature(feature)` | 语法特性协调器：源保真（`sourcePreserve`）、verbatim 顶层节点（`sourceVerbatim`）、markdown-it 插件等 | 释放后该特性不再参与解析/序列化，文档回退到核心默认行为 |
| `registerExtension(extension)` | ProseMirror 扩展：`plugins`、`nodeViews`、`insert`、代码块视图、`preview` / `embed` | 释放后编辑器重建时不再装配该扩展，已渲染节点回退内置视图 |
| `registerInsertCommand(command)` | 插入块命令（工具栏 / 斜杠菜单 / 快捷键 / 原生菜单共用的裸 slug） | 释放后对应插入入口消失；贡献 id 内部带 owner，跨插件同名 slug 不会互撞 |
| `registerContextMenuItem(item)` | 正文右键菜单项（`requires: ['selection' | 'block']` + `when` / `enabled` / `run`） | 释放后该项不再列出；单项抛错只隔离该项 |
| `registerSelectionAction(action)` | 悬浮选区工具栏动作（释义、翻译等） | 释放后按钮不再出现；`when()` 每次显示时求值 |
| `registerFormatToolbarItem(item)` | 行内格式按钮（悬浮栏 / 顶部工具栏 + 激活态） | 释放后按钮与激活态一并消失 |
| `registerSyntaxHighlight(contribution)` | 代码块语言高亮贡献（语言 + 语法加载器） | 释放后该语言不再高亮，代码块本身不受影响 |

另有 `insertText(text)` / `canEdit()` / `parseEmbedRef(text)` / `registerEmbed(options)`。

贡献形状（`EditorExtension`、`InsertCommandMeta`、`EditorContextMenuItemMeta`、
`SelectionActionMeta`、`FormatToolbarItemMeta`、`SyntaxHighlightContribution`）与读取入口见
`docs/plugin-development.md`；插入命令的 `id` 必须是**裸 slug**（与快捷键 / 原生菜单 action id 一致）。

## 导出 / 图片上传 / Agent

0.4.0 起 `PluginApp` 多出三个能力面，均只依赖 `@textox/plugin-sdk`，实现由宿主桥接到现有注册表。

### 导出（`app.exporters.register`）

```ts
const sub = app.exporters.register({
  id: 'html',                 // 全局唯一；建议裸 slug（与其它插件同名会互撞，后者覆盖）
  labelKey: 'export.html',    // 写裸 key：宿主补 `<插件 id>.` 前缀
  extension: 'html',          // 不含点
  kind: 'text',               // 可选，缺省 text；二进制用 'binary'
  menuAction: 'export_html',  // 可选：原生「导出」菜单项 id，声明后才会进子菜单
  order: 10,                  // 可选：子菜单排序（升序），缺省 0
  async run({ currentFile, documentDir }) {
    return { data: '<h1>hi</h1>', suggestedName: 'note.html' };
  },
});

sub.dispose(); // 注销：导出器注册表与原生菜单同时更新
```

- `run` 返回 `{ data, suggestedName }`；`data` 可以是 `string`，也可以是 `Uint8Array`（`kind: 'binary'`）。
- `currentFile` / `documentDir` 在未保存的新文档上为 `null`，导出器需自行兜底文件名。
- 注册 / 注销都会同步原生「导出」子菜单；lite（free）版没有导出菜单，但导出器仍会被注册，
  命令面板 / 工具栏等程序入口可用。
- 同一 `id` 后注册者覆盖先注册者；释放 `Disposable` 后按 `id` 移除。

### 图片上传（`app.imageUploader.register`）

```ts
app.imageUploader.register({
  id: 'uploader', // 可选，诊断用；缺省用插件 id
  async upload(app, filePath) {
    // app 是你自己的 PluginApp：可读写本插件 settings、发 toast
    return 'https://cdn.example.com/x.png'; // 插入 Markdown 的 src
  },
});
```

- 返回值直接写进 `![alt](src)`：可以是远端 URL，也可以是文档相对路径。
- 宿主只在**启用插件**里解析上传器（后注册者优先）；没有可用上传器时走「仅本地保存」。
- 停用 / 释放后宿主回退到本地保存；桥接层按插件 id 取运行中的 `PluginApp`，
  插件已停用时上传会 reject（不会静默失败）。
- 骨架侧的粘贴图片与工具栏「插入图片」共用同一个入口。

### Agent（`app.agent`）

```ts
const profiles = app.agent.profiles.list();
if (profiles.length === 0 || !app.agent.available(profiles[0].id)) {
  app.toast.error(app.i18n.t('agent.notConfigured'));
  return;
}

const handle = app.agent.present(
  { system: '你是编辑助手', messages: [{ role: 'user', content: text }] },
  { profileId: profiles[0].id, anchor, title: '释义', sourceText: text },
);
// handle.abort() 中止本轮
```

- `available(profileId)`：同步布尔值；空串、未知 id、模型配置未启用/不完整一律 `false`，不抛错。
- `run(request, handlers, { profileId })`：只经 `handlers.onEvent` 流式回调，**不产生任何 UI**。
- `present(request, { profileId, anchor, ... })`：写入共享会话并按宿主配置显示悬浮块 / 侧栏
  （会中止上一条 `present`）。
- `profiles.list()`：只读摘要（不含 Key / baseUrl）；`tools.list()` / `tools.call(name, args)`：
  工具注册表（v1 只能手动调用，宿主不把工具注册给模型）。
- **必须显式传 `profileId`**：三个入口都不提供默认配置回退；先用 `profiles.list()` 让用户选，
  再用 `available()` 判定。

### 设置里的 `action` 字段

```ts
// plugin.config.ts
settings: [
  { key: 'testConnection', type: 'action', labelKey: 'testConnection', command: 'testConnection' },
]
```

```ts
// src/index.ts —— 插件自己注册同名命令；清单只引用 id
this.addCommand({
  id: 'testConnection', // 必须与清单里的 `command` 完全一致
  name: 'Test connection',
  callback: async () => {
    const ok = await ping();
    this.app.toast[ok ? 'success' : 'error'](this.t('ping'));
  },
});
```

- 点击即分派**本插件**注册的同名命令（`field.command`），找不到命令时面板提示「未启用 / 未注册」，
  不会跑到别的插件的命令上。
- `manifest.json` 是 JSON，函数无法随清单落盘，所以字段只带命令 id；`run` 函数形态只在
  旧体系（`contributes['app:settingsSection']` 的富字段）里存在，运行时的清单里会被丢弃并告警。
- 不承载存储值：没有 `default`、不参与默认值回填、不出现在 `settings.all().values`，也不需要 `apply`。

## 主题 / 对话框

两个能力在 0.4.0 起补进 `PluginApp`，语义与旧体系 `PluginHost['theme']` / `['dialogs']` 一致，
迁移时可直接替换。

### 代码块高亮配色（`app.theme`）

```ts
interface PluginThemeApi {
  readonly appearance: 'light' | 'dark'; // 已解析的实际外观（'system' 已按系统偏好展开）
  applyCodeHighlightTheme(light: string, dark: string): void; // 亮/暗各一个 id，空串 = 跟随默认
  subscribe(listener: (appearance: 'light' | 'dark') => void): Disposable;
  codeHighlightThemeDefaults(): Promise<{ light?: string; dark?: string }>; // 仅迁移用
}
```

```ts
async onload() {
  // 一次性迁移：自己配置缺失时用宿主配色主题的历史值种子化
  const legacy = await this.app.theme.codeHighlightThemeDefaults();
  const apply = () =>
    this.app.theme.applyCodeHighlightTheme(
      this.settings.get<string>('light') || legacy.light || DEFAULT_LIGHT,
      this.settings.get<string>('dark') || legacy.dark || DEFAULT_DARK,
    );

  apply();
  this.disposables.add(this.app.theme.subscribe(apply)); // 用户切亮/暗时重新应用
  this.disposables.add(this.settings.onDidChange(apply));
}
```

- `appearance` 是**结果**而不是设置值：外观设为「跟随系统」时，它随系统偏好变化；系统偏好变化也会
  触发 `subscribe`（宿主统一广播 `appearancechange`）。
- 主题 id 必须是宿主内置的高亮主题目录里的值，未知 id 被忽略（不会抛错）。
- 插件只管**代码块**配色；界面主题由用户设置，没有写入口。

### 原生对话框（`app.dialogs`）

```ts
const picked = await app.dialogs.pickFile({
  filters: [{ name: 'Images', extensions: ['png', 'jpg'] }],
});
if (!picked) return; // 用户取消（或无原生环境）

const ok = await app.dialogs.confirm({ title: 'Upload?', message: `上传 ${picked}？` });
```

- `pickFile(options?)` 返回绝对路径或 `null`；`confirm(options)` 返回 `boolean`。
- **不抛错**：浏览器预览等无原生环境返回 `null` / `false`，面板调用失败（如权限被拒）同样按「取消」处理。
- 只承载「选文件 / 二次确认」这类原生交互。任意表单请用设置字段声明，或在插件自己的视图里渲染。

## 读取自己的配置（`EditorContext.config`）

编辑器扩展的 `create(ctx)` 里，`ctx.config` 是**本插件**的实时配置读取器：

```ts
create(ctx) {
  const mode = ctx.config.get<string>('mode') ?? 'compact';
  const all = ctx.config.all<Record<string, unknown>>();
  // ...
}
```

- 数据源三层回退：**运行时插件设置**（`app.settings`，含 `manifest.settings` 默认值回填）→
  旧体系配置快照（`contributes['app:settingsSection']` 的 `settingsApply: 'immediate'` 时实时更新）→ 空读取器。
- 读取器每次访问都取当前值：插件改设置后，编辑器重建时创建的新扩展立刻看到新值。
- 编辑器不允许 import 骨架的插件运行时（`check:editor-boundary`），这条链只能由宿主经
  `EditorHost.readPluginConfig` 注入——插件侧只是读它，不需要做任何装配。
- 想在设置变更时**不重建编辑器**地更新行为，用 `app.settings.onDidChange(...)`（或你认为合适的
  `requestReload()`），不要依赖 `ctx.config` 持有旧引用。

## 共享模块（不要内联）

宿主通过 import map 提供下列裸模块，**构建时必须保持 external**（构建工具用
`@textox/plugin-sdk` 的 `SHARED_MODULES` 自动处理）：

```
react, react/jsx-runtime, react-dom, react-dom/client,
prosemirror-model, prosemirror-state, prosemirror-view, prosemirror-transform,
i18next, react-i18next, @textox/plugin-sdk, @texto/export-runtime,
@tauri-apps/api/core, @tauri-apps/api/event
```

只做**精确匹配**：`react-dom/server` 之类子路径不会被外部化（import map 没有子路径键），
它们会被打进你的包——需要时请自行承担体积。

如果打包产物里出现 React 内部字符串，构建工具会告警「react should stay external」，
通常意味着你把 `@textox/plugin-sdk` 或 `react` 的副本内联了。内联 SDK 还会让运行时认不出
插件类：`class does not extend the host Plugin (did the bundle inline @textox/plugin-sdk?)`。

## 构建与打包

```sh
bun run plugin build <pluginDir>   # -> <pluginDir>/dist/{main.js, manifest.json, styles.css}
bun run plugin pack  <pluginDir>   # -> <pluginDir>/dist/<id>-<version>.zip
bun run plugin dev   <pluginDir>   # 构建一次（不做 watch，改完重跑）
```

限制：

- **单文件 bundle**：`inlineDynamicImports` 会把动态 `import()` 内联；若产物出现额外 `.js`/`.mjs`
  chunk，构建会失败（运行时用 blob URL 载入 `main.js`，相对 chunk 取不到）。
- CSS 固定输出为 `styles.css`；JS 固定输出为 `main.js`。
- 产物里不得残留无保护的 `process.env.<name>`（WebView 没有 `process`），构建会在打包后拦截。

## 用 CLI 安装与验证

不用 GUI 也能端到端验证插件包（`src-tauri/src/bin/plugin-cli.rs`，复用运行时的纯函数）：

```sh
# 构建并打包
bun run plugin pack plugin-samples/hello-world

# 安装到临时数据目录（不要写用户的 Application Support）
cargo run --manifest-path src-tauri/Cargo.toml --bin plugin-cli -- \
  --data-dir /tmp/plugin-cli-demo install \
  plugin-samples/hello-world/dist/app.textox.hello-world-1.0.0.zip

bun run plugin:cli -- --data-dir /tmp/plugin-cli-demo list        # id / version / state / error
bun run plugin:cli -- --data-dir /tmp/plugin-cli-demo enable app.textox.hello-world
bun run plugin:cli -- --data-dir /tmp/plugin-cli-demo disable app.textox.hello-world
bun run plugin:cli -- --data-dir /tmp/plugin-cli-demo uninstall app.textox.hello-world
bun run plugin:cli -- --data-dir /tmp/plugin-cli-demo safe-mode off
```

约定：

- `--data-dir` 覆盖数据根，默认 `<appData>/com.texto.markdown`；插件目录是 `<data-dir>/plugins`，
  状态文件是 `<data-dir>/plugins/plugins.json`。Lite 版的 bundle identifier 是
  `com.texto.markdown.lite`，默认值对 Lite 不适用，请用 `--data-dir` 显式指定。
- 成功退出码 0；错误打到 stderr、退出码 1（不 panic）。
- `list` 输出 `id\tversion\tstate\terror` 表头，`state` 为 `enabled` / `disabled`，错误列可能为空。
- `install` 与 GUI 安装走同一套校验（顶层目录唯一、id 与目录一致、拒绝符号链接与越界路径、
  上限 96 MiB）。

## 应用内导入

1. 打开 设置 → 插件（面板标题「插件运行时（新）」）。
2. 点「导入插件」，选择构建好的 `.zip`（`bun run plugin pack` 的产物）。
3. 导入只解压到 `<appData>/plugins/<id>/`，**不会自动启用**；需要手动打开该行开关。
   同时该 id 的来源被记为 `user`（面板显示「本地」），并清掉同名卸载墓碑。
4. 安全模式默认开启：第三方插件（非 `app.textox.*`）在安全模式下**只能导入、不能启用**；
   要启用需先关闭「安全模式（仅允许内置插件）」。已经启用过的第三方插件仍可在面板里关闭。
5. **设置窗口与编辑器窗口是两个 WebView**：启用/导入只影响设置窗口的内存态，
   编辑器窗口需要**重启 Textox** 后才会加载该插件。
6. 每行右侧「卸载」会删除插件目录与其 `data.json`（不可恢复，会二次确认）。
7. 每行的「设置」展开渲染 `manifest.settings` 的字段（按 `group` 分组），每个字段可单独恢复默认。

## 出厂预装、来源与卸载

**唯一加载根**：`<appData>/plugins`。应用资源目录里的 `plugins/`（打包来源
`src-tauri/resources/plugins`）**只做首次播种的源**，运行时从不直接从资源目录加载。

播种记录写在 `<appData>/plugins/plugins.json`：

```json
{
  "safe_mode": true,
  "enabled": ["app.textox.mkdext"],
  "seeded": {
    "app.textox.mkdext": { "version": "1.0.0", "origin": "seed" }
  },
  "uninstalled": []
}
```

`seed_from` 对资源目录里的每个 `<id>/`：

| 条件 | 行为 |
|---|---|
| `<appData>/plugins/<id>` 不存在，且 id 不在 `uninstalled` | 递归复制（跳过符号链接），记 `origin: seed` |
| 已有记录且 `origin: seed`、版本相同 | 跳过（幂等） |
| 已有记录且 `origin: seed`、资源版本不同 | 整目录换位覆盖（`.tmp` → `.bak` → 换入，失败可回滚），保留 `data.json`，更新版本 |
| 已有记录且 `origin: user` | **永不覆盖**（同 id 的用户版本优先） |
| id 在 `uninstalled` | 跳过（尊重卸载） |

- 首次播种且 `manifest.defaultEnabled === true` 时会自动加入 `enabled`；
  **升级重播不会重新启用**（用户可能手动关过）。
- 面板来源标签：`origin: seed` 显示「出厂」（来自应用资源目录播种），`origin: user`
  显示「本地」（用户在应用内导入）。
- 只有「出厂」来源的插件显示「恢复出厂」：清墓碑 + 播种记录后立即重播一次。
- 卸载出厂插件（`origin: seed`）会留下 `uninstalled` 墓碑，下次启动不会重新播种；
  用户本地导入的插件（`origin: user`）**不留墓碑**，所以卸载后若资源目录里还有同 id
  的出厂版本，**下次启动会重新播种并回到「出厂」来源**。要彻底移除某个出厂 id，
  需要在应用资源里去掉它。
- 安装失败 / 换位失败会回滚状态文件，保证「返回错误 ⇒ 磁盘与之前一致」。

## 在独立插件仓库中开发

插件可以放在任意仓库（不必在 Textox monorepo 内）：

```sh
bun add -d @textox/plugin-build
# package.json
# "scripts": {
#   "build": "texto-plugin build .",
#   "pack": "texto-plugin pack ."
# }
bun run build   # -> dist/main.js + manifest.json + styles.css
bun run pack    # -> dist/<id>-<version>.zip
```

（CLI 首行是 `#!/usr/bin/env bun`，请用 Bun 执行。）

在 Textox 仓库内开发插件时，`plugin-sources.local.json`（已 gitignore）可以把本地插件目录
映射进构建产物：

```json
{
  "app.textox.mkdext": "../textoxmd/textox-plugin-mkdext"
}
```

- 值是**相对仓库根**的插件目录；`scripts/build/plugins.mjs` 会在该目录下依次找
  `dist/<id>/`、`dist/`、目录本身，取第一个含 `manifest.json` 的。
- 三个来源按 id 合并，后者覆盖前者：`plugins/*` → `vendor/plugins/*` → `plugin-sources.local.json`
  （本地映射优先级最高）。
- `bun run dev` / `bun run app:dev` 会先通过 `scripts/build/frontend.mjs` 调
  `buildPluginResources()`，把三源汇总到 `src-tauri/resources/plugins/`；资源缺失只告警，不阻断。

## 安装与产物

`.zip` 即插件包，安装后落到 `<appData>/plugins/<插件 id>/`：

```
<appData>/plugins/com.example.my-plugin/
├── main.js
├── manifest.json
├── styles.css
└── data.json          # 运行时生成，升级会保留
```

zip 要求：**恰好一个顶层目录**，目录名必须等于插件 id；`manifest.json` 的 `id` 必须与目录一致；
必须包含 `main.js`。符号链接条目、绝对路径、`..` 一律拒绝。

## `data.json`

```json
{
  "settings": { "greeting": "Hello" },
  "plugin": {}
}
```

- `settings`：声明式设置字段的值（缺省值由宿主回填到生效配置）。
- `plugin`：插件自己的任意状态。
- 写入是「临时文件 + fsync + rename」的原子写；若文件损坏会被改名为 `data.json.corrupt`
  并回退默认值。
- **升级时**（zip 安装或出厂重播）：新包若不含 `data.json`，安装流程会把旧目录的 `data.json`
  搬过来。

## 样式作用域约定

插件自带 UI 的容器必须带 `data-plugin="<插件 id>"`：

```html
<div data-plugin="com.example.my-plugin">…</div>
```

```css
[data-plugin='com.example.my-plugin'] .my-panel { display: grid; gap: 12px; }
```

宿主注入 `styles.css` 时会用同一个 `data-plugin` 标记 `<style>` 元素，插件样式因此不会污染宿主。
注意 CSS **不支持** `//` 行注释，只能用 `/* … */`。

## 安全模式

宿主默认开启安全模式：只自动加载 `app.textox.*`（随应用分发的内置插件），第三方插件需要用户在
「设置 → 插件」面板里手动启用；安全模式开启时第三方开关置灰，`enablePlugin` 会直接拒绝并抛出
`safe mode is enabled: only built-in plugins can be enabled`。

## 排错

- **改了 `vendor/plugin-sdk` 后必须重建 `dist`**：`cd vendor/plugin-sdk && bun run build`
  （`tsc -p tsconfig.build.json`）。宿主与单测读的是 `node_modules/@textox/plugin-sdk` 这个**拷贝**，
  它初始与 `vendor/plugin-sdk/dist` 硬链接；重建后如果链接脱钩（文件被替换 / 重新安装），
  需要 `bun install` 刷新，否则会读到旧产物导致**假绿**。
- 同理，`packages/plugin-sdk`、`packages/plugin-build` 的改动要先构建（或被 workspace 直接引用）
  才会影响使用方。
- 插件加载失败会显示在面板的错误列：模块导入失败、默认导出不是 `Plugin` 子类、
  `onload` 抛错或超时（10s）分别有对应提示。
