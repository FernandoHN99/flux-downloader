# Native messaging protocol

Updated: 2026-09-03.

Flux's extension talks to the local Flux Downloader CoApp through Chrome's native messaging port and a bidirectional request/reply layer named `weh#rpc`.

Native host ID: `com.fluxdownloader.coapp`.

## Layers

```text
extension TypeScript object
  │ chrome.runtime.connectNative / Port.postMessage
  ▼
Chrome native messaging transport
  │ 4-byte little-endian byte length + UTF-8 JSON
  ▼
coapp/src/native-messaging.ts
  │ parsed RpcMessage
  ▼
coapp/src/rpc.ts (weh#rpc)
```

The extension does not manually write length bytes; Chrome performs native-host transport framing. The CoApp must parse/write framing on stdin/stdout.

Native messaging is **not newline-delimited**. Stdout may contain only framed protocol bytes. Human diagnostics belong on stderr.

## Process-side framing

Each frame is:

```text
offset  size  meaning
0       4     unsigned little-endian JSON byte length N
4       N     UTF-8 JSON payload
```

The CoApp accumulates chunks because a read may contain a partial frame or several frames. Once `backlog.length >= 4 + N`, it parses one payload and keeps the remainder.

Sending performs the inverse:

```ts
const payload = Buffer.from(JSON.stringify(message), 'utf8');
const header = Buffer.alloc(4);
header.writeUInt32LE(payload.length, 0);
process.stdout.write(header);
process.stdout.write(payload);
```

## `weh#rpc` envelope

### Request

```json
{
  "type": "weh#rpc",
  "_request": 17,
  "_method": "info",
  "_args": []
}
```

### Success reply

```json
{
  "type": "weh#rpc",
  "_reply": 17,
  "_result": {
    "version": "1.1.1",
    "platform": "win32"
  }
}
```

### Error reply

```json
{
  "type": "weh#rpc",
  "_reply": 17,
  "_error": "Method missing is not a function"
}
```

Request IDs are local monotonically increasing counters. Each side maintains a pending map keyed by reply ID.

There is no separate `_notify` path in the current code. “Push” events are normal RPC requests in the reverse direction and therefore receive replies.

## Bidirectional calls

### Extension → CoApp

The background uses convenience methods from `extension/src/lib/native-client.ts`:

| Wrapper | RPC method |
|---|---|
| `ping()` | `ping` |
| `info()` | `info` |
| `convert()` / `abortConvert()` | `convert` / `abortConvert` |
| `probe()` | `probe` |
| `ytdlpFormats()` | `ytdlpFormats` |
| `ytdlp()` / `abortYtdlp()` | `ytdlp` / `abortYtdlp` |
| `downloadFile()` | `downloads.download` |
| `searchDownloads()` | `downloads.search` |
| `probeStatus()` | `downloads.probeStatus` |
| `cancelDownload()` | `downloads.cancel` |
| `uniquePath()` | `file.uniquePath` |
| `ensureDir()` | `file.ensureDir` |

### CoApp → extension

The background registers:

| Method | Purpose |
|---|---|
| `convertStartNotification(startHandler, pid)` | attach FFmpeg/yt-dlp PID to a logical download |
| `convertOutput(progressTime, currentSeconds, info, startHandler?)` | push FFmpeg or yt-dlp progress for one logical download |
| `downloadComplete(downloadId, outputPath)` | finish direct download |
| `downloadError(downloadId, error)` | fail direct download |

The callback name `convertStartNotification` is historical; it is an RPC request, not an unacknowledged notification.

## RPC dispatch behavior

On request:

1. Look up `listeners[_method]`.
2. Invoke it with positional `_args`.
3. Resolve sync/async result.
4. Send `_result` or stringify the thrown error into `_error`.

On reply:

1. Find the pending promise by `_reply`.
2. Delete it from the map.
3. Resolve `_result` or reject an Error carrying `_error`.

Unknown or non-function methods produce an error reply.

## NativeClient lifecycle

`NativeClient`:

- opens `chrome.runtime.connectNative("com.fluxdownloader.coapp")` lazily;
- reuses an already-live port (connection setup itself is synchronous);
- never caches a synchronous failed `connectNative` attempt, so the next call can recover after installation/restart;
- rejects every pending call when the port disconnects;
- records Chrome's `runtime.lastError` in a `ConnectionError`;
- schedules reconnect after five seconds unless disconnect was intentional;
- times ordinary calls out after 60 seconds;
- gives long-running `convert` and `ytdlp` calls no client timeout;
- can retry recoverable operations with increasing delays through `withRetry`.

Nine extension-side tests cover live-port reuse, retry after initial failure, request/reply correlation, remote errors, timeout policy, reverse calls, unknown handlers, reconnect, and intentional disconnect. The CoApp suite separately covers `RpcProtocol`, loopback HTTP transfers, process-line buffering, keyed progress arguments, and yt-dlp argument construction; it does not spawn real FFmpeg or yt-dlp binaries.

The settings status does not trust a cold `connected` boolean. Its `PING` background handler first tries to connect, calls `info`, and then reports version/error.

