#!/usr/bin/env bash
# PayWork Local Setup Script
# Registers the PayWork plugin with your local Canopy node and starts everything.
#
# Prerequisites:
#   - Canopy node binary installed (https://github.com/canopy-network/canopy)
#   - Go 1.21+
#   - Node.js 18+
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}"
echo "  ██████╗  █████╗ ██╗   ██╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗"
echo "  ██╔══██╗██╔══██╗╚██╗ ██╔╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝"
echo "  ██████╔╝███████║ ╚████╔╝ ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ "
echo "  ██╔═══╝ ██╔══██║  ╚██╔╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ "
echo "  ██║     ██║  ██║   ██║   ╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗"
echo "  ╚═╝     ╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝"
echo ""
echo "  Onchain Freelance Escrow on Canopy — powered by CNPY"
echo -e "${RESET}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Step 1: Check prerequisites ───────────────────────────────────────────────
echo -e "${BOLD}[1/5] Checking prerequisites...${RESET}"

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "  ${YELLOW}⚠  $1 not found — please install it and re-run.${RESET}"
    exit 1
  fi
  echo -e "  ✓ $1 found"
}

check_cmd canopy
check_cmd go
check_cmd node
check_cmd npm

# ── Step 2: Initialise Canopy node (if first run) ─────────────────────────────
echo -e "\n${BOLD}[2/5] Initialising Canopy node...${RESET}"
CANOPY_HOME="${CANOPY_HOME:-$HOME/.canopy}"

if [ ! -d "$CANOPY_HOME/config" ]; then
  echo "  Creating new Canopy node at $CANOPY_HOME..."
  canopy init paywork-local --chain-id paywork-local-1 --home "$CANOPY_HOME"
  echo "  ✓ Node initialised"
else
  echo "  ✓ Using existing node at $CANOPY_HOME"
fi

# ── Step 3: Register the PayWork plugin ───────────────────────────────────────
echo -e "\n${BOLD}[3/5] Registering PayWork plugin...${RESET}"

PLUGIN_DEST="$CANOPY_HOME/plugins/paywork"
mkdir -p "$PLUGIN_DEST"

# Copy plugin source to node's plugin directory
cp -r "$SCRIPT_DIR/plugin/"* "$PLUGIN_DEST/"

# Add plugin import to node main.go if not already there
MAIN_GO="$CANOPY_HOME/main.go"
if [ -f "$MAIN_GO" ]; then
  if ! grep -q "paywork" "$MAIN_GO"; then
    sed -i 's/^import (/import (\n\t_ "github.com\/your-org\/paywork\/plugin"/' "$MAIN_GO"
    echo "  ✓ Plugin import added to main.go"
  else
    echo "  ✓ Plugin already registered"
  fi
fi

# Build the plugin
echo "  Building plugin..."
cd "$PLUGIN_DEST"
go build ./... && echo "  ✓ Plugin compiled successfully"
cd "$SCRIPT_DIR"

# ── Step 4: Start Canopy node ─────────────────────────────────────────────────
echo -e "\n${BOLD}[4/5] Starting Canopy node...${RESET}"
echo "  Query RPC  → http://localhost:50002"
echo "  TX RPC     → http://localhost:50003"
echo "  Explorer   → http://localhost:9000"
echo ""

# Start node in background with dev mode
canopy start \
  --home "$CANOPY_HOME" \
  --rpc.query-port 50002 \
  --rpc.tx-port 50003 \
  --dev-mode \
  --log-level info \
  &>/tmp/canopy-node.log &

CANOPY_PID=$!
echo "  Node started (PID $CANOPY_PID) — logs at /tmp/canopy-node.log"

# Wait for node to be ready
echo -n "  Waiting for node to come online..."
for i in {1..30}; do
  if curl -sf http://localhost:50002/health &>/dev/null; then
    echo -e " ${GREEN}online!${RESET}"
    break
  fi
  sleep 1
  echo -n "."
done

# ── Step 5: Start frontend ────────────────────────────────────────────────────
echo -e "\n${BOLD}[5/5] Starting PayWork frontend...${RESET}"
cd "$SCRIPT_DIR/frontend"
npm install --silent
echo "  ✓ Dependencies installed"
echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${GREEN}  PayWork is running!${RESET}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Frontend    → ${CYAN}http://localhost:3000${RESET}"
echo -e "  Query RPC   → ${CYAN}http://localhost:50002${RESET}"
echo -e "  TX RPC      → ${CYAN}http://localhost:50003${RESET}"
echo -e "  Node logs   → /tmp/canopy-node.log"
echo ""
echo -e "  Press Ctrl+C to stop everything."
echo ""

# Trap to kill node when frontend exits
trap "kill $CANOPY_PID 2>/dev/null; echo 'Stopped.'" EXIT

# Start frontend (foreground)
npm run dev -- --port 3000
