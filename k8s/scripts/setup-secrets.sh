#!/usr/bin/env bash
# ==============================================================================
# CloudOps AI — Secure Kubernetes Secrets Configuration Helper
# ==============================================================================
# Creates or updates the 'cloudops-backend-secrets' Secret in the 'cloudops'
# namespace without logging or leaking secret values to the terminal.
#
# Usage:
#   ./k8s/scripts/setup-secrets.sh [OPTIONS]
#
# Options:
#   --from-env-file <path>   Extract secrets from a local env file (e.g. server/.env)
#   --mongo-uri <uri>        Set the MongoDB connection URI directly
#   --jwt-secret <secret>    Set the JWT signing secret directly
#   --interactive            Prompt for secret values securely without echo
#   --help                   Display this help message
# ==============================================================================

set -euo pipefail

NAMESPACE="cloudops"
SECRET_NAME="cloudops-backend-secrets"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

MONGO_URI=""
JWT_SECRET=""
GRAFANA_URL=""
GRAFANA_USER=""
GRAFANA_TOKEN=""
FROM_ENV=""
INTERACTIVE=false

show_help() {
    cat <<EOF
CloudOps AI Secret Setup Helper

Usage:
  ./k8s/scripts/setup-secrets.sh [OPTIONS]

Options:
  --from-env-file <path>   Extract secrets from a local env file (default: server/.env if present)
  --mongo-uri <uri>        Set the MongoDB connection URI
  --jwt-secret <secret>    Set the JWT signing secret (min 32 characters)
  --interactive            Prompt interactively for secrets (masked input)
  -h, --help               Show this help message

Examples:
  # Auto-load from existing server/.env:
  ./k8s/scripts/setup-secrets.sh --from-env-file server/.env

  # Prompt securely without typing secrets in command history:
  ./k8s/scripts/setup-secrets.sh --interactive

  # Set specific Atlas connection:
  ./k8s/scripts/setup-secrets.sh --mongo-uri "mongodb+srv://user:pass@cluster.mongodb.net/cloudops"
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from-env-file)
            FROM_ENV="$2"
            shift 2
            ;;
        --mongo-uri)
            MONGO_URI="$2"
            shift 2
            ;;
        --jwt-secret)
            JWT_SECRET="$2"
            shift 2
            ;;
        --interactive)
            INTERACTIVE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "❌ Unknown argument: $1"
            show_help
            exit 1
            ;;
    esac
done

# Ensure namespace exists before creating secret
if ! kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
    echo "📦 Creating namespace '${NAMESPACE}'..."
    kubectl apply -f "${REPO_ROOT}/k8s/namespace.yaml"
fi

# 1. Check if interactive mode requested
if [[ "${INTERACTIVE}" == "true" ]]; then
    echo "🔒 Interactive Secret Configuration (Input is hidden):"
    read -r -s -p "Enter MongoDB URI: " MONGO_URI
    echo ""
    read -r -s -p "Enter JWT Secret (min 32 chars): " JWT_SECRET
    echo ""

