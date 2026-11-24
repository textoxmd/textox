import { initAgentSettings } from './config';

/** 启动期初始化：订阅配置广播并读取一次当前设置。 */
export async function initAgent(): Promise<void> {
  await initAgentSettings();
}

export { agentCapability } from './capability';
