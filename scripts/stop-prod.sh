#!/usr/bin/env bash
set -euo pipefail

# ========================================================
# CloudOps AI — Stop Production Services
# ========================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
BLUE="\033[0;34m"
NC="\033[0m"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}========================================================${NC}"
echo -e "${BOLD}🛑 Stopping CloudOps AI Production Services${NC}"
echo -e "${BLUE}========================================================${NC}"

cd "$ROOT_DIR"
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop

echo -e "\n${GREEN}✅ CloudOps AI production services stopped.${NC}"
echo -e "${BLUE}ℹ️  Persistent volumes (MongoDB, Ollama, Prometheus, Grafana) are preserved.${NC}\n"
