# Flux / MediaGrabber documentation

This directory documents the implementation in this repository. It no longer describes Video DownloadHelper as though it were the current codebase.

The product name displayed in the browser is **Flux**. Internal packages, the native host, install paths, GitHub repository, and release artifacts continue to use **MediaGrabber**.

Documentation baseline: **2026-09-03**, version `1.1.1`, including the component popup, `TabStateStore`, central all-tab refresh, source-page attribution fix, parser suite, compact progress panel, and flat-list reorder inset.

## Start here

| Document | Use it for |
|---|---|
| [Project README](../README.md) | installation, usage, source setup, common troubleshooting |
| [Agent instructions](../AGENTS.md) | authoritative implementation invariants and recent refactor context |
| [Architecture](architecture.md) | processes, ownership, state, popup, refresh, and download flows |
| [Detection](detection.md) | network/DOM/MSE detection, navigation generations, parsers, source attribution |
| [Native messaging](native-messaging.md) | framing, bidirectional `weh#rpc`, handlers, failures |
| [Companion app](coapp.md) | CoApp modules, runtime discovery, downloads, installer |
| [FFmpeg](ffmpeg.md) | exact FFmpeg role, arguments, progress, cancellation, release binary |
| [YouTube](youtube.md) | yt-dlp-only detection and download path |
| [Quick reference](quick-reference.md) | commands, IDs, paths, keys, protocols |
| [Releasing](releasing.md) | tag workflow, Windows assets, checksums, runtime pins |
| [Privacy](PRIVACY.md) | locally stored data, network activity, permissions |
| [Store listing](STORE_LISTING.md) | current product copy and distribution caveat |
| [Changelog](changelog.md) | MediaGrabber/Flux releases and refactor history |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | FFmpeg and yt-dlp licensing/pins |

## Current engineering snapshot

- Chrome/Edge Manifest V3 extension and Node.js CoApp.
- One combined list for all current media and optional persisted history.
- Always-visible **Refresh tabs** action for every open HTTP(S) tab.
- Top-level source page is kept separately from media/CDN URLs.
- Vanilla TypeScript components with component-owned DOM and split CSS.
- Per-tab background data is owned by one `TabStateStore`.
- Vitest + happy-dom: 19 files / 290 passing tests at this baseline.
- Full verification: `npm test`, then `npm run build`.
- Tagged release automation currently builds Windows x64 only.

## Documentation ownership

When behavior changes:

1. Update `AGENTS.md` for implementation invariants and AI handoff context.
2. Update the focused document in this directory.
3. Update the root README when installation or user-visible behavior changes.
4. Add an entry to `docs/changelog.md`.
5. Update privacy/store/release/third-party files when their claims are affected.

Source code is the final authority. Counts and pinned versions are dated snapshots and must be rerun/rechecked before copying them forward.
