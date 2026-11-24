import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// Eager 懒加载外壳：只依赖 prosemirror-state / view（进主 bundle）。
// 真正的工具栏实现（React + 图标 + CSS，见 ./toolbar）在 view() 时才
// 动态 import，避免把表格悬浮工具栏拖进首屏包。与 HTML 插件的
// `lazyHtmlViewPlugin` 同构。
export function lazyTableToolbarPlugin(): Plugin {
  return new Plugin({
    view(view: EditorView) {
      let handle: { update(): void; destroy(): void } | null = null;
      let destroyed = false;
      void import('./toolbar')
        .then(({ createTableToolbar }) => {
          if (destroyed) return;
          handle = createTableToolbar(view);
          // PM 不在 view 创建时回调 update，且 import 完成前的 update 因
          // handle 为空被吞；显式补首帧，等效核心同步注册 focusin。
          handle.update();
        })
        .catch((err) => {
          if (import.meta.env.DEV) console.warn('[table] toolbar chunk load failed', err);
        });
      return {
        update() {
          handle?.update();
        },
        destroy() {
          destroyed = true;
          handle?.destroy();
        },
      };
    },
  });
}
