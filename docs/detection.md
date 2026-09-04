# Media detection

Updated: 2026-09-03. This is the implemented Flux detection pipeline.

## Goals

Detection must answer two independent questions:

1. What URL/quality can be downloaded?
2. Which top-level page exposed it to the user?

The second answer must never be replaced by a CDN hostname. `VideoInfo.url` is the media URL; `VideoInfo.pageUrl` is the exact source page.

## Parallel detectors

Flux combines four inputs:

| Input | Code | What it finds |
|---|---|---|
| Network requests | `background.ts` webRequest listeners | HLS/DASH URLs and direct MP4/WebM |
| DOM | `content.ts` | `video`/`audio` sources, metadata, dynamically inserted players |
| Page-world media APIs | `mse-inject.ts` | MediaSource/SourceBuffer state, segment/relay observations |
| YouTube metadata | background + CoApp | yt-dlp format list for the exact watch page |

Results merge into the current `TabState` and are deduplicated before the popup sees them.

## Service-worker network interception

The background registers:

- `chrome.webRequest.onBeforeRequest` to classify HTTP(S) URL paths containing `.m3u8`/`.mpd` or ending in `.mp4`/`.webm`;
- `chrome.webRequest.onHeadersReceived` to classify successful HLS/DASH responses by Content-Type.

Recognized HLS types include:

- `application/vnd.apple.mpegurl`
- `application/x-mpegurl`
- `audio/mpegurl`
- `audio/x-mpegurl`

DASH uses `application/dash+xml`.

The listener deliberately does not classify arbitrary `.ts` paths or generic `/manifest` URLs: both create too many false positives in normal web applications.

The request initiator supplies an origin-level Referer candidate when it is valid HTTP(S). Page metadata later supplies the exact top-level source page.

### Intercepted URL deduplication

Per-tab `interceptedMedia` prevents repeatedly parsing the same candidate. HLS/DASH redirect chains are compared by pathname while ignoring hostname because one logical manifest can move between CDN hosts without changing its path.

That rule is intentionally narrower than globally ignoring hostnames: direct files and genuinely different paths must remain distinct.

## Isolated-world content detector

`MediaDetector` in `extension/src/content.ts` starts at `document_start` in every frame.

It owns:

- `mediaUrls`, the normalized per-page-generation dedup set;
- `announced`, a replayable map of everything this page generation has sent;
- the last metadata signature;
- current page URL/content generation;
- accumulated MSE information.

### DOM scan

At startup, after relevant page lifecycle events, on mutations, and on refresh, `content/dom-media.ts` scans one DOM subtree. It finds nested dynamically inserted players as well as the added root itself, normalizes each URL against `window.location.href`, and deduplicates the result.

`video`, `audio`, and `source` elements are media evidence even when the URL has no familiar extension or uses `blob:`. An arbitrary element's `src` is accepted only when it is a recognizable HTTP(S) HLS/DASH/MP4/WebM URL. One capture-phase `loadedmetadata` listener handles all present/future media; rescans no longer add another listener per element.

For each detection it sends `VIDEO_DETECTED` with:

- generated ID;
- title;
- media URL/type/qualities;
- duration and thumbnail when known;
- exact current `pageUrl`;
- content generation.

Titles prefer a meaningful filename extracted from the media URL. Generic manifest names fall back to the page title. Page titles prefer Open Graph, then Twitter metadata, then `document.title`.

Thumbnail fallback order includes Open Graph/Twitter metadata, video poster, and poster/preview/thumbnail-looking images.

### Metadata

`PAGE_METADATA` contains title, thumbnail, duration, page URL, and generation. It is deduplicated by serialized content so repeated scans do not flood the worker.

The background accepts top-frame ownership only when:

- metadata URL equals the sender frame URL;
- top-frame URL equals the sender tab URL;
- navigation/content generation is current.

Child frames may contribute detections and duration, but do not overwrite a known top-level page URL/title.

## Navigation and stale-result protection

