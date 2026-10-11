#!/usr/bin/env bash
set -euo pipefail

# ========================================================
# CloudOps AI — Production Deployment Script
# ========================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}========================================================${NC}"
echo -e "${BOLD}🚀 CloudOps AI — Production Deployment${NC}"
echo -e "${BLUE}========================================================${NC}"

cd "$ROOT_DIR"

# 1. VERIFY DOCKER & DOCKER COMPOSE
echo -e "\n${YELLOW}[1/6] Checking Docker environment...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Fatal: Docker is not installed or not in PATH.${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Fatal: Docker daemon is not running.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker is active and available.${NC}"

# 2. VALIDATE ENVIRONMENT FILE
echo -e "\n${YELLOW}[2/6] Validating environment configuration...${NC}"
if [ ! -f "server/.env" ]; then
    if [ -f "server/.env.example" ]; then
        echo -e "${YELLOW}⚠️  server/.env not found. Creating from server/.env.example...${NC}"
        cp server/.env.example server/.env
        echo -e "${YELLOW}⚠️  Please configure production secrets in server/.env if needed.${NC}"
    else
        echo -e "${RED}❌ Fatal: server/.env and server/.env.example are missing.${NC}"
        exit 1
    fi
fi

# Check required variables in server/.env
ENV_CONTENT=$(cat server/.env)
if ! echo "$ENV_CONTENT" | grep -qE "^(MONGO_URI|MONGODB_URI)="; then
    echo -e "${RED}❌ Fatal: Neither MONGO_URI nor MONGODB_URI is defined in server/.env.${NC}"
    exit 1
fi

if ! echo "$ENV_CONTENT" | grep -qE "^JWT_SECRET=" || echo "$ENV_CONTENT" | grep -qE "^JWT_SECRET=your_jwt_secret_here"; then
    echo -e "${YELLOW}⚠️  Warning: JWT_SECRET appears to use a default or unset value. Generate a strong key for production.${NC}"
fi
echo -e "${GREEN}✅ Environment configuration validated.${NC}"

# 3. COMPOSE CONFIGURATION VALIDATION
echo -e "\n${YELLOW}[3/6] Validating Docker Compose configuration...${NC}"
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
echo -e "${GREEN}✅ Docker Compose configuration syntax is valid.${NC}"

# 4. BUILD AND START SERVICES
echo -e "\n${YELLOW}[4/6] Building and launching production containers...${NC}"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 5. WAIT FOR SERVICES & HEALTH VERIFICATION
PUBLIC_PORT="${CLOUDOPS_PUBLIC_PORT:-80}"
echo -e "\n${YELLOW}[5/6] Waiting for services to become healthy (HTTP Port: ${PUBLIC_PORT})...${NC}"

# Wait for backend health
BACKEND_HEALTHY=false
MAX_RETRIES=30
RETRY=0

while [ $RETRY -lt $MAX_RETRIES ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/health || true)
    if [ "$HTTP_CODE" = "200" ]; then
        BACKEND_HEALTHY=true
        break
    fi
    sleep 2
    RETRY=$((RETRY + 1))
    echo -e "   Waiting for backend http://127.0.0.1:5000/health (${RETRY}/${MAX_RETRIES})..."
done

if [ "$BACKEND_HEALTHY" != "true" ]; then
    echo -e "${RED}❌ Error: Backend failed healthcheck within timeout.${NC}"
    echo -e "   Check container logs using: docker compose -f docker-compose.yml -f docker-compose.prod.yml logs server"
    exit 1
fi
echo -e "${GREEN}✅ Backend service is healthy.${NC}"

# Wait for frontend reverse proxy
FRONTEND_OK=false
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PUBLIC_PORT}/" || true)
    if [ "$HTTP_CODE" = "200" ]; then
        FRONTEND_OK=true
        break
    fi
    sleep 2
    RETRY=$((RETRY + 1))
    echo -e "   Waiting for frontend on port ${PUBLIC_PORT} (${RETRY}/${MAX_RETRIES})..."
done

if [ "$FRONTEND_OK" != "true" ]; then
    echo -e "${YELLOW}⚠️  Notice: Public HTTP port ${PUBLIC_PORT} did not respond with 200 within timeout.${NC}"
    echo -e "   Check if port ${PUBLIC_PORT} requires root/sudo privileges or if CLOUDOPS_PUBLIC_PORT is set to another port."
else
    echo -e "${GREEN}✅ Frontend and API reverse proxy are responding on port ${PUBLIC_PORT}.${NC}"
fi

# 6. SUMMARY
echo -e "\n${BLUE}========================================================${NC}"
echo -e "${BOLD}🎉 CloudOps AI Production Deployment Complete!${NC}"
echo -e "${BLUE}========================================================${NC}"
echo -e "  🌐 Public Web Dashboard:    ${GREEN}http://localhost:${PUBLIC_PORT}${NC} (or http://<YOUR_SERVER_IP>:${PUBLIC_PORT})"
echo -e "  ⚙️  Backend Health Check:    ${GREEN}http://127.0.0.1:5000/health${NC}"
echo -e "  🔒 Internal Protected Ports:"
echo -e "     • Backend API:           127.0.0.1:5000 (proxied via /api on port ${PUBLIC_PORT})"
echo -e "     • Prometheus:            127.0.0.1:9090 (localhost only)"
echo -e "     • Grafana:               127.0.0.1:3000 (localhost only)"
echo -e "     • Alertmanager:          127.0.0.1:9093 (localhost only)"
echo -e "     • Ollama AI:             127.0.0.1:11434 (localhost only)"
echo -e "     • MongoDB:               127.0.0.1:27017 (localhost only)"
echo -e "${BLUE}========================================================${NC}\n"
