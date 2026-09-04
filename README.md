<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="extension/public/icons/icon-128.png">
    <img src="extension/public/icons/icon-128.png" width="128" alt="Flux logo">
  </picture>
</p>

<p align="center">
  <strong>Flux — detect online media, choose a quality, and download it locally.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-102%2B-4285F4?logo=googlechrome&logoColor=white" alt="Chrome 102+">
  <img src="https://img.shields.io/badge/Edge-102%2B-0078D7?logo=microsoftedge&logoColor=white" alt="Edge 102+">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

> The user-facing product is **Flux**. The repository, npm packages, native host, install paths, and release files still use the historical **MediaGrabber** name.

## See it in action

https://github.com/user-attachments/assets/05a171ad-6ba6-4ab1-8d7c-9ef7cbdec57d

Flux is a Manifest V3 browser extension plus a local companion app. The extension observes media used by open pages; the companion uses FFmpeg, yt-dlp, or direct HTTP streaming to save the selected item.

### Features

- Detects HLS (`.m3u8`), DASH (`.mpd`), direct MP4/WebM, DOM media elements, and streams exposed through Media Source Extensions.
- Parses available video, alternate audio, and subtitle renditions.
- Uses yt-dlp exclusively for YouTube format discovery and downloads.
- Maintains one list containing media from all open tabs and, optionally, up to 50 historical detections.
- Pins current media above history and can show either a flat list or collapsible groups by source site.
- Preserves the real page that exposed a stream. A Rocketseat lesson remains grouped under `app.rocketseat.com.br` even when its bytes come from `b-cdn.net`.
- Offers rename, search, drag reorder, selective delete, per-site download, and sequential batch download.
- Provides one compact progress panel and prevents overlapping download runs.
- Includes an always-visible **Refresh tabs** action that restores deleted current entries and asks every open HTTP(S) page to announce media again.
- Stores settings/history locally and contains no telemetry or analytics.

Flux does not bypass DRM. Download only content you are authorized to save.

## Release installation

