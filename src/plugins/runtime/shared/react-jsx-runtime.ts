// `react/jsx-runtime` 是 CJS 转发模块，`export *` 在构建期会丢光具名导出；
// 插件以 `jsx: react-jsx` 编译时正是从这里取 `jsx` / `jsxs` / `Fragment`。
export { Fragment, jsx, jsxs } from 'react/jsx-runtime';
