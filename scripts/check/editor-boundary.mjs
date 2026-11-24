#!/usr/bin/env node
// 编辑器边界守护：编辑器不得 import 骨架。
// 方向固定为「骨架 → 编辑器」；反向禁止。
// 覆盖：别名 `@/`（from / 副作用 / 动态导入）；相对路径逃逸（解析后落在编辑器目录之外）。
//
// 排除项：tests / specs（fixtures 可合法使用）。
//
// 用法：bun run check:editor-boundary
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const EDITOR = join(ROOT, 'src/components/TextoEditor');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', 'specs', '__tests__']);
const EXTS = new Set(['.ts', '.tsx']);
const BANNED = /(?:from\s*|import\s*\(?\s*)['"]@\//;
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(?\s*)['"](\.[^'"]*)['"]/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (EXTS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

const hits = [];
for (const file of walk(EDITOR)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const at = `${relative(ROOT, file)}:${index + 1}`;
    if (BANNED.test(line)) {
      hits.push(`${at}: ${line.trim()}`);
      return;
    }
    const m = RELATIVE_IMPORT.exec(line);
    if (m) {
      const target = resolve(dirname(file), m[1]);
      if (target !== EDITOR && !target.startsWith(EDITOR + sep)) {
        hits.push(`${at}: ${line.trim()} -> ${relative(ROOT, target)}`);
      }
    }
  });
}

if (hits.length > 0) {
  console.error('[check:editor-boundary] 编辑器出现对骨架的依赖：');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

console.log('[check:editor-boundary] clean');
