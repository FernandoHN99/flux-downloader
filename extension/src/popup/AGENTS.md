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
| `UiState` | popup | search, refresh, selection (`selectionMode`, `selected`, `selectionAnchor`, `movingSelection`), expansion, rename, grouping, dragging, quality choice, status, errors |

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
- Selection, rename, search, quality expansion, single download, grouped
  download and batch download all operate on the same entries.

## Picking rows

Picking is for acting on several videos at once: file them into a folder, move
them, or delete them. It is one mode (`selectionMode`), entered three ways:
the row's **Select** button, **Shift-click** or **Ctrl/Cmd-click** on any row.

- **Shift-click** picks every row from the anchor to the clicked one, on top of
  what is already picked, then moves the anchor there, so Shift-clicks chain.
  The anchor is the row last picked, or, before anything is picked, the row
  last opened. With neither, it picks just that row. The range is computed from
  `displayOrder(state)` (pure, in `selectors.ts`): rows as the list draws them,
  folders first, skipping collapsed folders and sites and anything the search
  hides. Rows of a running download are skipped, like they cannot be filed.
- **Ctrl/Cmd-click**, or any plain click while picking, flips one row. Dropping
  the last picked row leaves the mode.
- While Shift is held, `VideoList` previews the rows a click would pick
  (`.range-preview`). That is done on the DOM, not through the store: the pointer
  moves far faster than the list should be rebuilt.
- The **selection bar** replaces the action bar in place: `N selected`, Select
  all, **New folder**, **Move to…** (only once a folder exists) and **Delete**.
  Esc backs out one step: the name form first, then the picking.
- **Delete** sends `DELETE_HISTORY_ITEMS`, unless every video is picked, when it
  sends `CLEAR_HISTORY`: that also drops the rows a master playlist hides, which
  would otherwise resurface. There is no separate "Clear all" button.
- New folder from a selection files exactly the picked videos (the "Create with
  all N videos not in a folder" shortcut is not offered: they already chose),
  then leaves the mode. Cancelling the form, or leaving the name empty, keeps
  the picks.

## Row line

A row's meta line is the **length** spelled out (`formatLength`: "10 min 55 s",
"45 s", never folded into hours) followed by the quieter type ("HLS"). It
deliberately does not show when the video was detected: the length is what tells
one lesson from the next. A video with no known length shows just its type.
The two are separate spans (`.media-length`, `.media-kind`), not a string joined
with a dot. The row's badges are plain words ("On this page", "Failed"), not
capitals.

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
  is hidden when nothing is loose or when the form was opened from a selection.
- The form lives in `ListHeader`, above the scroll box, not at the top of the
  list: after picking forty rows the list is scrolled, and the field has to be
  where the user is looking. Opening it replaces the action bar.
- Whether each folder is collapsed is remembered across popup sessions under its
  own `collapsedFolders` storage key (`collapsed-folders.ts`), not in settings:
  the settings page rewrites the whole settings object and could clobber it. It
  is loaded before the first render so a closed folder never flashes open, and
  ids of deleted folders are dropped on every save. New folders start open.
- Rows inside a folder are not reorderable, so folders have no reorder zone.
- Creating and renaming use `FolderComposer` (mounted by `ListHeader`) and
  `FolderGroup`'s inline input,
  tagged with `data-focus-id` like the row rename so redraws keep the caret.
- Deleting a folder deletes the videos in it, from the list as well: the worker
  removes them from the history (`DELETE_FOLDER`), so none is left loose. It is
  refused, and the button disabled, while one of them is part of a running
  download. Renaming such a folder is refused too: a batch has already chosen
  each file's directory from the folder's name.
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

### While a download runs

Every video the run was started for is **locked** (`isLocked`, from
`BatchStatus.keys` or the one-off download's key) until it ends, the finished
items of a batch as well as the running ones: no rename, no filing, no picking,
no dragging, no deleting. A locked row shows a lock where its actions would be
(a spinner while it is actually transferring) and keeps its length and type. A
folder holding a locked video cannot be renamed or deleted. Rows outside the run
stay editable, and `editable()` strips locked keys from every selection-based
action, because a selection can predate the run. The worker enforces the same
rule, so a popup that has not caught up cannot edit a running video.

### The end-of-run notice

"Download complete!" is `ui.notice`, not `ui.status`: the status line is
rewritten by every scan and refresh, the notice has to outlast them. It is set
once the whole run is over — a one-off download completing, or the batch going
away (`endBatch`, from `BATCH_STATUS` going to `null`) — never per item. A batch
with failures says how many instead, and a cancelled one claims nothing. It is
cleared by a new run starting or by the × next to it, and ending a run empties
the status line so dismissing the notice cannot uncover a stale "Downloading…".

## Styles

Bundled from `styles/index.css`, split into `tokens`, `shell`, `list`, `folder`,
`row`, `quality`, `progress`, `misc` and `animations`. Keep component rules in
the matching file. `tokens.css` holds the palette, the type scale
(`--fs-xs/sm/md/lg` = 10/11/12/13px: small on purpose, a popup has 600px to show
a list in), the 4px spacing steps and the radii; use them instead of literals,
and keep text at 10px or more. Violet means "selected"
or "the main action", green and red only mark state. Type is one family (the
system UI font), weight and tabular numerals do the work: no monospace, no
all-caps labels.

**The `hidden` attribute loses to any `display` the element's class sets.** A
`.btn-dismiss` that is `display: flex` stays visible with `hidden` on it (the ×
of the status bar did, with no notice to dismiss). Give such an element its own
`[hidden] { display: none }` rule. Unit tests read the property, not the pixels,
so only looking at the popup catches this one.

**Chrome action popups need explicit pixel sizing.** Do not replace the fixed
width/min/max-height with `100vw`, `100vh` or `min()` viewport units — Chrome
can collapse the popup to about one pixel.

Current size: **500px wide, 380–600px tall**: the height follows the content, so
a short list is a short popup (the settings page shares the width). Chrome caps
an action popup at about 800×600, so height cannot grow past 600; the list is a
`390px` scroll box (`350px` while the download panel takes room, via
`.with-progress` on the section) so the page itself never gets a second
scrollbar, even with the new-folder form open. The list used to use
`min(430px, 68vh)`, which collapses to 0 whenever the viewport has no height
yet — fixed pixels only.

Design work on the popup uses the project skill `frontend-design`
(`.claude/skills/frontend-design`, invoke it as `/frontend-design`). The look is
a choice, not a default: dark, violet only for "selected" and "the main action",
the system font, sentence case, no monospace, no all-caps. Refine it; do not
swap it for a template.

The settings page stays a small separate static page (`settings.html`,
`settings.ts`, `settings.css`) on purpose.

## Testing

Components are tested against happy-dom. Two of its gaps to know about:

- `DragEvent` constructs as a plain `Event`, dropping `clientY` and
  `dataTransfer`. Tests use a `MouseEvent` with a `dataTransfer` stub attached.
- `:scope >` selectors match nothing. Iterate `element.children` instead.
