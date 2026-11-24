// `react-dom` 是 CJS 模块，需显式列出具名导出（见 shared/react.ts 的说明）。
export {
  createPortal,
  findDOMNode,
  flushSync,
  hydrate,
  render,
  unmountComponentAtNode,
  unstable_batchedUpdates,
  unstable_renderSubtreeIntoContainer,
  version,
} from 'react-dom';
// 刻意选择：`createRoot`/`hydrateRoot` 取自 `react-dom/client`，与宿主 `src/main.tsx`
// 使用的是同一实现；`require('react-dom').createRoot` 只是带 "not supported" 警告的兼容壳，
// 二者并非同一函数，因此这里不做“从 react-dom 再导出”的类型妥协。
export { createRoot, hydrateRoot } from 'react-dom/client';
export { default } from 'react-dom';
