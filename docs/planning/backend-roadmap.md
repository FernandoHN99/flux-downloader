# Backend roadmap (Phase 2 — not started)

This describes a system that **does not exist yet**. Nothing in this file is
implemented. It's here so the shape of the decision is written down before
it's needed, not so it gets built on a schedule. Don't start this until the
go/no-go checkpoint in `mvp-launch-plan.md` says to.

Fernando owns this end-to-end (backend is his stated area — the extension is
"frontend" to whatever this becomes). This doc is scaffolding for that work,
not a spec to hand to someone else.

## Repository: separate, not monorepo

```
GitHub org or account
├── flux-downloader (this repo)        — extension + CoApp, stays as-is
└── flux-downloader-backend (new repo) — API, auth, database
```

Why separate rather than a workspace folder in this repo:

- **Deploy independently.** The extension ships via Chrome Web Store review
  cycles (days); the backend should deploy in minutes. Coupling them to one
  repo couples their release cadence for no benefit.
- **Secrets stay out of the extension repo.** `.env` files, DB credentials,
  Stripe keys — none of that belongs anywhere near a repo whose build output
  is a public, installable browser extension.
- **This repo's `npm` workspaces (`extension`, `coapp`) are about sharing
  build tooling between two things that ship together as one product.** The
  backend doesn't ship with the extension — it's a separate service the
  extension calls over the network. Different relationship, different repo.

## Stack

Node.js + TypeScript, so the RPC/type patterns already used in
`extension/src/lib` and `coapp/src` transfer directly — no context-switch to
a different language for what's conceptually a very similar client/server
shape (typed request → typed response, already the whole native-messaging
design in this codebase).

- **API**: Express (simplest thing that works; skip a heavier framework
  until there's a concrete reason for one)
- **Database**: PostgreSQL. Skip Firebase/Supabase for this — Fernando
  already owns backend/database work and a plain Postgres instance is more
  portable and inspectable than a BaaS, with no vendor lock-in if this needs
  to move hosts later.
- **Auth**: JWT, issued by the backend on login, stored in
  `chrome.storage.local` on the extension side (same storage already used
  for settings/history — see `extension/src/lib/settings.ts`)
- **Payments**: Stripe (see `monetization-strategy.md` — not built in this
  phase, but the schema below leaves room for it)
- **Hosting**: Railway or Render to start (~$5-10/mo) — cheap, fast to
  deploy, easy to move off later if scale demands it. Don't over-provision
  for load that doesn't exist yet.

## Phased build order

Building this in one shot is how it never ships. Three phases, each one a
working, deployable thing on its own.

### Phase 2a — version check only

The smallest possible backend: one endpoint, no database, no auth.

```
GET /api/version/check
  → { updateRequired: boolean, latestVersion: string }
```

Purpose: confirms the deploy pipeline, the extension→backend network call,
and CORS/manifest permissions all work end-to-end, before anything stateful
is built on top. If this phase alone ships and nothing else ever gets built,
that's a fine outcome — it's still useful on its own.

Extension side: add `host_permissions` for the backend's domain in
`manifest.json`, and a minimal client (see sketch below) called once on
service worker startup.

### Phase 2b — accounts

```
POST /api/auth/register   { email, password } → { token, userId }
POST /api/auth/login       { email, password } → { token, expiresAt }
GET  /api/auth/me          (bearer token)      → { userId, email }
```

Database: one `users` table (id, email, password_hash, created_at). Use
`bcrypt` or `argon2` for hashing — don't roll your own.

This phase has no product purpose by itself yet — it exists so 2c isn't
building auth and payments at the same time. Ship it, confirm login works
from the extension's popup, stop there.

### Phase 2c — subscription/entitlement check

```
GET /api/subscription/check   (bearer token) → { isPaid: boolean, expiresAt: string | null }
```

Database: add a `subscriptions` table (user_id, status, stripe_customer_id,
current_period_end). This is the endpoint the extension calls before
unlocking anything gated — see `monetization-strategy.md` for what "gated"
means and why it should be a short list.

Stripe integration (checkout session creation, webhook handling for
subscription status changes) is real work — budget it as its own chunk, not
a footnote on this phase.

## Extension-side integration sketch

```typescript
// extension/src/lib/backend-client.ts (does not exist yet)

class BackendClient {
  private baseUrl = 'https://api.<domain>.com'; // TBD — not yet registered

  async checkVersion(): Promise<{ updateRequired: boolean; latestVersion: string }> {
    const resp = await fetch(`${this.baseUrl}/api/version/check`);
    return resp.json();
  }

  async login(email: string, password: string): Promise<{ token: string }> {
    const resp = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!resp.ok) throw new Error('Login failed');
    return resp.json();
  }

  async checkSubscription(): Promise<{ isPaid: boolean; expiresAt: string | null }> {
    const { authToken } = await chrome.storage.local.get('authToken');
    const resp = await fetch(`${this.baseUrl}/api/subscription/check`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return resp.json();
  }
}
```

Notes for whoever picks this up:

- This mirrors `NativeClient` in `extension/src/lib/native-client.ts` in
  spirit (typed async calls wrapping a transport) but is deliberately a
  separate class — native messaging and HTTP-to-backend are different
  failure modes (offline, backend down, token expired vs. CoApp not
  installed) and conflating them into one client makes error handling worse,
  not simpler.
- `checkSubscription` must fail *open* on network error, not closed — if the
  backend is unreachable, don't lock a paying user out of features they
  already paid for. Cache the last-known entitlement locally
  (`chrome.storage.local`) and fall back to it.
- `host_permissions` in `manifest.json` needs the backend's domain added
  once it's registered. This itself is a Chrome Web Store re-review trigger
  for an already-listed extension — factor that lead time in.

## What this phase deliberately does not include

- Analytics/telemetry beyond what Phase 2a needs — see `mvp-launch-plan.md`
  on why the Chrome Web Store dashboard is enough until there's a specific
  question it can't answer.
- Refresh-token rotation, password reset flows, email verification — real
  auth hardening, worth doing before charging real money, not worth doing
  before there's a single paying user.
- Rate limiting / abuse prevention — add when there's traffic that needs it,
  not speculatively.
