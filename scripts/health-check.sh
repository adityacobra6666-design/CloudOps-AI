#!/usr/bin/env bash
set -euo pipefail

# ========================================================
# CloudOps AI — Health & Verification Script
# ========================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

PUBLIC_PORT="${CLOUDOPS_PUBLIC_PORT:-80}"

echo -e "${BLUE}========================================================${NC}"
echo -e "${BOLD}🏥 CloudOps AI — Production Health Check${NC}"
echo -e "${BLUE}========================================================${NC}"

ALL_HEALTHY=true

# 1. CHECK BACKEND DIRECT HEALTH
echo -e "\n${YELLOW}[1/4] Checking Backend API (/health)...${NC}"
HEALTH_JSON=$(curl -sf http://127.0.0.1:5000/health || true)

if [ -n "$HEALTH_JSON" ] && echo "$HEALTH_JSON" | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✅ Backend status: HEALTHY${NC}"
    echo -e "   Response: $HEALTH_JSON"
else
    echo -e "${RED}❌ Backend status: UNHEALTHY or UNREACHABLE${NC}"
    ALL_HEALTHY=false
fi

# 2. CHECK FRONTEND REVERSE PROXY
echo -e "\n${YELLOW}[2/4] Checking Frontend HTTP (Port ${PUBLIC_PORT})...${NC}"
FRONTEND_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PUBLIC_PORT}/" || true)

if [ "$FRONTEND_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Frontend Nginx: HTTP 200 OK${NC}"
else
    echo -e "${RED}❌ Frontend Nginx: HTTP ${FRONTEND_CODE} (Port ${PUBLIC_PORT})${NC}"
    ALL_HEALTHY=false
fi

# 3. CHECK API PROXY THROUGH NGINX
echo -e "\n${YELLOW}[3/4] Checking /api/health through Nginx Reverse Proxy...${NC}"
PROXY_HEALTH=$(curl -sf "http://localhost:${PUBLIC_PORT}/api/health" || true)

if [ -n "$PROXY_HEALTH" ] && echo "$PROXY_HEALTH" | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✅ API Reverse Proxy: Operational (Same-Origin routing works)${NC}"
else
    echo -e "${RED}❌ API Reverse Proxy: Failed to proxy /api/health${NC}"
    ALL_HEALTHY=false
fi

# 4. CHECK PROMETHEUS TARGETS
echo -e "\n${YELLOW}[4/4] Checking Prometheus Telemetry Pipeline...${NC}"
PROM_TARGETS=$(curl -sf http://127.0.0.1:9090/api/v1/targets || true)

if [ -n "$PROM_TARGETS" ] && echo "$PROM_TARGETS" | grep -q '"health":"up"'; then
    UP_COUNT=$(echo "$PROM_TARGETS" | grep -o '"health":"up"' | wc -l)
    echo -e "${GREEN}✅ Prometheus: Collecting metrics (${UP_COUNT} active scrape targets UP)${NC}"
else
    echo -e "${YELLOW}⚠️  Prometheus: Targets not accessible or unavailable${NC}"
fi

echo -e "\n${BLUE}========================================================${NC}"
if [ "$ALL_HEALTHY" = "true" ]; then
    echo -e "${GREEN}${BOLD}🎉 Overall System Health: PASSING${NC}"
    echo -e "${BLUE}========================================================${NC}\n"
    exit 0
else
    echo -e "${RED}${BOLD}❌ Overall System Health: ISSUES DETECTED${NC}"
    echo -e "${BLUE}========================================================${NC}\n"
    exit 1
fi
