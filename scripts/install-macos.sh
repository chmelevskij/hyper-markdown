#!/usr/bin/env bash
#
# Build hyper-markdown from source and (re)install it into /Applications.
# Usage: pnpm app:install
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_NAME="hyper-markdown"
DEST="/Applications/${APP_NAME}.app"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer targets macOS (/Applications)." >&2
  echo "On other platforms run 'pnpm tauri build' and use the bundle in" >&2
  echo "src-tauri/target/release/bundle/." >&2
  exit 1
fi

echo "▸ Building release bundle (pnpm tauri build)…"
pnpm tauri build

# Find the freshly built .app under the release bundle dir.
APP_SRC="$(find src-tauri/target -type d -name "${APP_NAME}.app" -prune 2>/dev/null \
  | grep "/release/bundle/macos/" | head -n1)"
if [[ -z "${APP_SRC}" ]]; then
  echo "Could not find ${APP_NAME}.app under src-tauri/target — build may have failed." >&2
  exit 1
fi

echo "▸ Quitting any running ${APP_NAME}…"
osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
sleep 1

echo "▸ Installing to ${DEST}…"
rm -rf "${DEST}"
ditto "${APP_SRC}" "${DEST}"

# Refresh Launch Services so the .md/.mdx file association + `open -a` routing
# pick up this build.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "${DEST}" >/dev/null 2>&1 || true

# Install the `hmd` CLI onto PATH.
BIN=""
for d in /usr/local/bin "$HOME/.local/bin"; do
  if [[ -d "$d" && -w "$d" ]]; then BIN="$d"; break; fi
done
if [[ -z "${BIN}" ]]; then
  mkdir -p "$HOME/.local/bin"
  BIN="$HOME/.local/bin"
fi
cp scripts/hmd "${BIN}/hmd"
chmod +x "${BIN}/hmd"
echo "▸ Installed hmd CLI → ${BIN}/hmd"
case ":$PATH:" in
  *":${BIN}:"*) ;;
  *) echo "  Note: ${BIN} is not on your PATH — add it to use \`hmd\`." ;;
esac

VERSION="$(/usr/bin/defaults read "${DEST}/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
echo "▸ Launching…"
open "${DEST}"

echo "✓ Installed ${APP_NAME} ${VERSION:+v$VERSION} → ${DEST}"
