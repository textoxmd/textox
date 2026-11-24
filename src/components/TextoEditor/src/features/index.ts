// Single registry of all Typora-syntax features. Each core module reads
// exactly from here — adding a feature means one import + one array entry.

import { chainCommands } from "prosemirror-commands";
import type { Command, Plugin } from "prosemirror-state";
import type { Schema } from "prosemirror-model";

import { getContributions } from "@texto/plugin-sdk";
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";

import type { FeatureSpec, InlineFeatureSpec, InlineDecorationWidgetBuilder, InlineDeriveFeature, TokenAdvance } from "./_types.ts";
import { autoLink } from "./auto-link.ts";
import { autolink } from "./autolink.ts";
import { blockquote } from "./blockquote.ts";
import { code } from "./code.ts";
import { emphasis } from "./emphasis.ts";
import { escape } from "./escape.ts";
import { fencedCode } from "./fenced-code.ts";
import { heading } from "./heading.ts";
import { hr } from "./hr.ts";
import { image } from "./image.ts";
import { link } from "./link.ts";
import { imageRef } from "./image-ref.ts";
import { refDef } from "./ref-def.ts";
import { list } from "./list.ts";
import { strike } from "./strike.ts";
import { task } from "./task.ts";
import { slashMenu } from "./slash-menu/index.ts";
import { inlineFormatToolbar } from "./inline-format-toolbar/index.ts";
import { typewriter } from "./typewriter/index.ts";
import { pasteImage } from "./paste-image.ts";
// Built-in feature list, in registration order. Plugin-contributed features
// (via `markdown-editor:syntaxFeature`) are merged on top lazily — see
// allFeatures(). Reordering entries here changes collection order.
const BUILTIN_FEATURES: FeatureSpec[] = [
  escape,
  emphasis,
  code,
  strike,
  pasteImage,
  autolink,
  autoLink,
  link,
  image,
  imageRef,
  hr,
  blockquote,
  heading,
  // task before list so its Enter command runs first (chainCommands order).
  task,
  list,
  fencedCode,
  refDef,
  slashMenu,
  inlineFormatToolbar,
  typewriter,
];

// 惰性合并：内置 + 插件贡献，首次调用时计算并缓存。插件在启动时登记贡献，
// 因此缓存只需算一次（切换插件需重启生效）。
let _features: FeatureSpec[] | undefined;

function mergeFeatures(builtins: FeatureSpec[], contributed: FeatureSpec[]): FeatureSpec[] {
  const out = [...builtins];
  const sorted = [...contributed].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const feature of sorted) {
    const existing = out.findIndex((f) => f.name === feature.name);
    if (existing >= 0) {
      // 同名 → 原地覆盖，保持位置（splice + push 会移到末尾，违反契约注释）。
      if (import.meta.env.DEV) {
        console.warn(`[features] "${feature.name}" 被后注册的贡献覆盖（保持原位置）`);
      }
      out[existing] = feature;
    } else {
      out.push(feature);
    }
  }
  return out;
}

/** 全部功能 = 内置 + 插件贡献（惰性合并并缓存）。 */
export function allFeatures(): FeatureSpec[] {
  return (_features ??= mergeFeatures(BUILTIN_FEATURES, getContributions(MARKDOWN_EDITOR_SYNTAX_FEATURE)));
}

/** 仅供测试：清空惰性缓存。 */
export function resetFeaturesForTests(): void {
  _features = undefined;
  _inlineFeaturesNamed = undefined;
  _inlineFeatures = undefined;
  _deriveFeatures = undefined;
  _tokenAdvances = undefined;
}

// 收集结果的数组形态也会被热路径反复读取（序列化按块、normalize 按事务），
// 每次 flatMap 新建数组在大文档上会产生可观的瞬时分配，因此与 _features
// 同生命周期缓存；贡献在启动后不变（切换插件需重启生效）。
let _inlineFeaturesNamed: Array<NamedFeatureItem<InlineFeatureSpec>> | undefined;
let _inlineFeatures: InlineFeatureSpec[] | undefined;
let _deriveFeatures: InlineDeriveFeature[] | undefined;
let _tokenAdvances: TokenAdvance[] | undefined;

// 逐个功能隔离收集期错误：单个功能的钩子抛错时只记录并跳过它，不阻断
// 编辑器创建（与 collectEditorExtensions 的隔离策略一致）。仅对「收集时
// 会执行插件代码」的收集点使用（plugins / keymap / inputRules）。
function safe<T>(featureName: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    if (import.meta.env.DEV) console.error(`[features] ${featureName} threw:`, err);
    return undefined;
  }
}

// 执行期隔离：`safe()` 只守护「收集期」（调用 f.plugins() / f.inputRules() 等），
// 收集到的产物仍会在后续解析/序列化时执行。执行期抛错会中断整篇文档操作，
// 因此这些调用点经 runFeatureStep 只跳过出错的功能，DEV 下记录来源。
export function runFeatureStep<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    if (import.meta.env.DEV) console.error(`[features] ${label} threw:`, err);
    return undefined;
  }
}

// 带来源名的收集器：执行期调用点用它把出错项关联到具体功能，便于定位。
// 收集语义与下方同名（无 Named）收集器完全一致——后者在前者之上投影。
export type NamedFeatureItem<T> = { feature: string; item: T };

export function collectMdItPluginsNamed(): Array<NamedFeatureItem<NonNullable<FeatureSpec["mdItPlugins"]>[number]>> {
  return allFeatures().flatMap((f) =>
    (f.mdItPlugins ?? []).map((item) => ({ feature: f.name, item })),
  );
}

// Thin helpers that collect a named map from every feature. They are
// the only place the core modules touch the registry, so each seam stays
// declarative.

