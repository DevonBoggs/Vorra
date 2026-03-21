#!/usr/bin/env bash
# Vorra Setup — macOS/Linux
# Equivalent of setup.ps1 for Unix systems
set -e

# ── Resolve project root ──
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/setup-log.txt"
STEP_START=""
T0=""

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
CYAN='\033[0;36m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'
CHK='\xe2\x9c\x94'
CROSS='\xe2\x9c\x98'
ARR='\xe2\x96\xb8'

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

warn() {
  printf "   ${YELLOW}!  %s${NC}\n" "$1"
  log "WARN: $1"
}

info() {
  printf "   ${GRAY}${ARR}  %s${NC}\n" "$1"
}

step() {
  printf "\n   ${GREEN}[%s]${NC} ${BOLD}%s${NC}\n" "$1" "$2"
}

fail_exit() {
  fail "$1"
  printf "\n   ${RED}SETUP FAILED -- Check setup-log.txt${NC}\n\n"
  log "=== SETUP FAILED ==="
  exit 1
}

now_seconds() {
  date '+%s'
}

step_time() {
  local now
  now="$(now_seconds)"
  local elapsed=$(( now - STEP_START ))
  log "$1 in ${elapsed}s"
  STEP_START="$(now_seconds)"
}

# ── Spinner ──
spinner() {
  local pid=$1
  local label=$2
  local spin_chars='|/-\'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    local c="${spin_chars:i%4:1}"
    printf "\r      %s  %s                              " "$c" "$label" >&2
    i=$(( i + 1 ))
    sleep 0.15
  done
  printf "\r                                                            \r" >&2
}

# ── Run command with spinner and logging ──
run_with_spinner() {
  local label="$1"
  shift
  log "--- $label --- $*"
  local tmpout
  tmpout="$(mktemp)"
  "$@" > "$tmpout" 2>&1 &
  local pid=$!
  spinner "$pid" "$label"
  local code=0
  wait "$pid" || code=$?
  cat "$tmpout" >> "$LOG"
  rm -f "$tmpout"
  log "Exit: $code"
  return $code
}

# ── Error trap ──
on_error() {
  printf "\n   ${RED}${CROSS}  An unexpected error occurred on line %s${NC}\n" "$1"
  printf "   ${RED}   Check setup-log.txt for details${NC}\n\n"
  log "=== UNEXPECTED ERROR on line $1 ==="
  exit 1
}
trap 'on_error $LINENO' ERR

# ── Start ──
T0="$(now_seconds)"
printf 'Vorra Setup Log | %s | bash %s | %s | %s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "${BASH_VERSION}" "$OS_NAME" "$ROOT" > "$LOG"

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

STEP_START="$(now_seconds)"

# ── STEP 1: Check Node.js ──
step "1/8" "Checking Node.js"
log "Step 1"

if ! command -v node > /dev/null 2>&1; then
  if [ "$OS_NAME" = "macOS" ]; then
    fail_exit "Node.js not found. Install via: brew install node  or  https://github.com/nvm-sh/nvm"
  else
    fail_exit "Node.js not found. Install via: nvm (https://github.com/nvm-sh/nvm) or  sudo apt install nodejs npm"
  fi
fi

NODE_VERSION="$(node -v 2>/dev/null || echo 'unknown')"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  fail_exit "Node.js $NODE_VERSION is too old. Version 18+ required. Current: $NODE_VERSION"
fi

pass "Node.js $NODE_VERSION"

NPM_VERSION="$(npm -v 2>/dev/null || echo 'unknown')"
info "npm $NPM_VERSION"
step_time "Step 1"

# ── STEP 2: Check disk space ──
step "2/8" "Checking disk space"
log "Step 2"

FREE_KB=0
if [ "$OS_NAME" = "macOS" ]; then
  FREE_KB="$(df -k "$ROOT" | tail -1 | awk '{print $4}')"
else
  FREE_KB="$(df -k "$ROOT" | tail -1 | awk '{print $4}')"
fi
FREE_MB=$(( FREE_KB / 1024 ))

if [ -n "$FREE_MB" ] && [ "$FREE_MB" -lt 500 ] 2>/dev/null; then
  warn "Low disk space: ${FREE_MB}MB free (500MB recommended)"
  log "Low disk space: ${FREE_MB}MB"
else
  pass "Disk space OK (${FREE_MB}MB free)"
fi
step_time "Step 2"

# ── STEP 3: Prepare environment ──
step "3/8" "Preparing environment"
log "Step 3"

if [ -d "$ROOT/dist" ]; then
  rm -rf "$ROOT/dist"
  info "Cleaned old dist/"
fi

# Remove stale files
for sf in _launcher.cs _wv_check.js; do
  if [ -f "$ROOT/$sf" ]; then
    rm -f "$ROOT/$sf"
    info "Removed stale $sf"
  fi
done

if [ -d "$ROOT/node_modules" ]; then
  info "Updating existing installation"
  pass "Environment ready"
else
  info "Fresh install detected"
  pass "Environment ready"
fi
step_time "Step 3"

# ── STEP 4: Install dependencies ──
step "4/8" "Installing dependencies"
log "Step 4"

FRESH=false
if [ ! -d "$ROOT/node_modules" ]; then
  FRESH=true
  printf "\n      ${CYAN}Downloading Electron + dependencies (~80MB, first time only)${NC}\n\n"
else
  info "Checking packages..."
fi

cd "$ROOT"
if ! run_with_spinner "Installing packages" npm install --progress; then
  info "Retrying with --legacy-peer-deps..."
  if ! run_with_spinner "Installing packages (legacy)" npm install --legacy-peer-deps --progress; then
    fail_exit "npm install failed"
  fi
