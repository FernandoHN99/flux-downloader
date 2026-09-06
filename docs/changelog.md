# Flux Downloader changelog

This is the project changelog. It replaces the old Video DownloadHelper historical timeline that previously occupied this file.

## Unreleased — refactor baseline 2026-09-03

This section describes commits after the `v1.1.1` tag on the current refactor line. These changes are not part of a tagged public release yet.

### Download acceleration

- Added eight-fragment yt-dlp downloads through `--concurrent-fragments 8`.
- Replaced the single-stream direct downloader with validated parallel byte ranges: up to eight connections, 4 MiB minimum parts, per-range resume/retry, object validators, exact-length checks, cancellation, and automatic sequential fallback.
- Forwarded Referer and Origin to every direct HTTP/range request and stopped treating a partial `ECONNRESET` response as a complete file.
- Changed batch execution from sequential to a four-worker pool while retaining one synchronously acquired user-run lease.
- Made batch cancellation cover every active native ID plus IDs that arrive late, and preallocated case-insensitively unique names before parallel starts.
- Keyed FFmpeg/yt-dlp progress by logical download, made process IDs collision-safe within the worker, and added per-row plus aggregate parallel progress in the popup.
- Added a compatibility path for old three-argument `convertOutput` callbacks and preserved the old callback prefix for older extensions.
- Documented the complete tuning and fallback model in `docs/performance.md`.

### Rename to Flux Downloader

- Renamed the project to **Flux Downloader** everywhere: manifest, UI, npm packages, install directories, log prefix, page-world globals, and release artifacts.
- **Breaking:** the native messaging host id changed from `com.mediagrabber.coapp` to `com.fluxdownloader.coapp`, and install paths moved from `MediaGrabber`/`MEDIAGRABBER_*` to `FluxDownloader`/`FLUX_*`. The host must be re-registered with `node dist/native-autoinstall-cli.js register <extension-id>`; the previous registration and install directory are orphaned and can be deleted by hand.
- The `github.com/miroshArtem/MediaGrabber` URLs and the repository directory keep the old name for now, since they are live external references.

### Source layout

- Grouped extension source by domain: `entrypoints/`, `detection/`, `catalog/`, `download/`, `shared/`, replacing the 30-file `lib/` drawer and the `content/` folder.
- Added a per-domain `AGENTS.md` to each folder plus a root `CLAUDE.md` pointer, and trimmed the root `AGENTS.md` to cross-cutting material.
- Moved history persistence and the downloaded/failed markers out of `background.ts` into `catalog/history-store.ts`, which owns its own write queue; callers no longer chain onto a shared promise. 14 new tests; `background.ts` dropped from 1,554 to 1,410 lines.
- Added Vitest to the CoApp workspace with a first suite over `RpcProtocol`, which exposed and fixed a pending-reply leak when the transport throws.
- Dropped the 3.9MB promo video from git tracking.

### Product and list model

- Rebranded the user-facing extension and popup to **Flux** while retaining MediaGrabber internal/release compatibility names. *(Superseded by the full rename above.)*
- Replaced separate current/history presentations with one global list.
- Current media from every open tab is pinned and visibly marked.
- Added optional persisted history (maximum 50 entries) and **Only current** mode.
- Added search, rename, stable drag reorder, bulk/selective delete, downloaded/failed markers, and expired-link checks.
- Added Flat list and By site modes with collapsible/downloadable site groups.
- Added sequential Best/Worst batch downloads in one `Flux_<timestamp>` folder.
- Added unique output names using `_1`, `_2`, etc. instead of overwriting.
- Current and busy rows are structurally excluded from reorder zones.

### Popup component refactor

- Added Vitest + happy-dom before restructuring the UI.
- Extracted `VideoRow` and `QualityPanel`.
- Extracted `VideoList`, `VideoGroup`, `ListHeader`, and `ProgressPanel`.
- Replaced the 1,519-line global `popup.ts` with `popup/index.ts`, an `App` shell, typed `Messenger`, selectors, and a `Store`.
- Split state into background-owned `RemoteState` and popup-owned `UiState` so detections/progress cannot erase selection, rename, search, or expansion.
- Added component-owned DOM; components no longer coordinate by global `document` queries.
- Added focus/caret/range preservation through stable `data-focus-id` across component redraws.
- Split the approximately 1,600-line popup stylesheet into concern/component files bundled by `styles/index.css`.
- Kept the settings page intentionally small/static rather than forcing it into the component layer.

### Refresh and source attribution

- Added one always-visible **Refresh tabs** button and removed the ineffective split empty-state refresh behavior.
- Centralized refresh in `refreshOpenTabs()`:
  1. re-record live in-memory media to restore deleted current rows;
  2. send `RESCAN` to all open HTTP(S) tabs;
  3. replay cached detections, rescan DOM, resend metadata;
  4. await history writes and return fresh current/history lists.
