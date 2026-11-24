import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../../src"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: [
      // 本配置的 include 也会收集骨架测试（sidebar / __tests__ / utils 等），
      // 因此需要与根配置一致的 localStorage 兼容层（见 vitest.setup.localstorage.ts）。
      path.resolve(__dirname, "../../../vitest.setup.localstorage.ts"),
      path.resolve(__dirname, "vitest.setup.ts"),
      path.resolve(__dirname, "tests/plugins-setup.ts"),
    ],
    // 只收集仓库自己的测试；仓库根目录默认会扫进 vendor 下的第三方包
    // 等外部测试文件（不同环境/包管理），导致全量运行大面积误报。
    include: [
      "src/components/TextoEditor/tests/**/*.test.ts",
      "src/components/TextoEditor/tests/**/*.test.tsx",
      "src/components/sidebar/**/*.test.ts",
      "src/components/styles/**/*.test.ts",
      "src/components/__tests__/**/*.test.ts",
      "src/components/__tests__/**/*.test.tsx",
      "src/utils/__tests__/**/*.test.ts",
      "src/app/**/*.test.ts",
    ],
    // 该测试依赖 vi.mock 替换 @tauri-apps/api/core；编辑器 setup 会先导入真实模块
    // 并安装 __TAURI_INTERNALS__ 桩，模块 mock 无法覆盖。它由根 vitest 配置负责。
    exclude: [...configDefaults.exclude, "src/utils/__tests__/appConfig.test.ts"],
  },
});
