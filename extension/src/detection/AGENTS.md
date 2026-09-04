# detection/ — finding media

Everything that answers *"what media is on this page, and what is it called?"*
Runs in three execution contexts, which is the main thing to keep straight.

| Context | Files | Constraint |
|---|---|---|
| MAIN world | `mse-bridge.ts` helpers used by `entrypoints/mse-inject.ts` | **No `chrome.*` API.** Communicates only via `window.postMessage`. |
| Isolated world | `dom-media.ts`, `page-metadata.ts`, `mse-media.ts` | Content-script APIs only; a loaded page can outlive an extension reload, so sends must catch invalidated-extension errors. |
| Service worker | `m3u8-parser.ts`, `dash-parser.ts`, `manifest-qualities.ts`, `http-media.ts`, `youtube.ts`, `relay-codec.ts` | **No `DOMParser`.** This is why both manifest parsers are regex-based. |

`media-url.ts`, `media-title.ts`, `video-key.ts` and `page-context.ts` are pure
and run anywhere.

## Identity rules

`videoKey(url)` is the stable identity of a media item: it normalizes volatile
query tokens so a re-signed CDN URL stays the same video. Use it everywhere an
item is matched — history, current markers, active downloads, selection,
downloaded/failed flags. Never key on the raw URL.

It drops the query string, with one exception: hosts listed in
`IDENTITY_PARAMS` keep the parameters that say *which* video the URL points at.
YouTube needs this — every watch URL is `/watch`, so dropping `?v=` would
collapse every YouTube video into a single entry. Add a host there only when the
path alone cannot identify the media.

`domainOf(pageUrl, fallbackUrl)` decides which site owns an item. The
top-level page wins; the media host is only a fallback. A lesson on
`app.rocketseat.com.br` served from `vz-*.b-cdn.net` must group under
Rocketseat, not the CDN.

`titleFromMediaUrl()` rejects generic filenames (`playlist`, `index`,
`master`), hex IDs, UUIDs and bare numbers, falling back to the page title.

## Parsers

Both parsers take an optional referer and pass it as the fetch referrer:
authenticated CDNs reject context-free requests. Always propagate the page URL
from detection into manifest fetching and FFmpeg arguments.

- Redirect-chain manifest dedup compares **pathname only**, ignoring hostname —
  intentional.
- HLS keeps distinct same-resolution variants when their audio rendition groups
  differ, and deduplicates groups whose rendition membership is equivalent.
  Variants record both `AUDIO` and `SUBTITLES` group IDs.
- DASH inherits representation attributes from `AdaptationSet`, records DRM
  presence, and extracts subtitle tracks.
- DASH durations accept the full ISO-8601 form including zero years/months
  (`P0Y0M0DT0H25M23.000S`) plus days and weeks. **Non-zero** years or months are
  rejected on purpose: they have no fixed length.
- `M3U8ParserWrapper.parse()` without a base URL cannot resolve relative
  variants and silently yields nothing. Production always goes through
  `fetchAndParse()`, which supplies one.
- `manifest-qualities.ts` projects parsed variants into typed popup/FFmpeg
  choices. `VideoQuality.kind` is `video`, `audio` or `subtitle`.

Coverage: 38 HLS tests, 39 DASH tests. `quality-utils.ts` and `mpd-parser.ts`
were deleted as unreachable duplicates — do not reintroduce them.

## Page-world traffic is untrusted

`mse-bridge.ts` validates and reduces every MAIN-world event before it is
allowed to mutate isolated-world state. Invalid or duplicate events must not
pollute or flood content state. Messages are checked against the sender frame
URL, sender tab URL, and content generation; stale navigation results are
discarded. Child frames may contribute media but must never replace top-level
source ownership.

`relay-codec.ts` infers relay mappings one-to-one. An ambiguous mapping must be
rejected rather than resolved to a plausible-but-wrong URL.

## YouTube

YouTube tabs are handled exclusively as `VideoInfo.type='ytdlp'`; ordinary
intercepted YouTube media is filtered out of the visible commit path. Do not
implement a second signature parser in the extension — that is yt-dlp's job.
