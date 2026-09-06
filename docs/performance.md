# Download performance

Flux uses bounded parallelism at three layers. The defaults are intentionally
aggressive enough to fill a fast connection without creating an unbounded
number of requests.

| Path | Parallelism | Owner |
|---|---:|---|
| yt-dlp fragmented media | 8 fragments per yt-dlp process | `coapp/src/ytdlp-options.ts` |
| Direct HTTP files | up to 8 byte ranges per file | `coapp/src/http-download.ts` |
| Batch | up to 4 media items at once | `extension/src/download/batch-pool.ts` |

A batch of four large direct files can therefore use up to 32 data connections.
The limits are bounds, not promises: small files use fewer connections and a
server that does not implement ranges uses one.

## yt-dlp

Every yt-dlp download receives:

```text
--concurrent-fragments 8
```

This lets yt-dlp fetch DASH/HLS fragments concurrently while preserving its
existing format selection, FFmpeg merge, subtitle, audio, progress, and
cancellation behavior. The flag does not split a source that yt-dlp itself
exposes only as a single non-fragmented response.

The common argument builder is isolated in `coapp/src/ytdlp-options.ts`. User
selection arguments still come after the defaults, so a future explicit
per-download override can replace the default using yt-dlp's normal last-option
behavior.

## Direct HTTP files

`DirectDownloadManager` performs a real range request instead of trusting the
advisory `Accept-Ranges` header:

1. Request `bytes=0-0` with `Accept-Encoding: identity`.
2. If the response is a normal `200`, reuse that response as a sequential
   download; there is no second full-file request.
3. If the response is a valid `206` with a numeric total, split the file into
   `min(8, floor(totalBytes / 4 MiB))` disjoint ranges (never fewer than one).
4. Pre-size the output and write each response at its exact byte offset.
5. Require every part to return the expected `Content-Range` and total size.

A strong ETag is forwarded as `If-Range`; when only Last-Modified is available,
that becomes the validator. This prevents parts from different object versions
being combined silently.

Each interrupted range resumes from its last successfully written byte and has
three retries with short exponential delays. If a CDN advertises ranges but
rejects the parallel burst or returns inconsistent range metadata, Flux cancels
the other parts, resets progress, and retries the file once as a normal stream.
Filesystem failures such as a full or read-only disk do not trigger a pointless
network fallback.

Sequential responses with a known Content-Length and parallel responses with a
known total must finish at exactly that byte count. A reset after a partial body
is an error, never a successful file. Failed and cancelled partial outputs are
removed. Redirects remain capped at five, and each request has a 30-second
inactivity timeout.

Every range carries the same supplied request headers. The extension now sends
the source page's Referer and Origin for direct media, matching the context that
FFmpeg already receives for protected CDNs.

`downloads.search` keeps its existing fields and additionally reports `mode`
(`probing`, `single`, or `parallel`) and the active connection count. Existing
extension versions ignore those extra fields safely.

## Concurrent batch

The background still acquires `DownloadRunGate` synchronously before its first
await. The gate now means one user-visible run, not one native process: a batch
owns one lease and dispatches up to four internal downloads through a bounded
worker pool. This keeps duplicate popup clicks and a manual/batch race out while
allowing CoApp's ID-keyed FFmpeg, yt-dlp, and HTTP operations to overlap.

`BatchRun` tracks every active source and native ID. Stop cancels all known IDs;
an operation whose ID arrives after Stop is cancelled immediately on attach.
Queued items are not started after cancellation, and cancelled items do not gain
persistent failure badges.

Batch rendition choice and output filenames are planned before dispatch. Names
are sanitized and deduplicated case-insensitively with `_1`, `_2`, and so on,
which closes the race where parallel `file.uniquePath` calls could all choose the
same not-yet-created file.

## Progress protocol and UI

FFmpeg and yt-dlp append their `startHandler` key to the existing
`convertOutput(progressTime, currentSeconds, info, startHandler)` callback. The
first three arguments are unchanged, so an older extension can still consume a
new CoApp. A new extension accepts the older three-argument callback when only
one process is active; with several unkeyed processes it ignores ambiguous
progress rather than assigning it to the wrong rows.

Process keys combine timestamp and a monotonic worker-local sequence, avoiding
same-millisecond collisions during batch fan-out. Popup progress messages carry
the stable source key. Active rows retain independent percentages, while the
compact batch bar reports completed items plus fractional progress across all
active items. `ACTIVE_DOWNLOAD` also identifies its single/batch run kind so a
reopened popup cannot turn a batch worker into a phantom manual run. Direct-
download polling calculates current bytes per second.

## HLS/DASH through FFmpeg

Flux continues to use stream copy/remux (`-c copy`) for the FFmpeg HLS/DASH
route. There is no re-encode to remove, so the batch-level parallelism is the
safe acceleration layer for these jobs. Relay rewriting, separate audio inputs,
Referer/Origin arguments, progress parsing, and cancellation remain unchanged.

## Verification

Run from the repository root:

```bash
npm test
npm run build
```

For a meaningful network benchmark, use the same URL and machine before/after,
verify that the server returned `206`, and compare sustained throughput rather
than startup time. Server throttling, geography, disk speed, VPNs, and YouTube's
current delivery format can dominate the result; parallelism cannot exceed the
slowest external limit.
