# Changelog

## [Unreleased]

- docs(README): README 默认英文，中文版独立为 `README.zh-CN.md`；补充官网与 App Store / Microsoft Store 下载入口
- docs(开源): 项目以 AGPL-3.0-or-later 开源，补充 NOTICE、THIRD_PARTY_NOTICES、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY 与 issue/PR 模板
- chore(构建): 仓库不再包含 Apple 签名材料与硬编码签名身份，签名身份改由 `TEXTO_APP_SIGNING_IDENTITY` / `TEXTO_INSTALLER_SIGNING_IDENTITY` 提供
- chore(隐私): 不再内置 Sentry DSN，从源码构建的版本不进行崩溃上报（官方构建经 `SENTRY_DSN` 注入）
- ci: 新增 GitHub Actions（前端类型检查/测试、Rust check/clippy）
- ci(构建): 新增 `Build` 工作流，手动触发或推送 `v*` 标签时产出 macOS DMG/PKG 与 Windows MSI/NSIS；签名材料只从仓库 secrets 读取，未配置时产出未签名包
- feat(构建): macOS 直接分发支持 Apple 公证——Developer ID + Hardened Runtime 签名（`entitlements-direct.plist`，不启用沙盒）后自动 `notarytool` 提交、staple 装订与 Gatekeeper 校验；推送 `v*` 标签时强制要求公证成功
- chore(构建): entitlements 中的团队 ID 改为 `YOUR_TEAM_ID` 占位，构建时由 `TEXTO_APPLE_TEAM_ID` 或签名身份末尾的 `(TEAMID)` 注入 `src-tauri/target/entitlements.<edition>.plist`，仓库不再包含团队 ID
- fix(插件): 文件类型支持改为由插件决定——白板（`.excalidraw`）等扩展名不再写进默认配置与系统文件关联，导入并启用对应插件后才可打开，禁用/卸载后自动失效

## [2.4.2]

- chore(维护): 移除演示站点、历史设计文档与未使用的静态资源，安装包更精简
- chore(插件): 下线内置 EPUB 导出插件，改由外部 Pandoc 插件提供（默认不启用），旧版本播种的副本会在启动时自动清理

## [2.4.1]

- feat(MCP): 内置本机 MCP 服务端（设置 → 实验功能），agent 可读取/改写当前文档、移动光标、打开文件、在工作区内新建文件
- feat(MCP): 写入默认按打字机节奏逐字呈现，期间锁定人工输入并显示「AI 正在输入」；多窗口下可指定目标窗口
- perf(编辑器): 移除分块加载，文档始终整篇渲染，源码模式、全选复制与保存不再受分块影响
- perf(编辑器): 复用序列化与行号换算缓存，长文档的编辑与保存更快

## [2.4.0]

- feat(插件): 全新的插件运行时（v1），支持从本地导入外部插件包（`.zip`），并在「设置 → 插件」中启用、禁用、卸载
- feat(插件): 插件面板显示版本与加载状态，新增安全模式开关（默认仅允许 `app.textox.*` 内置插件）
- feat(插件): Excalidraw 白板改为可独立安装的插件，导入后提供 `.excalidraw` 预览、文件编辑与「新建白板」命令
- feat(插件): 新增 `plugin-cli` 命令行，用于查看、安装、启用、禁用、卸载插件与切换安全模式
- feat(插件): 发布 `@textox/plugin-sdk` 契约包与 `@textox/plugin-build` 构建工具，第三方插件可打包为 `.zip` 分发
- feat(插件): 导入后自动刷新插件列表；加载失败的插件在列表中显示失败状态与原因，不阻塞应用启动
- fix(插件): 卸载插件时清理其配置与数据，避免残留
- perf(编辑器): 源码模式查找替换在编辑时按需刷新匹配与高亮，「全部替换」一次性应用变更
- perf(编辑器): 继续优化长文档的编辑与滚动性能

## [2.3.8]

