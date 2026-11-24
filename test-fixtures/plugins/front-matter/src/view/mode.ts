import {
  getPluginConfigSnapshot,
  subscribePluginConfig,
} from "@texto/plugin-sdk";

import type { ViewMode } from "./types";

const PLUGIN_ID = "front-matter";
export const VIEW_MODE_KEY = "view";
const DEFAULT: ViewMode = "panel";

/** 配置写入句柄（由 activate 注入；测试可注入 mock）。 */
interface ConfigWriter {
  set(key: string, value: unknown): Promise<void> | void;
}
let writer: ConfigWriter | null = null;

/** 由 activate（或测试）注入写配置能力。 */
export function setConfigWriter(next: ConfigWriter | null): void {
  writer = next;
}

/** 读当前视图模式。 */
export function readViewMode(): ViewMode {
  const raw = getPluginConfigSnapshot(PLUGIN_ID)[VIEW_MODE_KEY];
  return raw === "source" ? "source" : DEFAULT;
}

/** 订阅视图模式变更；返回退订函数。 */
export function subscribeViewMode(cb: (mode: ViewMode) => void): () => void {
  return subscribePluginConfig(PLUGIN_ID, (config) => {
    cb(config[VIEW_MODE_KEY] === "source" ? "source" : DEFAULT);
  });
}

/** 写视图模式（无 writer 时 no-op）。 */
export async function writeViewMode(mode: ViewMode): Promise<void> {
  await writer?.set(VIEW_MODE_KEY, mode);
}
