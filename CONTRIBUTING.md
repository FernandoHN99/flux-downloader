# Contributing to Flux Downloader

Thanks for looking. Bug reports, fixes, docs and new ideas are all welcome, and so are questions: open a [discussion](https://github.com/FernandoHN99/flux-downloader/discussions) if you are not sure something is a bug.

## Before you start

- **Read [AGENTS.md](AGENTS.md).** Despite the name it is for people too: it explains how the code is laid out, the rules it keeps (and why), and the bugs those rules came from. Each folder under `extension/src/` has its own short `AGENTS.md`.
- **Check the scope.** Flux detects media a page is already playing and saves it. It does not bypass DRM, and it will not grow site-specific scrapers for protected content. A pull request that does either will be declined, however well made.
- For anything bigger than a fix, open an issue first so we agree on the shape before you spend time on it.

## Set up

You need Node.js 22 (18+ works for running it), and FFmpeg if you want to try downloads.

```bash
git clone https://github.com/FernandoHN99/flux-downloader.git
cd flux-downloader
npm ci
npm test            # extension and companion app test suites
npm run build       # extension bundles, then the companion app
```

Then try your build in a browser:

```bash
scripts/install.sh  # registers this checkout's companion app (macOS and Linux)
```

Open `chrome://extensions`, turn on Developer mode, **Load unpacked**, and choose the `extension/` folder (not `extension/dist/`). On Windows use `coapp\scripts\register-dev-host.ps1`.

`npm run dev:extension` rebuilds on change, but it does not reload the extension or open pages: do that by hand when you change a script that runs in the page or the service worker.

The popup can be developed without a browser: its tests run in happy-dom, and `npm run build:site` builds a copy of it running against sample data, which is what the download page embeds.

## Making a change

1. Branch from `main`.
2. Write the test with the change. This code base is protected by its tests: parsers, the popup components, history rules and the protocol layers all have them, and the regressions listed in `AGENTS.md` each have one. If you fix a bug, add the test that would have caught it.
3. Run `npm test` and `npm run build`. CI runs both on Linux, macOS and Windows, plus shellcheck on the scripts and an install test.
4. Keep the diff focused. Put refactors in their own commit.
5. Update the docs that describe what you changed (`AGENTS.md` files, `docs/`, `docs/changelog.md` under *Unreleased*).

Commit messages follow the style already in the log: `feat: …`, `fix: …`, `docs: …`, `chore: …`, in the imperative, with a body that says why.

## Style

- TypeScript, two spaces, single quotes, semicolons. There is no linter; match what is around you.
- Components own one element and render only inside it. Business rules live in the domain folders, not in `background.ts`.
- Anything that runs in the page's own world must go through the helpers that keep it invisible to the page (see `entrypoints/AGENTS.md`).
- Plain words in the UI: sentence case, no jargon, say what the button does.

## Reporting a bug

Use the bug template. The most useful details are your OS, browser and Node version, how you installed Flux, and what the extension's Settings page says about the companion app. Please do not paste private links: a signed video URL can give access to your account.

## Security

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
