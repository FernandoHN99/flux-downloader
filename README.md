<p align="center">
  <img src="extension/public/icons/icon-128.png" width="96" alt="Flux Downloader">
</p>

<h1 align="center">Flux Downloader</h1>

<p align="center">
  Detect the media a page is streaming, pick a quality, save it locally.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Manifest%20V3-4285F4?logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/tests-585%20passing-3fb950" alt="585 tests">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

<p align="center">
  <sub>Chrome / Edge 102+ · Windows, macOS, Linux · no telemetry</sub>
</p>

---

https://github.com/user-attachments/assets/05a171ad-6ba6-4ab1-8d7c-9ef7cbdec57d

## What it does

A browser cannot write files or run FFmpeg, so Flux is two halves: a Manifest V3
extension that **finds** media, and a small local Node companion (CoApp) that
**fetches** it. They talk over Chrome native messaging.

| | |
|---|---|
| **Finds** | HLS (`.m3u8`), DASH (`.mpd`), direct MP4/WebM, `<video>` elements, and streams that only exist inside Media Source Extensions |
| **Understands** | Video, alternate audio and subtitle renditions, parsed from the manifest itself |
| **Downloads** | FFmpeg stream-copy for HLS/DASH, 8-fragment yt-dlp for YouTube, and up to 8 parallel HTTP ranges for direct files |
| **Organises** | One list across every open tab, optional history, grouping by the real source site, rename, search, reorder, and 4-at-once batch download |

Media playing right now is pinned above history. A video keeps the page that
actually exposed it — a Rocketseat lesson stays under `app.rocketseat.com.br`
even though its bytes come from `b-cdn.net`.

> Flux does not bypass DRM. Download only what you are allowed to save.

## Install

Not on the Chrome Web Store — load it unpacked.

**1. Build it**

```bash
git clone https://github.com/FernandoHN99/flux-downloader.git
cd flux-downloader
npm install
npm run build
```

**2. Load the extension**

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**,
and select the repository's `extension/` folder.

**3. Register the companion app**

```bash
cd coapp
./scripts/register-dev-host.sh      # macOS/Linux
```

```powershell
coapp\scripts\register-dev-host.ps1   # Windows
```

The extension ID is fixed by the manifest key, so both scripts pick it up
automatically — there is nothing to pass in. Each script builds a small
launcher that points at this checkout's `coapp/dist/main.js` and registers it
as the native messaging host. **Re-run it whenever you move, rename, or
re-clone the repository, or replace the selected Node version** — the launcher
embeds absolute paths to both. On fnm installations the script resolves Node's
physical version path instead of persisting the disposable per-shell shim. A
stale launcher is what makes Chrome report "Native host has exited" even
though the extension and CoApp builds are both fine.

**4. Make sure the tools are reachable**

`ffmpeg`, `ffprobe` and `yt-dlp` must be under the packaged/project runtime
folders, a standard system/Homebrew binary directory, or your `PATH`.

```bash
brew install ffmpeg yt-dlp      # macOS
```

Reload the extension, then reload any page that was already open.

## How it works

```mermaid
flowchart TB
    PAGE["🌐 <b>Web page</b><br/><sub>MSE · fetch · XHR hooks · DOM scan</sub>"]

    subgraph ext["🧩 Extension · service worker"]
        DET["<b>detection</b><br/><sub>parsers · identity</sub>"]
        CAT["<b>catalog</b><br/><sub>tab state · history</sub>"]
        DL["<b>download</b><br/><sub>plan · concurrency</sub>"]
        DET --> CAT
    end

    POPUP["📋 <b>Popup UI</b><br/><sub>components · store · selectors</sub>"]
    COAPP["⚙️ <b>CoApp</b> · local Node process<br/><sub>FFmpeg · yt-dlp · HTTP</sub>"]

    PAGE -- postMessage --> DET
    CAT --> POPUP
    POPUP -- "download this" --> DL
    DL -- native messaging --> COAPP
```

Source is grouped by domain, and each folder carries its own `AGENTS.md`
explaining the rules that live there:

| Folder | Owns |
|---|---|
| [`entrypoints/`](extension/src/entrypoints) | Service worker, content script, MAIN-world hook |
| [`detection/`](extension/src/detection) | Page hooks, HLS/DASH parsers, media identity |
| [`catalog/`](extension/src/catalog) | Per-tab state, history and its persistence |
| [`download/`](extension/src/download) | Download plan, concurrency gate, native client |
| [`popup/`](extension/src/popup) | Component UI with its own store and selectors |
| [`coapp/src/`](coapp/src) | RPC, FFmpeg, yt-dlp, filesystem |

A few decisions worth calling out:

- **Media identity is a normalised key, not a URL.** Signed CDN links rotate
  their token on every visit, so matching raw strings would show one video
  twice.
- **The popup owns its own state, split from the background's.** A detection
  arriving mid-rename cannot wipe what you are typing.
- **One user-visible run is reserved synchronously** before the first `await` —
  disabling buttons is feedback, not the lock. A batch fans that lease out to
  four native jobs.
- **The MAIN-world hooks stay invisible.** Patched APIs report native source and
  keep the extension out of error stacks, because a player that notices
  tampering stops rendering.

## Development

```bash
npm test          # 585 tests · Vitest (happy-dom + Node loopback HTTP)
npm run build     # tsc + esbuild bundles, then the CoApp
npm run dev:extension
```

No linter and no runtime dependencies — just TypeScript, esbuild and Vitest.
Deeper notes live in [AGENTS.md](AGENTS.md) and [docs/](docs).

## Credits

Flux Downloader started from [miroshArtem/MediaGrabber](https://github.com/miroshArtem/MediaGrabber)
and grew from there: the domain-grouped source layout, the component popup, the
parser and lifecycle test suites, and the detection and download fixes above.
Still MIT, same as the original.

## Privacy

Everything stays on your machine. Settings and history use
`chrome.storage.local`; the CoApp only talks to the extension that registered
it. No analytics, no accounts, no servers.

<p align="center"><sub><a href="LICENSE">MIT</a></sub></p>
