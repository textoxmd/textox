// 插件内 i18n：编辑器 NodeView 拿不到 PluginHost，故由 activate 注入翻译器；
// 未注入（如单测）时回退到英文 fallback。
type Translator = (key: string) => string | undefined;

let translator: Translator | null = null;

/** 由 activate 注入宿主翻译器（host.i18n.t）；测试可注入 mock 或置空。 */
export function setTranslator(next: Translator | null): void {
  translator = next;
}

const PLUGIN_ID = "front-matter";

/** 取 `front-matter.<key>` 的翻译；无翻译器或缺失时用 fallback。 */
export function t(key: string, fallback: string): string {
  if (!translator) return fallback;
  const value = translator(key);
  if (!value || value === `${PLUGIN_ID}.${key}`) return fallback;
  return value;
}
