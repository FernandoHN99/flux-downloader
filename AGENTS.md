# Flux Downloader — Agent Instructions

This file is the authoritative implementation guide for AI agents working in this repository. It describes the code as it exists after the popup, content, background, and download-lifecycle refactor completed on 2026-09-03. When a count or behavior matters, verify it again before changing code.

## Identity and scope

- **Flux Downloader** is the product name everywhere: manifest, UI, packages, native host, install directories, logs, and release artifacts.
- The repository directory and the `github.com/miroshArtem/MediaGrabber` remote still carry the old name. Those are live external references; leave them until the repository itself is renamed.
- The product is a Chrome/Edge Manifest V3 extension plus a local Node.js companion application (CoApp).
- TypeScript is used throughout. The extension detects media; the CoApp performs filesystem, FFmpeg, direct HTTP, and yt-dlp work.
- DRM bypass is out of scope.

Current package version: `1.1.1` in the root, extension, CoApp, and manifest. This baseline is `main` after the domain restructure and the Flux Downloader rename.

## Repository layout

This is an npm-workspaces monorepo.

Extension source is grouped by domain. Each domain folder carries its own `AGENTS.md` with the rules local to it; read that file plus this one before editing there.

| Path | Purpose | Guide |
|---|---|---|
| `extension/` | Manifest V3 extension (`flux-downloader-extension`) | |
| `extension/src/entrypoints/` | The three esbuild entry points: service worker, content script, MAIN-world hook | [AGENTS.md](extension/src/entrypoints/AGENTS.md) |
| `extension/src/detection/` | Page hooks, HLS/DASH parsers, quality projection, media identity | [AGENTS.md](extension/src/detection/AGENTS.md) |
| `extension/src/catalog/` | Tab state, history rules and persistence, video catalog | [AGENTS.md](extension/src/catalog/AGENTS.md) |
| `extension/src/download/` | Download plan, concurrency gate, tracker, batch, HLS args, native client | [AGENTS.md](extension/src/download/AGENTS.md) |
| `extension/src/shared/` | Types, typed protocols, settings, theme, errors | [AGENTS.md](extension/src/shared/AGENTS.md) |
| `extension/src/popup/` | Component popup, settings page, component-scoped CSS | [AGENTS.md](extension/src/popup/AGENTS.md) |
| `coapp/` | Native messaging host (`flux-downloader-coapp`) | |
| `coapp/src/` | RPC, FFmpeg, yt-dlp, HTTP download, paths, registration, installer | [AGENTS.md](coapp/src/AGENTS.md) |
| `coapp/scripts/` | SEA builds, release config/checksums, dev host registration (mac/Linux/Windows) | |
| `docs/` | Current Flux Downloader implementation and release documentation | |
| `.github/workflows/release.yml` | Windows x64 tagged-release pipeline | |

`extension/src/lib/` and `extension/src/content/` no longer exist; their contents moved into the domain folders above. There is no `agent-plan/` or `installer/` directory either — the installer is built from `coapp/src/installer.ts` and `coapp/scripts/build-sea.mjs`.

## Commands

Run from the repository root unless noted.

```bash
npm install
npm test                   # extension + CoApp Vitest suites
npm run build              # extension tsc + bundles, then CoApp tsc
npm run build:extension
npm run build:coapp
npm run package:extension  # extension/FluxDownloader-extension.zip
npm run dev:extension      # extension tsc --noEmit + six esbuild watchers
npm run dev:coapp          # CoApp tsc --watch
cd coapp && npm start      # node dist/main.js
```

`npm run dev:extension` watches all six extension outputs (`background`, `content`, `mse-inject`, popup JS/CSS, and settings) while a parallel TypeScript checker runs with `--noEmit`. It writes rebuilt bundles to `extension/dist/`, but it does not reload the unpacked extension or already-open pages in Chrome/Edge; do those reloads manually when their execution context must change.

Native registration after a CoApp build:

```bash
cd coapp
node dist/native-autoinstall-cli.js register <extension-id>
node dist/native-autoinstall-cli.js unregister
```

