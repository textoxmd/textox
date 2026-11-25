# Textox

[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![CI](https://github.com/textoxmd/textox/actions/workflows/ci.yml/badge.svg)](https://github.com/textoxmd/textox/actions/workflows/ci.yml)
[![Build](https://github.com/textoxmd/textox/actions/workflows/build.yml/badge.svg)](https://github.com/textoxmd/textox/actions/workflows/build.yml)
[![Website](https://img.shields.io/badge/website-textox.app-1f6feb?logo=safari&logoColor=white)](https://textox.app/)
[![App Store](https://img.shields.io/badge/App_Store-Download-0d96f6?logo=apple&logoColor=white)](https://apps.apple.com/cn/app/textox-markdown-%E7%BC%96%E8%BE%91%E5%99%A8/id6762083180?mt=12)

**English** | [简体中文](README.zh-CN.md)

Textox is a local-first Markdown editor: minimal by design, ready out of the box, and
built around an IDE-like workspace. It is written with Tauri v2, React and ProseMirror.

## Download

| Platform | Link |
| --- | --- |
| macOS (App Store) | [Textox Markdown Editor](https://apps.apple.com/cn/app/textox-markdown-%E7%BC%96%E8%BE%91%E5%99%A8/id6762083180?mt=12) — full edition |
| macOS (free) | [Textox Lite](https://apps.apple.com/cn/app/textox-lite-markdown%E7%BC%96%E8%BE%91%E5%99%A8/id6777365755?mt=12) — App Store |
| Windows | [Microsoft Store](https://apps.microsoft.com/detail/9pm13wbd5ssc) |
| Any | [GitHub Releases](https://github.com/textoxmd/textox/releases) — DMG / MSI / NSIS |
| Website | [textox.app](https://textox.app/) |

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

### Code signing and notarization

The repository contains **no** Apple certificates, provisioning profiles or notarization
credentials — everything comes from the environment. The two channels use different certs:

| Channel | Artifact | Certificate | Notarization |
|---|---|---|---|
| Direct download (`app:package`) | DMG | `Developer ID Application` | required (automatic) |
| App Store (`app:package -- --store`) | PKG | `Apple Distribution` + profile | not needed |

Direct download (DMG):

```sh
export TEXTO_APP_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export TEXTO_APPLE_TEAM_ID="TEAMID"             # optional when the identity ends with "(TEAMID)"

# notarization credentials, pick one:
export TEXTO_NOTARY_KEYCHAIN_PROFILE="notary"   # xcrun notarytool store-credentials notary
# or Apple ID + app-specific password
export TEXTO_NOTARY_APPLE_ID="you@example.com"
export TEXTO_NOTARY_PASSWORD="abcd-efgh-ijkl-mnop"
# or an App Store Connect API key
export TEXTO_NOTARY_API_KEY="/path/to/AuthKey_XXXX.p8"
export TEXTO_NOTARY_API_KEY_ID="XXXX"
export TEXTO_NOTARY_API_ISSUER="xxxx-xxxx-xxxx"  # required for team keys

bun run app:package
```

The flow: Tauri signs the app with Developer ID + Hardened Runtime
(`src-tauri/entitlements-direct.plist`, sandbox disabled) → DMG → DMG is signed →
`notarytool submit --wait` → `stapler staple` → `stapler validate` + `spctl`. On success it
prints “已公证并装订，可直接分发”.

Without certs/credentials the build warns and skips (local testing only); set
`TEXTO_REQUIRE_NOTARIZATION=1` to fail instead. `--no-sign` / `--no-notarize` skip explicitly.

> `Apple Distribution` and `3rd Party Mac Developer` certificates **cannot** be notarized.
> The script detects a non-`Developer ID Application` identity and skips (or fails in
> required mode).

Store (PKG) builds additionally need `embedded.provisionprofile` /
`embedded.provisionprofile.lite` in `src-tauri/` (gitignored) and an Apple Distribution cert.

`src-tauri/entitlements*.plist` keeps `YOUR_TEAM_ID` as a placeholder. The build script
substitutes the real Team ID into `src-tauri/target/entitlements.<edition>.plist` and
hands that file to `codesign`, so no Team ID lives in the repository.

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
| `TEXTO_APPLE_TEAM_ID` | optional; Team ID, otherwise parsed from `(TEAMID)` in the identities above |

The Team ID is injected into entitlements at build time (the repo only has a `YOUR_TEAM_ID`
placeholder), so there is nothing to edit by hand.
Windows code signing is not wired up yet, so MSI/NSIS trigger SmartScreen.

#### Preparing the Apple secrets

1. **Developer ID certificate** — in Keychain Access → Certificate Assistant →
   *Request a Certificate from a Certificate Authority*, upload the CSR at
   [developer.apple.com](https://developer.apple.com/account/resources/certificates) →
   *Developer ID Application*, download and install it, then export it **with its private key**
   as `.p12`.
2. **Notarization credentials** — either of these works, pick one:
   - **Apple ID + app-specific password** (simplest, and the only option for individual accounts
     that have no *Team Keys*): sign in at [appleid.apple.com](https://appleid.apple.com) →
     *Sign-In and Security* → *App-Specific Passwords* → create one (e.g. `notarytool`).
     `notarytool` accepts it from CI without any 2FA prompt.
   - **App Store Connect API key** (only the Account Holder/Admin sees *Users and Access* →
     *Integrations* → *Team Keys*): create a key with the **Developer ID** role, download
     `AuthKey_XXXX.p8` (only once), and note the Key ID and Issuer ID shown above the list.
3. Fill the secrets (works from a terminal; `gh` must be authenticated as a repo admin):

```sh
REPO=textoxmd/textox

# certificate, base64 (newlines are stripped by the workflow anyway)
base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE_P12 -R "$REPO"
gh secret set APPLE_CERTIFICATE_PASSWORD -R "$REPO" --body 'your-p12-password'
gh secret set TEXTO_APP_SIGNING_IDENTITY -R "$REPO" \
  --body 'Developer ID Application: Your Name (TEAMID)'
gh secret set TEXTO_APPLE_TEAM_ID -R "$REPO" --body 'TEAMID'

# notarization, option A: Apple ID + app-specific password (recommended)
gh secret set TEXTO_NOTARY_APPLE_ID -R "$REPO" --body 'you@example.com'
gh secret set TEXTO_NOTARY_PASSWORD -R "$REPO" --body 'abcd-efgh-ijkl-mnop'

# notarization, option B: App Store Connect API key
# base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set TEXTO_NOTARY_API_KEY -R "$REPO"
# gh secret set TEXTO_NOTARY_API_KEY_ID -R "$REPO" --body 'XXXXXXXXXX'
# gh secret set TEXTO_NOTARY_API_ISSUER -R "$REPO" --body 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
```

Then run *Actions → Build → Run workflow* (`store = false`) to produce a signed DMG without
publishing anything, and check it locally:

```sh
spctl -a -vvv -t open --context context:primary-signature Textox-*.dmg
xcrun stapler validate Textox-*.dmg
```

Caveats:

- macOS runners bill at 10× minutes; on a private repo watch your quota (or build only `full`).
- Unsigned DMGs are blocked by Gatekeeper elsewhere: right-click open, or
  `xattr -dr com.apple.quarantine Textox.app`.
- Without credentials the artifacts are unsigned/unnotarized; configure cert + notary secrets for real releases (tag builds verify it).
- `bun.lock` only records `registry.npmjs.org`; if you install through a mirror, restore the lockfile before committing.

## Tests and checks

```sh
bun run typecheck                              # whole-repo typecheck
bun run test:plugins                           # plugin/runtime contract tests
bun run check:skeleton                         # no plugin-specific literals in the skeleton
bun run check:editor-boundary                  # editor must not import app code
bun run check:version                          # app version + Tauri plugin versions

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
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (also available in
[简体中文](CODE_OF_CONDUCT.zh-CN.md)) first. Develop against `develop`; `main` is for
releases.

## Security

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

## License

Released under the [GNU Affero General Public License v3.0 or later](LICENSE).
The `Textox` name, logo and icons are not covered by the license — see [NOTICE](NOTICE).

Third-party copyrights and licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (the Apache-2.0 text for MathJax is at
[public/mathjax/LICENSE](public/mathjax/LICENSE)).
