# Flux privacy policy

Last updated: 2026-09-03.

Implementation audit: reviewed against the 505-test post-refactor baseline. Storage keys, permissions, external services, and runtime pins did not change.

Flux is the user-facing name of the Flux Downloader browser extension and local companion application.

## Summary

- Flux contains no analytics, advertising SDK, telemetry endpoint, or account system.
- The project maintainers do not receive your browsing history, detected media list, settings, or downloaded files through the extension.
- Detection and orchestration happen in the browser; downloads/conversion happen in a local companion process.
- Flux **does store recent media metadata locally** when History mode is enabled.
- Using Flux necessarily makes requests to the page/media services you choose to access.

## Data stored in the browser

Flux uses `chrome.storage.local`. This storage stays in the browser profile and is not `storage.sync`.

| Key | Stored data | Retention |
|---|---|---|
| `settings` | batch quality, History/Only current, Flat/By site | until reset/uninstall/profile removal |
| `mediaHistory` | media URL, exact source page URL/title, title, qualities, duration, thumbnail, Referer/context, detection time | up to 50 entries in History mode |
| `downloadedVideos` | normalized media identifiers marked downloaded | up to 500 |
| `failedVideos` | normalized media identifiers marked failed | up to 500 |

History exists so Flux can keep/reorder/rename past detections and distinguish current/downloaded/failed entries.

User controls:

- **Only current** immediately prunes persisted history to media still present in open tabs.
- Selective delete removes chosen history rows.
- Clear removes the history list.
- Removing the extension/profile clears data according to the browser's extension-storage behavior.

The downloaded/failed marker keys are local normalized identifiers, not uploaded status events.

## Data held only in memory

While running, the extension may hold:

- current media per tab;
- page title/URL/thumbnail/duration;
- parsed manifest variants and segment/child URLs;
- relay URL mappings;
- popup search/selection/rename state;
- active/batch download status and progress.

Page-world MSE/fetch/XHR observations are shape-validated in the isolated content script before entering this transient state. Segment observations are deduplicated and capped at 500 per page generation.

Most tab state disappears when a tab closes or the Manifest V3 service worker is stopped. Active native processes have their own local lifetime.

## Network activity

“Local processing” does not mean Flux is offline. It contacts third-party servers only as required for the requested feature:

1. The browser already loads the page and its media/CDN resources.
2. The extension may fetch detected HLS/DASH manifests, including a source-page referrer.
3. The local CoApp/FFmpeg/direct downloader requests the selected media URL.
4. yt-dlp contacts YouTube and related media endpoints to inspect/download a selected YouTube page.
5. The release installer downloads pinned FFmpeg, ffprobe, and yt-dlp assets from the project's GitHub Release and verifies SHA-256.

Those source/CDN/service operators can receive ordinary request information such as IP address, requested URL, headers (including Referer/Origin where needed), and whatever authentication their own page/tool supplies. Their privacy policies apply.

Flux has no separate maintainer-controlled collection endpoint.

## Native companion

The Flux Downloader CoApp:

- runs locally;
- is started through Chrome/Edge native messaging;
- communicates over local stdin/stdout with an allowlisted extension;
- writes downloaded output to the local filesystem;
- runs separate FFmpeg/ffprobe/yt-dlp programs;
- keeps direct download state in memory and removes completed records after a short delay;
- does not expose a listening network server.

Downloaded files remain wherever the local user/CoApp writes them. Flux does not upload those files.

## Permissions

Current `extension/manifest.json` permissions:

| Permission | Why it is used |
|---|---|
| `storage` | save local settings, history, and status markers |
| `downloads` | declared in the manifest; current file writes use CoApp and the code does not call `chrome.downloads` |
| `nativeMessaging` | connect to the local CoApp |
| `tabs` | query open tabs for current media and all-tab refresh |
| `activeTab` | declared alongside tabs; the current popup identifies the active tab with `chrome.tabs.query` |
| `webRequest` | observe media/manifest requests and response types |
| `notifications` | show local success/failure notifications |
| `favicon` | show browser-provided site icons in By site mode |
| `<all_urls>` host access | run detectors and inspect media across supported web pages |

Two scripts run at `document_start` in every frame: an isolated content detector and a MAIN-world MSE/fetch/XHR observer. The MAIN-world script cannot access extension storage/APIs and communicates through page messages.

Those page messages are not treated as trusted storage or native commands: the isolated script validates their type, page URL, generation, and type-specific fields, then emits the narrower typed content/background protocol. The service worker separately enforces one local native download run at a time.

## What Flux does not do

- No telemetry or analytics.
- No advertising or behavioral profiling.
- No sale/sharing of data by the project.
- No cloud account or cross-device history sync.
- No maintainer access to local browser storage or files.
- No DRM bypass.

## Security and responsibility

Native host registration allowlists exact extension origins. Release runtime downloads require HTTPS and pinned SHA-256 checksums.

Users are responsible for complying with website terms, copyright, privacy, and local law when downloading content.

## Changes and contact

Material changes to storage, permissions, external services, or telemetry must update this file and the store listing before release.

Questions can be filed in the [Flux Downloader GitHub repository](https://github.com/miroshArtem/MediaGrabber/issues).