For local development, prefer the dev-host scripts over calling
`native-autoinstall-cli.js` directly: it only writes a manifest pointing at a
`coapp` binary that must already exist at the install root, so following it
alone leaves the host unreachable. `coapp/scripts/register-dev-host.sh`
(macOS/Linux) and `coapp/scripts/register-dev-host.ps1 -ExtensionId <id>`
(Windows) instead build/register a launcher that execs this checkout's
`dist/main.js`. Both derive the extension ID from `extension/manifest.json`
automatically. Re-run the script after moving or renaming the repository —
the launcher embeds an absolute path.

## Verification baseline

As of 2026-09-03:

- 40 extension test files and **519 tests** pass, plus 1 CoApp file with **7 tests** — 526 in total.
- Tests use Vitest 3 with `happy-dom`; configuration is in `extension/vitest.config.ts`.
- `NativeClient` is covered on the extension side; there are still no process-side CoApp tests and no linter.
- The required final verification for code changes is `npm test` followed by `npm run build`.
- Parser and component regressions should be protected with tests before or with a refactor.

Do not keep reporting the 526 count after adding or removing tests without rerunning the suite.

## Extension build and loading

The extension build runs TypeScript and then bundles browser entries with esbuild:

| Source | Output |
|---|---|
| `src/entrypoints/background.ts` | `dist/background.js` |
| `src/entrypoints/content.ts` | `dist/content.js` |
| `src/entrypoints/mse-inject.ts` | `dist/mse-inject.js` (`iife`) |
| `src/popup/index.ts` | `dist/popup.js` |
| `src/popup/settings.ts` | `dist/settings.js` |
| `src/popup/styles/index.css` | `dist/popup.css` |

The manifest has no module type, so Chrome needs the bundled files; `tsc` output alone is not sufficient.

Load **`extension/`**, never `extension/dist/`, from `chrome://extensions` or `edge://extensions`. The manifest and source HTML live under `extension/`; their scripts point to `dist/`.

After rebuilding/reloading the extension, pages that still contain the old content-script context may need a page reload. `Refresh tabs` cannot message an invalidated content script.

### TypeScript configuration

- `tsconfig.base.json` is currently orphaned; neither workspace extends it.
- Both workspace configs have `strict: false` and `noImplicitAny: false`.
- Extension: ESNext modules, ES2022 + DOM, no declarations.
- CoApp: CommonJS, ES2022, declarations and declaration maps.
- Both currently use TypeScript 6 and `ignoreDeprecations: "6.0"`.

## Popup architecture

The popup is an app shell plus a store, pure selectors, typed messages, and components with scoped CSS. Entry point is `extension/src/popup/index.ts`; the old global `popup.ts` no longer exists.

Ownership, the remote/UI state split, list and reorder invariants, progress rendering, the fixed-pixel sizing rule, and the happy-dom testing gaps are documented in **[extension/src/popup/AGENTS.md](extension/src/popup/AGENTS.md)**.

## Central refresh flow

There is one user-facing refresh action: the always-visible **Refresh tabs** button. It spans all three contexts, so the message names must stay distinct: popup → background is `REFRESH_TABS`, background → content is the internal `RESCAN`. Do not collapse them into one ambiguous shared message.

The ordered steps and the cold-worker fallback are documented in **[extension/src/entrypoints/AGENTS.md](extension/src/entrypoints/AGENTS.md)**.

## Background state and lifecycle

All state tied to a browser tab lives in one `TabStateStore` (`extension/src/catalog/tab-state.ts`), keyed by tab ID, and `tabs.onRemoved` deletes the whole entry. Do not add a parallel per-tab map: single-point cleanup is the reason this store exists. Generations are globally monotonic for the service-worker lifetime, so a late async result cannot repopulate a reused tab ID.

State with a different lifetime deliberately sits outside it: `DownloadTracker`, `DownloadRunGate`, `BatchRun`, popup ports, and the settings cache.

Tab state contents, the history write queue, and the storage-key table are documented in **[extension/src/catalog/AGENTS.md](extension/src/catalog/AGENTS.md)**.

## URL and source ownership rules

`VideoInfo.url` and `VideoInfo.pageUrl` are different facts:

- `url`: media, manifest, rendition, or CDN URL used for detection/download.
- `pageUrl`: exact top-level page that exposed the media; used for site grouping, source navigation, history ownership, and Referer context.

