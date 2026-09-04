# Product & business planning

This directory is separate from the rest of `docs/`: everything else documents
*how the code works today*. Everything here documents *where the product is
going* — Chrome Web Store launch, monetization, and the backend that doesn't
exist yet. Treat it as a living plan, not a spec: update it as decisions
change, and delete sections once they're implemented and covered by the real
docs instead.

## Documents

| Document | Answers |
|---|---|
| [mvp-launch-plan.md](mvp-launch-plan.md) | How do we get Flux onto the Chrome Web Store with zero backend, and what does "done" look like for that? |
| [backend-roadmap.md](backend-roadmap.md) | If the MVP gets traction, what do we build next — stack, repo layout, API shape, phased rollout? |
| [monetization-strategy.md](monetization-strategy.md) | How would a paid tier actually work — pricing, what's gated, Chrome Web Store policy risk, Stripe flow? |

## Where things stand (2026-09-03)

- Product name shown to users: **Flux**. Internal package/repo/native-host name: **MediaGrabber**. Both docs sets use whichever name that document already established — don't rename mid-file.
- Currently distributed via **GitHub Releases as an unpacked extension**, not the Chrome Web Store. See `docs/STORE_LISTING.md` for the store copy already drafted for that future listing.
- **No backend exists.** Everything today is the extension + local CoApp talking over native messaging. `backend-roadmap.md` describes a system that has not been started.
- Three feature branches carry work not yet on `main`: `refactor/popup-components` (component-based popup rewrite, current `HEAD` as of this writing), `feat/faster-hls-downloads` (parallel HLS segment prefetch), `feat/history-and-unique-filenames` (history/batch download/rename/reorder). The launch plan assumes these land on `main` first — see the "Before launch" checklist in `mvp-launch-plan.md`.

## Ground rules for this plan

- **Backend is Phase 2, not Phase 0.** Ship the extension alone first; see `mvp-launch-plan.md` for why.
- **Monetization is Phase 3.** Don't gate anything until there's a user base worth gating for.
- Fernando owns backend work end-to-end when it starts (his stated preference) — the extension is "frontend" to a backend repo he drives.
