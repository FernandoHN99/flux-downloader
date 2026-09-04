# FFmpeg integration

Updated: 2026-09-03.

Flux uses FFmpeg and ffprobe as separate local runtime programs through the Flux Downloader CoApp. They are not linked into the extension or CoApp source.

## Responsibilities

FFmpeg handles:

- HLS download/remux;
- DASH download/remux;
- MSE/captured stream inputs;
- video/audio stream combination described by selected format arguments;
- machine-readable progress.

ffprobe inspects media URLs/files when Flux needs stream metadata or a fallback quality.

Direct MP4/WebM downloads do not normally use FFmpeg; they use the CoApp's Node HTTP/HTTPS downloader. YouTube is launched through yt-dlp, which may itself use the discovered FFmpeg directory.

Flux does not currently expose a generic conversion UI, transcoding presets, or watermarking.

## Discovery

`coapp/src/converter.ts` and `coapp/src/ytdlp.ts` search runtime roots from `coapp/src/paths.ts`.

Install roots:

- Windows: `%LOCALAPPDATA%\Flux Downloader`
- macOS: `~/Library/Application Support/FluxDownloader`
- Linux: `$XDG_DATA_HOME/FluxDownloader` or `~/.local/share/FluxDownloader`

Expected platform paths:

```text
ffmpeg/win/ffmpeg.exe
ffmpeg/win/ffprobe.exe
ffmpeg/darwin/ffmpeg
ffmpeg/darwin/ffprobe
ffmpeg/linux/ffmpeg
ffmpeg/linux/ffprobe
```

Search roots include `FLUX_HOME`, current working directory, install directory, executable directory, and the project directory near compiled code. Converter code also checks `<cwd>/ffmpeg/ffmpeg[.exe]` and `ffprobe[.exe]`. The final fallback is the command name on system `PATH`.

`FLUX_INSTALL_DIR` overrides the install root.

## Release binary

The current Windows release workflow downloads the **GyanD/codexffmpeg 8.1.2 Essentials** archive and publishes/install its `ffmpeg.exe` and `ffprobe.exe` as separate GPLv3 runtime programs.

The project does not claim these are custom Flux Downloader builds. Keep the exact provider/version and corresponding source/license information synchronized with [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) whenever the workflow pin changes.

## Converter RPC

The extension calls:

```ts
convert(args, {
  progressTime: 1000,
  startHandler: downloadKey,
  manifestFiles?: [{ placeholder, content }]
})
```

The CoApp prepends:

```text
-progress pipe:1 -hide_banner -loglevel error
```

It then spawns the resolved FFmpeg binary without a shell.

### Standard HLS/DASH shape

When no specialized quality arguments exist, the background builds a stream-copy invocation equivalent to:

```text
ffmpeg -progress pipe:1 -hide_banner -loglevel error \
  [Referer/Origin input options] -i <media-or-manifest-url> \
  -c copy -y <output-path>
```

Subtitle output uses `-c:s copy`. A selected quality can carry its own `formatArgs`, in which case those arguments are used before the final output path.

Stream copy/remux is intentional:

- no quality loss from re-encoding;
- lower CPU usage;
- faster completion;
- output compatibility remains dependent on source codecs/container.

### Request context

When source context is known, the background can prepend:

```text
-referer <page/referer>
-headers "Origin: <source-origin>\r\n"
```

Preserve this context for CDNs that reject requests without a valid page origin. `VideoInfo.pageUrl` is the source-page fact; `VideoInfo.url` is the stream/CDN fact.

### Local HLS manifests

Some opaque HLS streams require rewritten manifests. The background can send `manifestFiles` with placeholder arguments. The CoApp:

1. creates `<os tmp>/flux-hls-*`;
2. writes `manifest-0.m3u8`, `manifest-1.m3u8`, etc.;
3. replaces argument placeholders with local paths;
4. executes FFmpeg;
5. recursively removes the temporary directory on exit.

Do not write these generated manifests into the repository or download folder.

The text transformation is isolated in `extension/src/lib/hls-rewrite.ts`. It resolves segment lines and quoted `URI` attributes (including encryption keys and init maps) against the final manifest response URL, then asks the tab's relay codec for replacements. If zero URIs are rewritten or any URI is unresolved, the background fails with an actionable “start playback and retry” error instead of passing a partially rewritten playlist to FFmpeg.

