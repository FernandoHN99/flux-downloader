# Monetization strategy (Phase 3 — not started)

Depends on `backend-roadmap.md` Phase 2c (accounts + subscription check)
existing first. Nothing here is implemented. This is the answer to "if we
charge, how, and what does that break" — written down now so the decision
isn't made hastily later under the pressure of "let's just ship something."

## The $1-forever idea, and why it doesn't survive contact with reality

The original idea: charge $1 once, unlimited use forever. Worth being
explicit about why this doesn't work as stated:

- **Payment processing eats it.** Stripe's cut is ~2.9% + $0.30 per
  transaction. On $1, that's $0.33 — a third of revenue gone before hosting,
  before anything else.
- **"Forever" is a support and hosting liability with no matching revenue.**
  A backend (Phase 2) has ongoing hosting cost. A customer who paid once in
  2026 and expects the service to keep working in 2029 is a cost center with
  no corresponding income in year two or three.
- **No recovery from build/host cost.** Even at zero marginal cost per user,
  $1 one-time doesn't fund iterating on the product for someone who already
  paid.

**A small recurring price works better than a larger one-time price**,
because it ties revenue to the period you're actually incurring hosting
cost, and it's a smaller ask per-decision for the user (easier "yes" than a
bigger one-time price would be). Concretely: something like $0.99-2.99/month
or $9.99-19.99/year is a more sustainable shape than $1 once — exact number
is a pricing decision to make with real usage data from the MVP, not now.

## Chrome Web Store policy — read this before building anything

The Chrome Web Store **prohibits paywalling core functionality** without
clear disclosure, and reviews extensions specifically for "deceptive"
monetization (charging for what looks free, or blocking previously-free
functionality retroactively). Two paths that are actually compliant:

1. **Freemium with a clear, disclosed limit.** E.g. N downloads per day free,
   unlimited on paid tier — allowed if the listing clearly states the limit
   up front. This is the standard, low-risk pattern.
2. **Distribute outside the Web Store entirely** (GitHub Releases, as today)
   and charge however you want — no Google policy applies, but you lose Web
   Store discovery and the built-in install flow.

**Not compliant, don't do this:** shipping the extension free and unlimited,
building an audience, then retroactively adding a paywall to functionality
that was free — this reads as the "bait and switch" pattern Chrome Web Store
review explicitly looks for, and risks the listing.

If Phase 3 happens, decide which of the two paths above at the start, before
writing the gating code — it changes what the gating logic needs to do.

## What would actually be gated (assuming path 1: freemium)

Keep this list short. The product's core value — detect media, pick a
quality, download it — should stay free; that's what got installs in
Phase 1 and gutting it after the fact is the policy trap above.

Candidates for a paid tier, not decided, for discussion once Phase 2 exists:

- Unlimited batch download (free tier: cap batch size, e.g. 3-5 at a time)
- History size beyond some free cap
- Priority/concurrent download slots

Explicitly NOT candidates: single-video download, quality selection, basic
history — these are the free tier's reason to exist.

## Mechanics, once there's something to gate

```
1. Extension calls BackendClient.checkSubscription() (see backend-roadmap.md)
2. Result cached in chrome.storage.local with a timestamp
3. Gated action (e.g. "Download all" past the free batch cap) checks the
   cached entitlement before proceeding
4. If not entitled: show an upgrade prompt, not a silent failure
5. Upgrade prompt → Stripe Checkout (hosted by Stripe, not built by us —
   don't build a custom payment form; Stripe Checkout also keeps PCI scope
   off this codebase entirely)
6. Stripe webhook → backend updates the subscriptions table
7. Extension re-checks entitlement (or backend can push via next poll)
```

Re-affirming the fail-open note from `backend-roadmap.md`: if the backend or
network is unreachable, a previously-entitled user should not lose access
because of a connectivity blip. Cache and trust the last-known-good
entitlement for some grace window (e.g. 24-72h) before re-locking.

## Sequencing

1. Phase 2c ships (accounts + entitlement check plumbing) — see
   `backend-roadmap.md`
2. Decide the actual gate list and price with real MVP usage data in hand,
   not the placeholder list above
3. Stripe integration (Checkout + webhook handling) — budget this as real
   work, not an afternoon
4. Update the Chrome Web Store listing to disclose the free-tier limit
   explicitly before the gate goes live in a shipped version
5. Ship the gate

## Open questions to resolve before building, not during

- Exact price point and billing period — needs MVP usage data to guess well
- Exact free-tier limits — same
- Does a lapsed subscription revoke access immediately or at period end?
  (Standard SaaS practice: access continues until `current_period_end`,
  matching what Stripe already tracks — don't build custom proration logic)
- Refund policy — decide before the first payment, not after the first
  refund request
