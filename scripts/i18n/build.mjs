import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const translationsDir = join(projectRoot, 'vendor/translations')
const sourceDir = join(translationsDir, 'locales')
const targetDir = join(projectRoot, 'src/i18n/locales')

function runBun(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: translationsDir,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

runBun(['install'])
runBun(['run', 'build'])

if (!existsSync(sourceDir)) {
  console.error(`Missing translations output: ${sourceDir}`)
  process.exit(1)
}

mkdirSync(targetDir, { recursive: true })
for (const entry of readdirSync(sourceDir)) {
  cpSync(join(sourceDir, entry), join(targetDir, entry), { recursive: true, force: true })
}
