#!/usr/bin/env bash
# Flux Downloader: installer for macOS and Linux.
#
# It does three things, none of which needs root:
#   1. puts the companion app (CoApp) in your user folder,
#   2. tells your Chromium-based browsers where to find it (native messaging),
#   3. checks for FFmpeg and yt-dlp, which the companion calls to save videos.
#
# You then load the extension from its folder (the last lines print the path).
#
# It runs from the portable release archive, or from a source checkout after
# `npm run build`. Windows has its own installer on the Releases page.
#
#   ./install.sh              install or update
#   ./install.sh --yt-dlp     also fetch yt-dlp (checked against its published hashes)
#   ./install.sh --uninstall  remove everything this script put in place

set -euo pipefail

HOST_NAME="com.fluxdownloader.coapp"
MIN_NODE_MAJOR=18

usage() {
  sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Environment:
  FLUX_INSTALL_DIR   where to install (default: your user data folder)
  FLUX_HOST_LOG      write the companion app's log to this file (for debugging)
EOF
}

say() { printf '%s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

MODE=install
WITH_YTDLP=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) MODE=uninstall ;;
    --yt-dlp) WITH_YTDLP=1 ;;
    -h | --help) usage; exit 0 ;;
    *) printf 'unknown option: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

# --- Where things live -------------------------------------------------------

case "$(uname -s)" in
  Darwin)
    OS=darwin
    DEFAULT_INSTALL_DIR="$HOME/Library/Application Support/FluxDownloader"
    SUPPORT="$HOME/Library/Application Support"
    # "Name|folder the browser reads native messaging manifests from"
    BROWSERS=(
      "Google Chrome|$SUPPORT/Google/Chrome/NativeMessagingHosts"
      "Chromium|$SUPPORT/Chromium/NativeMessagingHosts"
      "Brave|$SUPPORT/BraveSoftware/Brave-Browser/NativeMessagingHosts"
      "Microsoft Edge|$SUPPORT/Microsoft Edge/NativeMessagingHosts"
      "Vivaldi|$SUPPORT/Vivaldi/NativeMessagingHosts"
    )
    ;;
  Linux)
    OS=linux
    DEFAULT_INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/FluxDownloader"
    CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
    BROWSERS=(
      "Google Chrome|$CONFIG/google-chrome/NativeMessagingHosts"
      "Chromium|$CONFIG/chromium/NativeMessagingHosts"
      "Brave|$CONFIG/BraveSoftware/Brave-Browser/NativeMessagingHosts"
      "Microsoft Edge|$CONFIG/microsoft-edge/NativeMessagingHosts"
      "Vivaldi|$CONFIG/vivaldi/NativeMessagingHosts"
    )
    ;;
  *)
    die "this installer is for macOS and Linux. On Windows, use FluxDownloader-Setup-win-x64.exe from the Releases page."
    ;;
esac

