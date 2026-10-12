#!/usr/bin/env bash
# ==============================================================================
# CloudOps AI — Kubernetes Safe Cleanup Script
# ==============================================================================
# Safely tears down CloudOps AI Kubernetes workloads.
# Does NOT delete unrelated namespaces or host resources.
#
# Usage:
#   ./k8s/scripts/cleanup.sh [OPTIONS]
#
# Options:
#   --workload-only   Remove only backend deployment, service, configmap, and HPA (default)
#   --with-secrets    Also delete backend secrets
#   --with-mongo      Also delete in-cluster development MongoDB (and its PVC)
#   --all             Delete all cloudops namespace resources
#   -h, --help        Show help
# ==============================================================================

set -euo pipefail

NAMESPACE="cloudops"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

MODE="workload"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --workload-only)
            MODE="workload"
            shift
            ;;
        --with-secrets)
            MODE="secrets"
            shift
            ;;
        --with-mongo)
            MODE="mongo"
            shift
            ;;
        --all)
            MODE="all"
            shift
            ;;
        -h|--help)
            cat <<EOF
Usage: ./k8s/scripts/cleanup.sh [OPTIONS]

Options:
  --workload-only   Delete backend deployment, service, configmap, HPA (default)
  --with-secrets    Delete workloads and cloudops-backend-secrets
  --with-mongo      Delete workloads and in-cluster MongoDB (+ PVC)
  --all             Delete all CloudOps AI resources in the namespace
  -h, --help        Show this help message
EOF
            exit 0
            ;;
        *)
            echo "❌ Unknown argument: $1"
            exit 1
            ;;
    esac
done

echo "🧹 Cleaning up CloudOps AI Kubernetes resources (Mode: ${MODE})..."

# Always remove backend workload
echo "Deleting backend deployment, service, configmap, HPA..."
kubectl delete -f "${REPO_ROOT}/k8s/backend-deployment.yaml" --ignore-not-found=true
kubectl delete -f "${REPO_ROOT}/k8s/backend-service.yaml" --ignore-not-found=true
kubectl delete -f "${REPO_ROOT}/k8s/backend-hpa.yaml" --ignore-not-found=true
kubectl delete -f "${REPO_ROOT}/k8s/configmap.yaml" --ignore-not-found=true

if [[ "${MODE}" == "secrets" || "${MODE}" == "all" ]]; then
    echo "Deleting secret 'cloudops-backend-secrets'..."
    kubectl delete secret cloudops-backend-secrets -n "${NAMESPACE}" --ignore-not-found=true
fi

if [[ "${MODE}" == "mongo" || "${MODE}" == "all" ]]; then
    echo "Deleting in-cluster development MongoDB and PVC..."
    kubectl delete -f "${REPO_ROOT}/k8s/mongodb-dev.yaml" --ignore-not-found=true
fi

if [[ "${MODE}" == "all" ]]; then
    echo "Deleting RBAC..."
    kubectl delete -f "${REPO_ROOT}/k8s/rbac.yaml" --ignore-not-found=true
fi

echo "✅ Cleanup completed safely."
