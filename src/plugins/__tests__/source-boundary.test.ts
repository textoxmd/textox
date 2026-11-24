import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function dirsWith(parent: string, marker: string): string[] {
  const dir = join(ROOT, parent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(dir, name, marker)))
    .sort();
}

describe('plugin source layout', () => {
  it('keeps v1 runtime plugins out of the legacy first-party glob root', () => {
    // 旧体系用 `import.meta.glob('/official-plugins/*/src/index.ts')` 收集第一方插件；
    // 新运行时插件（带 plugin.config.ts）放在这里会被当成 TextoPlugin 清单吞掉。
    expect(dirsWith('official-plugins', 'plugin.config.ts')).toEqual([]);
  });

  it('keeps v1 runtime plugins out of the legacy first-party root as well', () => {
    // v1 插件目录当前为空（excalidraw 已外置到独立仓库）；将来若放回这里，
    // 同样不能进入旧体系的 glob 根（上面那条覆盖），这里只做空/无冲突守卫。
    expect(dirsWith('official-v1-plugins', 'plugin.config.ts')).toEqual([]);
  });

  it('keeps sample plugins in plugin-samples', () => {
    expect(dirsWith('plugin-samples', 'plugin.config.ts').length).toBeGreaterThan(0);
  });
});
