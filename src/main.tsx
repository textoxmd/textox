import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { logger } from './utils/logger';
import { initTouchDeviceClass } from './utils/platform';
import { initNativeContextMenuGuard } from './utils/nativeContextMenu';
import { installEditorHost } from './editorHost';
import { showWindowIfHidden } from './utils/windowManager';
import { installStartupObservers, startupMark } from './utils/startupTiming';
import App from "./App";
import './i18n';
import { initPlugins } from './plugins';
// 注意：`./plugins/runtime` 会被同名旧文件 `src/plugins/runtime.ts` 抢占（TS/Vite 优先解析文件），
// 因此这里显式指向新目录的入口；旧体系文件不在本计划范围内，暂不改名。
import { createHostDeps, initPluginRuntime } from './plugins/runtime/index';
import { initAgent } from './agent';
import { useWindowFocus } from './hooks/useWindowFocus';
import 'highlight.js/styles/atom-one-dark.css';
import {
  getCurrentColorTheme,
  getCurrentAppearance,
  getCurrentFontFamily,
  getCurrentEditorFontFamily,
  applyColorTheme,
  applyAppearance,
  applyFontFamily,
  applyEditorFontFamily,
  initThemeRegistry,
} from './components/styles';

const SettingsWindow = lazy(() =>
  import("./components/SettingsWindow").then(m => ({ default: m.SettingsWindow }))
);
const AcknowledgmentsWindow = lazy(() =>
  import("./components/AcknowledgmentsWindow").then(m => ({ default: m.AcknowledgmentsWindow }))
);
const PrivacyWindow = lazy(() =>
  import("./components/PrivacyWindow").then(m => ({ default: m.PrivacyWindow }))
);
const OnboardingWindow = lazy(() =>
  import("./components/Onboarding/OnboardingWindow").then(m => ({ default: m.OnboardingWindow }))
);
async function initLog() {
  try {
    const { attachConsole } = await import('@tauri-apps/plugin-log');
    attachConsole().then(() => {
      logger.log('日志系统已初始化');
    }).catch((err: Error) => {
      logger.log('日志初始化失败（非 Tauri 环境）:', err);
    });
  } catch {
    logger.log('运行在浏览器环境，Tauri 日志不可用');
  }
}

initLog();
initTouchDeviceClass();
initNativeContextMenuGuard();
installEditorHost();
startupMark('js:boot');

function isSettingsWindow(): boolean {
  return window.location.pathname === '/settings';
}

function isAcknowledgmentsWindow(): boolean {
  return window.location.pathname === '/acknowledgments';
}

function isPrivacyWindow(): boolean {
  return window.location.pathname === '/privacy';
}

function isOnboardingWindow(): boolean {
  return window.location.pathname === '/onboarding';
}

function Root() {
  useWindowFocus();

  if (isSettingsWindow()) {
    return <SettingsWindow />;
  }

  if (isAcknowledgmentsWindow()) {
    return <AcknowledgmentsWindow />;
  }

  if (isPrivacyWindow()) {
    return <PrivacyWindow />;
  }

  if (isOnboardingWindow()) {
    return <OnboardingWindow />;
  }

  return <App />;
}

try {
  applyColorTheme(getCurrentColorTheme());
  applyAppearance(getCurrentAppearance());
  applyFontFamily(getCurrentFontFamily());
  applyEditorFontFamily(getCurrentEditorFontFamily());
} catch (e) {
  console.error('[Startup] Failed to apply theme:', e);
}

async function bootstrap(): Promise<void> {
  // Agent 配置先于插件加载：插件在 activate 里读 `host.agent.available()` 时
  // 必须已经反映真实配置，否则可用插件会被误判为不可用。
  try {
    await initAgent();
  } catch (error) {
    console.error('[agent] init failed', error);
  }
  startupMark('js:agent-ready');
  try {
    await initPlugins();
  } catch (error) {
    console.error('[Startup] Plugin init failed:', error);
  }
  startupMark('js:plugins-ready');
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <Suspense fallback={<div id="root-fallback" />}>
        <Root />
      </Suspense>
    </React.StrictMode>
  );
  startupMark('js:render-called');
  installStartupObservers();

  // 新插件运行时在首屏渲染之后启动：插件 onload 慢或卡住都不该拖住白屏。
  // 宿主能力由 createHostDeps() 桥接到旧体系（文档读写复用 App 注入的 host deps）。
  void createHostDeps()
    .then((deps) => initPluginRuntime(deps))
    .catch((error) => {
      console.error('[Startup] Plugin runtime init failed:', error);
    });

  // 渲染完成后立即显示窗口（取代 setTimeout 50ms 硬延迟）
  // 设置窗口/致谢/隐私窗口由自身控制 show() 时机，避免白屏闪烁
  if (!isSettingsWindow() && !isAcknowledgmentsWindow() && !isPrivacyWindow() && !isOnboardingWindow()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      // 主窗口的显示时机由 App 决定（可能先显示设置向导，完成后才显示编辑器）
      if (win.label === 'main') return;
      // 仅在首次创建（不可见）时显示；页面重载时窗口已可见，重复 show() 会置顶抢焦点
      if (await showWindowIfHidden(win)) {
        logger.log('[Startup] Window shown');
      }
    } catch (e) {
      console.error('[Startup] Failed to show window:', e);
    }
  }
}

void bootstrap().catch((error) => {
  console.error('[Startup] bootstrap failed:', error);
});

// 空闲时完成主题初始化（加载主题注册表、监听系统外观变化）
function finalizeThemeInit() {
  initThemeRegistry()
    .then(() => {
      // 注册表就绪后重新应用主题：顶部已同步应用内置主题防闪，
      // 这里确保第三方用户主题也能正确加载。
      applyColorTheme(getCurrentColorTheme());
      // 延迟启用主题过渡动画，防止初始加载时颜色渐变造成的闪烁
      setTimeout(() => {
        document.documentElement.classList.add('theme-transition-enabled');
      }, 500);
    })
    .catch((e) => {
      console.error('[Theme] Failed to finalize theme init:', e);
    });

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    const currentAppearance = getCurrentAppearance();
    if (currentAppearance === 'system') {
      // 统一走 applyAppearance（dark class + Windows 光标更新）
      applyAppearance(currentAppearance);
      window.dispatchEvent(new CustomEvent('appearancechange', { detail: currentAppearance }));
    }
  });
}

if ('requestIdleCallback' in window) {
  requestIdleCallback(finalizeThemeInit, { timeout: 2000 });
} else {
  setTimeout(finalizeThemeInit, 1000);
}
