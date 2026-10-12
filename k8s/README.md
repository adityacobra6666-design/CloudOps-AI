# CloudOps AI — Kubernetes & Minikube Deployment Guide

This guide details how to deploy and operate the real **CloudOps AI Node.js/Express Backend** on a Kubernetes cluster, targeting local **Minikube** on Linux (Arch Linux, Ubuntu, etc.) with support for both Bash and **Fish** shells.

---

## 1. Architecture Overview

In Kubernetes mode, the Express API runs as a containerized workload using the local image `cloudops-backend:local`.

```text
Cluster / Namespace: cloudops
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  [ Service: cloudops-backend ] (ClusterIP: Port 5000)                  │
│       │                                                                │
│       ├──► Pod: cloudops-backend-xxxx (Express API on Port 5000)       │
│       └──► Pod: cloudops-backend-yyyy (Express API on Port 5000)       │
│                 │                                                      │
│                 ├── In-Cluster RBAC ServiceAccount (cloudops-sa)       │
│                 ├── ConfigMap (cloudops-backend-config)                │
│                 ├── Secret (cloudops-backend-secrets)                  │
│                 ├── Health Probes: Startup, Readiness, Liveness        │
│                 └── Graceful Shutdown (SIGTERM: 30s)                   │
│                                                                        │
│  [ Optional Database ]                                                 │
│       ├── Option A: MongoDB Atlas (mongodb+srv://...)                  │
│       ├── Option B: Host Docker Mongo (host.minikube.internal:27017)   │
│       └── Option C: In-Cluster MongoDB (k8s/mongodb-dev.yaml)          │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Differences from Demo Workload:
- **Real Backend**: Replaces the placeholder `nginx:alpine` with the production Node.js 22 Express backend.
- **Port 5000**: Service routes traffic to container port `5000` (`httpGet /health` probe enabled).
- **In-Cluster RBAC**: Uses `ServiceAccount: cloudops-sa` with least-privilege Roles to inspect pods, deployments, and cluster nodes directly through `@kubernetes/client-node`.
- **Zero Committed Secrets**: Secrets are provisioned through secure scripts or kubectl commands, never saved to Git.

---

## 2. Prerequisites

| Tool | Verification Command | Notes |
| :--- | :--- | :--- |
| **Docker** | `docker --version` | Daemon must be running |
| **kubectl** | `kubectl version --client` | Kubernetes CLI |
| **Minikube** | `minikube status` | Cluster must show `Running` |
| **Node.js** | `node -v` | Used for safe `.env` parsing |

Ensure Minikube is started:
```bash
minikube start
```

---

## 3. Secret Configuration (Zero Secrets in Git)

The backend requires at least two credentials to start:
1. `MONGO_URI` (or `MONGODB_URI`)
2. `JWT_SECRET` (at least 32 characters)

### Option A: Using the Secure Helper Script (Recommended)
The helper script parses `server/.env` safely using Node.js without printing credentials to stdout:

```bash
# Bash or Fish:
./k8s/scripts/setup-secrets.sh
```

Or run interactively (inputs are hidden from terminal history):
```bash
./k8s/scripts/setup-secrets.sh --interactive
```

### Option B: Manual `kubectl` Command
If using **MongoDB Atlas**:
```bash
kubectl create secret generic cloudops-backend-secrets \
  --namespace=cloudops \
  --from-literal=MONGO_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/cloudops?retryWrites=true&w=majority" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

If connecting to the **Host Docker MongoDB container** from Minikube:
```bash
kubectl create secret generic cloudops-backend-secrets \
  --namespace=cloudops \
  --from-literal=MONGO_URI="mongodb://host.minikube.internal:27017/cloudops" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

If using **In-Cluster Persistent MongoDB** (`k8s/mongodb-dev.yaml`):
```bash
kubectl create secret generic cloudops-backend-secrets \
  --namespace=cloudops \
  --from-literal=MONGO_URI="mongodb://mongo:27017/cloudops" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

> 🔒 **Security Rules**:
> - Never commit `.env` or YAML files with populated secrets.
> - `secret.example.yaml` contains placeholder documentation only.

---

## 4. Building and Loading the Backend Image

Build the backend image and load it directly into Minikube's local container runtime cache:

### Bash / Fish Shell:
```bash
# 1. Build the local image
docker build -t cloudops-backend:local -f server/Dockerfile server/

# 2. Load image into Minikube
minikube image load cloudops-backend:local
```

