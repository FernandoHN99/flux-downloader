#!/usr/bin/env bash
# Kept so existing instructions still work. Registering a source checkout as
# the native messaging host is now what `scripts/install.sh` does when it runs
# from a built checkout, and it covers more browsers than this script did.
#
# FLUX_DEV_HOST_LOG is still honoured: it is passed on as FLUX_HOST_LOG.
set -euo pipefail

if [[ -n "${FLUX_DEV_HOST_LOG:-}" && -z "${FLUX_HOST_LOG:-}" ]]; then
  export FLUX_HOST_LOG="$FLUX_DEV_HOST_LOG"
fi

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../scripts/install.sh" "$@"