Never derive `pageUrl` from the media hostname when top-level metadata exists. `mergeDetectedVideosIntoHistory()` preserves/repairs page ownership, and `sameHistoryContent()` includes `pageUrl` and `pageTitle` while ignoring volatile timestamps and signed query strings.

`videoKey()` provides stable identity by normalizing volatile URL details. Use it consistently for history, current markers, active downloads, selection, and downloaded/failed flags.

## Detection pipeline

The manifest registers two scripts on `<all_urls>`, in all frames, at `document_start`:

| Script | World | Responsibilities |
|---|---|---|
| `dist/content.js` | isolated | DOM scanning, metadata, navigation generations, RESCAN cache, MAIN-world bridge |
| `dist/mse-inject.js` | MAIN | MSE hooks plus fetch/XHR relay observation; `window.postMessage` only |

The service worker also observes `webRequest.onBeforeRequest` and `onHeadersReceived` for HTTP(S) HLS, DASH, MP4 and WebM candidates, and merges network, DOM and MSE findings per tab.

Per-context constraints, message validation, and relay inference are documented in **[extension/src/detection/AGENTS.md](extension/src/detection/AGENTS.md)**.

## HLS and DASH parsing

Both parsers are regex-based because `DOMParser` is not available in the MV3 service worker. Always propagate the top page URL and referer from detection into manifest fetching and FFmpeg arguments; authenticated CDNs reject context-free requests.

Deduplication rules, audio/subtitle group handling, the ISO-8601 duration rules, and the base-URL caveat are documented in **[extension/src/detection/AGENTS.md](extension/src/detection/AGENTS.md)**.

The deleted `lib/quality-utils.ts` and `lib/mpd-parser.ts` were unreachable duplicates; do not reintroduce or import them.

## YouTube

YouTube tabs are handled exclusively as `VideoInfo.type='ytdlp'`, downloaded through the `ytdlp` RPC with the same progress and cancellation model as every other download. yt-dlp behavior depends on the installed binary and upstream changes; do not implement a second signature parser in the extension.

Details are in **[extension/src/detection/AGENTS.md](extension/src/detection/AGENTS.md)**.

## Native messaging and CoApp

Native host ID: `com.fluxdownloader.coapp`. The browser side uses `chrome.runtime.connectNative`; at the process boundary, messages are 4-byte little-endian length-prefixed UTF-8 JSON, stdout is protocol-only, and logs go to stderr. On top of transport both sides speak bidirectional `weh#rpc`, and CoApp progress calls back into extension RPC methods rather than firing and forgetting.

The handler list, RPC framing, runtime path discovery, install roots and SEA packaging rules are documented in **[coapp/src/AGENTS.md](coapp/src/AGENTS.md)**. The extension-side client lifecycle is in **[extension/src/download/AGENTS.md](extension/src/download/AGENTS.md)**.

## Download routing

HLS/DASH go through FFmpeg `convert`, MSE through FFmpeg with reconstructed inputs, YouTube through yt-dlp, and direct media through the CoApp HTTP downloader. Historical links are probed for expiration first; current links skip the check.

One download run owns the CoApp at a time, reserved synchronously by `DownloadRunGate` before the first await. Popup button state is feedback, not the lock.

Routing detail, the tracker/batch invariants, the FFmpeg `out_time_ms` nanosecond quirk, and output naming are documented in **[extension/src/download/AGENTS.md](extension/src/download/AGENTS.md)**.

## Release model

Flux is currently distributed by GitHub Releases, not the Chrome Web Store. The manifest public key fixes the extension ID as `igephdkobpgbfgdjmehckbhffbimgkii`.

Pushing a `v*` tag triggers `.github/workflows/release.yml` on Windows with Node 22. It builds/packages the project, downloads pinned FFmpeg/ffprobe and yt-dlp binaries, creates SEA executables, embeds release config and a gzip-compressed CoApp asset in the installer, creates SHA-256 sums, and publishes the assets.

Current workflow pins FFmpeg 8.1.2 Essentials and yt-dlp 2026.07.04. Update `THIRD_PARTY_NOTICES.md` and checksums/config whenever runtime pins change.

`extension/scripts/package-extension.mjs` includes `dist/popup.css` and validates every local `src`/`href` in packaged popup/settings HTML before creating the ZIP. Still inspect and load the extracted archive before tagging.