INSTALL_DIR="${FLUX_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
case "$INSTALL_DIR" in
  /*) ;;
  *) die "FLUX_INSTALL_DIR must be an absolute path (got '$INSTALL_DIR')" ;;
esac
LAUNCHER="$INSTALL_DIR/coapp"
MANIFEST_FILE="$HOST_NAME.json"

browser_name() { printf '%s' "${1%%|*}"; }
browser_dir() { printf '%s' "${1#*|}"; }

# --- Uninstall ---------------------------------------------------------------

if [[ "$MODE" == uninstall ]]; then
  say "Removing Flux Downloader"
  for entry in "${BROWSERS[@]}"; do
    target="$(browser_dir "$entry")/$MANIFEST_FILE"
    if [[ -e "$target" ]]; then
      rm -f "$target"
      note "unregistered from $(browser_name "$entry")"
    fi
  done
  # Only what this script puts there; the folder itself goes only if that
  # leaves it empty, so a path given by mistake cannot take anything else.
  for item in "$LAUNCHER" "$INSTALL_DIR/$MANIFEST_FILE" "$INSTALL_DIR/main.bundle.cjs" \
    "$INSTALL_DIR/extension" "$INSTALL_DIR/ytdlp"; do
    [[ -e "$item" || -L "$item" ]] && rm -rf "$item"
  done
  rmdir "$INSTALL_DIR" 2>/dev/null || true
  say "Done. Remove the extension from chrome://extensions too, if it is still there."
  exit 0
fi

# --- What to install ---------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/extension/manifest.json" && -f "$SCRIPT_DIR/coapp/main.bundle.cjs" ]]; then
  SOURCE=bundle
  SRC_EXTENSION="$SCRIPT_DIR/extension"
  SRC_HOST="$SCRIPT_DIR/coapp/main.bundle.cjs"
elif [[ -f "$SCRIPT_DIR/../extension/manifest.json" ]]; then
  SOURCE=checkout
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  SRC_EXTENSION="$ROOT/extension"
  SRC_HOST="$ROOT/coapp/dist/main.js"
  [[ -f "$SRC_EXTENSION/dist/background.js" && -f "$SRC_HOST" ]] ||
    die "this checkout is not built yet. Run: npm ci && npm run build"
else
  die "cannot find the extension next to this script. Run it from the release archive or from a source checkout."
fi

# --- Node.js -----------------------------------------------------------------

command -v node >/dev/null 2>&1 || die "Node.js $MIN_NODE_MAJOR or newer is required (it runs the companion app). Install it from https://nodejs.org or with your package manager, then run this again."
# Node's own idea of its path: a version manager's shim in PATH can vanish
# with the shell that created it, which would break the launcher later.
NODE_BIN="$(node -p 'process.execPath')"
NODE_VERSION="$(node -p 'process.versions.node')"
[[ -x "$NODE_BIN" ]] || die "could not resolve a Node.js executable (got '$NODE_BIN')"
if (( ${NODE_VERSION%%.*} < MIN_NODE_MAJOR )); then
  die "Node.js $NODE_VERSION is too old; $MIN_NODE_MAJOR or newer is required."
fi

# The extension's ID follows from the public key in its manifest, the same way
# the browser derives it.
EXTENSION_ID="$("$NODE_BIN" -e '
  const fs = require("fs"), crypto = require("crypto");
  const key = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).key;
  if (!key) process.exit(2);
  const hex = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  process.stdout.write([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""));
' "$SRC_EXTENSION/manifest.json")" || die "could not read the extension ID from $SRC_EXTENSION/manifest.json"
[[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]] || die "derived an invalid extension ID: $EXTENSION_ID"

# --- Install -----------------------------------------------------------------

say "Installing Flux Downloader ($SOURCE)"
mkdir -p "$INSTALL_DIR"

if [[ "$SOURCE" == bundle ]]; then
  cp "$SRC_HOST" "$INSTALL_DIR/main.bundle.cjs"
  rm -rf "$INSTALL_DIR/extension"
  cp -R "$SRC_EXTENSION" "$INSTALL_DIR/extension"
  HOST_ENTRY="$INSTALL_DIR/main.bundle.cjs"
  EXTENSION_FOLDER="$INSTALL_DIR/extension"
else
  HOST_ENTRY="$SRC_HOST"
  EXTENSION_FOLDER="$SRC_EXTENSION"
fi

# The browser starts this file; it needs an absolute Node path because a
# browser launched from the dock or a menu has a much shorter PATH than a shell.
q_node="$(printf '%q' "$NODE_BIN")"
q_entry="$(printf '%q' "$HOST_ENTRY")"
if [[ -n "${FLUX_HOST_LOG:-}" ]]; then
  # For debugging: every launch, and everything the host prints, goes to a file.
  mkdir -p "$(dirname "$FLUX_HOST_LOG")"
  q_log="$(printf '%q' "$FLUX_HOST_LOG")"
  cat >"$LAUNCHER" <<LAUNCHER_WITH_LOG
#!/bin/bash
printf '[%s] Native host launch: %s\\n' "\$(date '+%Y-%m-%d %H:%M:%S')" "\$*" >> $q_log
exec $q_node $q_entry "\$@" 2>> $q_log
LAUNCHER_WITH_LOG
else
  cat >"$LAUNCHER" <<LAUNCHER_PLAIN
#!/bin/bash
exec $q_node $q_entry "\$@"
LAUNCHER_PLAIN
fi
chmod 755 "$LAUNCHER"
note "companion app: $LAUNCHER"

"$NODE_BIN" -e '
  const [name, launcher, id] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({
    name,
    description: "Flux Downloader companion application",
    path: launcher,
    type: "stdio",
    allowed_origins: ["chrome-extension://" + id + "/"]
  }, null, 2) + "\n");
' "$HOST_NAME" "$LAUNCHER" "$EXTENSION_ID" >"$INSTALL_DIR/$MANIFEST_FILE"

# Register with the browsers that are installed, told by their profile folder.
# One that has never been started has none yet, so Chrome is the fallback.
registered=()
for entry in "${BROWSERS[@]}"; do
  dir="$(browser_dir "$entry")"
  if [[ -d "$(dirname "$dir")" ]]; then
    mkdir -p "$dir"
    cp "$INSTALL_DIR/$MANIFEST_FILE" "$dir/$MANIFEST_FILE"
    registered+=("$(browser_name "$entry")")
  fi
done
if (( ${#registered[@]} == 0 )); then
  first="${BROWSERS[0]}"
  mkdir -p "$(browser_dir "$first")"
  cp "$INSTALL_DIR/$MANIFEST_FILE" "$(browser_dir "$first")/$MANIFEST_FILE"
  registered+=("$(browser_name "$first") (not started yet)")
fi
note "registered with: $(IFS=,; printf '%s' "${registered[*]}" | sed 's/,/, /g')"

# --- Tools the companion calls -----------------------------------------------

# Looks where the companion looks, because a browser's PATH is short.
find_tool() {
  local name="$1" dir
  for dir in "$INSTALL_DIR/ffmpeg/$OS" "$INSTALL_DIR/ytdlp/$OS" /opt/homebrew/bin /usr/local/bin \
    "$HOME/.local/bin" /usr/bin /bin; do
    [[ -x "$dir/$name" ]] && { printf '%s' "$dir/$name"; return 0; }
  done
  command -v "$name" 2>/dev/null
}

install_hint() {
  if [[ "$OS" == darwin ]]; then
    printf 'brew install %s' "$1"
  elif command -v apt-get >/dev/null 2>&1; then
    printf 'sudo apt install %s' "$1"
  elif command -v dnf >/dev/null 2>&1; then
    printf 'sudo dnf install %s' "$1"
  elif command -v pacman >/dev/null 2>&1; then
    printf 'sudo pacman -S %s' "$1"
  elif command -v zypper >/dev/null 2>&1; then
    printf 'sudo zypper install %s' "$1"
  else
    printf 'install %s with your package manager' "$1"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

install_ytdlp() {
  command -v curl >/dev/null 2>&1 || { warn "curl is needed to fetch yt-dlp"; return 1; }
  local asset
  case "$OS-$(uname -m)" in
    darwin-*) asset=yt-dlp_macos ;;
    linux-x86_64) asset=yt-dlp_linux ;;
    linux-aarch64 | linux-arm64) asset=yt-dlp_linux_aarch64 ;;
    *) warn "no prebuilt yt-dlp for $(uname -m); $(install_hint yt-dlp)"; return 1 ;;
  esac
  local base="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
  local tmp dest expected actual
  tmp="$(mktemp -d)"
  dest="$INSTALL_DIR/ytdlp/$OS/yt-dlp"
  curl -fsSL "$base/$asset" -o "$tmp/$asset" || { rm -rf "$tmp"; warn "could not download yt-dlp"; return 1; }
  curl -fsSL "$base/SHA2-256SUMS" -o "$tmp/SUMS" || { rm -rf "$tmp"; warn "could not download yt-dlp's checksums"; return 1; }
  expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$tmp/SUMS")"
  actual="$(sha256_of "$tmp/$asset")"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    rm -rf "$tmp"
    warn "yt-dlp did not match its published checksum; not installed"
    return 1
  fi
  mkdir -p "$(dirname "$dest")"
  mv "$tmp/$asset" "$dest"
  chmod 755 "$dest"
  rm -rf "$tmp"
  note "yt-dlp: installed ($dest)"
}

say "Checking tools"
missing=0
for tool in ffmpeg ffprobe; do
  if found="$(find_tool "$tool")"; then
    note "$tool: $found"
  else
    note "$tool: NOT FOUND"
    missing=1
  fi
done
(( missing == 0 )) || warn "HLS and DASH videos need FFmpeg: $(install_hint ffmpeg)"

if (( WITH_YTDLP == 1 )); then
  install_ytdlp || true
elif found="$(find_tool yt-dlp)"; then
  note "yt-dlp: $found"
else
  note "yt-dlp: not found (only needed for YouTube; run with --yt-dlp, or $(install_hint yt-dlp))"
fi

# --- Next ---------------------------------------------------------------------

cat <<EOF

Installed. One step is left, and only you can do it:

  1. Open chrome://extensions (or edge://extensions, brave://extensions)
  2. Turn on "Developer mode"
  3. Click "Load unpacked" and choose this folder:

     $EXTENSION_FOLDER

Open the extension's Settings page to check that it reaches the companion app.
To remove everything later: $SCRIPT_DIR/install.sh --uninstall
EOF
