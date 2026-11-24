export type LoadFailure =
  | 'import-failed'
  | 'invalid-export'
  | 'activate-failed'; // 任务 12：onload 抛错时使用

export type LoadResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: LoadFailure; message: string };

export interface LoadPluginClassOptions {
  importModule: () => Promise<{ default?: unknown }>;
  isPluginClass: (value: unknown) => boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 动态导入插件模块并取出默认导出的插件类；所有失败都收敛为 `LoadResult`，不抛出。 */
export async function loadPluginClass<T>(
  options: LoadPluginClassOptions,
): Promise<LoadResult<T>> {
  let module: { default?: unknown };
  try {
    module = await options.importModule();
  } catch (error) {
    return { ok: false, failure: 'import-failed', message: describe(error) };
  }
  const exported = module.default;
  if (!options.isPluginClass(exported)) {
    return {
      ok: false,
      failure: 'invalid-export',
      message: 'default export is not a plugin class',
    };
  }
  return { ok: true, value: exported as T };
}
