#!/usr/bin/env bash
set -euo pipefail

# ========================================================
# CloudOps AI — Production Status Script
# ========================================================

BOLD="\033[1m"
BLUE="\033[0;34m"
NC="\033[0m"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}========================================================${NC}"
echo -e "${BOLD}📊 CloudOps AI — Service Status${NC}"
echo -e "${BLUE}========================================================${NC}"

cd "$ROOT_DIR"
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

echo -e "\n${BLUE}========================================================${NC}"
echo -e "${BOLD}🔍 Active Network Listening Ports (CloudOps Containers)${NC}"
echo -e "${BLUE}========================================================${NC}"
docker ps --filter "name=cloudops-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
