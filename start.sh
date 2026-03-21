#!/usr/bin/env bash
# Vorra Quick Start — macOS/Linux
# Equivalent of start.ps1 for Unix systems
set -e

# ── Resolve project root ──
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/start-log.txt"

# ── Detect OS ──
OS_NAME="unknown"
case "$(uname -s)" in
  Darwin*) OS_NAME="macOS" ;;
  Linux*)  OS_NAME="Linux" ;;
  *)       OS_NAME="$(uname -s)" ;;
esac

# ── Color helpers ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'
CHK='\xe2\x9c\x94'
CROSS='\xe2\x9c\x98'

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S.%3N' 2>/dev/null || date '+%H:%M:%S')" "$1" >> "$LOG"
}

pass() {
  printf "   ${GREEN}${CHK}  %s${NC}\n" "$1"
  log "OK: $1"
}

fail() {
  printf "   ${RED}${CROSS}  %s${NC}\n" "$1"
  log "FAIL: $1"
}

# ── Error trap ──
on_error() {
  printf "\n   ${RED}${CROSS}  An unexpected error occurred on line %s${NC}\n" "$1"
  printf "   ${RED}   Check start-log.txt for details${NC}\n\n"
  log "=== UNEXPECTED ERROR on line $1 ==="
  exit 1
}
trap 'on_error $LINENO' ERR

# ── Start log ──
printf '[%s] Quick Start\nRoot: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$ROOT" > "$LOG"

# Read version from package.json (single source of truth)
APP_VERSION="$(node -e "try{console.log(require('./package.json').version)}catch(e){console.log('?')}" 2>/dev/null || echo '?')"

clear 2>/dev/null || true
printf '\n'

# ── ASCII Banner ──
printf "${GREEN}"
cat << 'BANNER'
 █████   █████
░░███   ░░███
 ░███    ░███   ██████  ████████  ████████   ██████
 ░███    ░███  ███░░███░░███░░███░░███░░███ ░░░░░███
 ░░███   ███  ░███ ░███ ░███ ░░░  ░███ ░░░   ███████
  ░░░█████░   ░███ ░███ ░███      ░███      ███░░███
    ░░███     ░░██████  █████     █████    ░░████████
     ░░░       ░░░░░░  ░░░░░     ░░░░░      ░░░░░░░░
BANNER
printf "${NC}\n"
printf "   ${GRAY}AI-Powered Study & Life Planner                                 v${APP_VERSION}${NC}\n"
printf "   ${GRAY}========================================================================${NC}\n\n"

# ── Check Node.js ──
if ! command -v node > /dev/null 2>&1; then
  fail "Node.js not found — run ./setup.sh first"
  exit 1
fi
pass "Node.js $(node -v 2>/dev/null)"

# ── Check Electron ──
if [ "$OS_NAME" = "macOS" ]; then
  ELECTRON_BIN="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
else
  ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"
fi

if [ ! -e "$ROOT/node_modules/electron" ]; then
  fail "Dependencies missing — run ./setup.sh first"
  exit 1
fi
pass "Electron"

# ── Non-blocking check for available updates ──
if command -v git > /dev/null 2>&1 && [ -d "$ROOT/.git" ]; then
  FETCH_OUT="$(git -C "$ROOT" fetch --dry-run 2>&1 || true)"
  if [ -n "$FETCH_OUT" ]; then
    printf "   ${YELLOW}!  Updates may be available — run: git pull && ./setup.sh${NC}\n"
    log "Updates available"
  fi
fi

# ── Check build / rebuild if needed ──
DIST_FILE="$ROOT/dist/index.html"
REBUILD=false

if [ ! -f "$DIST_FILE" ]; then
  REBUILD=true
else
  # Check if any src/ file is newer than dist/index.html
  NEWER="$(find "$ROOT/src" -type f -newer "$DIST_FILE" 2>/dev/null | head -1)"
  if [ -n "$NEWER" ]; then
    REBUILD=true
  fi
fi

if [ "$REBUILD" = true ]; then
  printf "   ${YELLOW}!  Build outdated — rebuilding...${NC}\n"
  log "Rebuilding"
  cd "$ROOT"
  EXIT_CODE=0
  npx vite build >> "$LOG" 2>&1 || EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    fail "Build failed (exit $EXIT_CODE)"
    exit 1
  fi
  pass "Rebuilt"
else
  pass "Build current"
fi

# ── Launch ──
printf '\n'

# Brief spinner
SPIN_CHARS='|/-\'
for r in 1 2; do
  for i in 0 1 2 3; do
    c="${SPIN_CHARS:$i:1}"
    printf "\r   ${GREEN}%s${NC}  Starting Vorra..." "$c"
    sleep 0.05
  done
done
printf "\r   ${GREEN}${CHK}  Launching!              ${NC}\n"

printf '\n'
printf "   ${GREEN}========================================================================${NC}\n"
printf "    ${GREEN}${CHK}  All checks passed${NC}\n"
printf "   ${GREEN}========================================================================${NC}\n"
printf '\n'

log "Launching Electron"

# Launch Electron in background
if [ -x "$ELECTRON_BIN" ]; then
  "$ELECTRON_BIN" "$ROOT" >> "$LOG" 2>&1 &
else
  cd "$ROOT"
  npx electron . >> "$LOG" 2>&1 &
fi

# Brief countdown
for i in 3 2 1; do
  printf "\r   ${GRAY}Closing in %d...  ${NC}" "$i"
  sleep 1
done
printf '\n'
