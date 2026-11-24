# 启动速度怎么量

> 结论先行：**包体积是上界指标，不是启动时间**。Tauri 的静态资源走 `tauri://localhost`（或自定义协议），
> 没有网络往返，省下来的字节主要换来「少解析/编译/执行」；到底快了多少，必须在真实 WebView 里打时间点，
> 并且用多次运行的中位数去比，而不是看一眼 chunk 大小就下结论。

## 一、先定义「启动完成」

三个互不相同的指标，别混着说：

| 指标 | 定义 | 谁来量 |
|---|---|---|
| **M1 首帧** | 窗口出现第一帧有内容的画面 | `PerformanceObserver('paint')` / 应用内探针 |
| **M2 可交互** | 编辑器挂载、能开始输入 | 应用内探针（`.ProseMirror` 出现） |
| **M3 冷启动** | 进程创建 → 窗口显示 | Rust 侧 `Instant` + 系统计时（只能在带签名的 app 上量） |

包体积优化（本仓库这一轮做的 css-tree / fflate / 主题 CSS / hljs 语法包惰性化）主要影响 **M1 与 M2**，
对 M3 的影响被 WebView 创建、Rust setup、磁盘 IO 稀释，**要单独量**。

## 二、三层测量

### L1 启动 JS 图（静态、秒级、可做 CI 回归）

```sh
npx vite build
node scripts/perf/startup-graph.mjs
# 与另一个构建对比
node scripts/perf/startup-graph.mjs --baseline /tmp/textox-base/dist
```

它从 `dist/index.html` 里抓 `script` 与 `modulepreload`，因为**预加载的分块同样计入启动成本**
（只盯入口 chunk 会漏掉 vendor 分块——本仓库的 `highlight-vendor` 就是这样被漏掉的）。

当前基线（`vite build` 产物）：

```
文件数：51    原始 2265.4kB / gzip 641.6kB
入口：index-*.js 851.5kB (gzip 262.9kB)
highlight-vendor 42.2kB (gzip 12.8kB)   ← 惰性化前是 148.8kB (gzip 46.5kB)
非首屏 JS：1861 个 / 13378.1kB（按需）
```

**直接证据（不需要统计）**：`grep -o 'hljs-lang-[^"]*' dist/index.html | wc -l` 应为 **0**
——语法包不再出现在首屏预加载列表里，只有文档出现对应语言时才会被请求。

### L2 应用内时间点（真实 WebView）

`src/utils/startupTiming.ts` 已埋好探针：

- 开发模式默认开启；**生产构建**里在控制台执行
  `localStorage['texto:startup-timing']='1'` 再重载即可开启（需要 DevTools，可用 `make build-local`）。
- 输出的时间点（单位 ms，基准是 `navigation start`，与 DevTools Performance 面板对齐）：

```
js:boot            ← main.tsx 模块开始执行（此前是 HTML/入口 chunk 解析）
js:agent-ready     ← initAgent 完成
js:plugins-ready   ← initPlugins 完成（插件清单、i18n、配置、激活）
js:render-called   ← createRoot().render() 调用
app:root-filled    ← #root 首次出现子元素
app:first-frame    ← 下一帧
app:editor-mounted ← .ProseMirror 挂载（≈ M2 可交互）
```

读数：`copy(JSON.stringify(window.__TEXTO_STARTUP__))`，里面还带 paint 时间、启动期脚本数量/字节、
`domInteractive`。**每次启动取一份，至少 10 次，取中位数与 p90**，不要用单次。

### L3 进程级冷启动（M3）

只在真实打包产物上有意义：

```sh
make build-local            # 关闭签名、开启 DevTools，便于连探针
open -n out/mac-arm64/Texto.app
```

配合 LaunchServices 的 `-ApplePersistenceIgnoreState`、清 `~/Library/Caches/com.texto.markdown*`
再跑；想要「进程创建 → 窗口显示」的精确区间，在 Rust `setup` 里打 `Instant::now()`，
在窗口 `show()` 之后写一条日志（这一层目前还没埋，属于待办）。

## 三、A/B 怎么做才站得住

1. **基线要能归因**。不要在同一个工作区 `git stash`——仓库里有大量与本轮无关的未提交改动。
   用独立工作树：

   ```sh
   git worktree add /tmp/textox-base HEAD
   rsync -a --exclude node_modules --exclude dist --exclude .git ./ /tmp/textox-base/
   # 只回退本次要评估的文件（示例：本轮启动包优化的全部改动）
   cd /tmp/textox-base
   git checkout HEAD -- packages/export-runtime packages/markdown-editor-api \
       official-plugins/epub-export official-plugins/syntax-highlight \
       src/components/TextoEditor/src/highlight-theme.ts src/plugins/host.ts
   # vite.config.ts 的 manualChunks 也在其中
   git checkout HEAD -- vite.config.ts
   ln -s /Users/geange/workspace/Textox/node_modules node_modules
   npx vite build
   ```

   ⚠️ 坑：npm/bun workspaces 的 `node_modules/@texto/*` 是指向**主仓库**的软链，
   直接软链 `node_modules` 会让 baseline 用上主仓库里**已优化**的 workspace 包（css-tree / fflate 的
   惰性化就在 `packages/` 与 `official-plugins/` 里）。要么把这两个目录也复制进工作树并重指软链，
   要么 baseline 只评估「骨架侧」改动并明确声明范围。

2. **交替运行**：A B A B … 而不是「先跑 10 次 A 再跑 10 次 B」——机器温度/后台任务会漂移。
3. **N ≥ 10**，报中位数 + p90 + IQR；两个分布重叠就说明差异不可辨（这时别宣称变快）。
4. **控制变量**：同一台机器、同一电源模式、关闭 Spotlight 索引与备份、固定窗口尺寸、
   同一份文档、同一次安装位置。
5. **放大信号**：差异只有几毫秒时，用 DevTools 的 CPU ×4/×6 降频复测——真实低端机上
   解析/执行成本占比更高，优化收益也更明显。

## 四、常见误判

| 误判 | 实际 |
|---|---|
| 「入口 chunk 变小了，所以启动快了」 | 预加载的 vendor 分块同样计入；本轮入口 851.5kB 几乎没变，真正减的是 `highlight-vendor` 105kB |
| 「字节少了 = 时间少了」 | 本地协议无网络往返，收益在解析/编译/执行；gzip 体积和解析成本不是线性关系 |
| 「一次启动快 40ms」 | 噪声量级就是几十毫秒；必须多次取中位 |
| 「Chrome 里测的和 app 一样」 | macOS 上是 WKWebView / JavaScriptCore，与 Chromium 的编译策略不同；只能作为方向参考 |
| 「冷启动和窗口重载是一回事」 | 窗口 reload 不重建进程与 WebView，量到的只是 M1/M2 的一部分 |

## 五、这一轮改动的验收清单

- [ ] `node scripts/perf/startup-graph.mjs` 的「启动 JS 总量」在基线之上不增加
- [ ] `dist/index.html` 中不再出现 `hljs-lang-*` / `css-tree`（`grep` 验证）
- [ ] 应用内探针：`js:plugins-ready`、`app:editor-mounted` 的中位数下降（10 次）
- [ ] 打开一个含 ```` ```js ```` 的文档，Network 里只拉 `hljs-lang-javascript-*.js`，不拉其余 22 个
- [ ] 打开不含代码块的文档，不拉任何 `hljs-lang-*`