Production artifacts are published through [GitHub Releases](https://github.com/miroshArtem/MediaGrabber/releases/latest). The extension is currently sideloaded and is not published in the Chrome Web Store.

The tagged release workflow currently produces Windows x64 artifacts:

- `MediaGrabber-extension.zip`
- `MediaGrabber-CoApp-win-x64.exe`
- `MediaGrabber-Setup-win-x64.exe`
- pinned FFmpeg, ffprobe, and yt-dlp executables
- `SHA256SUMS.txt`
- `THIRD_PARTY_NOTICES.txt`

### Windows x64

1. Download `MediaGrabber-Setup-win-x64.exe` and `MediaGrabber-extension.zip` from the latest release.
2. Optionally verify both against `SHA256SUMS.txt`.
3. Run the setup executable. It installs CoApp and runtime tools in `%LOCALAPPDATA%\MediaGrabber` and registers the native host for Chrome and Edge.
4. Extract the extension ZIP to a permanent folder.
5. Open `chrome://extensions` or `edge://extensions`.
6. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
7. Reload Flux after setup, then reload any already-open media pages.

The manifest public key fixes the extension ID at `igephdkobpgbfgdjmehckbhffbimgkii`; the release installer registers this ID automatically.

See [the release guide](docs/releasing.md) for maintainer details.

## Source setup

### Requirements

- Node.js 22 is recommended and is what release CI uses.
- npm (included with Node.js).
- Chrome 102+ or Edge 102+.
- FFmpeg + ffprobe for HLS/DASH/MSE work.
- yt-dlp for YouTube.

Clone, install, test, and build:

```bash
git clone https://github.com/miroshArtem/MediaGrabber.git
cd MediaGrabber
npm install
npm test
npm run build
```

The root is an npm-workspaces project. `npm run build` compiles and bundles the extension, then compiles the CoApp.

### Runtime binaries in development

The CoApp first looks below its runtime roots, then uses generic project fallbacks and finally the system `PATH`.

Expected platform folder names come from Node's `process.platform`:

```text
coapp/ffmpeg/win/ffmpeg.exe
coapp/ffmpeg/win/ffprobe.exe
coapp/ffmpeg/darwin/ffmpeg
coapp/ffmpeg/darwin/ffprobe
coapp/ffmpeg/linux/ffmpeg
coapp/ffmpeg/linux/ffprobe

coapp/ytdlp/win/yt-dlp.exe
coapp/ytdlp/darwin/yt-dlp
coapp/ytdlp/linux/yt-dlp
```

Generic fallbacks also exist at `coapp/ffmpeg/ffmpeg[.exe]` and `coapp/ytdlp/yt-dlp[.exe]`. A system installation is valid when `ffmpeg`, `ffprobe`, and `yt-dlp` resolve on `PATH`.

The repository still contains historical `coapp/ytdlp/mac/` placeholders, but current path resolution uses `darwin`; do not rely on the `mac` folder.

### Load the unpacked extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's **`extension/`** directory.

Do not select `extension/dist/`. The manifest, popup HTML, icons, and source CSS are rooted in `extension/`; generated JavaScript and popup CSS are referenced from `dist/`.

After every build, reload the extension card. Also reload open test pages when content scripts from the previous extension instance were invalidated.

### Register the development CoApp

Build first, copy the extension ID from the browser card when it differs from the fixed release ID, then run:

```bash
cd coapp
node dist/native-autoinstall-cli.js register <extension-id>
```

To unregister:

```bash
node dist/native-autoinstall-cli.js unregister
```

On Windows, `coapp/scripts/register-dev-host.ps1 -ExtensionId <id>` provides a development registration flow.

## Using Flux

Open pages containing media, then click the Flux toolbar icon.

- Click a row to open its quality panel, select a rendition, and download.
- Use the search field to filter the combined list.
- Use the trash action to enter selective deletion mode.
- Drag historical rows to reorder them; current and busy rows stay pinned.
- In **By site** mode, click the source heading to collapse it or its icon to download that site's visible entries.
- Use **Download all** with the Best/Worst batch preference for a sequential run.
- Use **Refresh tabs** whenever a current item was deleted, the service worker restarted, or an open page needs to be scanned again.
- Open Settings to choose History versus Only current and Flat list versus By site.

The empty state uses the same **Refresh tabs** action; there is no separate refresh implementation.

YouTube pages use yt-dlp formats rather than raw intercepted Google video requests. Full behavior depends on the installed yt-dlp version and what the current page/account exposes.

## Architecture in one minute

```text
open web pages
  ├─ isolated content script: DOM scan, metadata, cached rescan
  ├─ MAIN-world hook: MSE + fetch/XHR observations
  └─ service-worker webRequest listeners
                 │
                 ▼
      background TabStateStore + download-run gate
        ├─ current media from every tab
        ├─ persisted history and markers
        ├─ popup message protocol
        └─ download orchestration
                 │
      Chrome native messaging + weh#rpc
                 │
                 ▼
         local Node.js CoApp
      FFmpeg · yt-dlp · direct HTTP
```

`VideoInfo.url` is the media/CDN URL. `VideoInfo.pageUrl` is the exact top-level source page. Keeping those facts separate is essential for grouping, links, Referer handling, and restoring history.

Read [architecture.md](docs/architecture.md), [detection.md](docs/detection.md), and [native-messaging.md](docs/native-messaging.md) for the complete flows.

## Development

### Commands

```bash
npm test                    # 39 files / 505 tests at the 2026-09-03 baseline
npm run build               # full extension + CoApp verification
npm run build:extension
npm run build:coapp
npm run package:extension
npm run dev:coapp
```

Tests use Vitest with happy-dom and live under `extension/src/**/*.test.ts`. They cover popup components, pure content/background rules, parsers, download lifecycle, and the extension-side native client. There are currently no process-side CoApp tests and no linter.

`npm run dev:extension` is currently broken because no extension `watch` script exists. Re-run the extension or full build after edits.

### Important source files

| Path | Responsibility |
|---|---|
| `extension/src/background.ts` | MV3 service worker, current/history state, protocol, downloads |
| `extension/src/lib/tab-state.ts` | one owner for per-tab state and page generations |
| `extension/src/lib/history.ts` | pure history merge/source attribution rules |
| `extension/src/content.ts` | isolated-world integration, navigation, rescan cache |
| `extension/src/content/` | tested DOM collection, metadata, MSE bridge validation/reduction |
| `extension/src/mse-inject.ts` | MAIN-world MSE/fetch/XHR hook |
| `extension/src/lib/m3u8-parser.ts` | HLS parsing |
| `extension/src/lib/dash-parser.ts` | DASH parsing |
| `extension/src/lib/manifest-qualities.ts` | parsed HLS/DASH → typed quality choices |
| `extension/src/lib/hls-{rewrite,arguments}.ts` | opaque manifest URI rewrite and multi-input FFmpeg preparation |
| `extension/src/lib/download-tracker.ts` | active IDs, outcomes, waiters, cancellation lifecycle |
| `extension/src/lib/download-run-gate.ts` | service-worker enforcement of one native run |
| `extension/src/lib/native-client.ts` | tested bidirectional native RPC client/reconnect lifecycle |
| `extension/src/popup/index.ts` | popup app shell |
| `extension/src/popup/state.ts` | separate remote and local UI state |
| `extension/src/popup/components/` | DOM-owning UI components |
| `extension/src/popup/styles/` | component/concern CSS imported by `index.css` |
| `coapp/src/` | native RPC, downloads, runtimes, paths, registration |

The detailed refactor record and invariants future agents must preserve are in [AGENTS.md](AGENTS.md) and [the project changelog](docs/changelog.md).

`npm run package:extension` includes `dist/popup.css` and fails before archiving if popup/settings HTML references a missing local asset.

## Troubleshooting

### CoApp shows Disconnected

- Build/install and register the native host with the exact extension ID.
- Reload the extension after registration.
- Confirm `com.mediagrabber.coapp.json` points to a real executable.
- Run `cd coapp && node dist/main.js`; diagnostics must go to stderr because stdout is reserved for native messages.

### No media appears

- Click **Refresh tabs** and wait for all open pages to reply.
- If the extension was just rebuilt/reloaded, reload the page itself; an invalidated old content script cannot receive `RESCAN`.
- Start playback or scroll the player into view on lazy-loaded sites.
- `chrome://`, `edge://`, and store pages cannot be scanned.
- DRM-protected media is unsupported.

### A historical link is expired

Reopen the exact source page, start playback if necessary, then use **Refresh tabs**. Flux probes historical URLs before starting and reports common expired-link HTTP statuses.

### Download fails or stalls

- Verify `ffmpeg -version`, `ffprobe -version`, and/or `yt-dlp --version`.
- Verify the page still authorizes its media URL; authenticated CDNs may require source Referer/Origin context.
- Check the Settings status for the CoApp connection.

## Privacy and license

Flux has no telemetry or analytics. It stores settings, recent media/history metadata, and downloaded/failed markers in `chrome.storage.local`; downloads and manifest/format requests necessarily contact the selected source/CDN. See [the privacy policy](docs/PRIVACY.md) for exact details.

The project source is MIT licensed. FFmpeg and yt-dlp are separate runtime programs with their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
