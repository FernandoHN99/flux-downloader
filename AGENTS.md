# Flux / MediaGrabber — Agent Instructions

This file is the authoritative implementation guide for AI agents working in this repository. It describes the code as it exists after the popup/background refactor completed on 2026-09-03. When a count or behavior matters, verify it again before changing code.

## Identity and scope

- **Flux** is the product name shown in the extension manifest and UI.
- **MediaGrabber** remains the repository/package namespace, native host description, install directory, logs, and release artifact prefix. This is intentional compatibility, not necessarily unfinished renaming.
- The product is a Chrome/Edge Manifest V3 extension plus a local Node.js companion application (CoApp).
- TypeScript is used throughout. The extension detects media; the CoApp performs filesystem, FFmpeg, direct HTTP, and yt-dlp work.
- DRM bypass is out of scope.

Current package version: `1.1.1` in the root, extension, CoApp, and manifest. The active refactor branch at this documentation baseline is `refactor/popup-components`.

## Repository layout

This is an npm-workspaces monorepo.

| Path | Purpose |
|---|---|
| `extension/` | Manifest V3 extension (`mediagrabber-extension`) |
| `extension/src/background.ts` | Service worker: detection aggregation, tab state, history, popup protocol, downloads |
| `extension/src/content.ts` | Isolated-world DOM detector and bridge from the page world |
| `extension/src/mse-inject.ts` | MAIN-world MSE/fetch/XHR hook; cannot use `chrome.*` |
| `extension/src/lib/` | Shared types, parsers, history/state helpers, native client, settings |
| `extension/src/popup/` | Component popup, settings page, and component-scoped CSS |
| `coapp/` | Native messaging host (`mediagrabber-coapp`) |
| `coapp/src/` | RPC, FFmpeg, yt-dlp, HTTP download, paths, registration, installer |
| `coapp/scripts/` | SEA builds, release config/checksums, Windows dev registration |
| `docs/` | Current Flux/MediaGrabber implementation and release documentation |
| `.github/workflows/release.yml` | Windows x64 tagged-release pipeline |

There is currently no `agent-plan/` or `installer/` directory. Do not follow old references to either. The installer is built from `coapp/src/installer.ts` and `coapp/scripts/build-sea.mjs`.

## Commands

Run from the repository root unless noted.

```bash
npm install
npm test                   # extension Vitest suite
npm run build              # extension tsc + bundles, then CoApp tsc
npm run build:extension
npm run build:coapp
npm run package:extension  # extension/MediaGrabber-extension.zip
npm run dev:coapp          # CoApp tsc --watch
cd coapp && npm start      # node dist/main.js
```

`npm run dev:extension` is currently broken because the extension package has no `watch` script. Re-run the build after extension changes.

Native registration after a CoApp build:

```bash
cd coapp
node dist/native-autoinstall-cli.js register <extension-id>
node dist/native-autoinstall-cli.js unregister
```

For Windows development, `coapp/scripts/register-dev-host.ps1 -ExtensionId <id>` builds/registers a development host.

## Verification baseline

As of 2026-09-03:

- 19 extension test files and **290 tests** pass.
- Tests use Vitest 3 with `happy-dom`; configuration is in `extension/vitest.config.ts`.
- There are no CoApp tests and no linter.
- The required final verification for code changes is `npm test` followed by `npm run build`.
- Parser and component regressions should be protected with tests before or with a refactor.

Do not keep reporting the 290 count after adding/removing tests without rerunning the suite.

## Extension build and loading

The extension build runs TypeScript and then bundles browser entries with esbuild:

| Source | Output |
|---|---|
| `src/background.ts` | `dist/background.js` |
| `src/content.ts` | `dist/content.js` |
| `src/mse-inject.ts` | `dist/mse-inject.js` (`iife`) |
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

The popup was refactored from one global 1,500-line script into an app shell, store, selectors, typed messages, components, and split CSS. Its entry is `extension/src/popup/index.ts`; the old `popup.ts` no longer exists.

### Ownership

