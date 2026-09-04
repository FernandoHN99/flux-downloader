# catalog/ — what we know about

Everything that answers *"which media do we currently hold, and what has been
seen before?"* Detection produces findings; the catalog decides what is kept,
merged and persisted.

| File | Owns |
|---|---|
| `tab-state.ts` | `TabStateStore` — all state whose lifetime is a browser tab |
| `history.ts` | Pure merge/prune/rename/reorder/decorate rules over `HistoryEntry[]` |
| `history-store.ts` | `HistoryStore` — the persisted history and its write queue |
| `video-catalog.ts` | Per-tab upsert rules, quality/child-URL merging, visibility |

## Tab state

One `TabStateStore` keyed by tab ID holds `pageGeneration`, detected `media`,
the intercepted URL set, page metadata, the last yt-dlp format URL,
content/navigation generations, the current top-level page URL, and relay
mappings/codecs.

- `resetPage()` starts a fresh generation while preserving navigation identity.
- `tabs.onRemoved` deletes the whole state. Do not add a parallel per-tab map;
  the whole point of this store is that tab cleanup happens in one place.
- Generations are globally monotonic for the service-worker lifetime, so a late
  async parser or yt-dlp result cannot repopulate a reused tab ID.

State with a *different* lifetime deliberately lives outside the store:
`DownloadTracker`, `DownloadRunGate`, `BatchRun`, popup ports, settings cache.

## History

### One video, one row

A video occupies exactly one row, everywhere. Identity is `videoKey(entry.url)`
— never the raw URL, which carries a signed token that rotates on every visit.
Four layers enforce this, and all four are load-bearing:

1. `upsertDetectedVideo` matches an existing tab entry by key, so a re-signed
   link updates the row instead of appending a second one.
2. `mergeDetectedVideosIntoHistory` accumulates incoming videos into a keyed
   map: one detection batch can report the same media twice, from the DOM and
   from the network, under different URLs.
3. `dedupeHistoryEntries` runs on every `HistoryStore.read()` and repairs lists
   persisted by older builds, writing the cleaned version back once.
4. `orderedEntries` in the popup deduplicates again at render, and also hides a
   variant row whose URL another entry already lists among its `childUrls` or
   `qualities` — a master playlist speaks for its variants.

When two rows collapse, the first keeps its position (the user may have dragged
it there) and only takes fields the later row can fill in.

`history.ts` is pure and returns the **same array reference** when nothing
changed. Callers rely on that identity check to skip a storage write and a
broadcast — preserve it in any new rule.

`HistoryStore` owns persistence. Every mutation goes through its internal
queue, so callers just `await` the call:

```ts
await history.rename(key, title);   // already serialized
await history.settled();            // wait for queued writes before reading
```

`chrome.storage` read-modify-write must not interleave — `record()` fires on
every detection commit, and two concurrent merges would drop entries. Never add
a storage mutation that bypasses the queue. A failed write does not poison the
queue behind it.

The store has no tab concept: `background.ts` looks up page identity and passes
it in as `PageContext`.

Turning `keepHistory` off is **intentionally destructive**: the stored list is
pruned to media currently present in open tabs, because the user asked for the
list to hold only what is playing.

`chrome.storage.local` keys:

| Key | Content | Limit |
|---|---|---|
| `mediaHistory` | `HistoryEntry[]` with source/media URLs and metadata | 50, newest/current merge |
| `downloadedVideos` | stable media keys marked downloaded | 500 |
| `failedVideos` | stable media keys marked failed | 500 |

## Source ownership

`VideoInfo.url` and `VideoInfo.pageUrl` are different facts. `url` is the
media/manifest/CDN URL used for detection and download; `pageUrl` is the exact
top-level page that exposed it, used for grouping, source navigation, history
ownership and Referer context.

Never derive `pageUrl` from the media hostname when top-level metadata exists.
`mergeDetectedVideosIntoHistory()` preserves and repairs page ownership, and a
partial detection must not erase a previously known `pageUrl`.
`sameHistoryContent()` compares `pageUrl` and `pageTitle` while ignoring
volatile timestamps and signed query strings.