Do not inject an already SEA-injected CoApp binary directly into another SEA binary: duplicate Node SEA sentinels are unsafe. The installer embeds the gzip-compressed CoApp asset.

## Recent refactor record

These commits are the context future work must preserve:

| Commit | Result |
|---|---|
| `aa2e47c` | Added Vitest/happy-dom and foundational tests |
| `339564b` | Extracted `VideoRow` and `QualityPanel` |
| `da131d5` | Extracted `VideoList`, `VideoGroup`, `ListHeader`, `ProgressPanel` |
| `714b043` | Replaced global `popup.ts` with component `App`, typed store/messages |
| `b40db9c` | Split the 1,600-line popup CSS by concern/component |
| `13b9eb0` | Removed unreachable duplicate parser/quality modules (333 lines) |
| `3cff55f` | Added 76 parser tests and fixed full ISO-8601 DASH duration |
| `3c52e13` | Replaced scattered per-tab maps with `TabStateStore` and fixed generation cleanup/leak |
| `893c3e8` | Centralized all-tab refresh and fixed source-page ownership (Rocketseat/CDN case) |
| `9388ff9` | Compacted progress UI and inset the flat-list reorder outline |
| `2d4187a` | Extracted content URL/metadata/MSE detection helpers and removed a dead parser |
| `f98bae1` | Extracted video catalog rules; partial updates retain known source ownership |
| `0ac5a04` | Extracted HTTP/media and download-plan rules |
| `3731f0e` | Centralized the typed popup/background protocol |
| `6760fc9` | Centralized and validated the typed content/background protocol |
| `2edc30d` | Extracted source-page ownership merge rules |
| `be786b6` | Normalized yt-dlp qualities and explicit video/audio/subtitle kinds |
| `97ac193` | Added popup CSS to the ZIP and packaged-HTML asset validation |
| `f6ed1b1` | Extracted and hardened one-to-one relay codec inference |
| `714932c` | Centralized active download outcomes, waiters, and cancellation tombstones |
| `47f1b32` | Extracted pure history mutation/decorating rules |
| `21471c3` | Extracted HLS/DASH quality projection and fixed HLS subtitle-group ownership |
| `b3fbb3c` | Extracted pure HLS relay-manifest rewriting |
| `aed5095` | Centralized batch transitions and fixed start/cancel races |
| `59428ef` | Validated and reduced MAIN-world MSE bridge events |
| `7cab5b6` | Centralized DOM media collection and removed repeated metadata listeners |
| `c70b819` | Fixed retry after an initial native connection failure; added RPC lifecycle tests |
| `d1e8be5` | Enforced one native download run in the service worker |
| `9c3a496` | Centralized FFmpeg/MSE/yt-dlp process settlement |
| `60d3d56` | Isolated multi-input HLS FFmpeg argument preparation |
| `16de619` | Added the TypeScript + six-bundle extension watch workflow |

Structural regressions this refactor prevents:

- querying global `document` before a detached quality panel is mounted;
- manually patching selection classes/counters until state and DOM diverge;
- one renderer overwriting another renderer's `disabled` state;
- accessing progress DOM after it was removed;
- dead listeners for nonexistent elements;
- redraws destroying focused search/rename fields;
- tab cleanup spread across independent maps;
- CDN hosts replacing the page that actually owns a video;
- partial detections erasing a previously known `pageUrl`;
- ambiguous relay mappings generating a plausible but wrong URL;
- late/duplicate native callbacks reviving a cancelled download;
- HLS subtitle groups being discarded because only audio group IDs were tracked;
- double batch starts and cancellation-before-download-ID races;
- invalid/duplicate page-world MSE events polluting or flooding content state;
- every refresh attaching another `loadedmetadata` listener to the same media element;
- an initial missing native host making every later connect retry reuse one rejected promise;
- separate popup instances bypassing the visual-only download concurrency guard;
- packaged popup HTML referencing a CSS asset absent from the ZIP;
- in-place HLS argument insertion skipping or misordering a later audio input.

Preserve these invariants with tests whenever touching popup rendering, content detection, protocols, history/catalog merging, tab generations, refresh, source attribution, native lifecycle, download concurrency/cancellation, or packaging.