- `App` owns the popup `Store`, `Messenger`, and the top-level `ListHeader`, `ProgressPanel`, `RefreshButton`, and `VideoList` components.
- `Component<S>` owns one root element and renders only inside it. Components must not query or mutate unrelated global DOM.
- `Component.update()` preserves focus, caret, and selection for descendants marked with `data-focus-id`. This protects search and rename fields while remote updates redraw components.
- `RemoteState` is background-owned and replaced from messages.
- `UiState` is popup-owned and contains search, refresh, selection, expansion, rename, grouping, dragging, quality choice, status, and errors.
- Incoming background updates must never reset in-progress UI state.

### Components and styles

Components live in `extension/src/popup/components/`:

- `ListHeader`
- `ProgressPanel`
- `RefreshButton`
- `VideoList`
- `VideoGroup`
- `VideoRow`
- `QualityPanel`
- `base.ts` and shared `icons.ts`

Styles are bundled from `extension/src/popup/styles/index.css` and split into tokens, shell, list, row, quality, progress, miscellaneous controls, and animations. Keep component-specific rules with the corresponding stylesheet. The settings page intentionally remains a small separate static page.

Chrome action popups require explicit pixel sizing. Do not replace the fixed width/min/max-height with `100vw`, `100vh`, or `min()` viewport sizing; Chrome can collapse the popup to about one pixel.

### List invariants

- Current media and persisted history are one list, not separate `VideoList`/`HistoryList` views.
- Media playing in any open tab is pinned above historical items and marked by `currentKeys`.
- `groupByDomain=false` renders a flat list; `true` creates collapsible site groups.
- Site ownership uses `domainOf(entry.pageUrl, entry.url)`: the top-level page is authoritative and the CDN URL is only a fallback.
- A Rocketseat lesson served by `vz-*.b-cdn.net`, for example, must remain under/link to the exact `app.rocketseat.com.br/...` lesson page.
- Only non-current, non-downloading history rows can be reordered.
- Movable rows live in explicit `.reorder-zone` containers. In grouped mode a drop stays inside its site; in flat mode the zone has a 3px inline inset so its dashed border is not clipped.
- Selection/delete, rename, search, quality expansion, single download, grouped download, and batch download all operate on the same entries.

### Progress and concurrency

- One download run owns the CoApp at a time; the UI blocks concurrent starts.
- `ProgressPanel` handles both single and batch runs.
- The compact panel is two visual rows: summary/speed/ETA/percent/Stop, then the bar. The 2026-09-03 browser preview measured 44px high (previously 54px).
- The active row shows a percentage; other batch rows show `Queued`.

## Central refresh flow

There is one user-facing refresh action: the always-visible **Refresh tabs** button.

Popup → background uses `REFRESH_TABS`. Background → content script uses internal `RESCAN`. Do not collapse these into an ambiguous shared message.

`refreshOpenTabs()` performs, in order:

1. `restoreCurrentMediaToHistory()` re-inserts media still held in every live tab state. This restores a current item the user deleted from history, including network-only media that no DOM rescan can rediscover.
2. `rescanAllTabs()` queries all tabs and sends `RESCAN` to every HTTP(S) tab.
3. Each content script re-announces its cached detections, rescans the DOM, and resends page metadata.
4. The background waits for queued history writes, then returns fresh `MEDIA_LIST` and `HISTORY_LIST` payloads.

If a cold service worker receives `GET_MEDIA` with no tab media state, it automatically requests a rescan. Tabs without a compatible listener are skipped safely.

## Background state and lifecycle

`extension/src/lib/tab-state.ts` owns all state tied to a browser tab in one `TabStateStore`, keyed by tab ID.

`TabState` contains:

- monotonic `pageGeneration`
- optional detected `media`
- intercepted manifest/media URL set
- top-page metadata
- last yt-dlp format URL
- content/navigation generation
- current top-level page URL
- relay URL mappings and learned relay codecs

`resetPage()` creates a fresh generation while preserving navigation identity. `tabs.onRemoved` deletes the complete state. Generations are globally monotonic for the service-worker lifetime so late async parser/yt-dlp results cannot repopulate a reused tab ID.

