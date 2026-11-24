// 构建产物统一出口：所有可分发文件都复制一份到仓库根目录的 out/。
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT } from './lib.mjs';

export function copyToOut(filePath) {
  const outDir = join(ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  const destination = join(outDir, basename(filePath));
  copyFileSync(filePath, destination);
  console.log(`📦 Artifact: ${destination}`);
  return destination;
}
