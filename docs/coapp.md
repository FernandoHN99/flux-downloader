# Companion application (CoApp)

Updated: 2026-09-03.

The Flux Downloader CoApp is the local Node.js process used by Flux for work a Manifest V3 extension cannot do directly: run FFmpeg/ffprobe/yt-dlp, write to chosen filesystem paths, and stream direct downloads.

Native host ID: `com.fluxdownloader.coapp`.

## Startup

`coapp/src/main.ts` imports modules for side-effect registration:

1. `native-messaging.ts` installs stdin/stdout framing.
2. `converter.ts` registers FFmpeg handlers.
3. `ytdlp.ts` registers yt-dlp handlers.
4. `downloads.ts` registers direct HTTP handlers.
5. `file.ts` registers output helpers.
6. app-level `ping`, `info`, and `quit` are registered.

Startup diagnostics use `console.error`. This is essential: stdout is reserved for framed native messages.

`info` currently returns version, platform, architecture, home directory, and the user's `Downloads` directory. The background caches the download directory and platform after first connection.

## Source map

| File | Responsibility |
|---|---|
| `src/main.ts` | module registration and app lifecycle |
| `src/native-messaging.ts` | 4-byte framing over stdin/stdout |
| `src/rpc.ts` | bidirectional `weh#rpc` dispatch/correlation |
| `src/converter.ts` | FFmpeg/ffprobe discovery, execution, progress, cancellation |
| `src/ytdlp.ts` | yt-dlp discovery, format normalization, execution, progress |
| `src/downloads.ts` | direct HTTP/HTTPS streaming, state, probe, cancellation |
| `src/file.ts` | unique output names and directory creation |
| `src/paths.ts` | install/runtime paths |
| `src/native-autoinstall.ts` | native manifest registration |
| `src/native-autoinstall-cli.ts` | register/unregister CLI |
| `src/installer.ts` | release install/uninstall and verified runtime download |
| `scripts/build-sea.mjs` | Node SEA executable creation |
| `scripts/create-release-config.mjs` | release URLs/checksums/extension ID |
| `scripts/create-checksums.mjs` | release `SHA256SUMS.txt` |

## RPC surface

### Application

| Method | Result |
|---|---|
| `ping(value)` | echoes the value |
| `info()` | version/platform/arch/home/downloadDir |
| `quit()` | schedules process exit |

### FFmpeg and ffprobe

| Method | Purpose |
|---|---|
| `convert(args, options)` | run FFmpeg and return exit code/PID/stderr |
| `abortConvert(pid)` | send `q`, then force-kill after 10 seconds if needed |
| `probe(input, json, headers)` | run ffprobe and optionally parse JSON |
| `converter.info()` | report FFmpeg version/binary |

`convert` prepends:

```text
-progress pipe:1 -hide_banner -loglevel error
```

If `options.manifestFiles` is present, it creates a temporary `flux-hls-*` directory, writes supplied HLS manifests, replaces placeholder arguments with local file paths, and removes the directory when FFmpeg exits.

The process PID is pushed to the extension through `convertStartNotification`. Machine-readable progress is parsed from stdout and sent through `convertOutput`. stderr is accumulated for the final result/error formatter.

In this integration FFmpeg's `out_time_ms` value is divided by 1,000,000 to obtain seconds; preserve this project-specific behavior.

### yt-dlp

| Method | Purpose |
|---|---|
| `ytdlpFormats(url)` | run `yt-dlp --no-playlist --no-warnings -J` and normalize choices |
| `ytdlp(url, args, options)` | execute selected format/subtitle/audio download |
| `abortYtdlp(pid)` | kill the matching process |

Format normalization:

- groups video by height/FPS/dynamic range;
- picks the strongest candidate per group;
- retains real `format_id`;
- pairs video-only formats with a preferred audio selector;
- adds an MP3 audio option;
- adds manual and automatic subtitle options;
- returns title, duration, and thumbnail.

Every returned choice now carries explicit `kind: video | audio | subtitle`. The extension revalidates/coerces the native payload in `lib/youtube.ts` and infers a kind for older CoApp payloads, so a batch “Worst” choice cannot accidentally select MP3 while video exists.

Downloads always use `--no-playlist`, `--no-warnings`, `--newline`, and an output template. If a local FFmpeg directory is found it is passed through `--ffmpeg-location`.

Progress lines are converted to percent/speed/ETA payloads and sent through the same `convertOutput` callback consumed by the extension's compact progress UI.

### Direct downloads

| Method | Purpose |
|---|---|
| `downloads.download(options)` | stream URL to a file and return numeric ID |
| `downloads.search({id})` | read bytes, total, filename, state, and error |
| `downloads.probeStatus(url, referer)` | lightweight URL liveness/status check |
| `downloads.cancel(id)` | destroy an in-progress stream |

