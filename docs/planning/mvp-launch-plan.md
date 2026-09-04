# MVP launch plan — Chrome Web Store, zero backend

Goal: get Flux in front of real users through the official Chrome Web Store
listing, with no backend, no accounts, no payment — and use that to decide
whether Phase 2 (backend) and Phase 3 (monetization) are worth building at
all. See [README.md](README.md) for how this fits the bigger picture.

## Why no backend for the MVP

- Nobody has used the product yet. A backend is infrastructure for a problem
  (scale, abuse, entitlements) we don't have.
- The CoApp already does everything downloads need locally — there's no
  server-side capability missing from the current experience.
- Chrome Web Store review is friction enough on its own (see below). Adding
  "explain what your backend does with `<all_urls>` host permission" to that
  review only slows the one thing this phase needs: getting listed.
- Cost of being wrong: if 3 people install it, a backend was wasted effort.
  Cost of the alternative being wrong: if it blows up, Phase 2 takes 30-40h
  starting from a known-good extension instead of an untested one. Asymmetric
  in favor of waiting.

## Before launch: land the pending branches

Three branches carry work not yet on `main` (see `docs/planning/README.md`
for what each contains: `refactor/popup-components`,
`feat/faster-hls-downloads`, `feat/history-and-unique-filenames`). Decide
merge order and get them onto `main` before building the store package —
the store listing, screenshots, and QA pass below should all be done against
what's actually shipping, not against a branch that might change.

- [ ] Decide merge order / resolve overlap between the three branches
- [ ] `main` builds clean: `npm run build` from repo root, no errors
- [ ] `main` tests pass: `npm test`
- [ ] Manual smoke test on a real HLS site (not just public test streams)

## Chrome Web Store submission

### Account & fee

- [ ] Register a Chrome Web Store developer account — **$5 one-time fee**
- [ ] Use an email/account you (Fernando) control long-term, not a throwaway —
      you can't easily transfer a published listing later

### Package

- [ ] `npm run package:extension` (already exists — confirm it produces a
      clean `.zip` with no dev-only files, source maps, or `console.log`
      noise you don't want reviewers reading)
- [ ] Confirm `manifest.json` permissions are the minimum actually used —
      `<all_urls>` host permission plus `webRequest`, `nativeMessaging`,
      `tabs` will all get scrutiny (see Policy risk below); don't ship a
      permission "just in case"

### Store listing content

Most of this is already drafted in `docs/STORE_LISTING.md` — reuse it, don't
rewrite from scratch. Still needed:

- [ ] Screenshots (Chrome Web Store requires at least one, 1280×800 or
      1640×1024) — capture the actual popup: media list, quality picker,
      history panel
- [ ] Small promo tile / icon assets sized per current Chrome Web Store spec
      (check current requirements at submission time — these change)
- [ ] Short description (already drafted) and long description (already
      drafted) — copy from `STORE_LISTING.md`, adjust only if the merged
      branches changed user-facing behavior
- [ ] Privacy practices disclosure — Chrome Web Store now requires an
      explicit data-use declaration in the dashboard (separate from
      `docs/PRIVACY.md`, which should stay the source of truth you copy from)
- [ ] Category selection and, if required, a support/contact URL — decide
      what that URL is before submitting (GitHub issues page is fine to start)

### Policy risk — read before submitting, not after rejection

- **"Single purpose" policy**: the listing description needs to make the
  single purpose obvious (media detection + download) — don't let the copy
  wander into "productivity tool" framing that invites a broader read of the
  host permission.
- **`<all_urls>` + `webRequest`**: this combination gets manual review
  attention. Be ready for a rejection asking to justify it, or to narrow it.
  Do not pre-narrow it defensively before submitting — see what the reviewer
  actually asks for, since guessing wrong wastes a review cycle either
  direction.
- **YouTube downloading**: yt-dlp-based YouTube downloads are the single
  highest-risk item for takedown/rejection. `STORE_LISTING.md` already flags
  this. Decide explicitly before submitting: ship YouTube support in the
  Web-Store build, or ship it GitHub-Releases-only and strip it from the
  store package. This is a real decision, not a checkbox — get a second
  opinion if unsure, because guessing wrong here can mean a listing pulled
  after users already depend on it.
- **Native messaging dependency**: the extension is inert without the
  separately-installed CoApp. The listing must say this plainly (install
  order, link to CoApp install instructions) so reviewers and first-time
  users don't think the extension is broken.
- **Remote code / obfuscation**: none of the current bundle should trip this,
  but re-check after the branches merge — no `eval`, no fetching-and-running
  remote JS.

### Submit

- [ ] Submit for review
- [ ] Expect **1-3 business days** typical review time, longer for `webRequest`
      + `<all_urls>` extensions specifically — don't schedule an announcement
      around a specific date
- [ ] If rejected: read the specific policy citation, fix precisely that,
      resubmit — don't preemptively over-correct on a guess

## After it's listed

### What the Chrome Web Store gives you for free

The developer dashboard provides, with zero backend:

- Install/uninstall counts over time
- Weekly active users (approximate, Chrome-reported)
- Rating and written reviews
- Crash reports IF you opt into Chrome's crash reporting for extensions

This is enough signal to answer the only question the MVP phase needs
answered: **is there real demand?** Don't build telemetry to answer a
question the dashboard already answers.

### What it does NOT give you

- Per-feature usage (which quality people pick, how often batch download
  runs, how often downloads fail) — you don't need this yet either. Decide
  what to build next from install/retention/reviews, not from feature
  telemetry you don't have.
- Any way to identify or contact individual users
- Any way to gate or meter usage

If either of those becomes something you actually need to make a go/no-go
call on Phase 2, that need itself is the trigger for Phase 2 — see
`backend-roadmap.md`.

### Go/no-go checkpoint (suggested: 30 days post-listing)

Don't backend-plan on a calendar date — plan it on a threshold. Reasonable
starting thresholds (revise once you see real numbers, these are guesses):

- [ ] 500+ installs — some real usage worth investing in
- [ ] Rating holding at 4+ stars — the product itself isn't the blocker
- [ ] At least a few reviews/issues asking for something a backend would
      enable (accounts, sync, "let me pay to remove a limit") — evidence of
      demand, not just your own hypothesis

If those hold: move to `backend-roadmap.md` Phase 2. If not: the answer isn't
"build a backend to fix it" — it's "figure out why adoption/retention is low
first," which is a product question, not an infrastructure one.