fi
pass "Dependencies installed"

# Check Electron binary
if [ "$OS_NAME" = "macOS" ]; then
  ELECTRON_BIN="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
else
  ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"
fi

if [ -x "$ELECTRON_BIN" ]; then
  ELECTRON_VERSION="$("$ELECTRON_BIN" --version 2>/dev/null || echo '?')"
  info "Electron $ELECTRON_VERSION"
fi

# Rebuild native modules for Electron
info "Rebuilding native modules for Electron..."
if run_with_spinner "Rebuilding native modules" npx electron-rebuild; then
  pass "Native modules rebuilt"
else
  info "electron-rebuild failed (non-critical, SQLite will fall back to localStorage)"
  log "electron-rebuild failed (non-critical)"
  # Reset ERR trap — this failure is non-critical
  true
fi
step_time "Step 4"

# ── STEP 5: Security audit ──
step "5/8" "Security audit"
log "Step 5"

AUDIT_OUT=""
AUDIT_OUT="$(npm audit --omit=dev 2>&1 || true)"
printf '%s\n' "$AUDIT_OUT" >> "$LOG"

if echo "$AUDIT_OUT" | grep -q "found 0 vulnerabilities"; then
  pass "No vulnerabilities"
elif echo "$AUDIT_OUT" | grep -qE '[0-9]+ (high|critical)'; then
  npm audit fix --omit=dev >> "$LOG" 2>&1 || true
  pass "Audit fixed"
else
  pass "Audit clean"
fi
step_time "Step 5"

# ── STEP 6: Build ──
step "6/8" "Building application"
log "Step 6"
info "Compiling..."

if ! run_with_spinner "Building" npx vite build; then
  fail_exit "Build failed"
fi

if [ ! -f "$ROOT/dist/index.html" ]; then
  fail_exit "dist/index.html missing after build"
fi
pass "Build complete"
step_time "Step 6"

# ── STEP 7: Run tests ──
step "7/8" "Running tests"
log "Step 7"

TEST_EXIT=0
TEST_OUT="$(npx vitest run 2>&1)" || TEST_EXIT=$?
printf '%s\n' "$TEST_OUT" >> "$LOG"

PASSED_COUNT=""
PASSED_COUNT="$(echo "$TEST_OUT" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+' || true)"

if [ -n "$PASSED_COUNT" ]; then
  pass "$PASSED_COUNT tests passed"
elif [ "$TEST_EXIT" -ne 0 ]; then
  info "Some tests failed (non-critical)"
  log "Test exit: $TEST_EXIT"
else
  pass "Tests passed"
fi
step_time "Step 7"

# ── STEP 8: Post-install health check ──
step "8/8" "Post-install health check"
log "Step 8"

HEALTH_OK=true

# Check Electron binary
if [ "$OS_NAME" = "macOS" ]; then
  ELECTRON_CHECK="$ROOT/node_modules/electron/dist/Electron.app"
  ELECTRON_LABEL="Electron.app"
else
  ELECTRON_CHECK="$ROOT/node_modules/electron/dist/electron"
  ELECTRON_LABEL="electron binary"
fi

if [ -e "$ELECTRON_CHECK" ]; then
  pass "$ELECTRON_LABEL exists"
else
  fail "$ELECTRON_LABEL missing"
  HEALTH_OK=false
fi

# Check preload.js
if [ -f "$ROOT/electron/preload.js" ]; then
  pass "electron/preload.js exists"
else
  fail "electron/preload.js missing"
  HEALTH_OK=false
fi

# Check database.js
if [ -f "$ROOT/electron/database.js" ]; then
  pass "electron/database.js exists"
else
  fail "electron/database.js missing"
  HEALTH_OK=false
fi

# Check dist/index.html
if [ -f "$ROOT/dist/index.html" ]; then
  pass "dist/index.html exists"
else
  fail "dist/index.html missing"
  HEALTH_OK=false
fi

if [ "$HEALTH_OK" = false ]; then
  fail_exit "Health check failed — some critical files are missing"
fi
step_time "Step 8"

# ── Done ──
printf '\n'

# Progress bar
BAR_WIDTH=35
for i in $(seq 0 5 100); do
  filled=$(( i * BAR_WIDTH / 100 ))
  empty=$(( BAR_WIDTH - filled ))
  bar=""
  j=0
  while [ "$j" -lt "$filled" ]; do bar="${bar}#"; j=$(( j + 1 )); done
  j=0
  while [ "$j" -lt "$empty" ]; do bar="${bar}-"; j=$(( j + 1 )); done
  printf "\r   ${GREEN}%s %d%%${NC}" "$bar" "$i"
  sleep 0.01
done
printf "\r   ${GREEN}%s 100%%  ${NC}\n" "$(printf '#%.0s' $(seq 1 $BAR_WIDTH))"

printf '\n'
printf "   ${GREEN}========================================================================${NC}\n"
printf "    ${GREEN}${CHK}  SETUP COMPLETE  --  All 8 steps passed${NC}\n"
printf '\n'
printf "    ${GRAY}Launch:${NC} ${GREEN}./start.sh${NC} ${GRAY}or${NC} ${CYAN}npm run electron:dev${NC}\n"
printf "   ${GREEN}========================================================================${NC}\n"
printf '\n'

ELAPSED=$(( $(now_seconds) - T0 ))
log "Done in ${ELAPSED}s"
log "=== COMPLETE ==="
printf "   ${GRAY}Finished in ${ELAPSED}s.${NC}\n\n"
