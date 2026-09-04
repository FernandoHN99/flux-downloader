# Flux / MediaGrabber architecture

Updated: 2026-09-03. This document describes the repository implementation, not Video DownloadHelper.

## System boundary

Flux has two processes joined by Chrome native messaging:

```text
┌──────────────────────── Browser ─────────────────────────┐
│                                                         │
│  web pages                                              │
│  ├─ content.ts (isolated world, every frame)            │
│  └─ mse-inject.ts (MAIN world, every frame)             │
│            │ runtime messages / window.postMessage      │
│            ▼                                            │
│  background.ts (Manifest V3 service worker)             │
│  ├─ TabStateStore + detection aggregation               │
│  ├─ local history/settings/download markers             │
│  ├─ typed popup/content protocols + focused pure rules   │
│  ├─ DownloadRunGate / BatchRun / DownloadTracker         │
│  └─ NativeClient                                        │
│            ▲                                            │
│  popup App ─┴─ Store + components + typed messages      │
└─────────────────────┬───────────────────────────────────┘
                      │ connectNative("com.mediagrabber.coapp")
                      │ 4-byte length + JSON, weh#rpc
┌─────────────────────▼───────────────────────────────────┐
│ local Node.js CoApp                                    │
│ ├─ FFmpeg / ffprobe                                    │
│ ├─ yt-dlp                                              │
│ ├─ direct HTTP/HTTPS downloads                         │
│ ├─ output path helpers                                 │
│ └─ native host registration / release installer        │
└─────────────────────────────────────────────────────────┘
```

The UI/product is named Flux. Internal IDs and release packaging intentionally retain MediaGrabber.

## Browser contexts

### Service worker

`extension/src/background.ts` is the Manifest V3 service worker. It is not persistent and may be stopped between events. It owns:

- `webRequest` media interception;
- parser invocation and deduplication;
- per-tab state;
- persisted history and status markers;
- popup port protocol;
- badge and desktop notifications;
- batch/single download orchestration;
- CoApp connection and callbacks.

Any essential state stored only in the worker must be reconstructable. Current media is reconstructed through content-script `RESCAN`; durable history/settings live in `chrome.storage.local`.

### Isolated content script

`extension/src/content.ts` runs at `document_start` on `<all_urls>` in every frame. It:

- scans existing/new `video`, `audio`, and source URLs;
- extracts page title, image, duration, and exact page URL;
- receives page-world MSE/relay messages;
- tracks SPA navigation generations;
- caches announced media so it can replay detections on `RESCAN`;
- catches invalidated-extension errors instead of breaking the host page.

The entry is now an integration shell. Deterministic work lives under `extension/src/content/`:

- `dom-media.ts`: normalized subtree collection, including nested dynamic players;
- `page-metadata.ts`: title, thumbnail, duration, and metadata projection;
- `mse-bridge.ts`: page-world payload validation and immutable/cadenced state reduction;
- `mse-media.ts`: replay identity and `VideoInfo` projection.

One capture-phase `loadedmetadata` listener serves every media element. Refresh scans do not attach another listener to each existing element.

### MAIN-world hook

`extension/src/mse-inject.ts` also runs at `document_start` in every frame, with `world: "MAIN"`. It can patch page APIs but cannot access `chrome.*`. It:

- guards duplicate installation with `window.__MediaGrabberMSEHooked`;
- observes `URL.createObjectURL(MediaSource)`;
- wraps `MediaSource.addSourceBuffer` and `SourceBuffer.appendBuffer`;
- tracks MIME/codecs, segment counts/bytes, and generation;
- observes fetch/XHR redirects/relay mappings used by opaque streams;
- communicates through `window.postMessage` only.

The isolated script accepts only validated bridge message shapes with matching page URL/generation. Invalid or duplicate observations cannot append undefined segment URLs or repeatedly announce the same 20-item boundary.

### Popup and settings

The action popup uses `src/popup/popup.html` plus the bundled `dist/popup.js` and `dist/popup.css`. Settings uses a small static page and `dist/settings.js`.