The implementation uses Node's built-in `http`/`https` modules and follows at most five redirects. Request headers can be supplied; TLS verification is enabled unless explicitly disabled.

States are `in_progress`, `complete`, or `interrupted`. The extension polls `downloads.search` for byte progress. Completion and errors are pushed back with `downloadComplete`/`downloadError`.

An `ECONNRESET` after bytes were received is treated as complete because some servers close a completed response abruptly. Entries are removed from the in-memory table after 60 seconds.

`downloads.probeStatus` adds Referer and Origin when possible, destroys the body after response status, and times out after 10 seconds. It is used before historical downloads to distinguish an expired signed URL from a deeper FFmpeg failure.

### File helpers

Only two filesystem methods are exposed over RPC:

| Method | Purpose |
|---|---|
| `file.uniquePath(directory, filename)` | append `_1`, `_2`, … before extension until unused |
| `file.ensureDir(directory)` | recursively create a batch output directory |

The older VDH-style broad `fs.*` surface is not part of this CoApp.

## Runtime discovery

`coapp/src/paths.ts` defines install roots:

| OS | Install root |
|---|---|
| Windows | `%LOCALAPPDATA%\FluxDownloader` |
| macOS | `~/Library/Application Support/FluxDownloader` |
| Linux | `$XDG_DATA_HOME/FluxDownloader` or `~/.local/share/FluxDownloader` |

Overrides:

- `FLUX_INSTALL_DIR` changes the install root.
- `FLUX_HOME` adds the first runtime search root.

Runtime roots also include the current working directory, install directory, executable directory, and project directory near compiled code.

Platform binary paths:

```text
ffmpeg/<win|darwin|linux>/ffmpeg[.exe]
ffmpeg/<win|darwin|linux>/ffprobe[.exe]
ytdlp/<win|darwin|linux>/yt-dlp[.exe]
```

Converter/ytdlp modules also check generic current-working-directory paths and finally return the command name for system `PATH` lookup.

Known source-layout caveat: tracked placeholder folders currently include `coapp/ytdlp/mac/`, while `process.platform` is `darwin`. Use/create `darwin` or a generic/system path unless path resolution itself is fixed.

## Native host registration

`registerManifest(extensionIds)` writes `com.fluxdownloader.coapp.json` under the install root with:

- name `com.fluxdownloader.coapp`;
- path to `coapp[.exe]` in the install root;
- `type: "stdio"`;
- Chrome extension origins for the supplied IDs.

Registration destinations:

| OS | Chrome | Edge |
|---|---|---|
| Windows | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fluxdownloader.coapp` | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdownloader.coapp` |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/` | `~/.config/microsoft-edge/NativeMessagingHosts/` |

Firefox manifests/IDs are not implemented.

Development CLI:

```bash
cd coapp
node dist/native-autoinstall-cli.js register <extension-id>
node dist/native-autoinstall-cli.js unregister
```

## Release installer

`installer.ts` can read `release-config.json` from an embedded Node SEA asset or next to the executable. It:

1. resolves extension ID/install directory;
2. extracts an embedded gzip-compressed CoApp asset when present;
3. copies and marks the CoApp executable;
4. downloads FFmpeg, ffprobe, and yt-dlp over HTTPS only;
5. requires and verifies a 64-character SHA-256 for each runtime;
6. installs into platform subdirectories;
7. registers the native host for the exact extension ID.

Temporary downloads are removed in `finally`. Runtime redirects are capped at five.

The release build embeds compressed raw CoApp bytes into the installer. Do not embed an already-injected SEA inside another SEA without compression/extraction; duplicate SEA sentinels can corrupt discovery.

## Build

```bash
cd coapp
npm run build             # TypeScript CommonJS output
npm run bundle            # main.bundle.cjs for SEA
npm run bundle:installer  # installer.bundle.cjs for SEA
npm run build:sea
npm start
```

The workspace emits declarations, declaration maps, and source maps. There is currently no process-side CoApp test suite. The extension-side `NativeClient` transport/lifecycle has nine Vitest cases, but they do not execute CoApp framing, child processes, filesystem, or HTTP code.

## Failure model

- Missing native registration: `connectNative` disconnects with Chrome's last error.
- Synchronous first-connect failure: the extension does not cache the rejected attempt; a later call can reconnect after registration/install is repaired.
- Missing runtime: process spawn fails or command exits nonzero.
- FFmpeg/yt-dlp nonzero exit: CoApp returns code/stderr; background sends user-facing failure.
- Extension disappears during callback: CoApp callback rejects; active conversion code may kill the child to avoid orphan work.
- Direct network error: state becomes interrupted and `downloadError` is called.
- Process shutdown: tracked FFmpeg/yt-dlp children are killed on SIGINT/SIGTERM/exit.

See [native-messaging.md](native-messaging.md), [ffmpeg.md](ffmpeg.md), and [youtube.md](youtube.md).