export function collectMarks(): NonNullable<FeatureSpec["marks"]> {
  return Object.assign({}, ...allFeatures().map((f) => f.marks ?? {}));
}
export function collectNodes(): NonNullable<FeatureSpec["nodes"]> {
  return Object.assign({}, ...allFeatures().map((f) => f.nodes ?? {}));
}
export function collectMdItPlugins(): NonNullable<FeatureSpec["mdItPlugins"]> {
  return collectMdItPluginsNamed().map((x) => x.item);
}
export function collectParserTokens(): NonNullable<FeatureSpec["parserTokens"]> {
  return Object.assign({}, ...allFeatures().map((f) => f.parserTokens ?? {}));
}
export function collectMarkDelims(): NonNullable<FeatureSpec["markDelims"]> {
  return Object.assign({}, ...allFeatures().map((f) => f.markDelims ?? {}));
}
export function collectInputRules(
  schema: Parameters<NonNullable<FeatureSpec["inputRules"]>>[0],
) {
  return allFeatures().flatMap((f) => safe(f.name, () => f.inputRules?.(schema) ?? []) ?? []);
}
export function collectBlockHandlers(): NonNullable<FeatureSpec["blockHandlers"]> {
  return Object.assign({}, ...allFeatures().map((f) => f.blockHandlers ?? {}));
}
export function collectInlineNodeHandlers(): NonNullable<FeatureSpec["inlineNodeHandlers"]> {
  return Object.assign({}, ...allFeatures().map((f) => f.inlineNodeHandlers ?? {}));
}
export function collectParserPostProcessorsNamed(): Array<NamedFeatureItem<NonNullable<FeatureSpec["parserPostProcess"]>>> {
  return allFeatures().flatMap((f) =>
    f.parserPostProcess ? [{ feature: f.name, item: f.parserPostProcess }] : [],
  );
}
export function collectParserPostProcessors(): Array<NonNullable<FeatureSpec["parserPostProcess"]>> {
  return collectParserPostProcessorsNamed().map((x) => x.item);
}
// When multiple features bind the SAME key (e.g. fenced-code and list both
// claim Enter), we chain their commands in allFeatures() order: each command
// gets to run its guard → action, and returning `false` falls through to the
// next. Without the chain, Object.assign would silently drop all but the
// last binding and whichever feature was registered last would win.
// Core baseKeymap is applied separately (and after) in editor.ts.

// Wraps a Command so it refuses to run when the editor is locked.
// view is always present when called from a keydown handler.
export function editableGuard(cmd: Command): Command {
  return (state, dispatch, view) => {
    if (view && view.editable === false) return false;
    return cmd(state, dispatch, view);
  };
}

export function collectKeymaps(schema: Schema): Record<string, Command> {
  const byKey = new Map<string, Command[]>();
  for (const f of allFeatures()) {
    const km = safe(f.name, () => f.keymap?.(schema));
    if (!km) continue;
    for (const [key, cmd] of Object.entries(km)) {
      const arr = byKey.get(key) ?? [];
      arr.push(cmd);
      byKey.set(key, arr);
    }
  }
  const out: Record<string, Command> = {};
  for (const [key, cmds] of byKey)
    out[key] = editableGuard(cmds.length === 1 ? cmds[0]! : chainCommands(...cmds));
  return out;
}
export function collectPlugins(schema: Schema): Plugin[] {
  return allFeatures().flatMap((f) => safe(f.name, () => f.plugins?.(schema) ?? []) ?? []);
}
// Inline features, in registration order. Consumed by inline-parse
// orchestration, normalize (mark sync), decorations (which marks use the
// inline path), and serializer (per-feature no-escape extRanges).
export function collectInlineFeaturesNamed(): Array<NamedFeatureItem<InlineFeatureSpec>> {
  return (_inlineFeaturesNamed ??= allFeatures().flatMap((f) =>
    f.inline ? [{ feature: f.name, item: f.inline }] : [],
  ));
}
export function collectInlineFeatures(): InlineFeatureSpec[] {
  return (_inlineFeatures ??= collectInlineFeaturesNamed().map((x) => x.item));
}

/** 声明了 v2 `derive` 的特性，按 `inline.order` 升序（同序保留注册序）。 */
export function collectDeriveFeatures(): InlineDeriveFeature[] {
  if (_deriveFeatures) return _deriveFeatures;
  const out: InlineDeriveFeature[] = [];
  for (const f of allFeatures()) {
    const inline = f.inline;
    if (inline?.derive) out.push({ name: f.name, inline });
  }
  return (_deriveFeatures = out.sort((a, b) => (a.inline.order ?? 0) - (b.inline.order ?? 0)));
}

/** 所有 v2 `tokenAdvance` 声明，按特性注册序（首个有效值生效）。 */
export function collectTokenAdvances(): TokenAdvance[] {
  if (_tokenAdvances) return _tokenAdvances;
  const out: TokenAdvance[] = [];
  for (const f of allFeatures()) {
    const advance = f.inline?.tokenAdvance;
    if (advance) out.push(advance);
  }
  return (_tokenAdvances = out);
}

/** 插件按 widget kind 注册的行内 widget 构建器（后注册覆盖）。 */
export function collectDecorationWidgets(): Record<string, InlineDecorationWidgetBuilder> {
  const out: Record<string, InlineDecorationWidgetBuilder> = {};
  for (const f of allFeatures()) {
    if (f.inline?.decorationWidgets) Object.assign(out, f.inline.decorationWidgets);
  }
  return out;
}

/** 声明抑制悬浮格式工具栏的内联 mark 名。 */
export function collectFormatToolbarSuppressedMarks(): string[] {
  return collectInlineFeatures()
    .filter((f) => f.suppressFormatToolbar)
    .flatMap((f) => f.markNames);
}
