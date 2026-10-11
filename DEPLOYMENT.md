# CloudOps AI — Production Deployment Guide

This guide details the complete, tested process for deploying CloudOps AI to production environments using **Docker Compose** with hardened networking, reverse-proxied frontend, shielded internal telemetry, and optional **Kubernetes** connectivity.

---

## 1. Production Architecture Overview

In production mode:
- **Client (Frontend)**: React 19 SPA built via `client/Dockerfile.prod` and served by **Nginx** on port 80 (or configurable `CLOUDOPS_PUBLIC_PORT`).
- **Same-Origin API Routing**: Nginx serves static assets for all UI routes (with SPA `try_files` fallback) and transparently reverse-proxies `/api/` and `/health` requests to `http://server:5000`. Public visitors never depend on `localhost` or hardcoded backend ports.
- **Backend API**: Node.js/Express service running inside the internal Docker bridge network (`cloudops`), with port 5000 bound exclusively to `127.0.0.1` for local host checks.
- **Shielded Microservices**: MongoDB (`27017`), Ollama (`11434`), Prometheus (`9090`), Alertmanager (`9093`), and Grafana (`3000`) are bound to `127.0.0.1` (or unexposed to `0.0.0.0`), preventing public exposure while remaining fully accessible across the internal container network.
- **Persistent Storage**: Named Docker volumes persist MongoDB data, Ollama model weights, Prometheus metrics, and Grafana state across container updates and restarts.

```text
Visitor / Browser
        ↓
  [ Port 80 / 443 (Nginx) ]
    ├── /           → Static Built React 19 SPA (HTML/JS/CSS)
    ├── /api/*      → Proxy to cloudops-server:5000/api/*
    └── /health     → Proxy to cloudops-server:5000/health
        ↓
Internal Docker Network ("cloudops")
    ├── cloudops-server:5000
    ├── cloudops-mongodb:27017
    ├── cloudops-ollama:11434 (LLM + Embeddings)
    ├── cloudops-prometheus:9090
    ├── cloudops-alertmanager:9093
    ├── cloudops-grafana:3000
    ├── cloudops-node-exporter:9100
    └── cloudops-cadvisor:8080
```

---

## 2. Prerequisites

| Requirement | Minimum Version | Notes |
| :--- | :--- | :--- |
| **Operating System** | Linux (Ubuntu, Debian, RHEL, Arch) | Any standard modern Linux distribution |
| **Docker Engine** | 24.0+ | Docker daemon running |
| **Docker Compose** | 2.20+ (Compose V2) | Standard `docker compose` plugin |
| **CPU / RAM** | 4 Cores, 8 GB RAM (16 GB recommended) | Required for running Ollama LLM (`llama3.2:3b`) smoothly |
| **Disk Space** | 20 GB free space | For Docker images, Ollama model weights, and Prometheus TSDB |

---

## 3. Environment Configuration

### Step 1: Create Environment File
```bash
cp server/.env.example server/.env
```

### Step 2: Configure Environment Variables
Edit `server/.env` with your production settings:

```bash
# Server Environment
NODE_ENV=production
PORT=5000

# MongoDB (supports either MONGO_URI or MONGODB_URI)
MONGO_URI=mongodb://mongo:27017/cloudops
# For MongoDB Atlas:
# MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/cloudops?retryWrites=true&w=majority

# JWT Authentication (generate with: openssl rand -hex 32)
JWT_SECRET=replace_with_a_secure_random_key_at_least_32_characters

# Ollama AI / LLM & RAG Service
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_EMBED_MODEL=nomic-embed-text:latest

# Monitoring Services
PROMETHEUS_URL=http://prometheus:9090
GRAFANA_URL=http://grafana:3000
ALERTMANAGER_URL=http://alertmanager:9093
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=replace_with_secure_grafana_password

# CORS Allowed Origins (comma-separated)
CORS_ORIGINS=http://localhost,http://127.0.0.1,https://your-domain.com

# Public URL (for password reset links)
FRONTEND_PUBLIC_URL=https://your-domain.com

# Kubernetes (set to true if cluster connectivity is available)
KUBERNETES_ENABLED=true
KUBERNETES_NAMESPACE=cloudops
```

> 🚨 **SECURITY CHECKLIST**:
> - Never commit `.env` to Git.
> - Generate a unique, strong `JWT_SECRET` (`openssl rand -hex 32`).
> - Set a strong `GF_ADMIN_PASSWORD`.
> - Never expose internal ports (`27017`, `11434`, `9090`, `9093`) directly to the public internet without firewall rules or VPN/SSH tunnels.

---

## 4. Production Deployment Commands

### Option A: One-Command Production Script (Recommended)
```bash
./scripts/deploy-prod.sh
# or using npm:
npm run deploy:prod
```