`extension/src/lib/hls-arguments.ts` prepares the final FFmpeg array without inserting into the array it is currently scanning. Every HTTP(S) `-i` is visited in order, so separate rewritten video and alternate-audio playlists each receive their own local-manifest protocol options. Local/data/already-placeholder inputs are left untouched.

## Progress

FFmpeg writes key/value records to stdout because of `-progress pipe:1`. The CoApp accumulates a record until it sees `progress=...` and then calls:

```text
convertOutput(progressTime, currentSeconds, info)
```

In this project, `out_time_ms` is treated as nanoseconds:

```ts
const seconds = parseInt(info.out_time_ms, 10) / 1_000_000;
```

The field name is misleading, but changing the divisor without testing real output will break percentage calculations.

The background uses the selected video's duration to calculate percent, clamps it to 100, records the last progress, updates the active popup row, and feeds the compact shared `ProgressPanel`.

Before a measurable value arrives, the popup shows an indeterminate bar rather than falsely claiming 0%.

## PID and cancellation

After spawning, CoApp calls `convertStartNotification(startHandler, pid)`. `startHandler` is the extension's logical download key, which avoids assigning a PID to the wrong concurrent record.

Cancellation:

1. extension finds the active download's PID;
2. calls `abortConvert(pid)`;
3. CoApp writes `q` to FFmpeg stdin;
4. after 10 seconds, it force-kills the still-running child.

All tracked FFmpeg children are also killed when CoApp receives SIGINT/SIGTERM or exits.

The popup disables concurrent actions for feedback, and `DownloadRunGate` enforces the same rule synchronously in the service worker across popup instances. PID association must still remain keyed because cancellation can arrive before `convertStartNotification`; `DownloadTracker` keeps a cancellation tombstone and aborts that late PID.

## Completion and errors

`convert` resolves with:

```ts
{
  exitCode: number | null,
  pid: number | undefined,
  stderr: string
}
```

The background uses one settlement path for FFmpeg, MSE conversion, and yt-dlp. It:

- publishes `DOWNLOAD_COMPLETE` and a desktop notification for exit code 0;
- formats stderr into `DOWNLOAD_ERROR` for nonzero exit;
- marks the stable source key as downloaded only on success;
- releases the active/batch waiter in both cases.

Single downloads release their native-run lease on settlement. A batch retains one lease between sequential items and releases it only when the queue ends. Cancelled batch items do not receive a persistent failure marker.

Historical signed URLs are probed through `downloads.probeStatus` before FFmpeg starts. Common HTTP expiry statuses produce a direct “reopen the page” error instead of an opaque FFmpeg failure.

## ffprobe

`probe(input, json=true, headers=[])` invokes:

```text
ffprobe -v quiet -print_format json -show_format -show_streams [headers] <input>
```

JSON output is parsed by the CoApp. Parse failure or nonzero exit rejects the RPC with stderr context.

`converter.info` runs `ffmpeg -h` and extracts a version token plus the resolved binary path. The app-level `info` method is separate and reports CoApp/platform/download-directory data.

## Troubleshooting

### Spawn fails

- Run `ffmpeg -version` and `ffprobe -version` from the environment that launches CoApp.
- Inspect resolved runtime roots and the `win`/`darwin`/`linux` folder name.
- Ensure the file is executable on macOS/Linux.
- Remember that tracked `mac` placeholders do not match Node's `darwin` platform string.

### HTTP/authorization error

- Reopen the source page and use **Refresh tabs**.
- Confirm Referer/Origin survived parser and quality selection.
- Confirm the media URL has not expired.
- Check whether the stream is DRM-protected.

### Percentage is wrong

- Confirm duration is seconds.
- Inspect actual `out_time_ms` payload from this FFmpeg build.
- Preserve the project's 1,000,000 divisor unless evidence/tests justify changing it.
- For direct downloads, diagnose byte polling instead; it does not use FFmpeg progress.

### Output has no audio

- Check whether HLS audio renditions or DASH/yt-dlp audio selectors are present.
- Inspect selected `formatArgs`.
- Confirm the source is not a video-only quality without a paired audio input.

### Cancellation leaves work

- Confirm `convertStartNotification` associated the PID with the same download key.
- Confirm the CoApp process is still connected to receive `abortConvert`.
- Allow the 10-second graceful-to-force-kill window.
