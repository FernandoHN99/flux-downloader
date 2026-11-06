# download/ — fetching media

Everything that answers *"how do we actually get this file?"* The extension
never downloads media itself: it plans the work and hands it to the CoApp over
native messaging.

| File | Owns |
|---|---|
| `native-client.ts` | `NativeClient` — the CoApp connection and RPC lifecycle |
| `download-run-gate.ts` | The exclusive user-visible run lease, and the videos it locks |
| `toolbar-spinner.ts`, `toolbar-icon.ts` | The toolbar icon that spins while a run holds the gate |
| `download-tracker.ts` | Active IDs, outcomes, cancellation tombstones |
| `download-key.ts` | Collision-safe FFmpeg/yt-dlp logical keys |
| `batch-run.ts` | Batch queue transitions |
| `batch-pool.ts` | Bounded concurrent batch dispatch |
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
the check, except a **rendition chosen from a master playlist**, which is always
probed. A master can list a rendition the server never had (a 4K answering 404);
that is not an expired link, so `startDownload` falls back to the next-best live
sibling from history (`rankFallbackRenditions`: at or below the chosen height
first) and only reports "Link expired" when none is alive. Master tokens also
expire in minutes while rendition tokens last a day, so never fall back *to* the
master URL. A probe that fails to run returns `undefined` and must never block a
download.

## Concurrency — the rules that bite

`DownloadRunGate` reserves one **user-visible run synchronously, before the
first `await`**, and holds it across popup instances and for the whole batch.
Disabling buttons in the popup is feedback, not the lock: separate popup
instances would otherwise both start a run. A batch holding one lease fans out
to four native jobs through `batch-pool.ts`; do not reacquire the gate per item.

The lease also carries `keys`: the videos the run was started for (`videoKey`).
`gate.lockedKeys` is the one answer to "may this video be edited right now?",
and it holds for the whole run, finished items included, not just the queue
(`BatchStatus.keys` is that list for the popup; `remainingKeys` shrinks as items
finish and cannot say it). The service worker refuses rename, delete, filing and
folder edits on those keys; the popup does not offer them (`isLocked`).

The gate's `changed` callback is what drives the toolbar icon: `ToolbarSpinner`
animates it while a lease is held and puts the manifest icon back on release.
The spinner owns timing (serialized frames, a frame that lands after the stop is
discarded) and takes its drawing as a port; `toolbar-icon.ts` is the only part
that needs a browser (OffscreenCanvas in the service worker, `action.setIcon`).

`DownloadTracker` owns active IDs, outcomes and cancellation tombstones. There
is exactly one settlement path that publishes process completion and releases
ownership — late or duplicate native callbacks must not revive a cancelled
download.

`BatchRun` owns queue transitions and every active source/native ID. A cancelled
item is **not** marked failed, Stop returns all known IDs, and a cancellation
arriving before any native ID exists is applied as soon as that ID appears.

Batch downloads run up to four at once and write into a `Flux_<timestamp>`
folder. Plan and case-insensitively deduplicate sanitized output names before
dispatch; parallel `file.uniquePath` checks cannot reserve a not-yet-created
path by themselves.

FFmpeg and yt-dlp progress must carry the logical download key. Process keys
include both time and a monotonic sequence because `Date.now()` alone collides
during fan-out. Direct HTTP receives Referer/Origin and may itself use up to
eight ranges; see `docs/performance.md`.

## Folders and output directories

A video filed in one of the user's folders downloads into a sub-directory named
after the folder, created on demand (`folderDirectory()` in `background.ts`):

- a **single** download goes to `<download dir>/<folder>/`;
- a **batch** keeps the folders *inside* its run folder:
  `<download dir>/Flux_<timestamp>/<folder>/video.mp4`, with the videos that are
  in no folder loose at the top of `Flux_<timestamp>`. The run folder is always
  created.

A folder that cannot be created is an error — never a silent fallback to the
wrong directory. The folder is looked up in the background by `videoKey`; the
`folderId` the popup sends is not trusted.

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

Every batch file is numbered by when its video was added, in front of the name:
`01-Lesson.mp4`. The batch is newest-first (the order the history stores), so the
last video is `01` and the first is the total; the width follows the total (two
digits at least) so a file manager sorts it as the course runs. The number is the
video's position in the list, whether or not that video could be planned, so a gap
in the numbers shows a missing lesson; it is also what makes every name unique. A
batch of one stays unnumbered. The numbering is batch-wide: videos filed into a
folder keep their place in the whole run, so a folder can hold 05, 06 and 09.

The popup must hand the batch over in **stored** order (`inStoredOrder` in
`popup/selectors.ts`), not screen order: the screen pins the video playing now to
the top, which would otherwise make the lesson open in a tab the highest number
whatever its place in the course. Single downloads are not numbered. Output names
are sanitized, and `file.uniquePath` appends `_1`, `_2`, … rather than overwriting
an existing file.
