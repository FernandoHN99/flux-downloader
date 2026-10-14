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
- Only non-current, non-downloading rows can be **reordered**. The current row
  can still be *dragged*, but only into a folder (see Folders). Movable rows live in
  explicit `.reorder-zone` containers; pinned and busy rows sit outside them.
  In grouped mode a drop stays inside its site; in flat mode the zone carries a
  3px inline inset so its dashed border is not clipped.
- Selection/delete, rename, search, quality expansion, single download, grouped
  download and batch download all operate on the same entries.

## Row line

A row's meta line is the type and the **length** spelled out (`formatLength`:
"10 min 55 s", "45 s", never folded into hours). It deliberately does not show
when the video was detected: the length is what tells one lesson from the next.
A video with no known length shows just its type.

## Folders

The user's own folders sit above the site/flat list and are independent of
`groupByDomain`. A filed row appears only inside its folder (`splitByFolder`);
an empty folder is still listed so it can be dropped into, except while
searching.

- Filing a row: drag a reorderable row onto a folder, or use the row's
  **Move to folder** button (`MovePanel` inside `VideoRow`), which also offers
  *Remove from folder* and *New folder…*. Dropping a filed row back on the main
  list takes it out; dropping it on its own folder is a no-op that must not
  bubble to the list (the list's handler would un-file it).
- **The video playing now is draggable** (it has a grip, titled "Drag into a
  folder") so it can be filed like any other. It is still pinned: the row's
  `data-reorderable` is `false`, so `VideoList` keeps it outside every reorder
  zone and it can never be reordered. `draggable` and `reorderable` are two
  facts; do not collapse them. A downloading row is neither.
- The new-folder form has a second button, **Create with all N videos not in a
  folder** (`unfiledEntries`): every loose video, the playing one included,
  filed in one click. It counts the whole history, not the search results, and
  is hidden when nothing is loose.
- Whether each folder is collapsed is remembered across popup sessions under its
  own `collapsedFolders` storage key (`collapsed-folders.ts`), not in settings:
  the settings page rewrites the whole settings object and could clobber it. It
  is loaded before the first render so a closed folder never flashes open, and
  ids of deleted folders are dropped on every save. New folders start open.
- Rows inside a folder are not reorderable, so folders have no reorder zone.
- Creating and renaming use `FolderComposer` / `FolderGroup`'s inline input,
  tagged with `data-focus-id` like the row rename so redraws keep the caret.
- Deleting a folder never deletes its videos; they return to the main list.
- Row/list/header handler objects are required: tests must supply the folder
  handlers too.

## Progress

`ProgressPanel` handles both single and batch runs. The compact panel is two
visual rows — summary/speed/ETA/percent/Stop, then the bar — measured at 44px.
Concurrent active rows keep independent progress in `progressByKey`; queued
rows say `Queued`, and the batch bar aggregates settled plus fractional active
items. A keyed progress update may select which active row supplies detail.

One user-visible run owns the worker gate at a time. A batch uses up to four
CoApp jobs inside that lease. Disabling popup buttons is feedback, not the lock.

## Styles

Bundled from `styles/index.css`, split into `tokens`, `shell`, `list`, `row`,
`quality`, `progress`, `misc` and `animations`. Keep component rules in the
matching file.

**Chrome action popups need explicit pixel sizing.** Do not replace the fixed
width/min/max-height with `100vw`, `100vh` or `min()` viewport units — Chrome
can collapse the popup to about one pixel.

Current size: **468px wide, 546–600px tall** (the settings page matches, so the
popup does not jump when you open it). Chrome caps an action popup at about
800×600, so height cannot grow past 600; the list takes the rest as a fixed
`455px` scroll box so the page itself never gets a second scrollbar. The list
used to use `min(430px, 68vh)`, which collapses to 0 whenever the viewport has
no height yet — fixed pixels only.

The settings page stays a small separate static page (`settings.html`,
`settings.ts`, `settings.css`) on purpose.

## Testing

Components are tested against happy-dom. Two of its gaps to know about:

- `DragEvent` constructs as a plain `Event`, dropping `clientY` and
  `dataTransfer`. Tests use a `MouseEvent` with a `dataTransfer` stub attached.
- `:scope >` selectors match nothing. Iterate `element.children` instead.
