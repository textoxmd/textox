import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isMobilePlatform } from '@/utils/platform';
import { recordAppLaunch, maybeRequestAppReview } from '@/utils/reviewPrompt';
import { shouldAutoShowOnboarding } from '@/components/Onboarding/onboardingStore';
import { resolveOnboardingContext } from '@/components/Onboarding/resolveOnboardingContext';
import { isMainWindow, showWindowIfHidden } from '@/utils/windowManager';

/**
 * 启动期窗口相关副作用：系统评分弹窗请求、设置向导门控。
 * 仅主窗口生效；引导窗口打开时主窗口保持隐藏。
 *
 * @param onOnboardingClosed 自动引导关闭后、主窗口显示前的回调（用于落地启动模式等选择）；
 *   回调放在 ref 里读取，避免其身份变化导致 effect 重跑、重复开向导窗口。
 */
export function useStartupPrompts(
  isInitializing: boolean,
  onOnboardingClosed?: () => Promise<void> | void,
) {
  const onOnboardingClosedRef = useRef(onOnboardingClosed);
  onOnboardingClosedRef.current = onOnboardingClosed;

  // 系统评分：主窗口在启动若干次后，于自然时机请求系统评分弹窗
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isMain = await isMainWindow();
        if (!isMain) return;
        recordAppLaunch();
        // 等启动完全稳定后再请求，避免打断首次体验
        window.setTimeout(async () => {
          if (cancelled) return;
          // 引导窗口还开着时不打扰（下次启动再评）
          try {
            const { version, previousVersion } = await resolveOnboardingContext();
            if (shouldAutoShowOnboarding(version, previousVersion)) return;
          } catch {
            // 取版本失败不阻断评分流程
          }
          await maybeRequestAppReview();
        }, 5000);
      } catch (error) {
        console.error('Failed to set up review prompt:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 设置向导：需要引导时主窗口保持隐藏，只打开向导窗口，完成后再显示编辑器
  useEffect(() => {
    if (isInitializing) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await isMainWindow())) return;
        const win = getCurrentWindow();
        const { version, previousVersion } = await resolveOnboardingContext();
        if (!shouldAutoShowOnboarding(version, previousVersion)) {
          await showWindowIfHidden(win);
          return;
        }
        // 移动端暂不展示独立引导窗口，直接进入主界面
        if (isMobilePlatform()) {
          await showWindowIfHidden(win);
          return;
        }
        // 引导优先：先挂监听（避免竞态），再打开向导窗口，主窗口暂不显示
        let handled = false;
        const unlisten = await listen('onboarding-closed', () => {
          if (handled) return;
          handled = true;
          // 先落地向导里的启动模式（如工作区），再显示窗口，避免先闪一下空白页
          void (async () => {
            try {
              await onOnboardingClosedRef.current?.();
            } catch (error) {
              console.error('Failed to apply onboarding result:', error);
            } finally {
              win.show().catch(() => {});
              win.setFocus().catch(() => {});
              unlisten();
            }
          })();
        });
        if (cancelled) {
          unlisten();
          await showWindowIfHidden(win);
          return;
        }
        await invoke('create_onboarding_window').catch((error) => {
          console.error('Failed to open onboarding window:', error);
          unlisten();
          showWindowIfHidden(win).catch(() => {});
        });
      } catch (error) {
        console.error('Failed to set up onboarding:', error);
        showWindowIfHidden(getCurrentWindow()).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isInitializing]);
}
