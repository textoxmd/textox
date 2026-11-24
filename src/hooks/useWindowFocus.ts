import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useWindowFocus(): boolean {
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    let unlisten: () => void | undefined;

    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        setIsFocused(focused);
        document.documentElement.classList.toggle('window-inactive', !focused);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        setIsFocused(true);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  return isFocused;
}
