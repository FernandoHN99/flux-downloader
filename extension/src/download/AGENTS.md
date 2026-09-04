# download/ — fetching media

Everything that answers *"how do we actually get this file?"* The extension
never downloads media itself: it plans the work and hands it to the CoApp over
native messaging.

| File | Owns |
|---|---|
| `native-client.ts` | `NativeClient` — the CoApp connection and RPC lifecycle |
| `download-run-gate.ts` | The single native execution slot |
| `download-tracker.ts` | Active IDs, outcomes, cancellation tombstones |
| `batch-run.ts` | Batch queue transitions |
| `download-plan.ts` | Filenames, extensions, output paths, batch quality choice |
| `hls-rewrite.ts` | Rewriting manifest URIs for learned browser relays |
| `hls-arguments.ts` | Multi-input FFmpeg argument preparation |

## Routing

| Media | Path |
|---|---|
| HLS / DASH | FFmpeg `convert`, normally stream-copy/remux |
| MSE | FFmpeg with captured/reconstructed input arguments |
| YouTube | yt-dlp |
| Direct MP4/WebM/other | CoApp HTTP downloader; byte progress polled, completion/errors pushed |

Historical links are probed for expiration before download; current links skip
the check. A probe that fails to run returns `undefined` and must never block a
download.

## Concurrency — the rules that bite

`DownloadRunGate` reserves the one native execution slot **synchronously,
before the first `await`**, and holds it across popup instances and for the
whole batch. Disabling buttons in the popup is feedback, not the lock: separate
popup instances would otherwise both start a run.

`DownloadTracker` owns active IDs, outcomes and cancellation tombstones. There
is exactly one settlement path that publishes process completion and releases
ownership — late or duplicate native callbacks must not revive a cancelled
download.

`BatchRun` owns queue transitions. A cancelled item is **not** marked failed,
and a cancellation arriving before a native ID exists is applied as soon as the
ID appears.

Batch downloads are sequential and write into a `Flux_<timestamp>` folder.

## Native client

`NativeClient` uses a 60-second timeout for ordinary RPC and **no timeout** for
long-running `convert`/`ytdlp`. It rejects pending calls on disconnect and
retries connection after five seconds. A synchronous initial `connectNative`
failure is not cached: a later call must make a fresh attempt, or one missing
host at startup makes every retry reuse the same rejected promise.

Host ID: `com.fluxdownloader.coapp`. See [../../../coapp/src/AGENTS.md](../../../coapp/src/AGENTS.md)
for the process side.

## FFmpeg arguments

`hls-rewrite.ts` rewrites segment, key and init-map URIs for learned relays and
**rejects a partial mapping** rather than emitting a half-rewritten manifest.

`hls-arguments.ts` walks inputs without mutating the array under iteration —
in-place insertion skipped or misordered a later audio input — and attaches
local-manifest protocol options to every rewritten HTTP(S) input.

FFmpeg `out_time_ms` is treated as **nanoseconds** in this integration and
divided by `1_000_000` for seconds. The field name is misleading; the tested
behavior is correct.

Output names are sanitized, and `file.uniquePath` appends `_1`, `_2`, … rather
than overwriting an existing file.
