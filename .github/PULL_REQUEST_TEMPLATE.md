## 这个 PR 做了什么

<!-- 一两句话说明动机与结果 -->

## 关联 issue

<!-- 例如 Closes #123 -->

## 改动类型

- [ ] 修复缺陷
- [ ] 新功能
- [ ] 重构（不改变行为）
- [ ] 文档 / 构建 / 杂项

## 如何验证

<!-- 复现步骤、测试命令、截图或录屏 -->

```sh
bun run typecheck
bun run test:plugins
```

## 检查清单

- [ ] 已在本地运行相关检查（`make check-ts` / `make check-rust`，如涉及 Rust）
- [ ] 新增行为有对应测试，或说明了无法测试的原因
- [ ] 涉及编辑器 DOM 的改动已在本机真机（WKWebView）冒烟
- [ ] 没有提交签名材料、API Key、DSN 或其他敏感信息
- [ ] 提交信息符合 Conventional Commits
