import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { SHARED_MODULES } from '@textox/plugin-sdk';

export type VersionResolver = (name: string, declared: string) => string | null;

/** 解析失败时的回退：声明值是 semver（可带 `^` / `~` 范围符）时取其裸版本，其它一律丢弃。 */
export function fallbackVersion(declared: string): string | null {
  const match = /^[\^~]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(
    declared.trim(),
  );
  return match ? match[1] : null;
}

function resolvePackageJson(
  require: NodeRequire,
  name: string,
  pluginDir: string,
): string | null {
  try {
    return require.resolve(`${name}/package.json`, { paths: [pluginDir] });
  } catch {
    // 有些包在 exports 里不暴露 ./package.json：退回「解析入口再向上找 package.json」
    try {
      let dir = path.dirname(require.resolve(name, { paths: [pluginDir] }));
      for (let depth = 0; depth < 10; depth += 1) {
        const candidate = path.join(dir, 'package.json');
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** 从插件目录出发，解析某个依赖「实际安装」的版本（而不是 package.json 里的声明值）。 */
export function createVersionResolver(pluginDir: string): VersionResolver {
  const require = createRequire(path.join(pluginDir, 'noop.js'));
  return (name, declared) => {
    const pkgPath = resolvePackageJson(require, name, pluginDir);
    if (!pkgPath) return fallbackVersion(declared);
    try {
      const pkg = JSON.parse(readFileSync(realpathSync(pkgPath), 'utf8')) as { version?: string };
      return pkg.version ?? fallbackVersion(declared);
    } catch {
      return fallbackVersion(declared);
    }
  };
}

/**
 * 只保留宿主共享模块对应的依赖，并把声明值替换成解析出的真实版本。
 * 解析不到真实版本且声明值不是 semver 时丢弃该键（不要写 `workspace:*` 这类无意义值）。
 */
export function collectBuiltAgainst(
  dependencies: Record<string, string>,
  resolve: VersionResolver,
): Record<string, string> {
  const shared = new Set<string>(SHARED_MODULES);
  const builtAgainst: Record<string, string> = {};
  for (const [name, declared] of Object.entries(dependencies)) {
    if (!shared.has(name)) continue;
    const version = resolve(name, declared);
    if (version === null) {
      console.warn(`[plugin-build] cannot resolve version for ${name} (${declared}); skipped`);
      continue;
    }
    builtAgainst[name] = version;
  }
  return builtAgainst;
}
