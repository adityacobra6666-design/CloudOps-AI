# CloudOps AI — Production Deployment Guide

This guide details the steps and considerations for deploying CloudOps AI in production environments using **Docker Compose** or **Kubernetes**.

---

## 1. Environment Configuration

Copy `server/.env.example` to `server/.env` and update all values for your production environment:

```bash
# Server Configuration
PORT=5000
NODE_ENV=production
CORS_ORIGINS=https://your-domain.com

# JWT Authentication
JWT_SECRET=use-a-strong-random-secret-key-at-least-32-chars

# MongoDB Database
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/cloudops?retryWrites=true&w=majority

# Prometheus & Alertmanager Services
PROMETHEUS_URL=http://prometheus:9090
ALERTMANAGER_URL=http://alertmanager:9093
GRAFANA_URL=http://grafana:3000

# Ollama AI Model Server
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:1b

# Remediation & Execution Engine
ENABLE_AUTO_REMEDIATION=false
KUBERNETES_MODE=true
```

> 🚨 **SECURITY CHECKLIST**:
> - Never hardcode secrets in source files or Dockerfiles.
> - Ensure `JWT_SECRET` is strong and kept confidential.
> - Limit `CORS_ORIGINS` strictly to your production frontend URLs.
> - Keep `ENABLE_AUTO_REMEDIATION=false` initially until verification is complete.

---

## 2. Deployment with Docker Compose

### Step 1: Validate Compose Configuration
```bash
docker compose config --quiet
```

### Step 2: Build and Launch Services
```bash
docker compose up -d --build
```

### Step 3: Verify Health Checks
```bash
docker compose ps
curl http://localhost:5000/api/health
```

Expected health response:
```json
{
  "status": "healthy",
  "timestamp": "2026-09-15T11:00:00.000Z",
  "uptime": 120.5,
  "services": {
    "mongodb": { "status": "up" },
    "prometheus": { "status": "up" },
    "ollama": { "status": "up" }
  }
}
```

---

## 3. Kubernetes / Minikube Deployment

### Step 1: RBAC & Service Accounts
CloudOps AI uses `kubectl` in Kubernetes mode to execute pod restarts and deployments. Ensure the server deployment uses a `ServiceAccount` bound to a `Role` with permissions to manage pods and deployments in the target namespace.

Sample `rbac.yaml`:
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cloudops-sa
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cloudops-role
  namespace: default
rules:
  - apiGroups: ["", "apps"]
    resources: ["pods", "deployments", "namespaces", "services"]
    verbs: ["get", "list", "watch", "restart", "patch", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cloudops-rb
  namespace: default
subjects:
  - kind: ServiceAccount
    name: cloudops-sa
    namespace: default
roleRef:
  kind: Role
  name: cloudops-role
  apiGroup: rbac.authorization.k8s.io
```

---

## 4. Monitoring & Verification

1. **Backend Health**: `GET /api/health`
2. **Metrics Inspection**: `GET /api/metrics/summary`
3. **Observability Graph**: `GET /api/observability/metrics?range=1h`

---

## 5. Rollback & Maintenance

If an issue occurs during deployment:
```bash
docker compose logs -f server
docker compose restart server
```
