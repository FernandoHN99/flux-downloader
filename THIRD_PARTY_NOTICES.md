# Third-party notices

Updated: 2026-09-03.

Pin audit: rechecked during the 505-test refactor documentation pass. No runtime provider, version, license, download URL, or redistribution model changed in that work.

Flux is the product name; Flux Downloader is the repository/release namespace. Flux Downloader release tooling installs or embeds the following third-party runtimes. They are governed by their own licenses.

## FFmpeg and ffprobe

Current Windows release workflow pin: **FFmpeg 8.1.2 Essentials** from GyanD/codexffmpeg.

- Project: https://ffmpeg.org/
- Binary provider: https://www.gyan.dev/ffmpeg/builds/
- Exact provider release: https://github.com/GyanD/codexffmpeg/releases/tag/8.1.2
- License for the selected build: GPLv3, according to the provider's build information
- Source/license information: follow the provider release and FFmpeg licensing links above

`ffmpeg.exe` and `ffprobe.exe` are separate runtime programs. They are not copied into the Flux Downloader source tree and are not linked into the browser extension. The release workflow republishes the exact binaries as release assets; the installer downloads them and verifies pinned SHA-256 hashes.

When changing the provider, configuration, or version, verify the resulting FFmpeg license (LGPL/GPL depends on build options) and update this notice before release.

## yt-dlp

Current Windows release workflow pin: **yt-dlp 2026.07.04**.

- Project: https://github.com/yt-dlp/yt-dlp
- Exact release: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04
- License: The Unlicense
- License text: https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE

`yt-dlp.exe` is a separate runtime program. The release installer downloads it from the Flux Downloader GitHub Release and verifies its pinned SHA-256 hash.

## Node.js runtime

The standalone CoApp and setup executable are Node.js Single Executable Applications (SEA). Release CI copies the Node 22.x executable and injects the Flux Downloader application blob.

- Project: https://nodejs.org/
- Source: https://github.com/nodejs/node
- License and bundled third-party notices: https://github.com/nodejs/node/blob/main/LICENSE

Node.js is distributed under the MIT license and includes third-party components listed in its license file. The exact Node 22.x patch used by a release is recorded by the GitHub Actions run.

## Build-only dependencies

TypeScript, esbuild, Vitest, happy-dom, and postject are development/build tools declared in npm metadata. They are not installed as separate end-user runtime programs by the Flux Downloader installer. Their exact versions and transitive dependency licenses are recorded in `package-lock.json`.

## Release obligations

- Ship this notice as `THIRD_PARTY_NOTICES.txt` with binary releases.
- Keep runtime URLs and versions synchronized with `.github/workflows/release.yml`.
- Generate and ship `SHA256SUMS.txt`.
- Preserve upstream license/source notices required by each runtime.
- Re-evaluate licensing whenever a runtime provider/build configuration changes.
