import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite'
import path from "path";
import pkg from "./package.json";
import { sharedModulesPlugin } from "./src/plugins/runtime/sharedModulesPlugin";

// @ts-ignore process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    sharedModulesPlugin(__dirname),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "katex": path.resolve(__dirname, "./src/utils/katex-stub.ts"),
    },
  },

  // 依赖预扫描默认按 `**/*.html` 全仓查找入口；这会把 vendor 子模块
  // （excalidraw-app / examples）与 src-tauri 构建产物一并纳入。其中
  // `vendor/excalidraw/excalidraw-app` 会 import
  // `@excalidraw/excalidraw/components/*`、`/i18n` 等仅在其 monorepo 内
  // 可解析的运行时子路径（fork 的 exports 只为它们暴露 types 条件），
  // esbuild 因「No known conditions」直接令扫描失败。这里显式限定为应用
  // 真实入口（根 index.html），避免误扫非本项目的 HTML。
  optimizeDeps: {
    entries: ["index.html"],
  },

  define: {
    'import.meta.env.VITE_FREE_VERSION': JSON.stringify(
      process.env.VITE_FREE_VERSION === 'true' ? 'true' : 'false'
    ),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // 开发期禁用依赖预构建产物的长效缓存。
    //
    // Vite 默认给 `/node_modules/.vite/deps/*` 返回 `max-age=31536000,immutable`，
    // 其缓存键 `?v=` 只由依赖集合 + lockfile/config 算出，不包含最终分块文件的
    // 哈希。而 esbuild 的 splitting 在两次优化之间可能产出不同的 `chunk-*.js`
    // 文件名（模块顺序不确定）。于是 WebView 会继续使用上一代 immutable 缓存
    // 的模块，这些模块 import 的分块在新缓存里不存在，报：
    //   The file does not exist at ".../chunk-XXXX.js?v=..." which is in the
    //   optimize deps directory.
    // 统一走 `no-cache` + ETag 协商：未变化时仍是 304，缓存重建后能立刻拿到
    // 新分块，避免必须手动清浏览器缓存。
    headers: {
      "Cache-Control": "no-cache",
    },
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/*.md", "**/*.markdown"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: any) {
          // Vite 的 __vitePreload helper 默认会被并入手工 chunk；若不显式拆出，
          // 它会与 lucide 映射表落在同一 chunk，入口为使用该 helper 而静态 import
          // 整个 chunk，导致映射表被 modulepreload 进初始加载。
          if (id.includes('vite/preload-helper')) return 'vite-preload-helper';
          if (id.includes('node_modules')) {
            // lucide 图标名映射表：独立懒加载 chunk（否则会并入初始 icons-vendor）。
            // 注意路径有两级：入口 `lucide-react/dynamicIconImports(.mjs)` 只是转发，
            // 真正的映射表在 `lucide-react/dist/esm/dynamicIconImports.js`，两者都要命中。
            if (id.includes('lucide-react') && id.includes('dynamicIconImports')) return 'lucide-dynamic-imports';
            // 所有 lucide 图标模块（无论被静态 import 还是 dynamicIconImports 动态引用）
            // 都独立按需分包。必须置于下方 icons-vendor 分支之前，否则会被并入
            // 初始加载的 icons-vendor（全量图标进初始包）。注意：此处返回 undefined
            // 无效——未手动分配的动态模块会被并入 importer 的 chunk。
            if (id.includes('lucide-react/dist/esm/icons/')) {
              const name = id.split('/icons/').pop()?.replace(/\.(?:m?js)(?:\?.*)?$/, '') ?? 'unknown';
              return `lucide-icon-${name}`;
            }
            if (id.includes('prosemirror-')) {
              return 'prosemirror-vendor';
            }
            if (id.includes('@codemirror') || id.includes('codemirror')) {
              return 'codemirror-vendor';
            }
            if (id.includes('highlight.js')) {
              // 语法包必须各自独立成 chunk：若并入静态加载的 highlight-vendor，
              // 入口一旦引入 core 就会把它们全部预加载，`loadGrammar` 的惰性失效。
              // 注意实际解析路径是 `highlight.js/es/languages/<lang>.js`（不是 lib/）。
              if (id.includes('highlight.js/') && id.includes('/languages/')) {
                const lang = id.split('/languages/').pop()?.replace(/\.(?:m?js)(?:\?.*)?$/, '') ?? 'lang';
                return `hljs-lang-${lang}`;
              }
              return 'highlight-vendor';
            }
            if (id.includes('markdown-it')) {
              return 'markdownit-vendor';
            }
            // use-sync-external-store 是 react-i18next 与 radix 的共同依赖。
            // 若不显式归入 react-vendor，它会被并进 radix-vendor，使 react-vendor
            // 反过来 import radix-vendor，形成 react-vendor ↔ radix-vendor 循环：
            // radix-vendor 在模块求值期就访问 React（reduce 生成 Primitive），
            // 拿到未初始化的 React 命名空间即 `undefined.forwardRef` 崩溃 → 白屏。
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/') || id.includes('/react-i18next') || id.includes('/use-sync-external-store/')) {
              return 'react-vendor';
            }
            if (id.includes('@tauri-apps')) {
              return 'tauri-vendor';
            }
            if (id.includes('lucide-react') || id.includes('lucide-static')) {
              return 'icons-vendor';
            }
            if (id.includes('/radix-ui') || id.includes('/@radix-ui/')) {
              return 'radix-vendor';
            }
            if (id.includes('/i18next')) {
              return 'i18n-vendor';
            }
            if (id.includes('/culori')) {
              return 'color-vendor';
            }
          }
        },
      },
    },
    // vendor 大包（excalidraw subset / codemirror / mermaid）体积超过默认阈值，
    // 这些是刻意整包的第三方依赖，提高阈值避免构建误报
    chunkSizeWarningLimit: 2000,
  },
}));