Pages and service workers are asynchronous. A manifest fetch or yt-dlp probe started on page A can finish after the tab navigates to page B.

Protection exists at two levels:

- content generation tracks SPA navigation in the content and MAIN worlds;
- `TabStateStore.pageGeneration` is globally monotonic for the worker lifetime.

`tabs.onUpdated` resets page state on URL/loading changes. Content handles `popstate`/`hashchange`, and the MAIN hook wraps `history.pushState`/`replaceState` plus those events.

Messages/results commit only when their page and content generations still match. On tab close, the entire `TabState` is deleted. Reused numeric tab IDs therefore cannot accept work from an older page lifetime.

## MAIN-world MSE and relay hook

`extension/src/mse-inject.ts` runs in the page's JavaScript world. It is guarded by `window.__MediaGrabberMSEHooked` and communicates only through `window.postMessage`.

It wraps or observes:

- `URL.createObjectURL` for `MediaSource` instances;
- `MediaSource.addSourceBuffer` for MIME type/codecs;
- `SourceBuffer.appendBuffer` for segment count and total bytes;
- selected fetch/XHR behavior and Performance entries to associate an original request with an opaque/relay response URL;
- SPA navigation APIs to reset MSE state.

The isolated content script validates `event.source` and every `content/mse-bridge.ts` discriminated payload before converting observations into `VIDEO_DETECTED` or `MEDIA_URL_MAP` messages. It rejects malformed URLs, non-finite/zero durations, negative byte counts, unknown types, and invalid generations.

`reduceMseState()` immutably applies valid source-buffer, segment, duration, and progress events. It retains at most 500 unique segment URLs, announces the first and every twentieth new segment, and does not re-announce when a duplicate happens to arrive at one of those boundaries. Rescan replays only the latest MSE snapshot under the stable `mse` replay key.

### Relay mappings

Some players transform an original media URL into an opaque relay URL. The worker stores exact original→relay mappings and can learn a per-origin character mapping for the current time window. Inference requires a consistent one-to-one substitution; ambiguous mappings are rejected instead of guessing a relay URL. This state belongs to one tab/page and is discarded on reset/close.

Treat this logic as site-compatibility code. Do not move mappings into global persistent storage.

## HLS

`M3U8ParserWrapper.fetchAndParse(url, referer?)` fetches text and parses it with the final response URL as the base.

The regex/line parser supports:

- master playlists and `EXT-X-STREAM-INF` variants;
- media playlists and `EXTINF` durations;
- `TARGETDURATION` fallback;
- relative and absolute URLs;
- CRLF input;
- alternate audio/subtitle `EXT-X-MEDIA` renditions;
- `AUDIO` and `SUBTITLES` group references on each variant;
- bandwidth-descending ordering;
- child URL and segment collection;
- semantic deduplication.

Same dimensions/bitrate/codecs are not sufficient to merge variants when their audio groups differ. Groups with equivalent rendition members can be deduplicated. Tracking subtitle group IDs prevents active subtitles from being discarded as unrelated renditions.

`lib/manifest-qualities.ts` projects parser output into explicit video/audio/subtitle choices. Alternate HLS audio creates a video choice with two inputs, Referer/Origin context, explicit stream maps, and stream copy; standalone audio/subtitle tracks remain selectable.

Calling `parse(manifest)` without a base URL cannot resolve relative variant/segment URLs. Production calls use `fetchAndParse` or provide an explicit base.

Current baseline: **38 HLS tests** in `m3u8-parser.test.ts`, plus focused manifest-quality projection tests.

## DASH

`DashParserWrapper` is regex-based because `DOMParser` is not available in the MV3 service worker.

It supports:

- `AdaptationSet` and `Representation` extraction;
- attribute inheritance from adaptation set to representation;
- video classification by content/mime/dimensions;
- bandwidth ordering/deduplication;
- `BaseURL` resolution;
- text adaptation sets as subtitle tracks;
- `ContentProtection` presence as an encrypted flag;
- MPD `mediaPresentationDuration`.

