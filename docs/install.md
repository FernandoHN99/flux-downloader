# Installing Flux Downloader

Flux has two parts that work together: the **extension**, which finds videos in your browser, and a small **companion app** on your computer, which does the saving (with FFmpeg and, for YouTube, yt-dlp). A browser cannot write files or run FFmpeg, so both are needed.

It is not on the Chrome Web Store. You install the companion with a script, then load the extension from a folder.

## What you need

- A Chromium-based browser: Chrome, Edge, Brave, Chromium or Vivaldi.
- **Node.js 18 or newer** (macOS and Linux). The companion app is a Node program.
- **FFmpeg** (with `ffprobe`), for HLS and DASH streams.
- **yt-dlp**, only for YouTube.

On Windows the installer brings its own copy of everything, and registers with Chrome and Edge.

## macOS and Linux

Download `flux-downloader-portable.tar.gz` from the [latest release](https://github.com/FernandoHN99/flux-downloader/releases/latest), then:

```bash
tar xzf flux-downloader-portable.tar.gz
cd flux-downloader-portable
./install.sh
```

It needs no root. It copies the companion app to your user folder, registers it with every Chromium-based browser it finds, and checks for FFmpeg and yt-dlp, telling you how to install what is missing:

```bash
brew install ffmpeg                  # macOS
sudo apt install ffmpeg              # Debian, Ubuntu
sudo dnf install ffmpeg              # Fedora (enable RPM Fusion first)
sudo pacman -S ffmpeg                # Arch
```

For YouTube, `./install.sh --yt-dlp` downloads yt-dlp for you and checks it against the hashes yt-dlp publishes. A system install (`brew install yt-dlp`) works just as well.

Where things go:

| | macOS | Linux |
|---|---|---|
| Companion app and extension | `~/Library/Application Support/FluxDownloader` | `~/.local/share/FluxDownloader` |
| Registration | each browser's `NativeMessagingHosts` folder | the same |

The script finishes by printing the extension folder. Keep it where it is: the browser reads the extension from there.

## Windows

Download `FluxDownloader-Setup-win-x64.exe` and `FluxDownloader-extension.zip` from the [latest release](https://github.com/FernandoHN99/flux-downloader/releases/latest). Run the installer, then extract the ZIP somewhere permanent. The installer downloads FFmpeg and yt-dlp from the same release and checks their hashes.

## Load the extension

This step cannot be scripted; the browser asks for it.

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the extension folder (the one that contains `manifest.json`).
4. Pin Flux from the puzzle-piece menu if you like.

Then open the extension's **Settings**. It shows whether it can reach the companion app.

The extension's ID is fixed by its manifest (`igephdkobpgbfgdjmehckbhffbimgkii`), so it is the same wherever you load it from, and the registration keeps working.

## Using it

Open a page with a video and start playing it. Click the Flux icon: the video appears in the list. Pick a quality and download. Videos from every open tab stay in one list, and **Refresh tabs** rescans them all.

- **Shift-click** a row to select a range, **Ctrl/Cmd-click** to pick single rows. A bar appears with **New folder**, **Move to…** and **Delete**.
- Files are saved in your `Downloads` folder. A batch gets its own `Flux_…` folder there, and your Flux folders become subfolders of it.

Flux does not get around DRM. Save only what you are allowed to save.

## Updating

Download the new archive and run `./install.sh` again (or the new Windows installer). Then click the reload icon on the extension's card in `chrome://extensions` and reload any pages that were already open.

## Uninstalling

```bash
./install.sh --uninstall      # from the folder you extracted, or from a source checkout
```

Then remove the extension from `chrome://extensions`. On Windows, run `FluxDownloader-Setup-win-x64.exe uninstall` (it removes the browser registration), then delete the folder `%LOCALAPPDATA%\FluxDownloader`.

## Troubleshooting

**"Native host has exited" or "Specified native messaging host not found."**
The browser could not start the companion app. Run `./install.sh` again: it rewrites the registration with the current Node path (a Node version manager moving or removing Node is the usual cause). To see what the host prints, install with `FLUX_HOST_LOG=$HOME/flux-host.log ./install.sh`, trigger the error again, and read the file.

**Settings says the companion cannot be reached, but you installed it.**
Reload the extension after installing, and make sure you loaded it from a folder that contains `manifest.json`. The browser must be Chromium-based and installed normally: browsers from **Snap or Flatpak** run in a sandbox that cannot start the companion, so use the deb/rpm build or a tarball instead.

**HLS or DASH downloads fail at once.**
FFmpeg or `ffprobe` is missing or not found. Run `./install.sh` and read its "Checking tools" section.

**YouTube does nothing.**
yt-dlp is missing. Run `./install.sh --yt-dlp`, or install it with your package manager.

**It does not see a video.**
Start playback first, then click **Refresh tabs**. Pages that were open before you loaded the extension need a reload.

Still stuck? [Open an issue](https://github.com/FernandoHN99/flux-downloader/issues/new/choose) and include your OS, browser, Node version and what the Settings page says.