Chrome action popups need explicit pixel dimensions; viewport-relative sizing can collapse them.

## Domain models

### Video and quality

`VideoInfo` is defined in `extension/src/lib/types.ts`:

- `id`: transient detection ID;
- `title`;
- `url`: media/manifest/rendition/CDN URL;
- `pageUrl`: exact top-level source page;
- `type`: HLS/DASH/direct/MP4/WebM/yt-dlp/MSE variants;
- `qualities`: video/audio/subtitle options;
- optional children, Referer, thumbnail, duration, and size.

`VideoQuality` may include dimensions, bitrate, format arguments, yt-dlp format ID, extension, FPS, file size, kind, and language.

`HistoryEntry` extends `VideoInfo` with `pageTitle`, `detectedAt`, and decorated downloaded/failed flags.

### Stable identity

`videoKey(url)` normalizes URL identity so volatile signed query strings do not create duplicate rows or lose current/download markers. The same key space is used by:

- history merge;
- current media markers;
- selections;
- active/queued rows;
- reorder;
- downloaded and failed lists.

Do not introduce a second identity algorithm.

## Per-tab ownership

All tab-lifetime data lives in one `TabStateStore` (`extension/src/lib/tab-state.ts`), replacing nine independent maps.

```text
TabStateStore
└─ tabId → TabState
   ├─ pageGeneration
   ├─ media?
   ├─ interceptedMedia?
   ├─ pageMetadata?
   ├─ ytdlpFormatUrl?
   ├─ navigationGeneration?
   ├─ currentPageUrl?
   ├─ relayMappings?
   └─ relayCodecs?
```

Every fresh page gets a monotonically increasing generation. Async parsing and yt-dlp results commit only if their generation is still current. Browser tab IDs can be reused, so resetting generation to zero or deriving it per tab would re-enable stale resurrection.

`tabs.onUpdated` records URL/navigation changes, resets page state, clears the badge, and notifies open popups. `tabs.onRemoved` deletes the whole state in one operation. The earlier `pageGenerationByTab` leak no longer exists.

The following state intentionally remains global because its lifecycle is not one tab: `DownloadTracker` active IDs/waiters/outcomes, `DownloadRunGate`, `BatchRun`, popup ports, CoApp metadata, settings cache, and history-write queue.

Pure service-worker rules live under `extension/src/lib/` rather than inside Chrome event callbacks. Important owners include `video-catalog.ts`, `page-context.ts`, `history.ts`, `http-media.ts`, `download-plan.ts`, `manifest-qualities.ts`, `relay-codec.ts`, and `hls-rewrite.ts`. Popup and content traffic use separate discriminated protocols in `popup-protocol.ts` and `content-protocol.ts`.

## Detection-to-history flow

```text
network / DOM / MSE / YouTube metadata
                 │
                 ▼
       validate tab + frame + generation
                 │
                 ▼
       merge into TabState.media
                 │
                 ▼
       getVisibleVideosForTab()
          ├─ suppress raw YouTube media
          ├─ merge qualities/children
          └─ prioritize useful duration/data
                 │
                 ▼
       commitVideos(tabId, visible)
          ├─ update badge
          ├─ queue recordHistory()
          └─ notify popup currentKeys
```

Top-frame page metadata is authoritative. Child frames can expose media, but must not replace source ownership. Metadata checks sender frame URL, sender tab URL, and content generation before commit.

`upsertDetectedVideo()` preserves a known source `pageUrl` when a later partial/network detection lacks it. HLS/DASH fetch remains effectful in the worker, while `buildHlsQualities()` / `buildDashQualities()` perform the deterministic parser-output projection.

## Source page versus media URL

This distinction is an invariant:

```text
pageUrl  = https://app.rocketseat.com.br/jornada/.../aula/...
url      = https://vz-dc851587-83d.b-cdn.net/.../playlist.m3u8
```

The first is where the user found the media. The second is where the bytes live.

`pageUrl` drives site grouping, source links, history context, and request Referer. `url` drives parsing/downloading and stable media identity. `domainOf(pageUrl, url)` uses the CDN only when page ownership is unavailable.