- perf(编辑器): 大幅提升长文档输入响应，每次按键不再重复做全文行号换算与多次全文序列化，大文件打字更跟手
- perf(编辑器): 大纲只在标题被修改时重新提取，正文输入不再整篇扫描
- fix(编辑器): 大纲自动展开只补齐新标题，不再把用户手动折叠的节点重新展开
- perf(编辑器): 代码块语法高亮只更新被修改的代码块，滚动时不再遍历整篇文档，含代码块的大文档滚动更顺畅
- perf(编辑器): 源码模式输入不再重复计算光标行列与整篇大纲，搜索面板关闭时不再后台扫描匹配项
- perf(编辑器): 源码模式「全部替换」在超长文档上从约 300ms 降到 10ms 级；正则搜索增加上限与时间预算，异常表达式不再冻住界面
- perf(编辑器): 输入时文件树、大纲、标题栏与命令面板不再随每个字符重渲染；关闭字数统计后不再后台扫描全文
- perf(启动): 代码块语法高亮、代码块主题样式与导出压缩库改为按需加载，首屏脚本体积减少约 316KB

## [2.2.0]

- perf(打开): 分块阈值从 200KB 降到 100KB，标题优先 + 段落兜底切分，无标题与超大单章节文档也能分块
- perf(打开): 分块文档的大纲覆盖全文，点击未加载块的标题会先加载对应内容再滚动
- perf(打开): 分块文档切到源码模式时载入全文并结束本次分块，源码模式不再只显示部分内容
- perf(启动): 冷启动打开文档合并为一次 `open_document` IPC（临时文件判定 + 类型判定 + 读取）
- perf(启动): 临时文件列表在启动时并行预取，额外未保存文档的窗口延后到首屏后创建
- perf(编辑器): 大纲改为按需计算——悬浮面板与侧栏大纲都不可见、且未进入 `#` 命令模式时不提取
- fix(编辑器): 修复大文档滚动后行内 Markdown 标记（如 `**`）不隐藏、点击文本后才恢复的问题；分块自动加载改为监听真实滚动容器
- fix(编辑器): 侧边栏大纲、迷你地图提示和命令面板 `#` 结果不再显示标题里的 Markdown 标记（如 `**`、链接地址）

## [1.1.1]
- feat(编辑器): 支持按删除键删除标题节点
- feat(编辑器): 添加RTL语言支持并调整相关组件样式
- feat(编辑器): 支持`==text==`高亮文本和颜色设置
- feat(编辑器): 添加强制使用编辑器背景色选项
- feat(编辑器): 支持Diff语法高亮显示
- feat(编辑器): 支持源码模式的代码折叠和代码块高亮
- feat(目录树): 添加文件扩展名标签
- feat(标题栏): 添加文件扩展名标签显示功能
- fix(编辑器): 修复代码块主题切换无法切换主题高亮问题
- fix(编辑器): 修复空段落无法编辑问题
- fix(编辑器): 修复空段落子节点渲染问题
- chore(编辑器): 重构列表项插件实现，修复一堆BUG
- chore(编辑器): 移除内嵌字体，减少打包大小
- fix(设置): 修复重置设置未确认先恢复的问题
- fix(目录树): 初始渲染时禁用展开动画避免闪烁

## [1.0.16]

- fix(右键菜单): 修复复制为 HTML 选项不是 HTML 格式的问题
- fix(mathjax): 修复 MathJax 加载问题，修复化学公式显示问题
- feat(目录树): 优化目录树切换图标
- feat(目录树): 优化目录树展开状态，保证切换大纲返回时
- fix(目录树): 修复目录树底部节点被遮挡问题
- feat(目录树): 移除目录树横向滚动
- feat(设置): 重构设置窗口布局优化刷新动画，并添加导航图标

#### [1.0.14]

- feat(图片插件):优化图片编辑体验，支持图片ALT文本输入

## [1.0.6]

- feat(应用菜单): 更新菜单项，暂时禁用更新日志、官方网站、反馈、导出
- feat(应用菜单): 添加鸣谢窗口
- feat(应用菜单): 添加隐私政策窗口
- fix(应用菜单): 修复最近打开文件逻辑并同步菜单状态
- fix(最近文件): macOS 下最近文件权限处理，文档目录外文件需通过选择器重新选择
- fix(最近文件): 修复打开文件位置菜单项的启用状态同步

## [1.0.5]
- fix: 修复URL解析问题，支持Punycode域名解析，支持文内跳转
- fix: 修复标题输入法无法输入问题

