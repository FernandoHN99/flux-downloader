#!/usr/bin/env bash
# End-to-end check of the macOS/Linux install, in a throwaway HOME so a real
# registration is never touched: unpack the portable archive, install, start
# the host the way a browser would, reinstall, uninstall.
#
#   scripts/smoke-install.sh [flux-downloader-portable.tar.gz]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-$ROOT/release/flux-downloader-portable.tar.gz}"
[[ -f "$ARCHIVE" ]] || { echo "archive not found: $ARCHIVE" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
unset XDG_CONFIG_HOME XDG_DATA_HOME FLUX_INSTALL_DIR
mkdir -p "$HOME"

case "$(uname -s)" in
  Darwin)
    INSTALL_DIR="$HOME/Library/Application Support/FluxDownloader"
    BROWSER_DIR="$HOME/Library/Application Support/Google/Chrome"
    ;;
  *)
    INSTALL_DIR="$HOME/.local/share/FluxDownloader"
    BROWSER_DIR="$HOME/.config/google-chrome"
    ;;
esac
mkdir -p "$BROWSER_DIR" # what a browser that has run once leaves behind
MANIFEST="$BROWSER_DIR/NativeMessagingHosts/com.fluxdownloader.coapp.json"

check() { # check "what" command...
  local what="$1"; shift
  if "$@"; then echo "ok   $what"; else echo "FAIL $what" >&2; exit 1; fi
}

tar -xzf "$ARCHIVE" -C "$TMP"
INSTALLER="$TMP/flux-downloader-portable/install.sh"

"$INSTALLER"
check "manifest registered with the browser" test -f "$MANIFEST"
check "manifest allows the extension's fixed ID" grep -q 'chrome-extension://igephdkobpgbfgdjmehckbhffbimgkii/' "$MANIFEST"
check "launcher is executable" test -x "$INSTALL_DIR/coapp"
check "extension folder is in place" test -f "$INSTALL_DIR/extension/manifest.json"
check "manifest points at the launcher" node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(m.path === process.argv[2] && m.type === "stdio" ? 0 : 1);
' "$MANIFEST" "$INSTALL_DIR/coapp"
check "host starts and answers" node "$ROOT/coapp/scripts/smoke-host.mjs" "$INSTALL_DIR/coapp"

"$INSTALLER" >/dev/null
check "installing again is harmless" node "$ROOT/coapp/scripts/smoke-host.mjs" "$INSTALL_DIR/coapp"

"$INSTALLER" --uninstall >/dev/null
check "uninstall removes the registration" test ! -e "$MANIFEST"
check "uninstall removes the install folder" test ! -e "$INSTALL_DIR"

echo "install smoke test passed"
