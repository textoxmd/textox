// Vitest 全局 setup。
//
// Node 22+ 默认启用实验性 WebStorage，会遮蔽 happy-dom 的 localStorage 实现
// （详见 vitest.setup.localstorage.ts）。该兼容层单独成文件，因为编辑器
// vitest 配置（会收集骨架测试）也需要挂载它。
import './vitest.setup.localstorage';
