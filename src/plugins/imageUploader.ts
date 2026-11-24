import { createPluginHost, NOOP_HOST_DEPS } from './host';
import { resolveImageUploaderWithOwner } from './registry';

/**
 * 解析当前启用插件提供的图片上传器，并绑定到该插件自己的 `PluginHost`
 * （`config` 读写落在插件独立 store）。无启用上传器时返回 null（仅本地保存）。
 */
export function resolveImageUploader(): {
  upload(filePath: string): Promise<string>;
} | null {
  const found = resolveImageUploaderWithOwner();
  if (!found) return null;
  const host = createPluginHost(NOOP_HOST_DEPS, found.pluginId);
  return { upload: (filePath) => found.contribution.upload(host, filePath) };
}