`mergeDetectedVideosIntoHistory()` stamps fresh top-page context and can repair old history entries. `sameHistoryContent()` compares title, quality count, `pageUrl`, and `pageTitle` while ignoring timestamps and volatile query signatures.

## Persisted history

History is one list shared by all tabs, not a current-tab list plus a separate history UI.

- Fresh detections merge at the front.
- Current media from every open tab is marked through `currentKeys` and pinned by popup selectors.
- Default maximum history length: 50.
- Downloaded/failed marker lists each keep up to 500 stable keys.
- History read-modify-write operations are serialized through `historyWrites`.
- Rename, delete, clear, and reorder all use the same queue.
- `keepHistory=false` immediately prunes storage to current media and keeps pruning as tabs change.

Merge, retain/remove, rename, reorder, decoration, and downloaded/failed marker updates are pure rules in `lib/history.ts`; the worker owns only serialized storage effects and broadcasts.

The popup receives history and current media separately so it can preserve persisted order while calculating pinned current rows.

## Popup state and components

### State boundary

`extension/src/popup/state.ts` deliberately separates:

| State | Owner | Examples |
|---|---|---|
| `RemoteState` | background messages | history, current keys, batch, active download, progress |
| `UiState` | popup interaction | search, selection, expansion, rename, group collapse, refresh, quality |

An incoming media/progress update can replace remote fields but must not clear local selection, typing, scroll intent, or open panels.

The immutable-ish `Store` replaces each half by shallow merge and notifies subscribers. Nested notification is coalesced into another pass rather than recursing.

### DOM ownership

`Component<S>` creates and owns one root element. `render()` only rebuilds inside that root; no component should query a detached/global sibling to update it.

Before redraw, `update()` captures a focused descendant's stable `data-focus-id`, selection start/end, and caret. It restores them after render. Search and rename inputs depend on this contract.

### Composition

```text
App
├─ ProgressPanel
├─ RefreshButton
├─ ListHeader
└─ VideoList
   ├─ VideoGroup (grouped mode)
   └─ VideoRow
      └─ QualityPanel (expanded row)
```

The shell HTML retains only durable mount points/status/error/empty containers. Components create their own interactive DOM.

### Reorder model

Selectors decide whether a row is movable: it must not be current, downloading/queued, or in selection mode.

`VideoList` places immutable rows outside a drop zone and movable rows inside `.reorder-zone`. This gives structural guarantees:

- current rows cannot be dragged below history;
- busy rows cannot move;
- grouped drops cannot cross site folders;
- the dashed outline represents only movable content.

Flat mode gives the direct zone a 3px inline margin so its outline remains inside the list border.

### Progress model

Single and batch runs share `ProgressPanel`. Batch progress counts the current queue position; only `activeDownloadKey` receives a live percentage and remaining rows say `Queued`.

The current compact layout uses one header row (summary, optional bytes/speed/ETA, percent, Stop) and one progress-bar row. It is indeterminate before measurable progress arrives.

Starting another download is disabled while manual or batch state owns the CoApp. This is only visual feedback: `DownloadRunGate` is the authoritative synchronous lock in the service worker.

## Central refresh architecture

There is one visible refresh control and one background implementation.

```text
RefreshButton
  │ REFRESH_TABS
  ▼
refreshOpenTabs()
  ├─ restoreCurrentMediaToHistory()
  │    └─ re-record all live TabState media
  ├─ rescanAllTabs()
  │    └─ RESCAN every open HTTP(S) tab
  ├─ await historyWrites
  └─ send MEDIA_LIST then HISTORY_LIST
```

Restoring before rescanning matters: network-only media can still be current in the worker but absent from the DOM/cache. This is also how the user recovers a current row deleted from history.

Content `RESCAN` replays every `announced` item, rescans DOM, clears the metadata dedup key, and sends metadata. Restricted browser pages and tabs with invalidated/absent content scripts are skipped.

A cold worker also calls `rescanAllTabs()` after `GET_MEDIA` when no tab has media state.

