export {};

// 测试环境全局 Tauri stub：避免模块导入期（如 i18n 的 event.listen）在
// happy-dom 环境触发 unhandled rejection，导致全量测试并行运行时的噪音失败。
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async () => undefined,
  convertFileSrc: () => "",
};
(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  registerListener: () => {},
  unregisterListener: () => {},
};
(window as unknown as Record<string, unknown>).__TAURI__ = {};

// 安装 Tauri stub 之后再加载 app i18n（导入期会调用 event.listen），
// 并等待翻译资源就绪，保证依赖文案的编辑器测试拿到真实翻译。
const { ensureI18nReady } = await import("./tests/i18n-setup.ts");
await ensureI18nReady();
