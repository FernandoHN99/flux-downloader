#!/usr/bin/env bash
# macOS/Linux equivalent of register-dev-host.ps1: builds a launcher that
# execs the current `dist/main.js` and registers it as the native messaging
# host, instead of the raw `native-autoinstall-cli.js register` step, which
# only writes a manifest pointing at a `coapp` binary that has to already
# exist at the install root.
set -euo pipefail

EXTENSION_ID="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COAPP_ROOT="$PROJECT_ROOT/coapp"
DIST_MAIN="$COAPP_ROOT/dist/main.js"
MANIFEST_FILE="$PROJECT_ROOT/extension/manifest.json"

DERIVED_ID="$(node "$PROJECT_ROOT/extension/scripts/get-extension-id.mjs" "$MANIFEST_FILE")"
if [[ ! "$DERIVED_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Could not derive a valid extension ID from $MANIFEST_FILE" >&2
  exit 1
fi

if [[ -z "$EXTENSION_ID" ]]; then
  EXTENSION_ID="$DERIVED_ID"
elif [[ "$EXTENSION_ID" != "$DERIVED_ID" ]]; then
  echo "Extension ID '$EXTENSION_ID' does not match the ID derived from $MANIFEST_FILE ('$DERIVED_ID')" >&2
  exit 1
fi

if [[ ! -f "$DIST_MAIN" ]]; then
  echo "CoApp build not found: $DIST_MAIN (run: cd coapp && npm run build)" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin*)
    DEV_DIR="$HOME/Library/Application Support/FluxDownloaderDev"
    BROWSER_DIRS=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    )
    ;;
  Linux*)
    DEV_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/FluxDownloaderDev"
    BROWSER_DIRS=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/microsoft-edge/NativeMessagingHosts"
    )
    ;;
  *)
    echo "Unsupported platform for register-dev-host.sh: $(uname -s). Use coapp/scripts/register-dev-host.ps1 on Windows." >&2
    exit 1
    ;;
esac

mkdir -p "$DEV_DIR"

NODE_BIN="$(command -v node)"
LAUNCHER="$DEV_DIR/flux-host-dev"

cat > "$LAUNCHER" <<EOF
#!/bin/bash
exec "$NODE_BIN" "$DIST_MAIN" "\$@"
EOF
chmod +x "$LAUNCHER"

MANIFEST_PATH="$DEV_DIR/com.fluxdownloader.coapp.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "name": "com.fluxdownloader.coapp",
  "description": "Flux Downloader companion application (dev)",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

for dir in "${BROWSER_DIRS[@]}"; do
  mkdir -p "$dir"
  cp "$MANIFEST_PATH" "$dir/com.fluxdownloader.coapp.json"
done

echo "Dev native host registered."
echo "Launcher: $LAUNCHER"
echo "Manifest: $MANIFEST_PATH"
echo "Extension ID: $EXTENSION_ID"
echo
echo "Note: the launcher embeds an absolute path to dist/main.js. Re-run this"
echo "script if you move or rename the repository, or the host will fail to"
echo "start with a MODULE_NOT_FOUND error."
