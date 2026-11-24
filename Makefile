# =============================================================================
# Textox 构建入口（薄别名层）
# =============================================================================
# 真正的构建逻辑在 scripts/build/cli.mjs；本文件只提供 make 习惯用法。
# 平台相关的签名/打包细节也由 cli.mjs 处理。
# =============================================================================

PKG_MANAGER := bun
VERSION := $(shell node -p "require('./src-tauri/tauri.conf.json').version")

.PHONY: default help
default: help

help:
	@echo "============================================================================="
	@echo "Textox 构建命令（当前版本 $(VERSION)）"
	@echo "============================================================================="
	@echo "开发:"
	@echo "  make dev            启动桌面开发模式（完整版）"
	@echo "  make dev-lite       启动桌面开发模式（Lite）"
	@echo "  make dev-web        仅启动前端开发服务器（浏览器）"
	@echo ""
	@echo "构建:"
	@echo "  make build          构建完整版（只出应用本体）"
	@echo "  make build-lite     构建 Lite 版"
	@echo "  make build-debug    调试构建"
	@echo "  make build-local    本地构建（不签名，启用 DevTools）"
	@echo ""
	@echo "打包:"
	@echo "  make package        直接安装渠道（macOS: DMG；Windows: MSI/NSIS）"
	@echo "  make package-lite   直接安装渠道（Lite）"
	@echo "  make package-store  应用商店渠道（macOS: full+lite PKG；Windows: MSIX）"
	@echo ""
	@echo "检查:"
	@echo "  make check          typecheck + 骨架/边界/版本号 + Rust 检查"
	@echo "  make check-ts       TypeScript 类型检查 + 硬规则 + 版本号"
	@echo "  make check-rust     cargo check + clippy"
	@echo "  make lint           cargo fmt --check"
	@echo ""
	@echo "维护:"
	@echo "  make install        安装前端 + Rust 依赖"
	@echo "  make update         更新依赖"
	@echo "  make clean          清理 dist / target / out"
	@echo "  make icons          重新生成完整版图标"
	@echo "  make icons-lite     重新生成 Lite 版图标"
	@echo "  make info           显示项目信息"
	@echo ""
	@echo "Git:"
	@echo "  make git-status / git-commit / git-push"
	@echo "============================================================================="

# ── 开发 ──────────────────────────────────────────────────────────────────────
.PHONY: dev dev-lite dev-web
dev:
	$(PKG_MANAGER) run app:dev

dev-lite:
	$(PKG_MANAGER) run app:dev -- --edition lite

dev-web:
	$(PKG_MANAGER) run dev

# ── 构建 ──────────────────────────────────────────────────────────────────────
.PHONY: build build-lite build-debug build-local
build:
	$(PKG_MANAGER) run app:build

build-lite:
	$(PKG_MANAGER) run app:build -- --edition lite

build-debug:
	$(PKG_MANAGER) run app:build -- --debug

build-local:
	TEXTO_DEVTOOLS=1 $(PKG_MANAGER) run app:build -- --no-sign

# ── 打包 ──────────────────────────────────────────────────────────────────────
.PHONY: package package-lite package-store
package:
	$(PKG_MANAGER) run app:package

package-lite:
	$(PKG_MANAGER) run app:package -- --edition lite

package-store:
	$(PKG_MANAGER) run app:package -- --store

# ── 检查 ──────────────────────────────────────────────────────────────────────
.PHONY: check check-ts check-rust lint
check: check-ts check-rust
	@echo "✅ 所有检查通过"

check-ts:
	$(PKG_MANAGER) run typecheck
	$(PKG_MANAGER) run check:skeleton
	$(PKG_MANAGER) run check:editor-boundary
	$(PKG_MANAGER) run check:version

check-rust:
	cd src-tauri && cargo check
	cd src-tauri && cargo clippy -- -D warnings

lint:
	cd src-tauri && cargo fmt -- --check

# ── 依赖 ──────────────────────────────────────────────────────────────────────
.PHONY: install update
install:
	$(PKG_MANAGER) install
	cd src-tauri && cargo fetch

update:
	$(PKG_MANAGER) update
	cd src-tauri && cargo update

# ── 清理 ──────────────────────────────────────────────────────────────────────
.PHONY: clean clean-dist clean-target
clean: clean-dist clean-target
	rm -rf out
	@echo "🧹 所有构建产物已清理"

clean-dist:
	rm -rf dist

clean-target:
	rm -rf src-tauri/target

# ── 图标 ──────────────────────────────────────────────────────────────────────
.PHONY: icons icons-lite
icons:
	node scripts/build/icons.mjs generate --edition full

icons-lite:
	node scripts/build/icons.mjs generate --edition lite

# ── 信息 ──────────────────────────────────────────────────────────────────────
.PHONY: info
info:
	@echo "============================================================================="
	@echo "Textox 项目信息"
	@echo "============================================================================="
	@echo "版本号: $(VERSION)"
	@echo "项目根目录: $(CURDIR)"
	@echo ""
	@echo "Bun: $(shell bun --version 2>/dev/null || echo '未安装')"
	@echo "Node: $(shell node --version 2>/dev/null || echo '未安装')"
	@echo "Rust: $(shell rustc --version 2>/dev/null || echo '未安装')"
	@echo "Cargo: $(shell cargo --version 2>/dev/null || echo '未安装')"
	@echo "============================================================================="

# ── Git（保留给 git-workflow.md 使用） ────────────────────────────────────────
.PHONY: git-status git-commit git-push
git-status:
	@git status --short

git-commit:
	@git fetch --prune
	@git status --short
	@if [ -z "$$(git status --short)" ]; then \
		echo "⚠️  没有待提交的变更，请先用 git add 暂存文件"; \
		exit 1; \
	fi
	@echo "📝 Commit Message 格式: <type>(<scope>): <description>"
	@git commit --template .git-commit-template.txt

git-push:
	@git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1 || { \
		echo "⚠️  未设置上游分支，请使用 git push --set-upstream"; \
		exit 1; \
	}
	@ahead="$$(git rev-list --count @{u}..HEAD)"; \
	if [ "$$ahead" -eq 0 ]; then \
		echo "⚠️  没有本地提交需要推送"; \
		exit 1; \
	fi; \
	echo "📤 推送 $$ahead 个提交至远程..."; \
	git push; \
	echo "✅ 推送完成"
