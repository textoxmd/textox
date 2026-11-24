# Git Workflow

## 流程规范

提交代码请按以下顺序操作：

```
git add <files>          → 暂存变更
make git-commit          → 拉取远程 + 提交（自动检查）
make git-push            → 推送至远程
```

### 步骤说明

1. **暂存变更** — 使用 `git add` 将需要提交的文件加入暂存区
2. **提交** — 运行 `make git-commit`，自动执行：
   - `git fetch --prune` 拉取最新远程变更
   - 检查是否有暂存文件，无则提示中止
   - 显示 Commit Message 模板供填写
   - 使用 `git commit --template` 创建提交
3. **推送** — 运行 `make git-push`，自动执行：
   - 检查本地分支是否有超前提交
   - 执行 `git push`

## Commit Message 格式

```
<type>(<scope>): <description>
```

### Type 必选

| Type       | 说明 |
|-----------|------|
| `feat`    | 新功能 |
| `fix`     | Bug 修复 |
| `chore`   | 构建、依赖、工具等杂项 |
| `docs`    | 文档变更 |
| `refactor`| 重构（非修复非功能） |
| `style`   | 代码风格变更（格式化等） |
| `perf`    | 性能优化 |
| `test`    | 测试相关 |

### Scope 可选

作用域是受影响的模块简称，例如 `editor`、`i18n`、`theme`、`git`。

### Description 必选

简要的祈使句描述，中文或英文均可。

### 示例

```
feat(editor): support markdown shortcut
fix: correct typo in login page
chore: update dependencies
refactor(theme): simplify color variable naming
```

## Makefile 命令

| 命令 | 说明 |
|------|------|
| `make git-status` | 查看当前变更摘要 |
| `make git-commit` | 拉取 + 检查 + 提交（推荐） |
| `make git-push` | 检查超前提交 + 推送 |
