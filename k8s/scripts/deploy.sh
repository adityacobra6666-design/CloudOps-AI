#!/usr/bin/env bash
# ==============================================================================
# CloudOps AI — Minikube Backend Deployment Workflow
# ==============================================================================
# Deploys the real Node.js/Express backend into Minikube with RBAC, ConfigMap,
# Secrets, Probes, and ClusterIP Service.
#
# Works across standard shells (Bash, Fish, Zsh).
#
# Usage:
#   ./k8s/scripts/deploy.sh [OPTIONS]
#
# Options:
#   --skip-build      Skip building the Docker image and use existing local tag
#   --skip-load       Skip loading image into Minikube (if already present)
#   --with-mongo      Deploy in-cluster development MongoDB instance
#   --help            Show this help message
# ==============================================================================

set -euo pipefail

NAMESPACE="cloudops"
DEPLOYMENT="cloudops-backend"
IMAGE_TAG="cloudops-backend:local"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SKIP_BUILD=false
SKIP_LOAD=false
WITH_MONGO=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-load)
            SKIP_LOAD=true
            shift
            ;;
        --with-mongo)
            WITH_MONGO=true
            shift
            ;;
        -h|--help)
            cat <<EOF
Usage: ./k8s/scripts/deploy.sh [OPTIONS]

Options:
  --skip-build    Skip Docker image build
  --skip-load     Skip loading image into Minikube
  --with-mongo    Deploy in-cluster persistent development MongoDB
  -h, --help      Show help
EOF
            exit 0
            ;;
        *)
            echo "❌ Unknown argument: $1"
            exit 1
            ;;
    esac
done

echo "🚀 [1/7] Checking environment prerequisites..."
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is not installed or not in PATH"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl is not installed or not in PATH"; exit 1; }
command -v minikube >/dev/null 2>&1 || { echo "❌ minikube is not installed or not in PATH"; exit 1; }

MINIKUBE_STATUS=$(minikube status --format='{{.Host}}' 2>/dev/null || true)
if [[ "${MINIKUBE_STATUS}" != "Running" ]]; then
    echo "❌ Minikube is not running (Status: ${MINIKUBE_STATUS:-Stopped}). Please run: minikube start"
    exit 1
fi
echo "   ✅ Docker, kubectl, and Minikube are running."

if [[ "${SKIP_BUILD}" == "false" ]]; then
    echo "🔨 [2/7] Building backend Docker image: ${IMAGE_TAG}..."
    docker build -t "${IMAGE_TAG}" -f "${REPO_ROOT}/server/Dockerfile" "${REPO_ROOT}/server"
    echo "   ✅ Image built successfully."
else
    echo "⏩ [2/7] Skipping Docker build."
fi

if [[ "${SKIP_LOAD}" == "false" ]]; then
    echo "🚚 [3/7] Loading image into Minikube cache..."
    minikube image load "${IMAGE_TAG}"
    echo "   ✅ Image loaded into Minikube."
else
    echo "⏩ [3/7] Skipping Minikube image load."
fi

echo "📦 [4/7] Verifying namespace and secrets..."
kubectl apply -f "${REPO_ROOT}/k8s/namespace.yaml"

# Check if secret exists
if ! kubectl get secret cloudops-backend-secrets -n "${NAMESPACE}" >/dev/null 2>&1; then
    echo "⚠️  Secret 'cloudops-backend-secrets' does not exist in namespace '${NAMESPACE}'."
    echo "   Invoking secure setup script..."
    "${SCRIPT_DIR}/setup-secrets.sh"
else
    echo "   ✅ Secret 'cloudops-backend-secrets' exists."
fi

# Optional In-Cluster MongoDB deployment
if [[ "${WITH_MONGO}" == "true" ]]; then
    echo "🍃 Deploying in-cluster development MongoDB..."
    kubectl apply -f "${REPO_ROOT}/k8s/mongodb-dev.yaml"
    kubectl rollout status deployment/cloudops-mongodb -n "${NAMESPACE}" --timeout=90s
    echo "   ✅ MongoDB ready at service 'mongo:27017'."
fi

echo "📋 [5/7] Applying Kubernetes manifests (RBAC, ConfigMap, Service)..."
kubectl apply -f "${REPO_ROOT}/k8s/rbac.yaml"
kubectl apply -f "${REPO_ROOT}/k8s/configmap.yaml"
kubectl apply -f "${REPO_ROOT}/k8s/backend-service.yaml"

echo "🚢 [6/7] Deploying CloudOps AI Express backend..."
kubectl apply -f "${REPO_ROOT}/k8s/backend-deployment.yaml"

echo "⏳ Waiting for deployment rollout..."
if kubectl rollout status deployment/"${DEPLOYMENT}" -n "${NAMESPACE}" --timeout=120s; then
    echo "   ✅ Backend deployment rolled out successfully!"
else
    echo "❌ Deployment rollout timed out. Checking pod diagnostics..."
    kubectl get pods -n "${NAMESPACE}" -l app=cloudops-backend
    kubectl logs -n "${NAMESPACE}" -l app=cloudops-backend --tail=30
    exit 1
fi

echo "🩺 [7/7] Verifying backend health..."
READY_POD=$(kubectl get pods -n "${NAMESPACE}" -l app=cloudops-backend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)

if [[ -n "${READY_POD}" ]]; then
    echo "   Pod '${READY_POD}' is running."
    # Test internal /health endpoint via port-forward or exec
    echo "   Checking /health status inside pod..."
    HEALTH_OUTPUT=$(kubectl exec -n "${NAMESPACE}" "${READY_POD}" -- node -e '
        const http = require("http");
        http.get("http://localhost:5000/health", (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    console.log(`STATUS:${res.statusCode} DB:${parsed?.dependencies?.database || "unknown"}`);
                } catch(e) {
                    console.log(`STATUS:${res.statusCode}`);
                }
            });
        }).on("error", err => console.log("ERROR:" + err.message));
    ' 2>/dev/null || true)

    echo "   Health check result: ${HEALTH_OUTPUT}"
fi

echo ""
echo "=============================================================================="
echo "🎉 CloudOps AI Backend is successfully running on Minikube!"
echo "=============================================================================="
echo "Useful Commands:"
echo "  • Status:       ./k8s/scripts/status.sh"
echo "  • View Logs:    kubectl logs -n ${NAMESPACE} -l app=cloudops-backend -f"
echo "  • Port Forward: kubectl port-forward -n ${NAMESPACE} svc/cloudops-backend 5000:5000"
echo "  • Scale:        kubectl scale deployment/${DEPLOYMENT} -n ${NAMESPACE} --replicas=3"
echo "  • Restart:      kubectl rollout restart deployment/${DEPLOYMENT} -n ${NAMESPACE}"
echo "=============================================================================="
