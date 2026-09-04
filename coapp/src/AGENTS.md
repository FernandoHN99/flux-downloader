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
| `downloads.ts` | Direct HTTP downloading, status probing |
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
`ytdlp/{win|darwin|linux}/`, then project/cwd fallbacks, then system `PATH`.
Note the mismatch: the tracked yt-dlp placeholder is `coapp/ytdlp/mac` while
`paths.ts` derives `darwin`, and there is no tracked `coapp/ffmpeg/` tree.
Verify real platform paths before changing discovery.

Use Node's built-in HTTP/HTTPS streams. SEA builds must not depend on an
ESM-only HTTP client.

## Packaging

Do **not** inject an already SEA-injected CoApp binary into another SEA binary:
duplicate Node SEA sentinels are unsafe. The installer embeds the
gzip-compressed CoApp asset instead.

## Tests

`npm test --workspace=coapp` (Vitest, node environment). Coverage is currently
`rpc.ts` only — 7 tests. The FFmpeg, yt-dlp and HTTP paths are untested and
spawn real processes; add tests behind injectable spawners rather than mocking
`child_process` globally.
