# Releasing Flux Downloader

Updated: 2026-09-03.

Flux is currently distributed through GitHub Releases. The extension is sideloaded with **Load unpacked** and is not published in the Chrome Web Store.

## Current scope

The automated workflow builds **Windows x64 only**. Source code supports Chrome/Edge and contains cross-platform CoApp registration/runtime paths, but tagged macOS/Linux installer artifacts are not produced.

Release naming retains Flux Downloader:

- `FluxDownloader-extension.zip`
- `FluxDownloader-CoApp-win-x64.exe`
- `FluxDownloader-Setup-win-x64.exe`
- `ffmpeg-win-x64.exe`
- `ffprobe-win-x64.exe`
- `yt-dlp-win-x64.exe`
- `THIRD_PARTY_NOTICES.txt`
- `SHA256SUMS.txt`

## Source of truth

- Workflow: `.github/workflows/release.yml`
- Extension packager: `extension/scripts/package-extension.mjs`
- Extension ID derivation: `extension/scripts/get-extension-id.mjs`
- Runtime config: `coapp/scripts/create-release-config.mjs`
- SEA builder: `coapp/scripts/build-sea.mjs`
- Installer: `coapp/src/installer.ts`
- Checksums: `coapp/scripts/create-checksums.mjs`
- Notices: `THIRD_PARTY_NOTICES.md`

## Pre-release checklist

1. Ensure the intended commit is on the release branch and the worktree is clean.
2. Choose a semantic version and update every checked-in version:
   - root `package.json`;
   - `extension/package.json`;
   - `extension/manifest.json`;
   - `coapp/package.json`;
   - hard-coded `coapp/src/main.ts` `info().version`;
   - `package-lock.json` via npm.
3. Update `docs/changelog.md` and move relevant Unreleased items under that version.
4. Review `README.md`, `docs/PRIVACY.md`, `docs/STORE_LISTING.md`, and this guide for changed behavior.
5. If runtime versions changed, update workflow URLs and `THIRD_PARTY_NOTICES.md`.
6. Run:

```bash
npm ci
npm test
npm run build
npm run package:extension
```

7. Inspect the extension ZIP contents and test the extracted package in a clean browser profile.
8. Test CoApp registration, Settings connectivity, one direct download, one HLS/DASH download, progress, cancellation, and unique naming.
9. Verify `Refresh tabs`, source-page grouping/linking, and history restoration in the packaged build.

The GitHub workflow currently runs `npm ci` and `npm run build` but **does not run `npm test`**. Passing local tests is therefore a maintainer responsibility until CI is changed.

## Package validation

The popup-CSS packaging blocker is resolved. `extension/scripts/package-extension.mjs` copies:

```text
dist/background.js
dist/content.js
dist/mse-inject.js
dist/popup.js
dist/popup.css
dist/settings.js
```

Before creating the archive, the script parses local `src` and `href` references in packaged `popup.html` and `settings.html`. It fails when an asset is missing or resolves outside staging. This protects the split `dist/popup.css` and future local HTML assets by construction.

Unpacked development can still hide package-only errors. Keep `unzip -t`, file-list inspection, and a clean extracted-browser smoke test in release preflight.

## Fixed extension ID

The public key in `extension/manifest.json` derives:

```text
igephdkobpgbfgdjmehckbhffbimgkii
```

The workflow computes this with `get-extension-id.mjs` and embeds it into release configuration. The installer writes only that exact origin into `allowed_origins`.

Do not remove/change the manifest key casually: it changes the extension ID and breaks native registration for installed users.

## Tagging

After preflight:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Every `v*` tag triggers the `Release` workflow on `windows-latest` with Node 22.x.

The workflow sets `MEDIA_GRABBER_VERSION` from the tag for the packaged manifest. This override does **not** update the checked-in packages or CoApp's hard-coded `info` version; that is why manual version synchronization remains required.

## Workflow sequence

1. Checkout and install dependencies with `npm ci`.
2. Set packaged extension version from the tag.
3. Build extension/CoApp and package the extension.
4. Download pinned runtime binaries:
   - FFmpeg/ffprobe GyanD Essentials 8.1.2;
   - yt-dlp 2026.07.04.
5. Rename/copy runtimes into the release directory.
6. Derive fixed extension ID.
7. Generate `release-config.json` with GitHub asset URLs and SHA-256 hashes.
8. Bundle CoApp and installer as CommonJS.
9. Build a Node SEA CoApp executable.
10. Build a Node SEA installer embedding:
    - `release-config.json`;
    - gzip-compressed CoApp bytes as `coapp.bin.gz`.
11. Copy extension ZIP and third-party notice.
12. Generate `SHA256SUMS.txt` for every release file.
13. Publish a GitHub Release with generated notes.

## SEA rule

`build-sea.mjs` copies the current Node executable, creates a SEA blob, and injects it with postject.

The installer embeds **gzip-compressed CoApp bytes**. Do not directly inject an already SEA-injected executable as a raw nested SEA payload; duplicate Node SEA sentinels can make postject target the wrong sentinel.

## Installer behavior

The release installer:

- installs under `%LOCALAPPDATA%\Flux Downloader` on Windows;
- extracts/copies `coapp.exe`;
- downloads each runtime from the same GitHub Release over HTTPS;
- verifies each pinned SHA-256;
- writes `com.fluxdownloader.coapp.json`;
- registers Chrome and Edge HKCU keys;
- allowlists the fixed extension origin.

Users still need to extract the extension ZIP, enable Developer mode, and choose **Load unpacked**. A normal GitHub installer cannot silently install an unpacked Chrome/Edge extension.

## Artifact verification

Recommended checks:

```bash
unzip -l extension/FluxDownloader-extension.zip
sha256sum -c SHA256SUMS.txt
```

On Windows use `Get-FileHash` or a compatible checksum utility.

Confirm:

- ZIP root contains `manifest.json`;
- every manifest/popup-referenced asset exists;
- manifest version matches tag without a leading `v`;
- extension ID derivation matches the installer origin;
- installer rejects a modified runtime checksum;
- CoApp `info` reports the release version;
- runtime executables launch;
- notices match exact runtime pins.

## Publishing corrections

Do not silently move an existing version tag to different binaries. Prefer a new patch version. If a release is unusable, mark it clearly, fix the source/workflow, and issue a new tag.

## User installation summary

1. Download setup + extension ZIP.
2. Verify checksums if desired.
3. Run setup.
4. Extract ZIP permanently.
5. Open `chrome://extensions` / `edge://extensions`.
6. Enable Developer mode.
7. Load the extracted directory containing `manifest.json`.
8. Reload Flux and already-open media pages.
