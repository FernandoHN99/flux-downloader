# coapp/src/ — the native host

A local Node process the extension talks to over Chrome native messaging. It
does everything the extension cannot: filesystem, FFmpeg, yt-dlp, and direct
HTTP downloads.

| File | Owns |
|---|---|
| `main.ts` | Process entry, handler registration |
| `native-messaging.ts` | Length-prefixed stdio transport |
| `rpc.ts` | Bidirectional `weh#rpc` protocol |
| `converter.ts` | FFmpeg invocation and progress |
| `ytdlp.ts` | yt-dlp invocation and format listing |
| `ytdlp-options.ts` | pure yt-dlp download arguments and fragment tuning |
| `line-buffer.ts` | chunk-safe process stdout line framing |
| `progress-callback.ts` | backward-compatible keyed progress arguments |
| `child-process.ts` | spawn-error settlement that keeps the RPC host alive |
| `downloads.ts` | Direct-download RPC registration and status probing |
| `http-download.ts` | parallel ranges, sequential fallback, progress, cancellation |
| `file.ts` | Unique paths, directory creation |
| `paths.ts` | Binary and install-root discovery |
| `installer.ts`, `native-autoinstall*.ts` | Install and host registration |

## Transport

Host ID: `com.fluxdownloader.coapp`.

Messages are 4-byte little-endian length-prefixed UTF-8 JSON. **Stdout is
protocol-only** — anything written there that is not a framed message corrupts
the stream. All logging goes to stderr.

On top of transport both sides speak `weh#rpc`:

```json
{ "type": "weh#rpc", "_request": 1, "_method": "info", "_args": [] }
{ "type": "weh#rpc", "_reply": 1, "_result": {} }
{ "type": "weh#rpc", "_reply": 1, "_error": "message" }
```

Progress is **not** fire-and-forget: the CoApp calls extension RPC methods
(`convertOutput`, `convertStartNotification`, `downloadComplete`,
`downloadError`) and receives replies.

`RpcProtocol.call()` drops its pending-reply entry if `post()` throws — a dead
transport never replies, and the entry would otherwise sit in the map for the
life of the process.

## Handlers

- app: `ping`, `info`, `quit`
- FFmpeg: `convert`, `abortConvert`, `probe`, `converter.info`
- yt-dlp: `ytdlpFormats`, `ytdlp`, `abortYtdlp`
- HTTP: `downloads.download`, `downloads.search`, `downloads.probeStatus`, `downloads.cancel`
- filesystem: `file.uniquePath`, `file.ensureDir`

## Runtime paths

Install roots:

- Windows: `%LOCALAPPDATA%\FluxDownloader`
- macOS: `~/Library/Application Support/FluxDownloader`
- Linux: `$XDG_DATA_HOME/FluxDownloader` or `~/.local/share/FluxDownloader`

`FLUX_INSTALL_DIR` overrides the install root; `FLUX_HOME` adds a search root.

Binaries are searched under known roots as `ffmpeg/{win|darwin|linux}/` and
`ytdlp/{win|darwin|linux}/`, then project/cwd fallbacks, common executable
directories (`/opt/homebrew/bin` and `/usr/local/bin` on macOS, user/local
binary directories on Linux), then system `PATH`. Browser-launched native
hosts commonly receive only `/usr/bin:/bin:/usr/sbin:/sbin`; do not assume a
terminal's Homebrew-aware `PATH` reaches the CoApp.
Note the mismatch: the tracked yt-dlp placeholder is `coapp/ytdlp/mac` while
`paths.ts` derives `darwin`, and there is no tracked `coapp/ffmpeg/` tree.
Verify real platform paths before changing discovery.

Call `settleChild()` immediately after every `child_process.spawn()`. A missing
executable emits `error`, not `exit`; leaving that event unhandled terminates
the native host and Chrome reports only “Native host has exited.” Return an
operation-level RPC error/result instead.

Use Node's built-in HTTP/HTTPS streams. SEA builds must not depend on an
ESM-only HTTP client.

## Performance invariants

- yt-dlp downloads use eight concurrent fragments. Keep the default in
  `ytdlp-options.ts` so argument tests do not have to spawn a real binary.
- Direct downloads prove range support with a `bytes=0-0` request; never trust
  `Accept-Ranges` alone. A valid known-length response uses up to eight ranges
  with at least 4 MiB per connection.
- Every part must match its requested `Content-Range` and object total. Forward
  a strong ETag or Last-Modified through `If-Range` when available.
- A part resumes from its last written byte and retries three times. Invalid
  range behavior falls back once to a clean sequential download. Disk errors
  do not retry over the network.
- Known-length bodies are complete only at the exact byte count. Never restore
  the old “some bytes plus ECONNRESET means complete” shortcut.
- Cancellation aborts every request and failed/cancelled partial outputs are
  removed. Completed/searchable records remain for 60 seconds.
- `convertOutput` keeps its original first three arguments and appends the
  logical `startHandler`; this is required for both concurrent attribution and
  compatibility with an older extension.

## Packaging

Do **not** inject an already SEA-injected CoApp binary into another SEA binary:
duplicate Node SEA sentinels are unsafe. The installer embeds the
gzip-compressed CoApp asset instead.

## Tests

`npm test --workspace=coapp` (Vitest, node environment). Process tests should
use pure argument/line helpers or injectable spawners rather than mocking
`child_process` globally. HTTP acceleration tests may use a loopback server and
temporary directory; assert both byte identity and observed request ranges.
