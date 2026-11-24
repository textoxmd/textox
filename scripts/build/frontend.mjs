// Tauri 的 beforeDevCommand / beforeBuildCommand 统一入口。
//
// 负责三件事：设置 edition 环境变量、同步图标、汇总插件产物并启动前端命令。
// Windows 的免费版/付费版当前都提供完整功能，因此不在 Windows 上设置
// VITE_FREE_VERSION（仅 macOS/Linux 的 Lite 版做前端门控）。
//
// 用法：
//   node scripts/build/frontend.mjs dev  [--edition full|lite]
//   node scripts/build/frontend.mjs build [--edition full|lite]
import { parseArgs, run, assertEdition } from './lib.mjs';
import { buildPluginResources } from './plugins.mjs';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'build';
const edition = assertEdition(args.edition ?? 'full');

const gated = edition === 'lite' && process.platform !== 'win32';

console.log(`🎛️  Frontend ${command} — edition: ${edition}${gated ? ' (lite gating on)' : ''}`);

run('node', ['scripts/build/icons.mjs', 'select', '--edition', edition]);
buildPluginResources();

if (command === 'dev') {
  run('bun', ['run', 'dev'], {
    env: { VITE_FREE_VERSION: gated ? 'true' : undefined },
  });
} else if (command === 'build') {
  run('bun', ['run', 'build'], {
    env: { VITE_FREE_VERSION: gated ? 'true' : undefined },
  });
} else {
  console.error(`Unknown frontend command: ${command} (expected dev | build)`);
  process.exit(1);
}
