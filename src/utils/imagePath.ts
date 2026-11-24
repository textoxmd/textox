import { convertFileSrc } from "@tauri-apps/api/core";
import { isAbsoluteImageStoragePath } from "./imageStoragePath";

const resolvedUrlCache = new Map<string, string | null>();
const MAX_CACHE_SIZE = 500;

function cacheKey(src: string, documentDir: string | null): string {
  return `${documentDir ?? "__no_doc__"}::${src}`;
}

function trimCache(): void {
  if (resolvedUrlCache.size <= MAX_CACHE_SIZE) return;
  const keys = [...resolvedUrlCache.keys()];
  const toDelete = keys.slice(0, keys.length - MAX_CACHE_SIZE);
  for (const k of toDelete) resolvedUrlCache.delete(k);
}

function isRelativePath(src: string): boolean {
  return (
    !src.startsWith("/") &&
    !src.startsWith("data:") &&
    !src.startsWith("http://") &&
    !src.startsWith("https://") &&
    !src.startsWith("blob:") &&
    !src.startsWith("tauri://") &&
    !src.startsWith("asset://") &&
    !src.startsWith("://")
  );
}

// 与图片存储路径校验共用同一判定，统一识别 POSIX / Windows 盘符 / UNC
function isAbsoluteFsPath(src: string): boolean {
  return isAbsoluteImageStoragePath(src);
}

function isDirectUrl(src: string): boolean {
  return (
    src.startsWith("data:") ||
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("blob:") ||
    src.startsWith("tauri://") ||
    src.startsWith("asset://") ||
    src.startsWith("//")
  );
}

export function resolveImageSrc(src: string, documentDir: string | null): string | null {
  const key = cacheKey(src, documentDir);
  const cached = resolvedUrlCache.get(key);
  if (cached !== undefined) return cached;

  let result: string | null;

  if (isDirectUrl(src)) {
    result = src;
  } else if (isAbsoluteFsPath(src)) {
    result = convertFileSrc(src);
  } else if (isRelativePath(src)) {
    if (documentDir) {
      const absolutePath = `${documentDir}/${src}`;
      result = convertFileSrc(absolutePath);
    } else {
      result = null;
    }
  } else {
    result = src;
  }

  resolvedUrlCache.set(key, result);
  trimCache();
  return result;
}

export function clearImageUrlCache(): void {
  resolvedUrlCache.clear();
}