# 2. Extract from specified or default .env file
elif [[ -n "${FROM_ENV}" || (-z "${MONGO_URI}" && -z "${JWT_SECRET}" && -f "${REPO_ROOT}/server/.env") ]]; then
    ENV_FILE="${FROM_ENV:-${REPO_ROOT}/server/.env}"
    if [[ ! -f "${ENV_FILE}" ]]; then
        echo "❌ Environment file not found: ${ENV_FILE}"
        exit 1
    fi
    echo "📄 Reading credentials securely from: ${ENV_FILE}"

    # Use Node.js to safely parse dotenv format without shell expansion or quoting corruption
    ENV_JSON=$(node -e '
        const fs = require("fs");
        const path = "'"${ENV_FILE}"'";
        const content = fs.readFileSync(path, "utf8");
        const env = {};
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("\x27") && val.endsWith("\x27"))) {
                val = val.slice(1, -1);
            }
            env[key] = val;
        }
        const out = {
            MONGO_URI: env.MONGO_URI || env.MONGODB_URI || "",
            JWT_SECRET: env.JWT_SECRET || "",
            GRAFANA_CLOUD_PROMETHEUS_URL: env.GRAFANA_CLOUD_PROMETHEUS_URL || "",
            GRAFANA_CLOUD_PROMETHEUS_USERNAME: env.GRAFANA_CLOUD_PROMETHEUS_USERNAME || "",
            GRAFANA_CLOUD_PROMETHEUS_TOKEN: env.GRAFANA_CLOUD_PROMETHEUS_TOKEN || ""
        };
        process.stdout.write(JSON.stringify(out));
    ')

    if [[ -z "${MONGO_URI}" ]]; then
        MONGO_URI=$(node -e "const d = ${ENV_JSON}; process.stdout.write(d.MONGO_URI);")
    fi
    if [[ -z "${JWT_SECRET}" ]]; then
        JWT_SECRET=$(node -e "const d = ${ENV_JSON}; process.stdout.write(d.JWT_SECRET);")
    fi
    GRAFANA_URL=$(node -e "const d = ${ENV_JSON}; process.stdout.write(d.GRAFANA_CLOUD_PROMETHEUS_URL);")
    GRAFANA_USER=$(node -e "const d = ${ENV_JSON}; process.stdout.write(d.GRAFANA_CLOUD_PROMETHEUS_USERNAME);")
    GRAFANA_TOKEN=$(node -e "const d = ${ENV_JSON}; process.stdout.write(d.GRAFANA_CLOUD_PROMETHEUS_TOKEN);")
fi

# Fallback: Auto-generate JWT_SECRET if empty
if [[ -z "${JWT_SECRET}" ]]; then
    echo "⚠️  No JWT_SECRET provided. Generating secure 32-byte secret..."
    JWT_SECRET=$(openssl rand -hex 32)
fi

# Validate MONGO_URI
if [[ -z "${MONGO_URI}" ]]; then
    echo "❌ Error: MONGO_URI is required."
    echo "   Provide via --mongo-uri, --from-env-file, or --interactive."
    exit 1
fi

# Special check for Docker Compose-style host 'mongo'
if [[ "${MONGO_URI}" == *"mongodb://mongo:"* || "${MONGO_URI}" == *"mongodb://mongo/"* ]]; then
    if ! kubectl get service mongo -n "${NAMESPACE}" >/dev/null 2>&1; then
        echo "⚠️  Notice: MONGO_URI points to host 'mongo', but no Service 'mongo' currently exists in namespace '${NAMESPACE}'."
        echo "   If you want to run an in-cluster MongoDB, apply: kubectl apply -f k8s/mongodb-dev.yaml"
        echo "   If connecting to your host Docker container from Minikube, you can use: mongodb://host.minikube.internal:27017/cloudops"
    fi
fi

# Build arguments safely
KUBECTL_ARGS=(
    "create" "secret" "generic" "${SECRET_NAME}"
    "--namespace=${NAMESPACE}"
    "--from-literal=MONGO_URI=${MONGO_URI}"
    "--from-literal=JWT_SECRET=${JWT_SECRET}"
    "--dry-run=client"
    "-o" "yaml"
)

if [[ -n "${GRAFANA_URL}" ]]; then
    KUBECTL_ARGS+=("--from-literal=GRAFANA_CLOUD_PROMETHEUS_URL=${GRAFANA_URL}")
fi
if [[ -n "${GRAFANA_USER}" ]]; then
    KUBECTL_ARGS+=("--from-literal=GRAFANA_CLOUD_PROMETHEUS_USERNAME=${GRAFANA_USER}")
fi
if [[ -n "${GRAFANA_TOKEN}" ]]; then
    KUBECTL_ARGS+=("--from-literal=GRAFANA_CLOUD_PROMETHEUS_TOKEN=${GRAFANA_TOKEN}")
fi

kubectl "${KUBECTL_ARGS[@]}" | kubectl apply -f - >/dev/null

echo "✅ Secret '${SECRET_NAME}' successfully created/updated in namespace '${NAMESPACE}'."
echo "🔒 Credentials safely injected into cluster (values hidden from terminal)."