State with a different lifetime remains outside `TabStateStore`: active downloads, batch state, completion waiters, popup ports, settings cache, and serialized history writes.

### Persistent storage

`chrome.storage.local` keys:

| Key | Content | Limit/behavior |
|---|---|---|
| `settings` | `batchQuality`, `keepHistory`, `groupByDomain` | merged over defaults |
| `mediaHistory` | detected `HistoryEntry[]` including source/media URLs and metadata | newest/current merge, max 50 |
| `downloadedVideos` | stable media keys marked downloaded | max 500 |
| `failedVideos` | stable media keys marked failed | max 500 |

History read-modify-write operations are serialized through `historyWrites`; do not introduce parallel storage mutations that can overwrite each other. Turning `keepHistory` off is intentionally destructive and prunes persisted history to media currently present in open tabs.

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
| `dist/mse-inject.js` | MAIN | MSE hooks plus fetch/XHR relay URL observation; communicates only through `window.postMessage` |

The service worker also observes `webRequest.onBeforeRequest` and `onHeadersReceived` for HTTP(S) HLS, DASH, MP4, and WebM candidates. It merges network, DOM, and MSE findings per tab.

Top-frame metadata owns page title/URL/thumbnail. Messages are checked against sender frame URL, sender tab URL, and content generation; stale navigation results are discarded. Child frames may contribute media but must not replace top-level source ownership.

`mse-inject.ts` is self-contained and guarded by `window.__MediaGrabberMSEHooked`. It has no extension API access. Content-script sends catch invalidated-extension errors because a loaded page can outlive an extension reload.

## HLS and DASH parsing

Both parsers are regex-based because `DOMParser` is not available in the MV3 service worker.

- `M3U8ParserWrapper.fetchAndParse(url, referer?)` and `DashParserWrapper.fetchAndParse(url, referer?)` pass source context as the fetch referrer.
- Always propagate the top page URL/referer from detection into manifest fetching and FFmpeg arguments when available; authenticated CDNs can reject context-free requests.
- Redirect-chain manifest deduplication intentionally compares pathname while ignoring hostname.
- `VideoQuality.kind` is `video`, `audio`, or `subtitle`.
- HLS preserves distinct same-resolution variants when their audio rendition groups differ, but deduplicates groups with equivalent rendition membership.
- DASH inherits representation attributes from `AdaptationSet`, records DRM presence, extracts subtitle tracks, and parses ISO-8601 media durations.
- DASH duration accepts full zero-year/month forms such as `P0Y0M0DT0H25M23.000S`, plus days/weeks. Non-zero years or months are rejected because they have no fixed duration.
- Calling M3U8 `parse()` without a base URL cannot resolve/return relative variants; production `fetchAndParse()` supplies one.

Current parser coverage: 37 HLS tests and 39 DASH tests. The deleted `lib/quality-utils.ts` and `lib/mpd-parser.ts` were unreachable duplicates; do not reintroduce or import them.

## YouTube

YouTube tabs are handled exclusively as `VideoInfo.type='ytdlp'`.

- Ordinary intercepted YouTube media entries are filtered out of the visible commit path.
- Top-page metadata triggers `ytdlpFormats(pageUrl)` in the CoApp.
- Returned qualities retain real yt-dlp `format_id` selectors and include video, MP3 audio, manual subtitles, and automatic subtitles when available.
- Downloads use the `ytdlp` RPC and the same progress panel/cancellation model as other downloads.
- yt-dlp behavior depends on the installed binary and upstream YouTube changes; do not implement a second signature parser in the extension.

## Native messaging and CoApp

Native host ID: `com.mediagrabber.coapp`.

The browser-facing API uses `chrome.runtime.connectNative`. At the native process boundary, messages are 4-byte little-endian length-prefixed UTF-8 JSON. Stdout is protocol-only; logs go to stderr.

On top of transport, both sides use bidirectional `weh#rpc`:

```json
{ "type": "weh#rpc", "_request": 1, "_method": "info", "_args": [] }
{ "type": "weh#rpc", "_reply": 1, "_result": {} }
{ "type": "weh#rpc", "_reply": 1, "_error": "message" }
```