ISO-8601 duration accepts short `PT...` forms, full packager forms such as `P0Y0M0DT0H25M23.000S`, days, and weeks. Non-zero years/months are rejected instead of converted because their length is calendar-dependent.

Current baseline: **39 DASH tests** in `dash-parser.test.ts`.

The parser can identify encrypted representations; Flux does not bypass DRM.

DASH video/subtitle choices are also produced by `lib/manifest-qualities.ts`, keeping parser syntax separate from popup/FFmpeg projection.

## YouTube

When accepted top-level metadata points to YouTube, the worker creates one `ytdlp` entry and asks the CoApp for `ytdlpFormats(pageUrl)`.

Ordinary HLS/DASH/direct detections on YouTube tabs are excluded from the visible media list. This prevents duplicate/raw Googlevideo rows and keeps one supported path.

The async format result is accepted only if its page generation and URL remain current. See [youtube.md](youtube.md).

## Commit and visibility

`commitVideos(tabId, videos)` stores the tab's current list, computes visible entries, updates the tab badge, queues history merge, and broadcasts current keys.

The visible list merges compatible qualities/child URLs and suppresses unsupported/noisy candidates. Every current video across all open tabs contributes to `currentMediaPayload()`, not only the active tab.

The popup receives:

- `videos`: deduplicated current entries;
- `currentKeys`: stable keys used to pin/mark matching history rows.

## Source attribution

History merge receives the current tab's top-level metadata:

```text
HistoryEntry.pageUrl   ← PageMetadata.pageUrl
                       ← TabState.currentPageUrl
                       ← existing VideoInfo.pageUrl

HistoryEntry.pageTitle ← PageMetadata.title
```

This ordering fixes sites such as Rocketseat where the manifest is served from `vz-*.b-cdn.net`. The list group and source link must use the exact `app.rocketseat.com.br/jornada/.../aula/...` URL.

If a CDN domain appears in the UI, trace where `pageUrl` became absent. Do not hard-code Rocketseat or rewrite display domains.

## Refresh and recovery

The always-visible popup button sends `REFRESH_TABS`. The worker:

1. records every current in-memory tab item back into history;
2. sends internal `RESCAN` to every open HTTP(S) tab;
3. waits for replayed detections and serialized history writes;
4. sends fresh current and history payloads.

The first step restores a current row even if the user deleted it and it came only from a network request. The content response replays `announced` media, rescans DOM, and resends metadata.

When a worker starts cold and `GET_MEDIA` finds no tab state, it also requests a rescan.

Restricted pages, tabs without a listener, and old invalidated content scripts are skipped. Reload the page after reloading the extension if refresh cannot reach it.

Popup → background traffic is typed in `lib/popup-protocol.ts`; content → background and internal `RESCAN` traffic is independently typed/validated in `lib/content-protocol.ts`. Keep the two refresh names and protocol boundaries distinct.

## Detection troubleshooting

### Nothing is listed

- Start playback or scroll a lazy player into view.
- Click **Refresh tabs**.
- Reload the page if the extension was rebuilt/reloaded.
- Confirm the page is HTTP(S), not a restricted browser URL.
- Inspect whether the media is DRM-protected.

### Wrong site/domain

- Inspect `PAGE_METADATA.pageUrl` and `TabState.currentPageUrl`.
- Confirm top-frame validation accepted metadata.
- Confirm `HistoryEntry.pageUrl` was repaired by history merge.
- Keep `domainOf(pageUrl, mediaUrl)` as the final fallback policy.

### Old video returns after navigation

- Inspect page and content generation checks.
- Ensure new async detection paths capture generation before awaiting.
- Ensure tab removal calls `TabStateStore.delete`.

### Manifest fetch fails

- Preserve final redirect URL as parser base.
- Pass top-page Referer context.
- Add a parser fixture/test before adjusting regex.

### Direct row has no progress

Detection may be correct; direct download progress comes from CoApp byte counters, while FFmpeg/yt-dlp use callbacks. Diagnose the route separately.