## [1.0.4]
- feat(编辑器): 改进标题字体缩放逻辑并添加标题级别标记
- feat(类移动端展示模式): 添加移动端布局适配和响应式设计

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Editor**: 实现基于 Markdown 的文本渲染组件
- **Editor**: 实现多行文本编辑器组件并优化代码显示
- **Editor**: 添加编辑器模式切换和侧边栏宽度调整功能
- **Editor**: 替换 Vditor 为 ProseMirror 实现 Markdown 编辑器
- **Editor**: 改进列表处理并优化 markdown 序列化
- **Editor**: 添加代码块内回车退出功能
- **Editor**: 改进空状态布局并添加新建文件功能
- **Editor**: 添加斜杠命令菜单支持插入图片和表格
- **Editor**: 添加表格插入功能和目录树折叠功能
- **Editor**: 实现基于 AST 的 Markdown 表格编辑功能
- **Editor**: 新增表格编辑器组件及增强功能
- **Editor**: 添加行列操作柄并优化表格编辑交互
- **UI**: 初始化 Tauri + React + TypeScript 项目
- **UI**: 添加应用菜单和窗口配置优化
- **UI**: 使用 ant-design 图标替换自定义 svg 图标
- **UI**: 添加自定义标题栏并支持 Overlay 模式
- **UI**: 添加并更新多平台应用图标资源
- **UI**: 调整编辑器容器布局并更新主题颜色
- **UI**: 优化图片显示样式并调整 SlashBar 样式
- **UI**: 添加关闭动画效果
- **UI**: 添加表格行列参数配置功能
- **UI**: 调整空状态标题的字体大小和颜色
- **UI**: 调整最近访问文件夹的样式和间距
- **File**: 添加文件浏览器和 Markdown 编辑器功能
- **File**: 增强文件保存功能并添加快捷键支持
- **File**: 添加创建文件和文件夹功能
- **File**: 添加多选和删除文件/文件夹功能
- **File**: 添加在 Finder 中打开按钮并优化路径显示
- **File**: 添加打开文件和最近项目功能
- **File**: 添加根目录右键菜单和创建功能
- **Process**: 添加进程管理和窗口关闭确认功能
- **Window**: 实现多窗口管理功能
- **Window**: 实现多窗口功能并优化窗口创建逻辑
- **Settings**: 添加设置页面和模态框功能
- **Settings**: 新增快捷键配置功能并重构设置页面布局
- **Image**: 实现 Markdown 编辑器图片上传功能
- **Image**: 优化图片保存逻辑
- **Devtools**: 添加开发者工具支持
- **Logging**: 添加日志系统支持
- **Logging**: 添加日志导出功能

### Fixed

- **Editor**: 修复编辑器初始化及内容同步问题
- **Editor**: 修复文本替换和光标位置计算问题
- **Editor**: 修复图片和表格插入逻辑并简化代码
- **Editor**: 修复插入表格后缺少换行符的问题
- **Editor**: 修复表格分隔线位置计算和删除按钮显示逻辑
- **Editor**: 优化 SlashBar 位置计算防止超出窗口
- **Editor**: 优化斜杠命令触发位置计算
- **Editor**: 优化 SlashBar 触发逻辑并移除无用代码
- **Editor**: 移除冗余的 contentRef 更新逻辑并添加输入日志
- **Editor**: 关闭斜杠菜单后自动聚焦到编辑器
- **Editor**: 显示工具栏以提供更好的用户体验
- **Editor**: 修复代码块和行内代码的样式问题
- **Editor**: 修复编辑器内容同步和样式问题
- **Editor**: 修复空列表项处理逻辑以支持子列表
- **UI**: 调整设置页面布局和样式
- **UI**: 调整文本输入框高度样式以填满父容器
- **Window**: 修复多窗口事件处理和窗口创建逻辑
- **Table**: 调整表格分隔线和操作柄的样式及交互

### Refactored

- **Editor**: 重构 heading 组件并调整模块结构
- **Editor**: 移除斜杠工具栏功能并添加最近访问文件夹功能
- **Editor**: 移除 MarkdownEditor 中的表格增强功能
- **Editor**: 使用 prosemirror-schema-list 重构列表缩进逻辑
- **UI**: 移除未使用的 getCurrentWindow 导入
- **UI**: 移除未使用的导入和变量
- **Logging**: 移除导出日志的原子标志检查逻辑

### Style

- **UI**: 调整最近访问文件夹的样式和间距

### Performance

- **Build**: 配置代码分割优化打包体积
