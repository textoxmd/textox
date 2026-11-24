// 编辑器测试环境的 i18n 初始化。
//
// 编辑器生产代码只使用 `i18next` 全局单例，不再 import 骨架的 i18n 模块；
// 因此测试运行时需要显式加载 app 的 i18n 配置。否则未初始化的 `i18next.t()`
// 返回 undefined（例如行内工具栏的按钮标题），依赖文案的测试会失败。
//
// 本文件位于 tests/ 下，属于允许依赖 `@/` 的测试夹具（见 check-editor-boundary）。
import i18next from "i18next";

import "@/i18n";

const READY_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/**
 * 等待 app i18n 完成初始化，且**当前语言**的翻译资源就绪。
 * app i18n 内的资源加载是异步的，测试执行前必须就绪。
 * 超时即抛错（fail-closed），避免测试挂起或静默使用缺失文案。
 */
export async function ensureI18nReady(): Promise<void> {
  if (!i18next.isInitialized) {
    await withTimeout(
      new Promise<void>((resolve) => {
        i18next.on("initialized", () => resolve());
      }),
      READY_TIMEOUT_MS,
      "[i18n-setup] i18next 未在超时内完成初始化",
    );
  }

  const lng = i18next.language || "zh-CN";
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (i18next.hasResourceBundle(lng, "translation")) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`[i18n-setup] 翻译资源未在超时内就绪：${lng}`);
}
