# Releasing Flux Downloader

Flux is distributed through GitHub Releases and loaded as an unpacked extension. It is not on the Chrome Web Store. Users get a portable archive for macOS and Linux, an installer for Windows, and the extension as a ZIP.

## What a release contains

| File | For |
|---|---|
| `flux-downloader-portable.tar.gz` | macOS and Linux: the built extension, the companion app, and `install.sh` |
| `FluxDownloader-Setup-win-x64.exe` | Windows installer (embeds the companion app) |
| `FluxDownloader-extension.zip` | the extension alone, for loading by hand |
| `FluxDownloader-CoApp-win-x64.exe`, `ffmpeg-win-x64.exe`, `ffprobe-win-x64.exe`, `yt-dlp-win-x64.exe` | what the Windows installer downloads from the same release |
| `THIRD_PARTY_NOTICES.txt` | licences of the bundled runtime binaries |
| `SHA256SUMS.txt` | a checksum for every other file |

The names are stable on purpose: `…/releases/latest/download/flux-downloader-portable.tar.gz` always points at the newest release, which is what the README and the download page link to.

## Source of truth

| Piece | File |
|---|---|
| Pipeline | `.github/workflows/release.yml` |
| Checks on every push and pull request | `.github/workflows/ci.yml` |
| Portable archive | `scripts/make-portable-bundle.mjs` (run it with `npm run package:portable`) |
| macOS/Linux installer | `scripts/install.sh` |
| Install smoke test | `scripts/smoke-install.sh` (`npm run smoke:install`), `coapp/scripts/smoke-host.mjs` |
| Version in every file | `scripts/set-version.mjs` (`npm run version:set -- X.Y.Z`) |
| Extension files, shared by the ZIP and the archive | `extension/scripts/stage-extension.mjs` |
| Extension ZIP | `extension/scripts/package-extension.mjs` |
| Fixed extension ID | `extension/scripts/get-extension-id.mjs` |
| Windows runtime config, SEA builder, installer | `coapp/scripts/create-release-config.mjs`, `coapp/scripts/build-sea.mjs`, `coapp/src/installer.ts` |
| Licences | `THIRD_PARTY_NOTICES.md` |

## Cutting a release

1. Be on `main`, up to date, with a clean tree and a green CI.
2. Pick a semantic version and write it everywhere in one go:

   ```bash
   npm run version:set -- 1.2.0
   ```

   It updates the root, extension and CoApp `package.json`, the manifest, `package-lock.json` and `coapp/src/version.ts`. A test fails if any of them disagree.
3. Move the entries under *Unreleased* in `docs/changelog.md` to the new version.
4. If the pinned FFmpeg or yt-dlp versions changed in `release.yml`, update `THIRD_PARTY_NOTICES.md` to match.
5. Check it locally:

   ```bash
   npm ci && npm test && npm run build
   npm run package:portable && npm run smoke:install
   ```

6. Commit through a pull request, merge, then tag the merge commit:

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

The workflow refuses a tag that does not match the version in `package.json`.

## What the workflow does

Three jobs, and the release is published only when both builds pass.

1. **portable** (Ubuntu): builds everything, packs `flux-downloader-portable.tar.gz` and the extension ZIP, and runs the install smoke test against the archive it just made.
2. **windows** (Windows): builds, downloads the pinned runtime binaries, writes `release-config.json` with their URLs and SHA-256 hashes, builds the companion app and the installer as Node single-executable applications.
3. **publish** (tags only): collects both artifact sets, writes `SHA256SUMS.txt`, and creates the release with generated notes under a short install section.

The same jobs run, without publishing, from the Actions tab and on any pull request that touches the release files, so a broken pipeline shows up before a tag needs it.

## Pinned runtimes (Windows)

The Windows installer downloads these from the release itself and checks each hash:

- FFmpeg and ffprobe: GyanD Essentials 8.1.2;
- yt-dlp 2026.07.04.

On macOS and Linux nothing is bundled: the installer looks for FFmpeg on the system and can fetch yt-dlp (`--yt-dlp`), checking it against the hashes yt-dlp publishes.

## SEA rule

`build-sea.mjs` copies the current Node executable, creates a SEA blob, and injects it with postject.

The installer embeds **gzip-compressed CoApp bytes**. Do not inject an already SEA-injected executable into another one: duplicate Node SEA sentinels can make postject target the wrong sentinel.

## Fixed extension ID

The public key in `extension/manifest.json` derives:

```text
igephdkobpgbfgdjmehckbhffbimgkii
```

Both installers write only that origin into `allowed_origins`, and `install.sh` derives it from the manifest the same way the browser does. Do not remove or change the manifest key: it changes the ID and breaks the registration of everyone who installed.

## Checking a release

```bash
sha256sum -c SHA256SUMS.txt
tar tzf flux-downloader-portable.tar.gz | head
unzip -l FluxDownloader-extension.zip
```

Confirm:

- the ZIP root contains `manifest.json`, and its version matches the tag without the `v`;
- the portable archive installs and uninstalls cleanly (`scripts/smoke-install.sh` does this);
- on Windows, the installer rejects a runtime whose checksum was modified;
- the companion app's `info` reports the release version.

## Corrections

Never move an existing tag to different binaries. If a release is unusable, say so in its notes, fix the cause, and publish a new patch version.
