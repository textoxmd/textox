import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  assetUrlToFsPath,
  base64ToBytes,
  bytesToBase64,
  dataUrlToBytes,
} from '@texto/export-runtime';
import { showGlassDialog } from '@/components/GlassDialog';
import {
  downloadInBrowser,
  setEditorHost,
} from '@/components/TextoEditor/src/host';
import type {
  SaveMediaRequest,
  SaveMediaResult,
} from '@/components/TextoEditor/src/host';
import {
  flushPendingSyntaxReload as flushHostSyntaxReload,
  registerSyntaxReloader as registerHostSyntaxReloader,
  requestSyntaxReload,
} from '@/editor/syntaxReload';
import { resolveImageUploader } from '@/plugins/imageUploader';
import { readPluginConfig } from '@/plugins/pluginConfigReader';
import { resolveImageSrc } from '@/utils/imagePath';
import { isTauriRuntime } from '@/utils/platform';
import { IS_MAC } from '@/utils/windowManager';


async function pickMediaSavePath(
  suggestedName: string,
  filterName: string,
  extension: string,
): Promise<string | null> {
  if (IS_MAC) {
    // macOS 沙盒：必须走原生面板并持有 security-scoped 访问，
    // 否则写入非当前打开目录会失败（与 PDF / HTML 导出同因）。
    return invoke<string | null>('pick_export_save_path', {
      defaultName: suggestedName,
      extension,
    });
  }
  return saveDialog({
    filters: [{ name: filterName, extensions: [extension] }],
    defaultPath: suggestedName,
  });
}

async function fetchMediaBytes(url: string): Promise<Uint8Array> {
  const filePath = assetUrlToFsPath(url);
  if (filePath) {
    const dataUrl = await invoke<string>('read_image_as_data_url', {
      path: filePath,
    });
    return dataUrlToBytes(dataUrl).bytes;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    // 远程图片可能被网站的 CORS 拦住：交给 Rust 侧直接下载。
    if (!isTauriRuntime() || !/^https?:\/\//i.test(url)) throw error;
    const base64 = await invoke<string>('download_remote_file', { url });
    return base64ToBytes(base64);
  }
}

async function saveMedia(
  request: SaveMediaRequest,
): Promise<SaveMediaResult> {
  if (!isTauriRuntime()) return downloadInBrowser(request);

  const path = await pickMediaSavePath(
    request.suggestedName,
    request.filterName,
    request.extension,
  );
  if (!path) return { saved: false };

  if (request.source.kind === 'text') {
    await invoke('write_file', { path, content: request.source.text });
  } else {
    const bytes = await fetchMediaBytes(request.source.url);
    await invoke('save_binary_file', {
      path,
      base64Data: bytesToBase64(bytes),
    });
  }
  return { saved: true, path };
}

/** 用真实 app 能力安装编辑器宿主契约；在 main.tsx 启动时调用一次。 */
export function installEditorHost(): void {
  setEditorHost({
    getImageUploader: async () => resolveImageUploader(),
    resolveImageSrc: (src, documentDir) => resolveImageSrc(src, documentDir),
    showDialog: (options) => showGlassDialog(options),
    saveMedia,
    readPluginConfig,
    // 语言包体积大：只在 SV 真正需要时动态加载，避免进入启动入口 chunk。
    loadCodeLanguageSupport: async () => {
      const mod = await import('@/utils/codeLanguages');
      return mod.getLanguageSupport;
    },
    // 任何拿到 host 的骨架代码都能请求重建语法；真正执行的是编辑器登记的
    // reloader（插件运行时在贡献增删后直接调 requestSyntaxReload）。
    reloadSyntax: () => requestSyntaxReload(),
    // 插件可能先于编辑器创建：登记成功后把「当时没有 reloader」的挂起请求补上。
    registerSyntaxReloader: (reload) => {
      const unregister = registerHostSyntaxReloader(reload);
      flushHostSyntaxReload();
      return unregister;
    },
    flushPendingSyntaxReload: () => flushHostSyntaxReload(),
  });
}
