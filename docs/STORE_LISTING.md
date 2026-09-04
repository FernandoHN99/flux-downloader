# Flux store/listing copy

Updated: 2026-09-03.

Copy audit: reviewed against the 505-test post-refactor implementation and current GitHub-distributed `1.1.1` baseline.

> Distribution status: Flux is currently shipped through GitHub Releases as an unpacked extension, **not** through the Chrome Web Store. This is maintained as canonical product copy for release pages or a future listing. Review store policy—especially YouTube behavior—before publishing.

## Product name

Flux — Video Downloader

## Short description

Detect online media and download the quality you choose with local tools.

## Long description

**Flux detects media used by your open browser tabs and lets you choose exactly what to save.**

Supported detection includes HLS, DASH, direct MP4/WebM, video/audio/source elements (including dynamically inserted players), and Media Source Extensions. When a manifest exposes several variants, Flux presents the available video qualities plus alternate audio and subtitle tracks.

Your media appears in one clear list:

- current items from every open tab stay pinned;
- optional local history keeps recent detections;
- search, rename, reorder, selective delete, and downloaded/failed markers;
- flat view or collapsible folders grouped by the real source site;
- one-click per-site or sequential batch downloads;
- compact live progress with Stop.

Flux serializes local downloads even if commands race from separate popup windows, so one FFmpeg, yt-dlp, or direct run owns the companion at a time.

The always-visible **Refresh tabs** action rescans every open HTTP(S) page. It can also restore a current item that was accidentally removed from the local history list.

Flux preserves where media came from separately from its CDN address. For example, a course lesson stays linked and grouped under the course page rather than the server that happens to deliver the stream.

Downloads run through the local Flux Downloader companion application:

- FFmpeg for HLS/DASH/MSE remuxing;
- direct local HTTP streaming for ordinary files;
- yt-dlp for YouTube format discovery/downloads in the current GitHub-distributed build.

Flux does not bypass DRM. Only download content you own or are authorized to save.

## How to use

1. Install/register the Flux Downloader companion app.
2. Load the Flux extension.
3. Open a page and start its media when necessary.
4. Click the Flux toolbar icon.
5. Expand an item, choose a quality/audio/subtitle option, and download.
6. Use **Refresh tabs** if an open page or current item needs to be rediscovered.

## Requirements

- Chrome or Edge 102+.
- Windows, macOS, or Linux source/runtime support.
- Local Flux Downloader CoApp for downloads.
- FFmpeg/ffprobe for adaptive/MSE media.
- yt-dlp for YouTube.

The automated tagged release currently provides a Windows x64 installer; other platforms require source/manual setup.

## Privacy copy

Flux has no analytics, advertising, telemetry, or cloud account. Settings, up to 50 recent media-history entries, and downloaded/failed markers are stored in `chrome.storage.local`.

The extension and local companion necessarily contact the page/media/CDN selected by the user; yt-dlp contacts YouTube for YouTube features. Files are written locally and are not uploaded to a Flux server.

Read the complete [privacy policy](PRIVACY.md).

## Permission explanations

| Permission | User-facing explanation |
|---|---|
| Sites / `<all_urls>` | detect media and page ownership on sites the user visits |
| `webRequest` | identify media manifests and response types |
| `tabs` / `activeTab` | query current/open tabs; `activeTab` is declared although current lookup uses `tabs` |
| `storage` | keep local settings/history/status |
| `nativeMessaging` | ask the local companion to download/convert |
| `notifications` | report local completion/failure |
| `favicon` | show browser-provided source-site icons |
| `downloads` | declared for compatibility; current file writes are performed by the local CoApp |

## Support copy

If no media appears:

- start playback or scroll the player into view;
- click **Refresh tabs**;
- reload the page after updating/reloading the extension;
- note that browser-internal pages and DRM-protected media are unsupported.

Issues: [github.com/miroshArtem/MediaGrabber/issues](https://github.com/miroshArtem/MediaGrabber/issues)