- A cold service worker now requests a rescan when `GET_MEDIA` finds no tab media state.
- Defined `VideoInfo.pageUrl` as the exact top-level source page and `VideoInfo.url` as the media/CDN URL.
- History merge now preserves/repairs page URL/title and treats ownership changes as meaningful.
- Fixed Rocketseat media being grouped/linking as `vz-*.b-cdn.net` instead of the exact `app.rocketseat.com.br/jornada/.../aula/...` page.

### Background state

- Consolidated scattered tab-lifetime maps into one `TabStateStore`.
- Made page generations monotonic for the worker lifetime.
- Made page reset/close cleanup atomic for all tab-owned state.
- Fixed `pageGenerationByTab` growing when tabs closed.
- Prevented stale async parser/yt-dlp results from repopulating a reused tab ID.
- Kept downloads, batch, popup ports, settings cache, and history-write queue outside tab state because they have different lifetimes.

### Pure boundaries and protocols

- Reduced `content.ts` from 595 to 261 lines by extracting page metadata, URL classification, MSE projection/reduction, and normalized DOM subtree collection.
- Removed the content script's dead private M3U8 parser and made content/background share `media-url.ts`.
- Added typed, validated popup/background and content/background protocols.
- Extracted video catalog, source ownership, history mutations, HTTP context, download planning, yt-dlp normalization, manifest quality projection, HLS relay rewriting, and relay codec inference.
- Preserved known `pageUrl` values across partial detections instead of letting a CDN-only update erase ownership.
- Hardened relay inference to require a one-to-one character mapping.

### Download lifecycle and native client

- Added `DownloadTracker` for active IDs, early outcomes, multiple waiters, cancellation tombstones, and late-callback suppression.
- Added `BatchRun` for deterministic queue transitions; cancellation no longer marks the current video failed.
- Fixed cancellation arriving before `startDownload()` returns its native ID.
- Reserved a batch before its first await so rapid duplicate starts cannot overlap.
- Added `DownloadRunGate`, enforced in the service worker, so popup instances and batches share one native execution slot.
- Centralized FFmpeg/MSE/yt-dlp completion, error publication, and ownership release.
- Added nine extension-side `NativeClient` tests and fixed retries after an initial synchronous `connectNative` failure.
- Fixed browser-launched macOS hosts inheriting a restricted `PATH`: runtime
  discovery now resolves Homebrew binaries directly, and every missing-tool
  spawn settles as an operation error instead of crashing the native host with
  `spawn ... ENOENT` / “Native host has exited.”

### Content and manifest fixes

- Validated MAIN-world MSE messages before mutating isolated-world state; invalid durations/bytes/URLs are rejected.
- Reduced MSE events immutably, capped segments at 500, and stopped duplicate segments from re-announcing snapshots.
- Centralized DOM media collection, including nested dynamically inserted players, and replaced per-element metadata listeners with one capture listener.
- Added explicit HLS `SUBTITLES` group tracking so valid subtitle renditions are not filtered as unrelated.
- Projected HLS/DASH parser output into explicit video/audio/subtitle qualities in a tested module.
- Covered HLS relay rewriting for segments, encryption-key URIs, and init-map URIs; partial relay maps fail early.
- Isolated HLS FFmpeg input preparation so video/audio inputs are visited in order without mutating the argument array being scanned.

### Parser work

- Deleted unreachable `lib/quality-utils.ts` and `lib/mpd-parser.ts` (333 lines), including duplicate formatter implementations.
- Added 38 HLS parser tests and 39 DASH parser tests.
- Covered realistic master/media manifests, relative URLs, CRLF, ordering, audio/subtitle renditions, inherited DASH attributes, DRM flags, and deduplication.
- Fixed DASH `mediaPresentationDuration` parsing for full ISO forms such as `P0Y0M0DT0H25M23.000S`.
- Added days/weeks support and deliberately reject non-zero years/months.

### UI polish and regressions fixed

- Unified single/batch progress in one panel and blocked concurrent runs.
- Compacted progress to a two-row layout; local browser preview measured 44px versus 54px previously.
- Moved progress Stop-button CSS into `progress.css`.
- Added a 3px inline inset to the flat-list reorder zone so its dashed side borders are not clipped.
- Fixed detached quality panels failing to select a quality.
- Fixed manual class patching causing selection counters/dots to diverge.
- Fixed render order overwriting disabled state.
- Fixed removed progress DOM being queried by error handling.
- Removed dead listener logic for a nonexistent download button.
- Prevented redraws from destroying active search/rename input state.

### Tests and verification

At the current 2026-09-04 baseline:

- 49 test files (42 extension + 7 CoApp);
- 585 passing tests (564 extension + 21 CoApp);
- Vitest 3 + happy-dom;
- full extension and CoApp build passes;
- no linter and no real FFmpeg/yt-dlp process integration suite yet.
- `npm run dev:extension` now runs a parallel no-emit TypeScript checker and watch contexts for all six extension bundles; browser reloads remain manual.

