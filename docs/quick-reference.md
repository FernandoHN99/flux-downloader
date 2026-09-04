# Flux Downloader quick reference

Updated: 2026-09-03.

## Identity

| Item | Value |
|---|---|
| UI/product name | Flux |
| Repository/package/release prefix | Flux Downloader |
| Version | `1.1.1` |
| Browsers | Chrome/Edge 102+, Manifest V3 |
| Native host | `com.fluxdownloader.coapp` |
| Fixed release extension ID | `igephdkobpgbfgdjmehckbhffbimgkii` |
| License | MIT for project source |
| Distribution | GitHub Release + unpacked extension |

## Commands

```bash
npm install
npm test
npm run build
npm run build:extension
npm run build:coapp
npm run package:extension
npm run dev:extension
npm run dev:coapp
cd coapp && npm start
```

`npm run dev:extension` runs one no-emit TypeScript checker plus esbuild watchers for `background.js`, `content.js`, `mse-inject.js`, `popup.js`, `settings.js`, and `popup.css`. Bundles update in `extension/dist/`; browser extension/page reloads remain manual.

Verification baseline: 39 extension test files, 505 tests, no process-side CoApp tests, no linter.

## Load and register

- Load `extension/` from `chrome://extensions` / `edge://extensions`.
- Do not load `extension/dist/`.
- Reload the extension after each build.
- Reload existing pages after an extension reload if their old content scripts were invalidated.

```bash
cd coapp
node dist/native-autoinstall-cli.js register <extension-id>
node dist/native-autoinstall-cli.js unregister
```

## Main entry points

| Source | Built output |
|---|---|
| `extension/src/background.ts` | `extension/dist/background.js` |
| `extension/src/content.ts` | `extension/dist/content.js` |
| `extension/src/mse-inject.ts` | `extension/dist/mse-inject.js` |
| `extension/src/popup/index.ts` | `extension/dist/popup.js` |
| `extension/src/popup/settings.ts` | `extension/dist/settings.js` |
| `extension/src/popup/styles/index.css` | `extension/dist/popup.css` |
| `coapp/src/main.ts` | `coapp/dist/main.js` |

Focused source owners (not separate bundles):

- `extension/src/content/{dom-media,page-metadata,mse-bridge,mse-media}.ts`
- `extension/src/lib/{popup-protocol,content-protocol,video-catalog,page-context,history}.ts`
- `extension/src/lib/{manifest-qualities,hls-rewrite,hls-arguments,relay-codec}.ts`
- `extension/src/lib/{download-plan,download-tracker,download-run-gate,batch-run}.ts`

## Popup

- `App`: store, messenger, top-level components.
- `RemoteState`: history, current keys, batch, active/manual download, progress.
- `UiState`: search, refreshing, selection, expanded/renaming key, groups, drag, quality, status/error.
- `Component.update()` preserves marked focus/caret/selection via `data-focus-id`.
- Current rows are pinned and not draggable.
- Movable history rows live in `.reorder-zone`; grouped zones cannot exchange rows.
- Flat reorder zone has `margin-inline: 3px` so the dashed border stays visible.
- Progress UI is one compact two-row panel for single and batch runs.
- `DownloadRunGate` in the service worker is the real concurrency lock; popup disabled state is feedback only.

## Refresh

User action: **Refresh tabs**.

```text
popup REFRESH_TABS
  → restore current in-memory media to history
  → query all tabs
  → background sends RESCAN to each HTTP(S) content script
  → content scripts re-announce cache + DOM + metadata
  → wait for serialized history writes
  → return MEDIA_LIST + HISTORY_LIST
```

`REFRESH_TABS` is popup/background protocol. `RESCAN` is background/content protocol.

## URL meanings

| Field | Meaning |
|---|---|
| `VideoInfo.url` | media/manifest/rendition/CDN URL |
| `VideoInfo.pageUrl` | exact top-level page that exposed it |
| `HistoryEntry.pageTitle` | source page title |
| `VideoInfo.referer` | request context used for manifests/FFmpeg when available |

Grouping and source links prefer `pageUrl`. The media URL is only a fallback. Never group a Rocketseat lesson under its `b-cdn.net` host when `app.rocketseat.com.br` is known.

## Per-tab state

`TabStateStore` owns one `TabState` per tab:

- page generation
- detected media
- intercepted URLs
- page metadata
- yt-dlp format URL
- navigation generation/current page URL
- relay URL mappings/codecs

Tab removal calls `delete`. Page reset gets a globally monotonic generation so stale async work cannot resurrect old media.

## Storage

