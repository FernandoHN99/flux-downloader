# entrypoints/ — the three bundles

Each file here is an esbuild entry point. Nothing imports them; they import
everything else.

| File | Bundle | World |
|---|---|---|
| `background.ts` | `dist/background.js` | MV3 service worker |
| `content.ts` | `dist/content.js` | isolated |
| `mse-inject.ts` | `dist/mse-inject.js` (IIFE) | MAIN |

Changing a filename here means updating `extension/package.json` (`bundle`),
`extension/scripts/watch.mjs`, and — for output names — `manifest.json`.

## background.ts

The service worker wires domains together: it owns `TabStateStore`,
`HistoryStore`, `NativeClient`, `DownloadTracker`, `DownloadRunGate`,
`BatchRun`, and the popup ports. Business rules belong in the domain folders;
this file should read as orchestration.

It is still the largest file in the repo (~1,400 lines). When adding to it, ask
whether the logic could be a tested unit in `detection/`, `catalog/` or
`download/` instead.

MV3 service workers are killed and restarted freely. Nothing may assume it has
been alive since the tab loaded: if `GET_MEDIA` arrives with no tab media
state, the worker requests a rescan rather than answering empty.

### Refresh flow

One user-facing action, **Refresh tabs**. `refreshOpenTabs()` runs, in order:

1. `restoreCurrentMediaToHistory()` re-inserts media still held in live tab
   state — this restores a current item the user deleted, including
   network-only media no DOM rescan could rediscover.
2. `rescanAllTabs()` sends `RESCAN` to every HTTP(S) tab.
3. Content scripts re-announce cached detections, rescan the DOM, resend
   metadata.
4. The worker awaits queued history writes, then returns fresh `MEDIA_LIST` and
   `HISTORY_LIST`.

Tabs without a compatible listener (chrome:// pages, the web store, tabs open
from before an extension reload) are skipped safely.

## content.ts

Isolated world, `document_start`, all frames. Scans the DOM, tracks navigation
generations, caches detections for `RESCAN`, and bridges the MAIN world.

A loaded page can outlive an extension reload, so every send catches
invalidated-extension errors.

Only the top frame owns page title/URL/thumbnail. Child frames may contribute
media but must not replace top-level source ownership.

## mse-inject.ts

MAIN world. **No `chrome.*` API is available here** — communication is
`window.postMessage` only, and everything it needs must be inlined into this
bundle (hence `--format=iife`).

Guarded by `window.__FluxMSEHooked` so a re-injection does not double-hook
`MediaSource`, `fetch` and `XHR`. Every refresh must not attach another
`loadedmetadata` listener to the same element.

Whatever this file posts is untrusted by the time it reaches the isolated
world; `detection/mse-bridge.ts` validates and reduces it.
