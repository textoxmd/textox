import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 注意：不要写 `new URL('../../editorHost.ts', import.meta.url)`——
// Vite 会把这种形式当静态资源 URL 重写成 http 地址，fileURLToPath 随之报错。
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

function readSkeletonHostSource(): string {
  // 从 src/components/__tests__/ 上溯两级即 src/
  return readFileSync(path.resolve(TESTS_DIR, '../../editorHost.ts'), 'utf8');
}

describe('EditorHost 语言支持注入', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('默认返回 null，注入后返回语言对象', async () => {
    const mod = await import('@/components/TextoEditor/src/host');
    // 缺省宿主必须自带该方法（否则调用方只能靠可选链兜底，契约形同虚设）
    expect(typeof mod.getEditorHost().getCodeLanguageSupport).toBe('function');
    expect(mod.getEditorHost().getCodeLanguageSupport?.('javascript') ?? null).toBeNull();

    const fake = { name: 'JavaScript' } as never;
    mod.setEditorHost({
      getImageUploader: async () => null,
      resolveImageSrc: () => null,
      showDialog: async <T,>(options: { dismissValue?: T }) => options.dismissValue as T,
      saveMedia: async () => ({ saved: false }),
      getCodeLanguageSupport: (lang: string) => (lang === 'javascript' ? fake : null),
    });
    expect(mod.getEditorHost().getCodeLanguageSupport?.('javascript')).toBe(fake);
  });

  it('异步 provider 可注入并被读取', async () => {
    const mod = await import('@/components/TextoEditor/src/host');
    const resolver = (lang: string) => (lang === 'javascript' ? ({ name: 'JS' } as never) : null);
    mod.setEditorHost({
      getImageUploader: async () => null,
      resolveImageSrc: () => null,
      showDialog: async <T,>(options: { dismissValue?: T }) => options.dismissValue as T,
      saveMedia: async () => ({ saved: false }),
      loadCodeLanguageSupport: async () => resolver,
    });
    await expect(mod.getEditorHost().loadCodeLanguageSupport?.()).resolves.toBe(resolver);
  });

  it('骨架宿主不得静态 import codeLanguages（否则 CodeMirror 会进入启动包）', () => {
    const source = readSkeletonHostSource();
    expect(source).not.toMatch(
      /import\s*\{[^}]*getLanguageSupport[^}]*\}\s*from\s*['"]@\/utils\/codeLanguages['"]/,
    );
    expect(source).toMatch(/import\(\s*['"]@\/utils\/codeLanguages['"]\s*\)/);
  });
});