CoApp progress is not a fire-and-forget notification: it calls extension RPC methods (`convertOutput`, `convertStartNotification`, `downloadComplete`, `downloadError`) and receives replies.

Key CoApp handlers:

- app: `ping`, `info`, `quit`
- FFmpeg: `convert`, `abortConvert`, `probe`, `converter.info`
- yt-dlp: `ytdlpFormats`, `ytdlp`, `abortYtdlp`
- direct HTTP: `downloads.download`, `downloads.search`, `downloads.probeStatus`, `downloads.cancel`
- filesystem: `file.uniquePath`, `file.ensureDir`

`NativeClient` uses a 60-second timeout for ordinary RPC, no timeout for long-running `convert`/`ytdlp`, rejects pending calls on disconnect, and retries connection after five seconds.

### Runtime paths

Release install roots:

- Windows: `%LOCALAPPDATA%\MediaGrabber`
- macOS: `~/Library/Application Support/MediaGrabber`
- Linux: `$XDG_DATA_HOME/MediaGrabber` or `~/.local/share/MediaGrabber`

`MEDIAGRABBER_INSTALL_DIR` overrides the install root. `MEDIAGRABBER_HOME` adds a runtime search root.

Runtime binaries are searched under known roots using `ffmpeg/{win|darwin|linux}/`, `ytdlp/{win|darwin|linux}/`, then project/current-working-directory fallbacks, then system `PATH` command names. Note that source-development folders use `coapp/ffmpeg/mac` and `coapp/ytdlp/mac`, while `paths.ts` derives `darwin` for release roots; verify the actual platform path before changing discovery logic.

The CoApp uses Node built-in HTTP/HTTPS streams so SEA builds do not depend on an ESM-only HTTP client.

## Download routing

- HLS/DASH: FFmpeg `convert`, normally stream-copy/remux.
- MSE: FFmpeg using captured/reconstructed input arguments where available.
- YouTube: yt-dlp.
- Direct MP4/WebM/other direct media: CoApp HTTP downloader; byte progress is polled while completion/errors are pushed.
- Historical links are probed for expiration before download; current links skip that check.
- Output names are sanitized and `file.uniquePath` appends `_1`, `_2`, etc. rather than overwriting.
- Batch downloads are sequential and use a `Flux_<timestamp>` folder.

FFmpeg `out_time_ms` is treated as nanoseconds in this integration and divided by `1_000_000` to produce seconds. Preserve the tested behavior even though the field name is misleading.

## Release model

Flux is currently distributed by GitHub Releases, not the Chrome Web Store. The manifest public key fixes the extension ID as `igephdkobpgbfgdjmehckbhffbimgkii`.

Pushing a `v*` tag triggers `.github/workflows/release.yml` on Windows with Node 22. It builds/packages the project, downloads pinned FFmpeg/ffprobe and yt-dlp binaries, creates SEA executables, embeds release config and a gzip-compressed CoApp asset in the installer, creates SHA-256 sums, and publishes the assets.

Current workflow pins FFmpeg 8.1.2 Essentials and yt-dlp 2026.07.04. Update `THIRD_PARTY_NOTICES.md` and checksums/config whenever runtime pins change.

Known pre-release blocker: `extension/scripts/package-extension.mjs` currently omits `dist/popup.css` from its copied bundle list even though packaged `popup.html` references it. Unpacked development masks this. Inspect/fix the ZIP before tagging.

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

Structural regressions this refactor prevents:

- querying global `document` before a detached quality panel is mounted;
- manually patching selection classes/counters until state and DOM diverge;
- one renderer overwriting another renderer's `disabled` state;
- accessing progress DOM after it was removed;
- dead listeners for nonexistent elements;
- redraws destroying focused search/rename fields;
- tab cleanup spread across independent maps;
- CDN hosts replacing the page that actually owns a video.

Preserve these invariants with tests whenever touching popup rendering, history merging, tab generations, refresh, or source attribution.
