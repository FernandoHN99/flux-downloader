# popup/ — the extension UI

Refactored from one 1,500-line global script into a shell, store, selectors,
typed messages and components. Entry point is `index.ts`; `popup.ts` no longer
exists.

## Ownership

- `App` (`index.ts`) owns the `Store`, the `Messenger`, and the top-level
  `ListHeader`, `ProgressPanel`, `RefreshButton` and `VideoList`.
- `Component<S>` owns **one root element and renders only inside it**. A
  component must never query or mutate DOM outside `this.el` — that is what let
  one renderer overwrite another's `disabled` state, and what left listeners
  bound to elements that no longer existed.
- Every action is either "send a message" or "call `setState`". Nothing else.

## State is split on purpose

| Half | Owner | Contents |
|---|---|---|
| `RemoteState` | background | history, currentKeys, batch, activeDownload, progress |
| `UiState` | popup | search, refresh, selection, expansion, rename, grouping, dragging, quality choice, status, errors |

Incoming background updates replace `RemoteState` and **must never reset
in-progress UI state**. A background message arriving mid-rename used to wipe
the input.

`Component.update()` preserves focus, caret and selection for descendants
marked `data-focus-id`, which is what keeps search and rename fields alive
across redraws.

Selectors in `selectors.ts` are pure and testable — ordering, search filtering,
grouping, busy labels, progress projection, reorder eligibility. Put derived
list logic there, not in a component.

## List invariants

- Current media and persisted history are **one list**, not separate views.
- Media playing in any open tab is pinned above historical items and marked via
  `currentKeys`.
- `groupByDomain=false` renders flat; `true` renders collapsible site groups.
- Site ownership uses `domainOf(entry.pageUrl, entry.url)`: the top-level page
  is authoritative, the CDN URL only a fallback.
- Only non-current, non-downloading rows can be reordered. Movable rows live in
  explicit `.reorder-zone` containers; pinned and busy rows sit outside them.
  In grouped mode a drop stays inside its site; in flat mode the zone carries a
  3px inline inset so its dashed border is not clipped.
- Selection/delete, rename, search, quality expansion, single download, grouped
  download and batch download all operate on the same entries.

## Progress

`ProgressPanel` handles both single and batch runs. The compact panel is two
visual rows — summary/speed/ETA/percent/Stop, then the bar — measured at 44px.
The active row shows a percentage; other batch rows show `Queued`.

One download run owns the CoApp at a time, enforced by `DownloadRunGate` in the
worker. Disabling popup buttons is feedback, not the lock.

## Styles

Bundled from `styles/index.css`, split into `tokens`, `shell`, `list`, `row`,
`quality`, `progress`, `misc` and `animations`. Keep component rules in the
matching file.

**Chrome action popups need explicit pixel sizing.** Do not replace the fixed
width/min/max-height with `100vw`, `100vh` or `min()` viewport units — Chrome
can collapse the popup to about one pixel.

The settings page stays a small separate static page (`settings.html`,
`settings.ts`, `settings.css`) on purpose.

## Testing

Components are tested against happy-dom. Two of its gaps to know about:

- `DragEvent` constructs as a plain `Event`, dropping `clientY` and
  `dataTransfer`. Tests use a `MouseEvent` with a `dataTransfer` stub attached.
- `:scope >` selectors match nothing. Iterate `element.children` instead.
