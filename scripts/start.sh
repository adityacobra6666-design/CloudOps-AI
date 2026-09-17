#!/usr/bin/env bash
set -e

# ========================================================
# CloudOps AI — One Command Full Startup Script
# ========================================================

BOLD="\031[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

echo -e "${BLUE}========================================================${NC}"
echo -e "${BOLD}🚀 CloudOps AI — Starting Platform & Kubernetes Infrastructure${NC}"
echo -e "${BLUE}========================================================${NC}"

# 1. CHECK DOCKER
echo -e "\n${YELLOW}[CloudOps] Checking Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Error: Docker is not installed or not in PATH.${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Error: Docker daemon is not running. Please start Docker and retry.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker is running.${NC}"

# 2. CHECK MINIKUBE & KUBECTL
echo -e "\n${YELLOW}[CloudOps] Checking Minikube & kubectl...${NC}"
if ! command -v minikube &> /dev/null; then
    echo -e "${RED}❌ Error: Minikube is not installed or not in PATH.${NC}"
    exit 1
fi

if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}❌ Error: kubectl is not installed or not in PATH.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Minikube and kubectl are installed.${NC}"

# 3. CHECK AND START MINIKUBE IF NEEDED
echo -e "\n${YELLOW}[CloudOps] Checking Minikube cluster status...${NC}"
MINIKUBE_STATUS=$(minikube status --profile minikube 2>&1 || true)

if echo "$MINIKUBE_STATUS" | grep -q "host: Running" && echo "$MINIKUBE_STATUS" | grep -q "apiserver: Running"; then
    echo -e "${GREEN}✅ Minikube is already running.${NC}"
else
    echo -e "${YELLOW}⏳ Starting Minikube cluster (driver: docker)...${NC}"
    # Temporarily stop server container if running to prevent minikube IP conflicts during startup
    docker stop cloudops-server &> /dev/null || true
    minikube start --profile minikube --driver=docker
fi

# 4. WAIT FOR KUBERNETES TO BECOME READY
echo -e "\n${YELLOW}[CloudOps] Waiting for Kubernetes cluster to be Ready...${NC}"
K8S_READY=false
MAX_K8S_WAIT=60
K8S_WAIT=0

while [ $K8S_WAIT -lt $MAX_K8S_WAIT ]; do
    NODE_STATUS=$(kubectl get nodes --no-headers 2>&1 | awk '{print $2}' || true)
    if [ "$NODE_STATUS" = "Ready" ]; then
        K8S_READY=true
        break
    fi
    sleep 3
    K8S_WAIT=$((K8S_WAIT + 3))
    echo -e "   Waiting for node status 'Ready'... (${K8S_WAIT}s/${MAX_K8S_WAIT}s)"
done

if [ "$K8S_READY" = "true" ]; then
    echo -e "${GREEN}✅ Kubernetes cluster is Ready (Context: $(kubectl config current-context)).${NC}"
else
    echo -e "${RED}❌ Error: Kubernetes cluster did not become Ready within ${MAX_K8S_WAIT} seconds.${NC}"
    exit 1
fi

# 5. START DOCKER COMPOSE INFRASTRUCTURE
echo -e "\n${YELLOW}[CloudOps] Starting Docker Compose services...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"
docker compose up -d

# 6. WAIT FOR BACKEND & SERVICES TO BECOME HEALTHY
echo -e "\n${YELLOW}[CloudOps] Waiting for backend server to respond...${NC}"
BACKEND_HEALTHY=false
MAX_HTTP_WAIT=45
HTTP_WAIT=0

while [ $HTTP_WAIT -lt $MAX_HTTP_WAIT ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health || true)
    if [ "$HTTP_CODE" = "200" ]; then
        BACKEND_HEALTHY=true
        break
    fi
    sleep 3
    HTTP_WAIT=$((HTTP_WAIT + 3))
    echo -e "   Waiting for http://localhost:5000/health... (${HTTP_WAIT}s/${MAX_HTTP_WAIT}s)"
done

if [ "$BACKEND_HEALTHY" = "true" ]; then
    echo -e "${GREEN}✅ CloudOps backend is running and healthy.${NC}"
else
    echo -e "${RED}❌ Warning: CloudOps backend health check did not return HTTP 200 within ${MAX_HTTP_WAIT}s.${NC}"
fi

# 7. VERIFY BACKEND KUBERNETES CONNECTIVITY
echo -e "\n${YELLOW}[CloudOps] Verifying backend Kubernetes connectivity...${NC}"
K8S_BACKEND_STATUS=$(docker exec cloudops-server node -e "
const { kubernetesService } = require('./src/services/kubernetes/kubernetes.service');
kubernetesService.getClusterStatus()
    .then(s => console.log(JSON.stringify(s)))
    .catch(e => console.log(JSON.stringify({ connected: false, error: e.message })));
" 2>&1 || true)

if echo "$K8S_BACKEND_STATUS" | grep -q '"connected":true'; then
    echo -e "${GREEN}✅ CloudOps backend is successfully connected to Kubernetes cluster.${NC}"
else
    echo -e "${RED}⚠️  Kubernetes cluster is running, but CloudOps backend cannot connect to the Kubernetes API.${NC}"
    echo -e "    Diagnostic info: $K8S_BACKEND_STATUS"
fi

# 8. PRINT STARTUP SUMMARY
echo -e "\n${BLUE}========================================================${NC}"
echo -e "${BOLD}🎉 CloudOps AI Platform is Ready!${NC}"
echo -e "${BLUE}========================================================${NC}"
echo -e "  🌐 Frontend Web App:     ${GREEN}http://localhost:5173${NC}"
echo -e "  ☸️  Kubernetes Dashboard: ${GREEN}http://localhost:5173/kubernetes${NC}"
echo -e "  📊 Observability:        ${GREEN}http://localhost:5173/observability${NC}"
echo -e "  ⚙️  Backend API:          ${GREEN}http://localhost:5000${NC}"
echo -e "  📈 Prometheus:           ${GREEN}http://localhost:9090${NC}"
echo -e "  🎨 Grafana:              ${GREEN}http://localhost:3000${NC}"
echo -e "  🔔 Alertmanager:         ${GREEN}http://localhost:9093${NC}"
echo -e "  🦙 Ollama AI:            ${GREEN}http://localhost:11434${NC}"
echo -e "  🍃 MongoDB:              ${GREEN}localhost:27017${NC}"
echo -e "${BLUE}========================================================${NC}\n"
