import i18next from 'i18next';

/** 请求构造/参数错误：不可重试，文案直接展示。 */
export class AgentRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

export interface AgentErrorInfo {
  message: string;
  retryable: boolean;
}

/**
 * i18next 未初始化（或资源尚未加载）时 `t()` 会返回 `undefined`/key 本身；
 * 这两类结果都用中文兜底，避免把 key 直接展示给用户。
 */
function translate(key: string, fallback: string): string {
  const value = i18next.t(key);
  if (!value || value === key) return fallback;
  return value;
}

/** 把异常转成可展示的文案与可重试性。 */
export function classifyAgentError(error: unknown): AgentErrorInfo {
  const raw = error instanceof Error ? error.message : String(error);
  if (error instanceof AgentRequestError) {
    return { message: raw, retryable: false };
  }
  if (/\b401\b|\b403\b|unauthorized|invalid api key|incorrect api key/i.test(raw)) {
    return {
      message: translate('agent.error.auth', 'API Key 无效或无权限，请检查设置'),
      retryable: true,
    };
  }
  if (/429|rate limit|too many requests/i.test(raw)) {
    return {
      message: translate('agent.error.rateLimit', '请求过于频繁，请稍后重试'),
      retryable: true,
    };
  }
  if (/cors|failed to fetch|networkerror|network request failed/i.test(raw)) {
    return {
      message: translate('agent.error.network', '网络请求失败，请检查网络或代理设置'),
      retryable: true,
    };
  }
  return { message: raw, retryable: true };
}
