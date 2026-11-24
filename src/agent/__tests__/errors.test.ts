import { describe, expect, it } from 'vitest';
import { AgentRequestError, classifyAgentError } from '../errors';

describe('classifyAgentError', () => {
  it('请求构造错误不可重试，文案原样返回', () => {
    const info = classifyAgentError(new AgentRequestError('agent request 需要以 user 消息结尾'));
    expect(info).toEqual({
      message: 'agent request 需要以 user 消息结尾',
      retryable: false,
    });
  });

  it('auth 错误可重试', () => {
    const info = classifyAgentError(new Error('401 Unauthorized'));
    expect(info.retryable).toBe(true);
    expect(info.message).toBeTruthy();
  });

  it('限流错误可重试', () => {
    const info = classifyAgentError(new Error('429 rate limit exceeded'));
    expect(info.retryable).toBe(true);
    expect(info.message).toBeTruthy();
  });

  it('网络错误可重试', () => {
    const info = classifyAgentError(new Error('Failed to fetch'));
    expect(info.retryable).toBe(true);
    expect(info.message).toBeTruthy();
  });

  it('未知错误可重试并保留原始文案', () => {
    const info = classifyAgentError(new Error('boom'));
    expect(info).toEqual({ message: 'boom', retryable: true });
  });

  it('数字串里的 401 不被误判为鉴权错误', () => {
    const info = classifyAgentError(new Error('error code 14019'));
    expect(info).toEqual({ message: 'error code 14019', retryable: true });
  });

  it('非 Error 值转字符串', () => {
    expect(classifyAgentError('oops')).toEqual({ message: 'oops', retryable: true });
  });
});
