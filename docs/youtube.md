# YouTube handling

Updated: 2026-09-03.

Flux handles YouTube exclusively through yt-dlp running in the local Flux Downloader CoApp. The extension does not maintain its own YouTube signature decipherer.

## Why the route is separate

YouTube format URLs and signatures change frequently, high qualities commonly separate video/audio, and subtitles have a different lifecycle from ordinary manifest variants. yt-dlp already owns that compatibility surface.

Using one dedicated route avoids:

- duplicate raw Googlevideo rows;
- stale extension-side signature logic;
- treating every intercepted rendition as a separate video;
- losing real yt-dlp `format_id` selectors.

## Detection flow

```text
top-level YouTube page metadata
  │ PAGE_METADATA with exact pageUrl/generation
  ▼
background addYouTubeVideo()
  ├─ create one VideoInfo(type = "ytdlp")
  ├─ suppress ordinary detected media on that tab
  └─ call CoApp ytdlpFormats(pageUrl)
                 │
                 ▼
       yt-dlp --no-playlist --no-warnings -J <url>
                 │
                 ▼
       normalized qualities/title/duration/thumbnail
                 │
                 ▼
       commit only if URL + page generation still match
```

Recognized page hosts include:

- `youtube.com` / `www.youtube.com` / `m.youtube.com`
- `youtu.be`
- `youtube-nocookie.com` and `www.youtube-nocookie.com`

The exact top-level page URL is used. A result from an older SPA navigation is discarded.

## Format normalization

`coapp/src/ytdlp.ts` parses the JSON returned by `-J` and creates Flux qualities.

### Video

- Requires a real `format_id`, video codec, and height.
- Groups candidates by height, rounded FPS, and dynamic range.
- Chooses the strongest candidate in each group by bitrate/size score.
- Sorts highest resolution/FPS/score first.
- Labels 4K/1440p/other heights, optional high FPS, and non-SDR dynamic range.
- If the format has no audio, pairs its ID with a preferred audio selector.
- Stores the selected yt-dlp expression in `formatArgs: ["-f", selector]`.

### Audio

When an audio-only format exists, Flux adds **Audio MP3**:

```text
-f ba -x --audio-format mp3 --audio-quality 0
```

The CoApp marks this option with `kind: "audio"`; video choices use `kind: "video"`.

### Subtitles

Manual subtitle languages become options using `--write-subs`, and automatic caption languages use `--write-auto-subs`. Both use `--skip-download` and retain language/extension metadata.

Subtitle choices use `kind: "subtitle"`. `extension/src/lib/youtube.ts` sanitizes the entire native result and infers kinds for payloads from older CoApp versions. Batch Best/Worst first selects video-kind options, falling back to non-video only when no video exists.

The exact available formats, languages, and metadata depend on yt-dlp, the page, region, login state, and YouTube at that moment.

## Fallback choices

The extension has fallback definitions for:

- Best: `-f bv*+ba/b`
- Audio MP3: `-f ba -x --audio-format mp3 --audio-quality 0`

The normal path uses the real format list returned by `ytdlpFormats`.

## Download

Selecting a YouTube option routes to:

```ts
ytdlp(pageUrl, formatArgs, {
  progressTime: 1000,
  startHandler: downloadKey,
  outputDir,
  filename: "<sanitized-name>.%(ext)s"
})
```

The CoApp prepends:

```text
--no-playlist --no-warnings --newline --concurrent-fragments 8 -o <template>
```

If FFmpeg is found, its directory is supplied through `--ffmpeg-location` so yt-dlp can merge separate tracks or convert audio.

The selected `VideoInfo.url` for a yt-dlp item remains the YouTube page URL, not an expiring Googlevideo rendition URL.

## Progress and cancellation

The CoApp parses yt-dlp `[download] N% ... at SPEED ... ETA ...` lines. It sends percent, optional speed, optional ETA, `source: "ytdlp"`, and the logical download key through the same `convertOutput` reverse RPC used by FFmpeg. Eight concurrent fragments are requested for fragmented formats.

The background associates the process PID through `convertStartNotification(startHandler, pid)`.

Cancellation calls `abortYtdlp(pid)` and kills the child process. The popup uses the same compact progress panel and Stop action as every other route.

The service-worker `DownloadRunGate` prevents two user-visible runs from racing. Inside a batch, up to four yt-dlp/FFmpeg/direct jobs may overlap and each remains keyed for progress and cancellation. Completion/error handling is shared with native FFmpeg processes so active state and the lease are released consistently.

## Runtime discovery

Expected paths are:

```text
ytdlp/win/yt-dlp.exe
ytdlp/darwin/yt-dlp
ytdlp/linux/yt-dlp
```

Search roots include install/project/executable/current directories and `FLUX_HOME`. A generic `<cwd>/ytdlp/yt-dlp[.exe]`, common macOS Homebrew/system and Linux user/system binary directories, and system `PATH` are fallbacks. Windows additionally scans common per-user Python installation `Scripts` directories. Missing-executable spawn errors fail only the requested RPC operation; they no longer take down the native host.

Known caveat: the repository's historical `coapp/ytdlp/mac/` placeholder is not the `darwin` folder current code searches.

The tagged Windows workflow currently pins **yt-dlp 2026.07.04**. Keep the workflow, release config, and third-party notice synchronized when updating it.

## Supported and unsupported cases

Flux asks yt-dlp for one page, not a playlist (`--no-playlist`).

Possible failures include:

- yt-dlp binary missing or too old;
- login/age/region restrictions;
- bot/captcha checks;
- unavailable/private videos;
- upstream extractor changes;
- DRM-protected rentals/purchases/streams;
- format disappearing between probe and download.

Flux does not bypass authentication, regional controls, service policy, or DRM. The user remains responsible for permission to download content.

## Chrome distribution note

The current project is distributed as an unpacked GitHub Release, not through the Chrome Web Store. Do not copy old Video DownloadHelper claims that “Chrome cannot download YouTube but Edge can” into this codebase: that was documentation about another product and does not describe Flux's implementation.

If a future store distribution changes YouTube behavior for policy reasons, update the manifest/code and this document together.

## Troubleshooting

### No YouTube entry

- Confirm accepted `PAGE_METADATA.pageUrl` is a recognized YouTube URL.
- Confirm top-frame/sender URL and generation checks pass.
- Check Settings reports CoApp connected.
- Run `yt-dlp --version` in the CoApp environment.
- Reload the YouTube tab after rebuilding/reloading the extension.

### Entry appears but has fallback/empty formats

- Run `yt-dlp --no-playlist --no-warnings -J <url>` manually.
- Upgrade/pin yt-dlp deliberately.
- Inspect stderr for authentication or extractor errors.
- Confirm the tab did not navigate while the probe was running.

### Download lacks audio

- Inspect the selected format's `formatArgs`.
- Confirm a compatible audio selector exists.
- Confirm FFmpeg was discovered and passed via `--ffmpeg-location`.

### Progress is missing

- Confirm `progressTime` is nonzero.
- Confirm yt-dlp is writing newline progress to stdout.
- Confirm the PID and reverse `convertOutput` callback reach the same active key.

### Subtitle output is missing

- Distinguish manual from automatic languages.
- Confirm the chosen language/ext still exists.
- Remember subtitle choices use `--skip-download` and do not create a video file.
