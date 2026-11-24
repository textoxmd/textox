/**
 * 启动耗时探针。
 *
 * 目的：把「启动快了多少」从「包体积小了」这类间接判断，变成可对齐的
 * 时间点序列（navigation start → JS 开始执行 → 插件就绪 → 首帧 → 编辑器挂载）。
 *
 * 开关：开发模式默认开启；生产构建里设 `localStorage['texto:startup-timing'] = '1'`
 * 后重载即可开启（需要能看到 DevTools，例如 `make build-local`）。
 *
 * 读数：控制台会打印 `[startup]` 表格，同时也挂到 `window.__TEXTO_STARTUP__`，
 * 可直接在控制台 `copy(JSON.stringify(window.__TEXTO_STARTUP__))` 取走，
 * 多次启动各取一份即可算中位数。
 *
 * 所有时间都是相对 `performance.timeOrigin`（即 navigation start）的毫秒数，
 * 因此和 bundle 分析、DevTools 的 Performance 面板可以直接对齐。
 */

const STORAGE_KEY = 'texto:startup-timing';

export interface StartupMark {
  name: string;
  /** 相对 navigation start 的毫秒数 */
  at: number;
}

export interface StartupReport {
  /** 从 navigation start 到探针收尾的总耗时（毫秒） */
  total: number;
  marks: StartupMark[];
  paint: { firstPaint: number | null; firstContentfulPaint: number | null };
  /** 启动期已请求的脚本资源（数量 / 解码后总字节 / 传输字节） */
  scripts: { count: number; decodedBytes: number; transferBytes: number };
  /** 页面导航时间线（来自 PerformanceNavigationTiming） */
  navigation: {
    domContentLoaded: number | null;
    loadEventEnd: number | null;
    domInteractive: number | null;
  };
  environment: { dev: boolean; path: string };
}

const marks: StartupMark[] = [];
let installed = false;

function readEnabledFlag(): boolean {
  try {
    if (import.meta.env.DEV) return true;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const enabled = typeof window !== 'undefined' && readEnabledFlag();

export function isStartupTimingEnabled(): boolean {
  return enabled;
}

/** 记录一个时间点；未开启时是空操作（调用点不必判空）。 */
export function startupMark(name: string): void {
  if (!enabled) return;
  marks.push({ name, at: performance.now() });
  if (import.meta.env.DEV) {
    const prev = marks.length > 1 ? marks[marks.length - 2]!.at : 0;
    const mark = marks[marks.length - 1]!;
    console.debug(`[startup] ${name} +${mark.at.toFixed(1)}ms (Δ${(mark.at - prev).toFixed(1)}ms)`);
  }
}

function paintEntries(): StartupReport['paint'] {
  let firstPaint: number | null = null;
  let firstContentfulPaint: number | null = null;
  for (const entry of performance.getEntriesByType('paint') as PerformanceEntry[]) {
    if (entry.name === 'first-paint') firstPaint = entry.startTime;
    if (entry.name === 'first-contentful-paint') firstContentfulPaint = entry.startTime;
  }
  return { firstPaint, firstContentfulPaint };
}

function scriptSummary(): StartupReport['scripts'] {
  let count = 0;
  let decodedBytes = 0;
  let transferBytes = 0;
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    if (entry.initiatorType !== 'script' && entry.initiatorType !== 'link') continue;
    if (!entry.name.endsWith('.js')) continue;
    count += 1;
    decodedBytes += entry.decodedBodySize || 0;
    transferBytes += entry.transferSize || 0;
  }
  return { count, decodedBytes, transferBytes };
}

function navigationSummary(): StartupReport['navigation'] {
  const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return {
    domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
    loadEventEnd: nav ? nav.loadEventEnd : null,
    domInteractive: nav ? nav.domInteractive : null,
  };
}

export function collectStartupReport(): StartupReport {
  return {
    total: marks.length > 0 ? marks[marks.length - 1]!.at : performance.now(),
    marks: [...marks],
    paint: paintEntries(),
    scripts: scriptSummary(),
    navigation: navigationSummary(),
    environment: { dev: import.meta.env.DEV, path: window.location.pathname },
  };
}

function publish(): void {
  const report = collectStartupReport();
  (window as unknown as { __TEXTO_STARTUP__?: StartupReport }).__TEXTO_STARTUP__ = report;
  console.info(
    '[startup] ' +
      report.marks.map((m) => `${m.name}=${m.at.toFixed(0)}ms`).join(' '),
  );
  console.info(
    `[startup] first-paint=${report.paint.firstPaint?.toFixed(0) ?? '-'}ms ` +
      `fcp=${report.paint.firstContentfulPaint?.toFixed(0) ?? '-'}ms ` +
      `domInteractive=${report.navigation.domInteractive?.toFixed(0) ?? '-'}ms ` +
      `scripts=${report.scripts.count}/${(report.scripts.decodedBytes / 1024).toFixed(0)}kB`,
  );
  console.table(report.marks);
}

/**
 * 观察「根节点出现内容」与「编辑器挂载」，两者都命中后输出报告。
 * 幂等；由 main.tsx 在首次渲染后调用一次。
 */
export function installStartupObservers(): void {
  if (!enabled || installed) return;
  installed = true;

  let rootFilled = false;
  let editorMounted = false;

  const finishIfReady = () => {
    if (rootFilled && editorMounted) {
      // 等一帧，让编辑器首屏布局落定
      requestAnimationFrame(() => {
        startupMark('app:editor-visible');
        publish();
      });
    }
  };

  const root = document.getElementById('root');
  if (root) {
    if (root.childElementCount > 0) {
      rootFilled = true;
      startupMark('app:root-filled');
    } else {
      const observer = new MutationObserver(() => {
        if (root.childElementCount === 0) return;
        rootFilled = true;
        startupMark('app:root-filled');
        observer.disconnect();
        finishIfReady();
      });
      observer.observe(root, { childList: true });
    }
  }

  const markEditor = () => {
    if (editorMounted) return;
    editorMounted = true;
    startupMark('app:editor-mounted');
    finishIfReady();
  };

  if (document.querySelector('.ProseMirror')) {
    markEditor();
  } else {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.ProseMirror')) return;
      observer.disconnect();
      markEditor();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // 兜底：10s 后无论是否挂载都输出一次，避免报告永远不出现
    setTimeout(() => {
      observer.disconnect();
      if (!editorMounted) {
        startupMark('app:editor-timeout');
        publish();
      }
    }, 10_000);
  }

  requestAnimationFrame(() => startupMark('app:first-frame'));
}
