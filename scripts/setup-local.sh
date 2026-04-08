#!/bin/bash
set -e

# ─── Non-interactive detection ───────────────────────────────────────
if [ ! -t 0 ]; then
  NON_INTERACTIVE=true
else
  NON_INTERACTIVE=false
fi

# ─── Colors (disabled when piped / non-interactive) ──────────────────
if [ "$NON_INTERACTIVE" = true ]; then
  BOLD='' DIM='' GREEN='' YELLOW='' RED='' CYAN='' NC=''
else
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  CYAN='\033[0;36m'
  NC='\033[0m'
fi

step() { echo -e "\n${BOLD}${CYAN}[$1]${NC} $2"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${DIM}$1${NC}"; }

# ─── Resolve paths ───────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

echo ""
echo -e "${BOLD}Praxis2 — Local Development Setup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ═════════════════════════════════════════════════════════════════════
# 1/7  Prerequisites
# ═════════════════════════════════════════════════════════════════════
step "1/7" "Checking prerequisites..."

MISSING=()

check_tool() {
  local name="$1" install_hint="$2"
  if command -v "$name" &> /dev/null; then
    ok "$name $(command -v "$name")"
  else
    MISSING+=("  $name  →  $install_hint")
  fi
}

check_tool "node"   "https://nodejs.org (v18+)"
check_tool "pnpm"   "corepack enable && corepack prepare pnpm@latest --activate"
check_tool "docker" "https://docker.com/products/docker-desktop"

if [ ${#MISSING[@]} -gt 0 ]; then
  err "Missing required tools:"
  for m in "${MISSING[@]}"; do echo -e "$m"; done
  echo ""
  echo "  Install the tools above, then re-run: pnpm setup"
  exit 1
fi

# Node version check
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 required (found $(node -v))"
  exit 1
fi
ok "Node $(node -v)"

# Docker daemon check
if ! docker info &> /dev/null 2>&1; then
  err "Docker is installed but the daemon is not running"
  info "Start Docker Desktop, then re-run: pnpm setup"
  exit 1
fi
ok "Docker daemon running"

# ═════════════════════════════════════════════════════════════════════
# 2/7  Environment
# ═════════════════════════════════════════════════════════════════════
step "2/7" "Configuring environment..."

# Load existing .env if present (so we skip already-set vars)
if [ -f "$ENV_FILE" ]; then
  info "Found existing .env — only missing variables will be prompted"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# ── Helper: prompt for a variable ────────────────────────────────────
prompt_var() {
  local var_name="$1" description="$2" default="$3"
  local current_value="${!var_name}"

  if [ -n "$current_value" ]; then
    ok "$var_name already set"
    return
  fi

  if [ -n "$default" ]; then
    read -rp "  $description [$default]: " input
    eval "$var_name=\"\${input:-$default}\""
  else
    read -rp "  $description: " input
    eval "$var_name=\"\$input\""
    if [ -z "${!var_name}" ]; then
      warn "$var_name left empty"
    fi
  fi
}

prompt_secret() {
  local var_name="$1" description="$2"
  local current_value="${!var_name}"

  if [ -n "$current_value" ]; then
    ok "$var_name already set"
    return
  fi

  read -rp "  $description (Enter to skip): " input
  eval "$var_name=\"\$input\""
  if [ -z "$input" ]; then
    info "Skipped $var_name"
  else
    ok "$var_name set"
  fi
}

# ── Auto-fill from docker-compose defaults ───────────────────────────
DATABASE_URL="${DATABASE_URL:-postgresql://praxis2_user:change_me_before_use@localhost:5432/praxis2}"
PORT="${PORT:-3001}"
CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:3000}"
NODE_ENV="${NODE_ENV:-development}"
LOG_LEVEL="${LOG_LEVEL:-info}"
RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-1000}"
STORAGE_PROVIDER="${STORAGE_PROVIDER:-local}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/.praxis/workspaces}"

ok "DATABASE_URL → local PostgreSQL (from docker-compose)"
ok "Defaults: PORT=$PORT, CORS_ORIGIN=$CORS_ORIGIN"

# ── Auth0 (required, no safe defaults) ───────────────────────────────
AUTH0_NEEDED=false
for v in AUTH0_ISSUER_BASE_URL AUTH0_AUDIENCE VITE_AUTH0_DOMAIN VITE_AUTH0_CLIENT_ID VITE_AUTH0_AUDIENCE; do
  if [ -z "${!v}" ]; then AUTH0_NEEDED=true; break; fi
done

if [ "$AUTH0_NEEDED" = true ]; then
  echo ""
  echo -e "  ${BOLD}Auth0 Configuration${NC}"
  echo "  ─────────────────────────────────────────────"
  echo "  Find these at https://manage.auth0.com:"
  echo "    Domain & Client ID → Applications → your SPA → Settings"
  echo "    Audience           → Applications → APIs → Identifier"
  echo ""

  prompt_var AUTH0_ISSUER_BASE_URL "Auth0 Issuer URL (https://dev-xxx.us.auth0.com/)" ""
  prompt_var AUTH0_AUDIENCE         "Auth0 API Audience URL" ""
  prompt_var VITE_AUTH0_DOMAIN      "Auth0 Domain (dev-xxx.us.auth0.com)" ""
  prompt_var VITE_AUTH0_CLIENT_ID   "Auth0 SPA Client ID" ""
  prompt_var VITE_AUTH0_AUDIENCE    "Auth0 Audience for frontend" "${AUTH0_AUDIENCE}"
else
  ok "Auth0 already configured"
fi

# ── Optional secrets ─────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Optional Integrations${NC} (press Enter to skip)"
echo "  ─────────────────────────────────────────────"

prompt_secret ANTHROPIC_API_KEY "Anthropic API Key (worker Claude sessions)"

# ── Write .env ───────────────────────────────────────────────────────
cat > "$ENV_FILE" <<ENV
# ─── Database (local docker-compose) ─────────────────────────────────
DATABASE_URL=${DATABASE_URL}

# ─── Auth0 ───────────────────────────────────────────────────────────
AUTH0_ISSUER_BASE_URL=${AUTH0_ISSUER_BASE_URL:-}
AUTH0_AUDIENCE=${AUTH0_AUDIENCE:-}

# ─── Frontend (Vite — prefixed with VITE_) ───────────────────────────
VITE_AUTH0_DOMAIN=${VITE_AUTH0_DOMAIN:-}
VITE_AUTH0_CLIENT_ID=${VITE_AUTH0_CLIENT_ID:-}
VITE_AUTH0_AUDIENCE=${VITE_AUTH0_AUDIENCE:-}

# ─── API ─────────────────────────────────────────────────────────────
PORT=${PORT}
CORS_ORIGIN=${CORS_ORIGIN}
NODE_ENV=${NODE_ENV}
LOG_LEVEL=${LOG_LEVEL}
RATE_LIMIT_MAX=${RATE_LIMIT_MAX}

# ─── Storage ─────────────────────────────────────────────────────────
STORAGE_PROVIDER=${STORAGE_PROVIDER}
WORKSPACE_ROOT=${WORKSPACE_ROOT}

# ─── Optional ────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
ENV

ok "Wrote .env"

# ═════════════════════════════════════════════════════════════════════
# 3/7  Install dependencies
# ═════════════════════════════════════════════════════════════════════
step "3/7" "Installing dependencies..."

cd "$REPO_ROOT"
if [ -f "$REPO_ROOT/pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile 2>&1 | tail -3
else
  pnpm install 2>&1 | tail -3
fi

ok "Dependencies installed"

# ═════════════════════════════════════════════════════════════════════
# 4/7  Start PostgreSQL
# ═════════════════════════════════════════════════════════════════════
step "4/7" "Starting PostgreSQL..."

cd "$REPO_ROOT"
docker compose up -d 2>&1

info "Waiting for PostgreSQL to accept connections..."
RETRIES=30
until docker compose exec -T postgres pg_isready -U praxis2_user -d praxis2 &> /dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    err "PostgreSQL did not become ready within 30s"
    info "Check: docker compose logs postgres"
    exit 1
  fi
  sleep 1
done

ok "PostgreSQL ready on localhost:5432"

# ═════════════════════════════════════════════════════════════════════
# 5/7  Build packages
# ═════════════════════════════════════════════════════════════════════
step "5/7" "Building packages..."

cd "$REPO_ROOT"
pnpm build 2>&1 | tail -5

ok "Build complete"

# ═════════════════════════════════════════════════════════════════════
# 6/7  Run migrations
# ═════════════════════════════════════════════════════════════════════
step "6/7" "Running database migrations..."

cd "$REPO_ROOT"
pnpm db:migrate 2>&1 | tail -3

ok "Database schema up to date"

# ═════════════════════════════════════════════════════════════════════
# 7/7  Done
# ═════════════════════════════════════════════════════════════════════
step "7/7" "Setup complete!"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Services:"
info "  PostgreSQL  → localhost:5432 (Docker)"
info "  API         → http://localhost:3001"
info "  Web         → http://localhost:3000"
info "  Worker      → background processor"
echo ""

# Warnings for missing config
if [ -z "${AUTH0_ISSUER_BASE_URL:-}" ] || [ -z "${VITE_AUTH0_CLIENT_ID:-}" ]; then
  warn "Auth0 not fully configured — auth will not work until .env is updated"
  echo ""
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  info "ANTHROPIC_API_KEY not set — worker Claude sessions disabled"
  echo ""
fi

echo -e "  ${BOLD}Start developing:${NC}"
echo ""
echo "      pnpm dev"
echo ""
echo -e "  ${BOLD}Other commands:${NC}"
echo ""
echo "      pnpm db:studio     Open Drizzle Studio (DB browser)"
echo "      pnpm db:seed       Seed sample data"
echo "      pnpm test          Run tests"
echo "      pnpm build         Production build"
echo ""
echo ""
