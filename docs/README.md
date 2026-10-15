# Flux Downloader documentation

This directory documents the implementation in this repository. It no longer describes Video DownloadHelper as though it were the current codebase.

The product name displayed in the browser is **Flux**. Internal packages, the native host, install paths, GitHub repository, and release artifacts continue to use **Flux Downloader**.

Documentation baseline: **2026-09-03**, brought up to date on **2026-10-15** for 1.2.0 (install, release, popup and history changes are described in the guides that cover them), including the component popup, pure content/background boundaries, `TabStateStore`, central all-tab refresh, source-page attribution, parser/manifest projection, download lifecycle/concurrency, native reconnect coverage, package validation, the extension watch workflow, compact progress panel, and flat-list reorder inset.

## Start here

| Document | Use it for |
|---|---|
| [Project README](../README.md) | what Flux is, install in a minute, how it works |
| [Install guide](install.md) | installing and updating on macOS, Linux and Windows, and troubleshooting |
| [Agent instructions](../AGENTS.md) | authoritative implementation invariants and recent refactor context |
| [Architecture](architecture.md) | processes, ownership, state, popup, refresh, and download flows |
| [Detection](detection.md) | network/DOM/MSE detection, navigation generations, parsers, source attribution |
| [Native messaging](native-messaging.md) | framing, bidirectional `weh#rpc`, handlers, failures |
| [Companion app](coapp.md) | CoApp modules, runtime discovery, downloads, installer |
| [FFmpeg](ffmpeg.md) | exact FFmpeg role, arguments, progress, cancellation, release binary |
| [YouTube](youtube.md) | yt-dlp-only detection and download path |
| [Download performance](performance.md) | fragment, HTTP-range, and batch parallelism |
| [Quick reference](quick-reference.md) | commands, IDs, paths, keys, protocols |
| [Releasing](releasing.md) | cutting a release, the release pipeline, assets, checksums, runtime pins |
| [Privacy](PRIVACY.md) | locally stored data, network activity, permissions |
| [Changelog](changelog.md) | Flux Downloader releases and refactor history |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | FFmpeg and yt-dlp licensing/pins |
| [Archive](archive) | plans that were dropped: a store listing, monetization, a backend |

## Current engineering snapshot

- Chrome/Edge Manifest V3 extension and Node.js CoApp.
- One combined list for all current media and optional persisted history.
- Always-visible **Refresh tabs** action for every open HTTP(S) tab.
- Top-level source page is kept separately from media/CDN URLs.
- Vanilla TypeScript components with component-owned DOM and split CSS.
- Per-tab background data is owned by one `TabStateStore`.
- Vitest: 45 extension files / 754 tests plus 8 CoApp files / 28 tests (782 total, 2026-10-15).
- Content-side DOM/MSE transformations and background catalog/history/download rules live in focused tested modules rather than anonymous service-worker blocks.
- One `DownloadRunGate` in the worker—not popup timing—enforces one user-visible run; a batch uses four native jobs concurrently.
- `npm run dev:extension` watches all six browser bundles plus TypeScript; Chrome/Edge reloads remain manual.
- Full verification: `npm test`, then `npm run build`.
- Tagged releases build a portable macOS/Linux archive and a Windows installer; CI runs on all three systems.

## Documentation ownership

When behavior changes:

1. Update `AGENTS.md` for implementation invariants and AI handoff context.
2. Update the focused document in this directory.
3. Update the root README when installation or user-visible behavior changes.
4. Add an entry to `docs/changelog.md`.
5. Update privacy/store/release/third-party files when their claims are affected.

Source code is the final authority. Counts and pinned versions are dated snapshots and must be rerun/rechecked before copying them forward.

All 15 tracked Markdown files were reviewed against this baseline. Focused implementation documents carry the details; privacy, listing, release, and third-party claims were rechecked as part of the same audit.
