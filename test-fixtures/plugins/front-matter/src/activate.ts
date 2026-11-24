import type { PluginHost } from "@texto/plugin-sdk";

import { setTranslator } from "./view/i18n";
import { setConfigWriter } from "./view/mode";

/** 启动期捕获宿主能力（幂等）：视图模式写配置 + 面板文案翻译。 */
export function activate(host: PluginHost): void {
  setConfigWriter({ set: (key, value) => host.config.set(key, value) });
  setTranslator((key) => host.i18n.t(key));
}
