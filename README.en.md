# Textox

[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![CI](https://github.com/textoxmd/textox/actions/workflows/ci.yml/badge.svg)](https://github.com/textoxmd/textox/actions/workflows/ci.yml)
[![Build](https://github.com/textoxmd/textox/actions/workflows/build.yml/badge.svg)](https://github.com/textoxmd/textox/actions/workflows/build.yml)

[简体中文](README.md) | **English**

Textox is a local-first Markdown editor: minimal by design, ready out of the box, and
built around an IDE-like workspace. It is written with Tauri v2, React and ProseMirror.

## Features

- **Two editing modes**: WYSIWYG (IR) and source view (SV), sharing one undo/redo history
- **Math**: bundled MathJax with LaTeX and mhchem support
- **Diagrams**: Mermaid flowcharts, sequence diagrams, Gantt charts and more
- **Code blocks**: syntax highlighting with a CodeMirror editing experience
- **Tables, task lists, footnotes, highlights** and other Markdown extensions
- **Whiteboard**: `.excalidraw` file editing and inline preview built on an Excalidraw fork (provided by a plugin)
- **Themes**: multiple editor themes and font choices
- **Images**: paste to save, pluggable upload providers
- **Workspace**: sidebar file tree, multiple windows, in-file search
- **Plugins**: external plugin runtime with declarative extension points
- **AI**: bring your own API key, used by explanation/translation plugins
- **MCP server**: loopback-only MCP endpoint for external agents to read and edit the active document

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| Editor | ProseMirror (IR), CodeMirror 6 (SV) |
| Rendering / export | markdown-it, Mermaid, MathJax, highlight.js |
| Package manager | Bun (required) |

## Prerequisites

- [Bun](https://bun.sh) 1.2+
- Rust stable (rustup) plus the Tauri 2 system dependencies — see
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- Node.js 20+ (used by some build scripts)
- macOS: Xcode Command Line Tools

## Getting started

The repository uses 4 git submodules; clone them together with the repo:

```sh
git clone --recurse-submodules https://github.com/textoxmd/textox.git
cd Textox

# if you cloned without submodules
git submodule update --init --recursive

bun install
(cd src-tauri && cargo fetch)
```

Run it:

```sh
bun run app:dev      # full desktop app (Tauri + Vite)
bun run dev          # frontend only, open http://localhost:1420
```

## Build and package

All builds go through one entry point with the same flags:
`--edition full|lite`, `--platform macos|windows`, `--store`.

```sh
bun run app:dev
bun run app:dev -- --edition lite

bun run app:build
bun run app:build -- --edition lite
bun run app:build -- --debug --no-sign

bun run app:package                 # direct install: DMG / MSI+NSIS
bun run app:package -- --edition lite
bun run app:package -- --store      # stores: PKG / MSIX
```

> On Windows, the free and paid editions currently ship identical features; only the
> bundle identifier and store listing differ.

Installers (DMG / PKG / MSIX) are copied to `out/`; MSI/NSIS remain under
`src-tauri/target/release/bundle/`. `make` is a thin alias around `scripts/build/`.

### Code signing

The repository contains **no** Apple certificates or provisioning profiles. Signing
identities are read from the environment only:

```sh
export TEXTO_APP_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export TEXTO_INSTALLER_SIGNING_IDENTITY="Developer ID Installer: Your Name (TEAMID)"
```

Without them the build skips signing and prints a warning; pass `--no-sign` to skip
explicitly. Store (PKG) builds additionally require
`embedded.provisionprofile` / `embedded.provisionprofile.lite` in `src-tauri/`
(gitignored).

> `src-tauri/entitlements*.plist` still carries the original team's
> `com.apple.application-identifier` and `com.apple.developer.team-identifier`.
> Replace them with your own Team ID before doing App Store builds; for local/direct
> builds you can drop both keys.

### Crash reporting

No Sentry DSN is baked into the repository, so builds from source send nothing.
Official builds inject one at compile time:

```sh
SENTRY_DSN="https://<key>@<host>/<project>" bun run app:build
```

## Building on GitHub Actions

The repository ships two workflows:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | push (main / develop), PR | typecheck, architecture guards, frontend/Rust tests, `cargo check` / `clippy` |
| `build.yml` | manual `Run workflow`, `v*` tag push | installers: macOS DMG (full / lite, universal) + Windows MSI/NSIS |

A manual run lets you pick `edition` (`both` / `full` / `lite`) and `store` (macOS PKG instead of DMG).
Pushing a `v*` tag also attaches the artifacts to a **draft release**.

**No secrets are required** — the output is simply unsigned. For distribution, add these under
Settings → Secrets and variables → Actions:

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE_P12` | base64 of your signing certificate `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password |
| `APPLE_PROVISION_PROFILE` | base64 of the full-edition Mac App Store profile |
| `APPLE_PROVISION_PROFILE_LITE` | base64 of the lite-edition profile |
| `TEXTO_APP_SIGNING_IDENTITY` | e.g. `Apple Distribution: Your Name (TEAMID)` |
| `TEXTO_INSTALLER_SIGNING_IDENTITY` | e.g. `3rd Party Mac Developer Installer: Your Name (TEAMID)` |

You also need to replace the Team ID in `src-tauri/entitlements*.plist` (see above).
Windows code signing is not wired up yet, so MSI/NSIS trigger SmartScreen.

Caveats:

- macOS runners bill at 10× minutes; on a private repo watch your quota (or build only `full`).
- Unsigned DMGs are blocked by Gatekeeper elsewhere: right-click open, or
  `xattr -dr com.apple.quarantine Textox.app`.
- Notarization (`notarytool`) is not implemented yet; add it before public distribution.
- Parts of `bun.lock` pin Chinese mirrors — installs work on CI but can be slower.

## Tests and checks

```sh
bun run typecheck                              # whole-repo typecheck
bun run test:plugins                           # plugin/runtime contract tests
bun run check:skeleton                         # no plugin-specific literals in the skeleton
bun run check:editor-boundary                  # editor must not import app code
bun run check:version                          # version consistency

bunx vitest run --config src/components/TextoEditor/vitest.config.ts

make check                                     # frontend + Rust
make check-rust                                # cargo check + clippy -D warnings
```

## Project layout

```
src/                      React frontend (@/ → src/)
  components/TextoEditor/ ProseMirror editor (own tsconfig / vitest config)
  plugins/                plugin runtime, registry and host capabilities
  agent/                  AI model profiles and runtime
src-tauri/                Tauri v2 Rust backend (incl. MCP server)
packages/                 internal workspace packages
test-fixtures/plugins/    first-party plugin fixtures (not shipped)
vendor/                   git submodules (excalidraw / translations / plugin-sdk / mkdext)
scripts/build/            unified dev / build / package entry points
docs/                     plugin development, runtime and icon specs
openspec/                 change proposals and specs
```

## Plugin development

The plugin contract lives in [`vendor/plugin-sdk`](vendor/plugin-sdk); the build tool is
`@textox/plugin-build`. See [docs/plugin-development.md](docs/plugin-development.md),
[docs/plugin-runtime.md](docs/plugin-runtime.md) and
[docs/plugin-icon-spec.md](docs/plugin-icon-spec.md).

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first. Develop against `develop`; `main` is for
releases.

## Security

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

## License

Released under the [GNU Affero General Public License v3.0 or later](LICENSE).
The `Textox` name, logo and icons are not covered by the license — see [NOTICE](NOTICE).

Third-party copyrights and licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (the Apache-2.0 text for MathJax is at
[public/mathjax/LICENSE](public/mathjax/LICENSE)).