This automated script:
1. Verifies Docker and Compose prerequisites.
2. Validates `server/.env` (verifies `JWT_SECRET` and `MONGO_URI`/`MONGODB_URI`).
3. Validates Compose configuration syntax.
4. Builds the production Nginx container and starts all services in detached mode (`-d`).
5. Waits for the backend and frontend health endpoints to return HTTP 200.
6. Prints the deployment summary.

### Option B: Native Docker Compose Command
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

---

## 5. Ollama AI Model Provisioning

Models are stored in the persistent Docker volume `cloudops-ai-ollama-data`. On a fresh deployment where models have not yet been downloaded, pull the required models once:

```bash
# 1. Pull the LLM for root-cause analysis and remediation decisions
docker exec cloudops-ollama ollama pull llama3.2:3b

# 2. Pull the embedding model for RAG vector retrieval
docker exec cloudops-ollama ollama pull nomic-embed-text:latest
```

*Note: Once pulled, these models remain saved in persistent storage across container restarts and updates.*

---

## 6. Health & Verification Checks

Run the automated health check:
```bash
./scripts/health-check.sh
# or
npm run health:check
```

Or run manual inspection commands:
```bash
# 1. Direct Backend Health
curl -s http://127.0.0.1:5000/health | jq .

# Expected output:
# {
#   "success": true,
#   "status": "healthy",
#   "timestamp": "...",
#   "dependencies": {
#     "database": "healthy",
#     "prometheus": "healthy",
#     "ollama": "healthy"
#   }
# }

# 2. Public Frontend via Nginx Reverse Proxy
curl -I http://localhost/

# 3. Same-Origin API Check via Reverse Proxy
curl -s http://localhost/api/health | jq .

# 4. Service and Container Status
./scripts/status.sh
# or
npm run status
```

---

## 7. Connecting Kubernetes in Production

CloudOps AI supports three flexible paths to connect to Kubernetes:

### Path A: Running CloudOps Inside Kubernetes (In-Cluster)
If CloudOps AI runs inside a Kubernetes cluster:
1. The server automatically detects `/var/run/secrets/kubernetes.io/serviceaccount/token`.
2. Apply the RBAC permissions using `k8s/manifests/rbac.yaml`:
   ```bash
   kubectl apply -f k8s/manifests/rbac.yaml
   ```

### Path B: External Kubernetes Cluster via Kubeconfig
To connect the Docker Compose backend to an external or managed cluster (e.g., EKS, GKE, AKS, or remote control plane):
1. Place the kubeconfig file securely on the host (e.g., `/etc/cloudops/kubeconfig.yaml`).
2. Point `KUBECONFIG` to that path, or mount it into the container.
3. CloudOps AI will automatically authenticate using the provided cluster credentials.

### Path C: Remote Infrastructure Connector Agent (Outbound Only)
If the Kubernetes cluster or Prometheus server resides behind a private corporate firewall or private VPC without inbound ports:
1. Open the CloudOps UI at **Infrastructure Connections** (`/connections`).
2. Click **Add Connection** to generate a secure enrollment token.
3. Deploy the lightweight connector agent from the `agent/` directory directly onto the private cluster. The agent initiates an outbound-only HTTPS tunnel to CloudOps AI.

---

## 8. Public HTTPS & Domain Setup (Reverse Proxy)

When deploying to a public VPS with a domain name (e.g., `cloudops.example.com`), configure HTTPS termination in front of port 80.

### Example Caddyfile (Automatic Let's Encrypt SSL):
```caddy
cloudops.example.com {
    reverse_proxy localhost:80
}
```

### Example Nginx Host Configuration with Certbot:
```nginx
server {
    server_name cloudops.example.com;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Run `certbot --nginx -d cloudops.example.com` to obtain free TLS certificates.

---

## 9. Stopping, Updating, and Backups

### Stopping Production Services
```bash
./scripts/stop-prod.sh
# or
npm run stop:prod
```

### Applying Code Updates
```bash
git pull
./scripts/deploy-prod.sh
```

### Database Backup
```bash
# Dump MongoDB data from the host
docker exec cloudops-mongodb mongodump --archive=/data/db/backup-$(date +%F).archive --gzip
```

### Troubleshooting Common Issues
| Issue | Cause | Fix |
| :--- | :--- | :--- |
| `port 80 already in use` | Another web server (e.g. Apache/Nginx) is running on port 80 | Set `CLOUDOPS_PUBLIC_PORT=8080` before running `./scripts/deploy-prod.sh`, or stop the competing service. |
| `Missing required environment variables` | `server/.env` is missing or lacks `JWT_SECRET`/`MONGO_URI` | Ensure `server/.env` exists and contains valid settings. |
| `Ollama returns status: unavailable` | Ollama container is starting or model is not pulled | Run `docker exec cloudops-ollama ollama pull llama3.2:3b`. |
| `Kubernetes status shows disconnected` | Kubeconfig not configured or no cluster reachable | CloudOps continues functioning. Connect a cluster via `KUBECONFIG` or the Outbound Agent. |