Verify the image is in Minikube's registry:
```bash
minikube image ls | grep cloudops-backend
```

---

## 5. Deployment Workflow

### Automated One-Step Deployment:
```bash
# Bash or Fish:
./k8s/scripts/deploy.sh
```

To include the in-cluster development MongoDB instance:
```bash
./k8s/scripts/deploy.sh --with-mongo
```

---

### Step-by-Step Manual Deployment:

#### 1. Create Namespace:
```bash
kubectl apply -f k8s/namespace.yaml
```

#### 2. Apply RBAC Permissions:
```bash
kubectl apply -f k8s/rbac.yaml
```

#### 3. Apply ConfigMap:
```bash
kubectl apply -f k8s/configmap.yaml
```

#### 4. Configure Secrets (if not already done):
```bash
./k8s/scripts/setup-secrets.sh
```

#### 5. Apply Service and Deployment:
```bash
kubectl apply -f k8s/backend-service.yaml
kubectl apply -f k8s/backend-deployment.yaml
```

#### 6. Watch Rollout:
```bash
kubectl rollout status deployment/cloudops-backend -n cloudops --timeout=120s
```

---

## 6. Verification and Health Checking

### 1. Check Resources and Pods:
```bash
# Using the status script:
./k8s/scripts/status.sh

# Or directly with kubectl:
kubectl get pods -n cloudops -o wide
kubectl get svc -n cloudops
```

### 2. Verify Real Backend `/health` Response:
Forward port 5000 locally to test the API:
```bash
# Forward port:
kubectl port-forward -n cloudops svc/cloudops-backend 5000:5000
```

In another terminal (Bash or Fish):
```bash
curl -s http://localhost:5000/health | jq .
```

Expected Output:
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-10-12T...",
  "dependencies": {
    "database": "healthy",
    "prometheus": "not_checked",
    "ollama": "not_checked"
  }
}
```

> **Note on Probe Design**:
> - `/health` and `/api/health` serve as fast, lightweight Kubernetes readiness and liveness probes based on MongoDB connection state (`mongoose.connection.readyState === 1`).
> - External dependency network checks (Prometheus, Ollama) are omitted from `/health` to guarantee sub-millisecond probe execution and avoid readiness timeouts.
> - Full monitoring dependency checks remain available via `/api/observability/overview` and `/api/metrics/services/health`.

---

## 7. Autoscaling (HPA) and Resource Monitoring

The project includes Horizontal Pod Autoscaler configuration: `k8s/backend-hpa.yaml`.

### 1. Enable Minikube Metrics Server:
```bash
minikube addons enable metrics-server
```

Verify Metrics Server is active:
```bash
kubectl top nodes
kubectl top pods -n cloudops
```

### 2. Apply HPA:
```bash
kubectl apply -f k8s/backend-hpa.yaml
```

### 3. Inspect HPA Status:
```bash
kubectl get hpa -n cloudops
```

---

## 8. Operational Commands

### View Live Logs:
```bash
kubectl logs -n cloudops -l app=cloudops-backend -f --tail=100
```

### Scale Deployment:
```bash
kubectl scale deployment/cloudops-backend -n cloudops --replicas=4
```

### Rolling Restart:
```bash
kubectl rollout restart deployment/cloudops-backend -n cloudops
```

### Safe Cleanup:
```bash
# Remove backend deployment and service:
./k8s/scripts/cleanup.sh

# Complete cleanup including secrets and volumes:
./k8s/scripts/cleanup.sh --all
```

---

## 9. Local Minikube vs Render Production

| Characteristic | Local Minikube Cluster | Render Public Deployment |
| :--- | :--- | :--- |
| **Location** | Local Arch Linux workstation (`192.168.250.2`) | Render Cloud Platform (Oregon/Frankfurt) |
| **Network Reachability** | Private, accessible only from host | Public internet with SSL (`onrender.com`) |
| **Backend Runtime** | Kubernetes Pods (`cloudops-backend:local`) | Render Web Service container |
| **Telemetry** | Local Prometheus / Node Exporter | Grafana Cloud Prometheus via HTTP Basic Auth |
| **Database** | Minikube host bridge / In-cluster MongoDB | MongoDB Atlas managed cluster |

> ⚠️ **Important Boundary Rule**:
> Changes made to Minikube manifests are strictly local. The Render production backend runs independently and is unaffected by local Minikube configurations. Never attempt to point Render production to local Minikube endpoints (`host.minikube.internal` or `192.168.x.x`).
