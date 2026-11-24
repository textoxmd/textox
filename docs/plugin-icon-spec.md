# 插件图标规范

> 适用范围：所有外置插件（`@textox/plugin-sdk` 运行时）。宿主不维护图标表，**图标归插件**，
> 由插件随包分发、宿主只负责读取与渲染。

## 1. 作者只需要「放一个文件」

**最简做法**：把图标放到插件目录，文件名固定为 `icon.<ext>`：

```
plugins/<id>/
  assets/icon.svg     ← 推荐位置（构建时自动复制进 dist/）
  dist/icon.svg       ← 宿主实际读取的位置
```

构建工具会：

1. 按 `assets/icon.svg` → `assets/icon.png` → … → 项目根 `icon.*` 的顺序查找；
2. 复制到 `dist/`；
3. 自动把文件名写进 `manifest.json` 的 `icon` 字段。

**作者不需要在 `plugin.config.ts` 里写 `icon`，也不需要自己 `cp`。**

没有品牌图的工具型插件可以不提供文件，改用 lucide 名称（仍然写在 `icon` 里）：

```ts
export default {
  id: 'app.textox.typing-particle',
  icon: 'sparkles',        // 没有任何 icon.* 文件时的兜底
};
```

也可以完全省略 `icon`：宿主会渲染默认图标。

优先级：`assets/icon.*` / 根 `icon.*` **高于** 配置里的 `icon` 字段——放了文件就自动用文件。

## 2. 资源图标的硬性要求（构建期强制）

`@textox/plugin-build` 在构建末尾调用 `assertPluginIcon()`，以下任一条不满足会**直接构建失败**，
错误信息里带修复提示：

| 项 | 要求 | 原因 |
|---|---|---|
| 格式 | `svg` / `png` / `webp` / `jpg` / `jpeg` | 与宿主 `plugin_read_asset` 白名单一致 |
| 位置 | `assets/icon.<ext>` 或项目根 `icon.<ext>`（自动复制到 `dist/` 根） | 宿主按 `<插件id>/<icon>` 读取 |
| 大小 | ≤ 256KB | 图标会随包分发，大位图没有收益 |
| 比例 | 方形（宽高差 ≤ 2%） | 卡片图标与外框都是方形，非方形会被裁切 |
| 位图边长 | 128–2048px | 32px 渲染清晰，又不至于臃肿 |
| SVG | 根 `<svg>` 必须有 `width`/`height` 或 `viewBox` | 否则浏览器无法确定固有尺寸 |

> SVG 的 `viewBox` 单位任意，不做像素范围检查，只检查是否为方形画布。

## 3. 视觉规范

1. **满幅、无透明留白**。图标会以 `object-fit: cover` 铺满容器（32px），
   四周的透明边距会被当作留白显示，看起来比同尺寸的 lucide 图标小一圈。
   - 位图：用 `sharp().trim()` 之类按 alpha 裁边后再导出；
   - SVG：让图形画到 viewBox 边缘（或裁掉外层空白画板）。
2. **自带背景块**。宿主容器是浅灰/深灰圆角方块，不额外加底色；
   需要品牌底色的 Logo（Excalidraw 的白底紫标、PicGo 的蓝标）直接把底色画进图里。
3. **32px 可辨识**。细线条 Logo 在 32px 会糊，优先用实心/粗线版本，必要时简化细节。
4. **明暗都能看**。容器底色来自主题，图标不要依赖「白色背景」才能看清。
5. **不要圆角**。圆角由容器统一裁剪（8px @ 32px），图里再画圆角会出现双重圆角。

## 4. 修改图标后的生效路径

图标是插件目录里的静态文件，宿主**每次扫描都会重新读**，但出厂插件的目录由播种管理：

- 本地导入的插件：重新导入 zip 即可；
- 出厂（`origin: seed`）插件：必须**升级版本号**，否则 `plugin_seed_bundled` 同版本幂等跳过，
  磁盘上的旧图标不会更新（`data.json` 会保留，启用状态不变）。

## 5. 宿主的渲染与回退

```
manifest.icon
  ├─ kebab 名称 → lucide（单色，走编辑器图标缓存）
  ├─ 资源路径   → plugin_read_asset → base64 → data: URL → <img>（按插件id:路径缓存）
  └─ 缺失/读取失败 → 默认 lucide 图标（不会留空白）
```

宿主的图标位：卡片 32px（圆角 8px）、详情页 40px（圆角 12px），两者都 `overflow: hidden`。

## 6. 自检清单

- [ ] 图标文件名为 `assets/icon.<ext>`（或 `icon` 字段写 lucide 名称）
- [ ] 方形、无透明留白、32px 下能认出来
- [ ] 明暗主题下都可辨识
- [ ] `bun run build` 通过（`assertPluginIcon` 无报错，`dist/manifest.json` 的 `icon` 已自动填写）
- [ ] 发布/导入后用设置 → 插件的卡片与详情页各看一次
