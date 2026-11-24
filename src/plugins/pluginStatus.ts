/** 插件启用状态：前端 localStorage（命名空间 texto:plugin:）。 */
const PREFIX = 'texto:plugin:';

/** 读取插件启用状态；未设置时回退到 defaultEnabled，localStorage 异常时同样回退。 */
export function isPluginEnabled(id: string, defaultEnabled = true): boolean {
  try {
    const value = localStorage.getItem(`${PREFIX}${id}`);
    return value === null ? defaultEnabled : value === 'true';
  } catch {
    return defaultEnabled;
  }
}

/** 写入插件启用状态；localStorage 异常时静默忽略。 */
export function setPluginEnabledState(id: string, enabled: boolean): void {
  try {
    localStorage.setItem(`${PREFIX}${id}`, String(enabled));
  } catch {
    /* ignore */
  }
}
