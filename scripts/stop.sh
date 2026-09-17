#!/usr/bin/env bash
set -e

# ========================================================
# CloudOps AI — Stop Platform Script
# ========================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
BLUE="\033[0;34m"
NC="\033[0m"

echo -e "${BLUE}========================================================${NC}"
echo -e "${BOLD}🛑 Stopping CloudOps AI Platform${NC}"
echo -e "${BLUE}========================================================${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo -e "\n${YELLOW}[CloudOps] Stopping Docker Compose services...${NC}"
docker compose stop

echo -e "\n${GREEN}✅ CloudOps AI Docker services stopped successfully.${NC}"
echo -e "${BLUE}ℹ️  Minikube cluster is preserved and kept running/paused.${NC}"
echo -e "   To start CloudOps AI again: ${BOLD}./scripts/start.sh${NC}\n"
