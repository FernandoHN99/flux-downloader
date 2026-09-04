# shared/ — contracts used across contexts

Types and protocols with no domain of their own. Everything here is imported by
at least two of: the service worker, content scripts, and the popup.

| File | Owns |
|---|---|
| `types.ts` | `VideoInfo`, `VideoQuality`, `HistoryEntry`, `DownloadProgress` |
| `popup-protocol.ts` | Typed popup ↔ background messages plus `isPopupRequest()` |
| `content-protocol.ts` | Typed content ↔ background messages plus `isRuntimeRequest()` |
| `settings.ts` | Settings shape, defaults, load/merge |
| `theme.ts` | Popup/settings theme application |
| `errors.ts` | Shared error shaping |

## Protocol rules

Both protocols are **typed and validated at the boundary**. Every inbound
message passes its `is*Request()` guard before use — a message arriving from a
content script or a popup port is untrusted input, not a typed object.

Keep the two protocols separate. Popup → background uses `REFRESH_TABS`;
background → content uses the internal `RESCAN`. Do not collapse them into one
ambiguous shared message: they have different senders, different trust, and
different lifetimes.

When adding a message, add it to the union *and* the guard. A message the guard
does not know is dropped, which fails silently and is hard to trace.

## Types

`VideoInfo.url` and `VideoInfo.pageUrl` are different facts — see
[../catalog/AGENTS.md](../catalog/AGENTS.md) for the ownership rules.

`HistoryEntry extends VideoInfo` and carries no key of its own: identity is
always `videoKey(entry.url)`. `downloaded` and `failed` are set only when
broadcasting, never persisted on the entry.

`VideoQuality.kind` is `video`, `audio` or `subtitle`.

## Settings

`chrome.storage.local.settings` holds `batchQuality`, `keepHistory` and
`groupByDomain`, merged over defaults on read. A missing key must fall back to
its default rather than `undefined`, because the popup renders from it
directly.
