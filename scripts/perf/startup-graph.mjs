#!/usr/bin/env node
/**
 * 启动 JS 图统计：从 `dist/index.html` 反推「首屏一定会请求的 JS」并给出体积。
 *
 * 为什么需要它：Vite 的入口 chunk 大小并不等于启动成本——凡是 index.html 里
 * 写了 `modulepreload` 的分块，都会在首屏发起请求并解析执行。只盯入口 chunk
 * 会漏掉这类「静态预加载」的 vendor 分块（本仓库的 highlight-vendor 就是例子）。
 *
 * 用法：
 *   node scripts/perf/startup-graph.mjs                # 统计 dist/
 *   node scripts/perf/startup-graph.mjs --dir out/dist # 指定构建产物目录
 *   node scripts/perf/startup-graph.mjs --baseline /tmp/baseline/dist
 *                                                      # 与基线构建对比
 *
 * 注意：体积只是「上界指标」——本地 tauri:// 资源没有网络往返，真正花掉的是
 * 解析/编译/执行时间。配合 src/utils/startupTiming.ts 的启动时间点一起看。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function parseArgs(argv) {
  const args = { dir: 'dist', baseline: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--baseline') args.baseline = argv[++i];
  }
  return args;
}

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length;
}

function collectStartupFiles(dir) {
  const htmlPath = path.join(dir, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const refs = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.js)"/g)) {
    refs.add(match[1].replace(/^\//, ''));
  }
  const files = [];
  for (const rel of refs) {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) continue;
    const buffer = fs.readFileSync(abs);
    files.push({ rel, raw: buffer.length, gzip: gzipSize(buffer) });
  }
  files.sort((a, b) => b.raw - a.raw);
  const isEntry = (rel) => /(^|\/)index-[^/]+\.js$/.test(rel);
  const totals = files.reduce(
    (acc, f) => ({ raw: acc.raw + f.raw, gzip: acc.gzip + f.gzip }),
    { raw: 0, gzip: 0 },
  );
  return { files, totals, entry: files.find((f) => isEntry(f.rel)) ?? null };
}

function collectLazyFiles(dir) {
  const assetsDir = path.join(dir, 'assets');
  if (!fs.existsSync(assetsDir)) return { count: 0, raw: 0 };
  const startup = collectStartupFiles(dir);
  const startupNames = new Set(startup.files.map((f) => path.basename(f.rel)));
  let count = 0;
  let raw = 0;
  for (const name of fs.readdirSync(assetsDir)) {
    if (!name.endsWith('.js') || startupNames.has(name)) continue;
    count += 1;
    raw += fs.statSync(path.join(assetsDir, name)).size;
  }
  return { count, raw };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}kB`;
const delta = (after, before) => {
  const diff = after - before;
  const sign = diff > 0 ? '+' : '';
  const pct = before === 0 ? '—' : `${sign}${((diff / before) * 100).toFixed(1)}%`;
  return `${sign}${kb(diff)} (${pct})`;
};

const args = parseArgs(process.argv.slice(2));
const current = collectStartupFiles(args.dir);

console.log(`启动 JS 图（${args.dir}/index.html 中的 script + modulepreload）`);
console.log(`  文件数：${current.files.length}`);
console.log(`  原始体积：${kb(current.totals.raw)}    gzip：${kb(current.totals.gzip)}`);
if (current.entry) {
  console.log(
    `  入口 chunk：${path.basename(current.entry.rel)} ${kb(current.entry.raw)} (gzip ${kb(current.entry.gzip)})`,
  );
}
console.log('  最大的 8 个：');
for (const file of current.files.slice(0, 8)) {
  console.log(`    ${kb(file.raw).padStart(9)}  gzip ${kb(file.gzip).padStart(8)}  ${file.rel}`);
}

const lazy = collectLazyFiles(args.dir);
console.log(`  非首屏 JS：${lazy.count} 个 / ${kb(lazy.raw)}（按需加载，不计入启动）`);

if (args.baseline) {
  const base = collectStartupFiles(args.baseline);
  console.log(`\n对比基线（${args.baseline}）`);
  console.log(`  文件数：${base.files.length} → ${current.files.length}`);
  console.log(
    `  启动 JS 总量：${kb(base.totals.raw)} → ${kb(current.totals.raw)}  变化 ${delta(current.totals.raw, base.totals.raw)}`,
  );
  console.log(
    `  gzip 总量：${kb(base.totals.gzip)} → ${kb(current.totals.gzip)}  变化 ${delta(current.totals.gzip, base.totals.gzip)}`,
  );
  const baseNames = new Set(base.files.map((f) => path.basename(f.rel)));
  const currentNames = new Set(current.files.map((f) => path.basename(f.rel)));
  const dropped = base.files.filter((f) => !currentNames.has(path.basename(f.rel)));
  const added = current.files.filter((f) => !baseNames.has(path.basename(f.rel)));
  if (dropped.length) {
    const raw = dropped.reduce((sum, f) => sum + f.raw, 0);
    console.log(`  退岀首屏的分块：${dropped.length} 个 / ${kb(raw)}`);
    for (const file of dropped.slice(0, 10)) console.log(`    - ${kb(file.raw).padStart(9)}  ${file.rel}`);
  }
  if (added.length) {
    const raw = added.reduce((sum, f) => sum + f.raw, 0);
    console.log(`  新增的首屏分块：${added.length} 个 / ${kb(raw)}`);
  }
}
