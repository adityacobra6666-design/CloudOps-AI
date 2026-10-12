#!/usr/bin/env bash
# ==============================================================================
# CloudOps AI — Kubernetes Status Inspector
# ==============================================================================
# Inspects cluster resources in the 'cloudops' namespace and verifies backend health.
# ==============================================================================

set -euo pipefail

NAMESPACE="cloudops"

echo "=============================================================================="
echo "📊 CloudOps AI — Kubernetes Cluster Status (${NAMESPACE})"
echo "=============================================================================="

echo ""
echo "🔹 Deployments:"
kubectl get deployments -n "${NAMESPACE}" -o wide

echo ""
echo "🔹 Pods:"
kubectl get pods -n "${NAMESPACE}" -o wide

echo ""
echo "🔹 Services & Endpoints:"
kubectl get services,endpoints -n "${NAMESPACE}"

if kubectl get hpa -n "${NAMESPACE}" >/dev/null 2>&1; then
    echo ""
    echo "🔹 Autoscalers (HPA):"
    kubectl get hpa -n "${NAMESPACE}"
fi

echo ""
echo "🔹 Backend Health Probe:"
POD=$(kubectl get pods -n "${NAMESPACE}" -l app=cloudops-backend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -n "${POD}" ]]; then
    kubectl exec -n "${NAMESPACE}" "${POD}" -- node -e '
        const http = require("http");
        http.get("http://localhost:5000/health", (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                console.log(`HTTP ${res.statusCode}: ${body}`);
            });
        }).on("error", err => console.log(`Probe error: ${err.message}`));
    ' 2>/dev/null || echo "Pod probe unavailable"
else
    echo "⚠️  No cloudops-backend pod found."
fi

echo ""
echo "🔹 Recent Events (Warnings):"
kubectl get events -n "${NAMESPACE}" --field-selector type=Warning --sort-by='.lastTimestamp' 2>/dev/null | tail -n 10 || true
echo "=============================================================================="