## Download orchestration

Before any asynchronous preparation, the worker acquires one `DownloadRunGate` lease. A single download holds it until settlement; a batch holds it across its complete sequential queue. Thus another popup/window cannot bypass concurrency by racing UI state.

`startDownload()` connects to CoApp, chooses a unique output name, records an active entry in `DownloadTracker`, and routes by type:

| Media | Route | Progress |
|---|---|---|
| HLS/DASH | CoApp `convert` → FFmpeg | CoApp `convertOutput` callbacks |
| MSE | CoApp `convert` → FFmpeg | same |
| YouTube | CoApp `ytdlp` | parsed yt-dlp lines through `convertOutput` |
| Direct | `downloads.download` | extension polls `downloads.search`; completion/error callbacks |

Historical items can carry expired signed URLs. The popup marks them with `checkFreshness=true`; the background calls `downloads.probeStatus` and reports common expiry statuses before starting the heavier process. Current media skips this probe.

Batch downloads are sequential, choose Best/Worst video quality per item, and write to one `Flux_<timestamp>` folder. `BatchRun` owns the current source, remaining keys, counts, and cancellation state. A cancellation received before the native ID is known is applied immediately when that ID arrives; cancelled work is not persisted as failed.

`DownloadTracker` retains very short-lived outcomes so a process that finishes before the batch begins waiting is still observed. It resolves multiple waiters, ignores duplicate/late callbacks, and keeps cancellation tombstones long enough to abort a late PID. FFmpeg/MSE/yt-dlp promises share one settlement path for popup events, notifications, markers, and lease release.

Opaque HLS media playlists are transformed by `hls-rewrite.ts`: segment lines plus quoted key/init-map `URI` attributes are resolved against the final manifest URL and replaced with learned relay URLs. A zero/partial mapping fails before FFmpeg rather than producing a corrupt output.

## Native boundary

The extension uses `chrome.runtime.connectNative("com.mediagrabber.coapp")`. Chrome serializes extension-side JS objects; the process-side stream uses a 4-byte little-endian byte length followed by UTF-8 JSON.

`weh#rpc` is bidirectional request/reply. CoApp progress “pushes” are requests back to registered extension handlers, not unacknowledged notification envelopes.

`NativeClient` retries unexpected disconnects after five seconds, times ordinary calls out after 60 seconds, and leaves long `convert`/`ytdlp` calls untimed. A synchronous first connection failure is never cached, so installing/restarting the host can be recovered by the next call. Nine extension tests cover this lifecycle and RPC correlation.

See [native-messaging.md](native-messaging.md) and [coapp.md](coapp.md).

## Storage and privacy boundary

`chrome.storage.local` holds settings, history entries (including source/media URLs), and status marker keys. The service worker holds transient tab/download state. Downloaded files are written by the local CoApp.

There is no analytics/telemetry endpoint. Network traffic still occurs where functionality requires it:

- pages and their media/CDN origins;
- manifest fetches;
- yt-dlp requests to YouTube;
- installer downloads from pinned GitHub Release URLs.

See [PRIVACY.md](PRIVACY.md) for exact disclosure.

## Architectural constraints

- Manifest V3 service workers are ephemeral.
- MAIN-world code has no extension APIs.
- Native host stdout must contain only framed protocol messages.
- DRM is unsupported.
- Signed media URLs expire.
- A rebuilt extension invalidates content scripts already injected into pages.
- HLS/DASH parsers are regex-based and need regression fixtures for new syntax.
- The settings page is intentionally not forced into the popup component abstraction.
- `background.ts` remains the Chrome/I/O composition root. Deterministic rules already have focused owners; further extraction should target cohesive effects, preserve the single-owner boundaries above, and remain test-led.

## Verification baseline

As of this update, 38 Vitest files contain 500 passing extension tests. This includes popup components, parsers, content DOM/MSE helpers, protocols, catalog/history/relay/download state, and `NativeClient`. The CoApp still has no process-side test runner. Required verification remains `npm test` followed by `npm run build`.