| Key | Purpose | Limit |
|---|---|---|
| `settings` | batch quality, keep history, group by domain | none |
| `mediaHistory` | local detected media + source metadata | 50 |
| `downloadedVideos` | stable downloaded media keys | 500 |
| `failedVideos` | stable failed media keys | 500 |

History writes are serialized through `historyWrites`.

## Detection

- Service-worker `webRequest`: HLS, DASH, MP4, WebM by URL/content type.
- Isolated content script: normalized DOM subtree collection, metadata, SPA navigation, validated MSE bridge, cached rescan.
- MAIN-world hook: MediaSource/SourceBuffer plus fetch/XHR relay observations.
- YouTube: top-page metadata → CoApp `ytdlpFormats`; raw YouTube media is not shown.
- HLS/DASH parsers are regex-based.
- Parser baseline: 38 M3U8 tests + 39 DASH tests, plus manifest-quality projection tests.

## Popup messages

Popup → background:

`GET_MEDIA`, `GET_HISTORY`, `GET_BATCH_STATUS`, `GET_ACTIVE_DOWNLOAD`, `REFRESH_TABS`, `DOWNLOAD`, `DOWNLOAD_ALL`, `CANCEL_DOWNLOAD`, `CANCEL_BATCH`, `RENAME_HISTORY_ITEM`, `RENAME_VIDEO`, `REORDER_HISTORY`, `DELETE_HISTORY_ITEMS`, `CLEAR_HISTORY`.

Background → popup:

`MEDIA_LIST`, `HISTORY_LIST`, `BATCH_STATUS`, `DOWNLOAD_STARTED`, `DOWNLOAD_PROGRESS`, `DOWNLOAD_COMPLETE`, `DOWNLOAD_ERROR`, `ACTIVE_DOWNLOAD`, `NO_ACTIVE_DOWNLOAD`, `ERROR`.

## Native RPC

Transport at the native process: 4-byte little-endian payload length + UTF-8 JSON.

Envelope: `type: "weh#rpc"` with request (`_request`, `_method`, `_args`) or reply (`_reply` plus `_result`/`_error`).

CoApp handlers:

- `ping`, `info`, `quit`
- `convert`, `abortConvert`, `probe`, `converter.info`
- `ytdlpFormats`, `ytdlp`, `abortYtdlp`
- `downloads.download`, `downloads.search`, `downloads.probeStatus`, `downloads.cancel`
- `file.uniquePath`, `file.ensureDir`

CoApp → extension callbacks are also RPC requests: `convertOutput`, `convertStartNotification`, `downloadComplete`, `downloadError`.

`NativeClient`: ordinary timeout 60 seconds; `convert`/`ytdlp` untimed; pending calls reject on disconnect; unexpected reconnect delay 5 seconds; a synchronous initial connection failure is not cached. Nine extension tests cover the lifecycle.

## Download routing

| Type | Engine |
|---|---|
| HLS/DASH | FFmpeg stream copy/remux |
| MSE | FFmpeg with captured/reconstructed input |
| YouTube | yt-dlp |
| Direct MP4/WebM | CoApp Node HTTP/HTTPS stream |

Historical links are probed for common expiration responses. Output collision suffix is `_1`, `_2`, etc. Batch folder is `Flux_<timestamp>`.

`DownloadTracker` owns active IDs/outcomes/waiters/cancellation tombstones. `BatchRun` owns queue transitions and late-start cancellation. A cancelled item is not marked failed.

## Extension package

`npm run package:extension` copies all six bundles, including `dist/popup.css`, then validates local `src`/`href` references in popup/settings HTML before creating `extension/FluxDownloader-extension.zip`.

## Install roots

| OS | Root |
|---|---|
| Windows | `%LOCALAPPDATA%\FluxDownloader` |
| macOS | `~/Library/Application Support/FluxDownloader` |
| Linux | `$XDG_DATA_HOME/FluxDownloader` or `~/.local/share/FluxDownloader` |

Overrides: `FLUX_INSTALL_DIR` and `FLUX_HOME`.

## Current release pins

- FFmpeg/ffprobe: GyanD Essentials 8.1.2.
- yt-dlp: 2026.07.04.
- Release runner: Windows + Node 22.

## Fast troubleshooting

- Empty list: click **Refresh tabs**; reload the page if the extension itself was reloaded.
- CoApp disconnected: verify native manifest, path, allowlisted extension ID, and reload the extension.
- Expired item: reopen/play its exact source page, then **Refresh tabs**.
- CDN shown as site: inspect where `pageUrl` was lost; do not patch the domain formatter.
- Parser result appears after navigation: inspect page/content generations.
- Search/rename loses focus: ensure the field retains a stable `data-focus-id`.
- Popup collapses in Chrome: restore explicit pixel dimensions.
