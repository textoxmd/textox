import { useRef, useLayoutEffect } from 'react';

interface UseHeightAnimationOptions {
  duration?: number;
  easing?: string;
  noAnimation?: boolean;
}

export function useHeightAnimation(
  isExpanded: boolean,
  options: UseHeightAnimationOptions = {}
) {
  const ref = useRef<HTMLDivElement>(null);
  const prevExpanded = useRef(isExpanded);

  const {
    duration = 300,
    easing = 'cubic-bezier(0.4, 0, 0.2, 1)',
    noAnimation = false,
  } = options;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (noAnimation) {
      prevExpanded.current = isExpanded;
      el.style.transition = 'none';
      el.style.height = isExpanded ? '' : '0px';
      el.style.opacity = isExpanded ? '' : '0';
      el.style.overflow = isExpanded ? '' : 'hidden';
      return;
    }

    if (prevExpanded.current === isExpanded) {
      el.style.transition = 'none';
      el.style.height = isExpanded ? '' : '0px';
      el.style.opacity = isExpanded ? '' : '0';
      el.style.overflow = isExpanded ? '' : 'hidden';
      return;
    }

    prevExpanded.current = isExpanded;

    const transition = `height ${duration}ms ${easing}, opacity ${duration}ms ${easing}`;
    const targetHeight = el.scrollHeight;

    if (isExpanded) {
      el.style.transition = 'none';
      el.style.height = '0px';
      el.style.opacity = '0';
      el.style.overflow = 'hidden';
      void el.offsetHeight;
      el.style.transition = transition;
      el.style.height = `${targetHeight}px`;
      el.style.opacity = '1';
      el.style.overflow = '';
    } else {
      el.style.transition = 'none';
      el.style.height = `${targetHeight}px`;
      el.style.opacity = '1';
      void el.offsetHeight;
      el.style.transition = transition;
      el.style.height = '0px';
      el.style.opacity = '0';
      el.style.overflow = 'hidden';
    }

    const handleTransitionEnd = () => {
      if (isExpanded) {
        el.style.height = '';
        el.style.transition = 'none';
      }
    };

    el.addEventListener('transitionend', handleTransitionEnd, { once: true });
    return () => {
      el.removeEventListener('transitionend', handleTransitionEnd);
    };
  }, [isExpanded, duration, easing, noAnimation]);

  return ref;
}
