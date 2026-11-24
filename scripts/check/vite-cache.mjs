/**
 * 开发启动前校验 Vite 依赖预构建缓存是否完整。
 *
 * 背景：`node_modules/.vite/deps/_metadata.json` 的 hash 只由 lockfile 与
 * Vite 配置算出，不覆盖被预构建依赖自身的文件内容。一旦缓存目录中的分块
 * 文件缺失（预构建被中断、并发写入、手动清理等），hash 依旧“匹配”，Vite
 * 会跳过重建并持续返回指向不存在文件的模块 URL，表现为：
 *
 *   The file does not exist at ".../node_modules/.vite/deps/chunk-XXXX.js?..."
 *   which is in the optimize deps directory.
 *
 * 此时只能手动删除缓存才能恢复。这里在每次 dev 启动前按元数据登记的文件
 * 做一次存在性校验，发现缺失就直接清掉 deps 缓存，让 Vite 正常重建。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const depsDir = join(projectRoot, 'node_modules/.vite/deps')
const metadataPath = join(depsDir, '_metadata.json')

function resetCache(reason) {
  rmSync(depsDir, { recursive: true, force: true })
  console.warn(`🧹 Vite 依赖缓存不完整：${reason}，已清理，启动时将重新预构建`)
}

if (!existsSync(metadataPath)) {
  // 没有缓存（首次启动或已被其他方式清理），交给 Vite 正常预构建。
  process.exit(0)
}

let metadata
try {
  metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
} catch (error) {
  resetCache(`元数据无法解析（${error.message}）`)
  process.exit(0)
}

// optimized 收录入口文件，chunks 收录共享分块；两者合起来覆盖 deps 目录下
// 全部 .js 产物（.map 不参与模块解析，无需校验）。
//
// 注意：Vite 6 写 metadata 时会用 flattenId() 把 chunk id 里的 `.` 换成 `__`
// （见 optimizer 中 chunks 的 file = getOptimizedDepPath(id)），但 esbuild
// 实际产物保留原始文件名。例如 excalidraw 的动态分块：
//   metadata: subset-worker__chunk-RADLPGUA.js
//   实际文件: subset-worker.chunk-RADLPGUA.js
// 因此校验时若 flatten 后的路径不存在，还要回退检查 `<id>.js`，否则每次
// 启动都会把健康的缓存误判为损坏。
const expectedFiles = new Map()
for (const record of [metadata.optimized, metadata.chunks]) {
  if (!record || typeof record !== 'object') continue
  for (const [id, info] of Object.entries(record)) {
    if (info && typeof info.file === 'string') expectedFiles.set(info.file, id)
  }
}

const missingFiles = []
for (const [file, id] of expectedFiles) {
  if (existsSync(join(depsDir, file))) continue
  if (existsSync(join(depsDir, `${id}.js`))) continue
  missingFiles.push(file)
}

if (missingFiles.length > 0) {
  const example = missingFiles.slice(0, 3).join(', ')
  const suffix = missingFiles.length > 3 ? ' 等' : ''
  resetCache(`${missingFiles.length} 个文件缺失（${example}${suffix}）`)
}