## Typical FFmpeg sequence

```text
Extension                         CoApp
    │ connectNative                │
    │── info request ─────────────▶│
    │◀─ info reply ────────────────│
    │                              │
    │── convert(args, options) ───▶│
    │                              ├─ spawn FFmpeg
    │◀─ convertStartNotification ──│
    │── callback reply ───────────▶│
    │◀─ convertOutput ─────────────│  repeated
    │── callback reply ───────────▶│
    │                              ├─ process exits
    │◀─ convert final reply ───────│
```

The final `convert` request stays pending for the whole process. Progress uses independent reverse requests.

## Typical direct-download sequence

```text
Extension                         CoApp
    │── downloads.download ───────▶│
    │◀─ numeric ID ────────────────│
    │── downloads.search({id}) ───▶│  repeated polling for bytes
    │◀─ state/bytes ───────────────│
    │◀─ downloadComplete/error ────│
    │── callback reply ───────────▶│
```

## Popup protocol is separate

Do not confuse native RPC with the long-lived `chrome.runtime.connect({name: "popup"})` port.

The popup uses the discriminated protocol in `extension/src/lib/popup-protocol.ts`, with application messages such as `GET_MEDIA`, `REFRESH_TABS`, `DOWNLOAD`, `MEDIA_LIST`, and `DOWNLOAD_PROGRESS`. Unknown popup message types are rejected before routing. These messages have no `weh#rpc` envelope and never cross the native process boundary directly.

Similarly, `extension/src/lib/content-protocol.ts` separately types and validates content/background traffic. `RESCAN` is an internal background → content-script runtime message; do not rename it to the user-facing `REFRESH_TABS` command.

The service worker's `DownloadRunGate` reserves one user-visible run before asynchronous setup. This is above RPC: it prevents separate popups or a batch/manual race, while the batch holding that lease may start four ID-keyed native operations concurrently.

## Native manifest

Representative generated manifest:

```json
{
  "name": "com.fluxdownloader.coapp",
  "description": "Flux Downloader companion application",
  "path": "C:\\Users\\name\\AppData\\Local\\FluxDownloader\\coapp.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://igephdkobpgbfgdjmehckbhffbimgkii/"
  ]
}
```

Chrome/Edge require exact extension origins. The release manifest key fixes the production/sideload ID so the installer can embed it.

### Registration locations

Windows stores registry values under the current user:

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fluxdownloader.coapp
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdownloader.coapp
```

macOS copies JSON into:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/
```

Linux copies JSON into:

```text
~/.config/google-chrome/NativeMessagingHosts/
~/.config/microsoft-edge/NativeMessagingHosts/
```

This repository does not register Firefox `allowed_extensions`.

## Security properties

- Only allowlisted extension origins can start the host.
- The channel is local stdio, not a listening network socket.
- RPC dispatch only invokes registered method names.
- The exposed file API is intentionally narrow: unique path and ensure directory.
- Runtime downloads performed by the installer require HTTPS and pinned SHA-256.
- Download URLs still cause outbound requests to their source/CDN; “local CoApp” does not mean “offline.”

## Debugging

### CoApp is not found

1. Confirm `com.fluxdownloader.coapp.json` exists.
2. Confirm its `path` is absolute and executable.
3. Confirm `allowed_origins` contains the browser's actual extension ID.
4. Confirm the Windows registry value points to that JSON.
5. Reload the extension after registration.
6. On a source checkout, prefer `coapp/scripts/register-dev-host.sh` (or
   `.ps1` on Windows) over the raw `native-autoinstall-cli.js register` step —
   the latter only writes a manifest pointing at a `coapp` binary that has to
   already exist at the install root. If the repository was ever moved or
   renamed after registering, or its selected Node version was removed, an
   embedded path goes stale and Chrome reports the host as having exited
   immediately; re-run the script to fix it. The macOS/Linux script records
   Node's physical `process.execPath`, avoiding fnm's disposable per-shell
   `fnm_multishells` executable path.

### Port disconnects immediately

- Run `cd coapp && node dist/main.js` and inspect stderr.
- Ensure no log is written to stdout.
- Verify the built CommonJS files exist.
- Verify the process does not exit due to a missing import/runtime exception.
- For a source checkout, temporarily register with
  `FLUX_DEV_HOST_LOG="$HOME/Library/Logs/FluxDownloader/native-host.log" ./scripts/register-dev-host.sh`.
  This redirects only the development host's stderr to that file; native RPC
  stdout stays untouched. Register again without the variable after diagnosis
  to disable persistent logging. Avoid sharing the log without reviewing it,
  because downloader diagnostics can contain source URLs.

### Requests hang

- Ordinary methods should time out after 60 seconds.
- `convert`/`ytdlp` intentionally have no timeout; inspect the child process and progress callbacks.
- Ensure each reverse callback gets a reply; CoApp may stop work when the extension disappears.

### Manual framing tests

Account for the **UTF-8 byte length**, not JavaScript character count. A shell `echo` is error-prone for binary framing; use a small Node script or the extension itself and keep diagnostic output on stderr.