### Documentation

- Rewrote every tracked Markdown documentation file around the current Flux Downloader implementation.
- Removed obsolete claims about Video DownloadHelper, Firefox, proprietary code, watermarking, VDH v10, and broad filesystem RPCs.
- Corrected privacy disclosure to describe locally persisted media history and required source/CDN network activity.
- Documented the Flux Downloader naming split, popup/state invariants, refresh protocol, source ownership, tab generations, parser coverage, native RPC, CoApp, runtime paths, and release process.

### Commit map

| Commit | Change |
|---|---|
| `5b6ad94` | detection history, unique names, batch |
| `84ecdfa` | rename, reorder, search, freshness checks |
| `30d0287` | unified media rows/current-history movement |
| `a0b4980` | one list, on-demand detail panel, batch folders |
| `b7c6652` | Flux UI name, current markers, bulk delete |
| `539b2e2` | per-row panel, busy rows, optional history |
| `a109516` | unified progress and simplified settings |
| `0165c14` | filename titles, site grouping, reorder gutter |
| `140e528` | dark UI and isolated delete/rename flows |
| `1b1b337` | progress restoration, concurrency guard, real rescan |
| `aa2e47c` | test runner and refactor foundations |
| `339564b` | `VideoRow` / `QualityPanel` components |
| `da131d5` | list/group/header/progress components |
| `714b043` | component `App` replaces global popup |
| `b40db9c` | component/concern CSS split |
| `13b9eb0` | unreachable modules removed |
| `3cff55f` | parser suite and ISO duration fix |
| `3c52e13` | `TabStateStore` consolidation |
| `893c3e8` | all-tab refresh and page-source fix |
| `9388ff9` | compact progress and flat reorder inset |
| `2d4187a` | pure content detection helpers |
| `f98bae1` | video catalog rules |
| `0ac5a04` | HTTP/media and download-plan rules |
| `3731f0e` | typed popup protocol |
| `6760fc9` | typed content protocol |
| `2edc30d` | page ownership merge rules |
| `be786b6` | yt-dlp quality normalization |
| `97ac193` | popup CSS packaging and asset validation |
| `f6ed1b1` | relay codec hardening |
| `714932c` | active download lifecycle |
| `47f1b32` | history mutation rules |
| `21471c3` | manifest quality projection/subtitle groups |
| `b3fbb3c` | HLS relay rewriting |
| `aed5095` | batch state/race fixes |
| `59428ef` | MSE bridge validation/reducer |
| `7cab5b6` | DOM media collection/listener fix |
| `c70b819` | native reconnect retry/tests |
| `d1e8be5` | global native-run gate |
| `9c3a496` | native process settlement |
| `60d3d56` | HLS input argument preparation |
| `c0d9183` | complete documentation rewrite/audit |
| `f05c530` | HLS argument documentation and 505-test baseline |
| `16de619` | extension TypeScript/six-bundle watch workflow |

### Resolved release check

`extension/scripts/package-extension.mjs` now includes `dist/popup.css`. Before archiving it scans local `src`/`href` references in popup/settings HTML and fails if an asset is missing or escapes the staging directory. The resulting ZIP still needs extracted-browser smoke testing before release.

## 1.1.1 — opaque HLS segment rewrite

Tag: `v1.1.1`, commit `daf968e`.

- Rewrote opaque HLS segment playlists for FFmpeg.
- Added local manifest-file support to CoApp converter calls.
- Expanded fetch/XHR relay URL mapping in the MAIN-world hook.
- Updated package/manifest/CoApp versions to 1.1.1.

## 1.1.0 — opaque HLS audio variants

Tag: `v1.1.0`, commit `09e8cb5`.

- Added support for opaque HLS audio variants and child URLs.
- Expanded HLS/DASH quality metadata.
- Updated package/manifest/CoApp versions to 1.1.0.

## 1.0.1 — release asset pin

Tag: `v1.0.1`, commit `8572133`.

- Corrected the pinned Windows FFmpeg release asset.
- Updated third-party notice metadata.

## 1.0.0 — first Windows packaged release

Tag: `v1.0.0`, commit `f07fa9c`.

- Added tagged GitHub Release workflow.
- Added extension ZIP packaging.
- Added Windows Node SEA CoApp and installer builds.
- Added native host auto-registration and install/runtime path helpers.
- Added pinned runtime download/checksum configuration.
- Added fixed manifest key/extension ID support.
- Added release/privacy/third-party documentation.

## Pre-release foundation

Before `v1.0.0` the project established:

- npm workspace structure;
- Manifest V3 background/content/popup entries;
- HLS and DASH parsing;
- MAIN-world MSE interception;
- bidirectional native messaging;
- CoApp FFmpeg/direct-download modules;
- yt-dlp integration;
- settings and packaging foundations.
