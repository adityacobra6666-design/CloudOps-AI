# CloudOps AI — Production Deployment & Cloud Architecture Guide

This guide details the complete deployment process for CloudOps AI, covering:
1. **Public Cloud Deployment** (Render Web Services + MongoDB Atlas + Grafana Cloud + Google Gemini API).
2. **Local & Hybrid Deployment** (Docker Compose with Prometheus remote_write and Alertmanager).
3. **Outbound Connected Agent** (Minikube / Kubernetes remote telemetry and remediation).

---

## 1. System Architecture & Data Flow

```text
Visitor / SRE
     ↓
[ Render Frontend: https://cloudops-ai-frontend-project.onrender.com ]
     ↓ HTTPS (API requests with JWT Cookie/Bearer)
[ Render Backend: https://cloudops-ai-backend-project.onrender.com ]
     ├── MongoDB Atlas (Users, Incidents, Telemetry Snapshots, Audit Logs)
     ├── Google Gemini API (Serverless Incident Analysis & Remediation Decision)
     ├── Grafana Cloud Prometheus (Metrics Querying & Dashboard Aggregation)
     └── Alertmanager / Webhook Endpoint (/api/incidents/webhook with Secret Token)
         ↑
         │ (Outbound-only HTTPS polling / heartbeat / telemetry)
[ Local / Remote Infrastructure Agent: "Arch-Minikube" ]
     ├── Local Kubernetes (Kubeconfig / Minikube cluster: nodes, pods, deployments)
     ├── Local Prometheus (Scraping node-exporter, cadvisor, app metrics)
     └── Prometheus remote_write ──→ [ Grafana Cloud Metrics Store ]
```

### Key Architectural Tenets:
- **Zero Exposed Inbound Cluster Ports**: The backend never accesses local kubeconfigs on Render or connects directly to private minikube IPs. The registered outbound-only agent (`KUBERNETES-TEST`) polls the control plane and ships telemetry snapshots.
- **Serverless AI**: Replaced the local Ollama dependency with Google Gemini API (`@google/genai`), enabling public deployment on cloud hosts like Render without heavyweight GPU/RAM requirements.
- **Unified Observability**: The backend queries either the Connected Agent's live MongoDB snapshot (default for local cluster) or Grafana Cloud directly when configured.
- **Authenticated Alert Ingestion**: Webhooks from Alertmanager or Grafana Cloud Managed Alerting require a shared secret token (`ALERTMANAGER_WEBHOOK_SECRET`), preventing unauthorized incident spoofing on the public internet.

---

## 2. Environment Variables Reference

### Render Backend (`cloudops-ai-backend-project`)

| Variable Name | Required | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `production` | Enables production optimizations and security headers |
| `PORT` | Yes | `5000` | HTTP listen port (configured automatically on Render) |
| `CLIENT_URL` | Yes | `https://cloudops-ai-frontend-project.onrender.com` | Allowed frontend URL for CORS with credentials |
| `MONGODB_URI` | Yes | `mongodb+srv://...` | MongoDB connection string (Atlas or self-hosted) |
| `JWT_SECRET` | Yes | `<random-32-chars-hex>` | Secret key for signing and verifying user session JWTs |
| `GEMINI_API_KEY` | Yes | `AIzaSy...` | Google AI Studio API key for incident root-cause analysis |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model name (`gemini-2.5-flash`, `gemini-1.5-flash`) |
| `GEMINI_EMBED_MODEL`| No | `text-embedding-004` | Embedding model for incident vector search |
| `ALERTMANAGER_WEBHOOK_SECRET` | Recommended | `<random-secret>` | Secret token required to post alerts to `/api/incidents/webhook` |
| `GRAFANA_CLOUD_PROMETHEUS_URL` | Optional | `https://prometheus-prod-XX.../api/prom` | Base URL for backend PromQL queries to Grafana Cloud |
| `GRAFANA_CLOUD_PROMETHEUS_USERNAME` | Optional | `123456` | Numeric Grafana Cloud Instance ID |
| `GRAFANA_CLOUD_PROMETHEUS_TOKEN` | Optional | `glc_...` | Access policy token with `metrics:read` scope |
| `CORS_ORIGINS` | No | `https://cloudops-ai-frontend-project.onrender.com` | Comma-separated list of additional allowed origins |

### Render Frontend (`cloudops-ai-frontend-project`)

| Variable Name | Required | Example | Purpose |
| :--- | :--- | :--- | :--- |
| `VITE_API_URL` | Yes | `https://cloudops-ai-backend-project.onrender.com/api` | Base API endpoint consumed by the React app |

---

## 3. Component Configuration Guides

### 3.1 Google Gemini API Integration

1. Go to [Google AI Studio](https://aistudio.google.com/) and generate an API key.
2. Add `GEMINI_API_KEY` to your backend environment settings:
   ```bash
   GEMINI_API_KEY=AIzaSyYourGeneratedApiKeyHere
   GEMINI_MODEL=gemini-2.5-flash
   ```
3. **Features Powered by Gemini**:
   - **Incident Root-Cause Analysis**: Automatically diagnoses triggered alerts by correlating current symptoms with historical incident context.
   - **Remediation Recommendation**: Evaluates incident metrics against safety rules (e.g. stateful singletons like `cloudops-mongodb` can only restart, never scale) and outputs structured recommendations.
   - **Embeddings & Similarity**: Converts incident summaries to semantic embeddings using `text-embedding-004` to retrieve past similar outages.
4. **Testing without an API Key**:
   Set `GEMINI_MOCK=true` in local development to run end-to-end tests without calling the external API.

---

### 3.2 Grafana Cloud Metrics Forwarding (Prometheus `remote_write`)

To ship metrics from your local cluster or Docker environment to Grafana Cloud:

1. In your **Grafana Cloud Portal**, open **Prometheus** → **Send Metrics**.
2. Note your:
   - **Remote Write Endpoint**: e.g. `https://prometheus-prod-10-prod-us-central-0.grafana.net/api/prom/push`
   - **Username / Instance ID**: e.g. `1425890`
   - **Password / Token**: An Access Policy token with `metrics:write` permission.
3. **Using `monitoring/prometheus/prometheus.cloud.yml`**:
   Start Prometheus with environment variable expansion enabled:
   ```bash
   export GRAFANA_CLOUD_REMOTE_WRITE_URL="https://prometheus-prod-XX.grafana.net/api/prom/push"
   export GRAFANA_CLOUD_USER="1425890"
   export GRAFANA_CLOUD_API_KEY="glc_your_token_here"

   prometheus --config.file=monitoring/prometheus/prometheus.cloud.yml --enable-feature=expand-env
   ```
4. **Importing the CloudOps Dashboard**:
   - In Grafana Cloud, navigate to **Dashboards** → **New** → **Import**.
   - Upload [monitoring/prometheus/grafana-cloud-dashboard.json](file:///home/aadi/Projects/CloudOps-AI/monitoring/prometheus/grafana-cloud-dashboard.json).
   - Select your Grafana Cloud Prometheus data source.
   - You will see live panels for Host CPU, Host Memory, HTTP Request Rate, 5xx Error Rate, P95 Latency, and Container Network throughput.

---

### 3.3 Alerting & Webhook Pipeline

CloudOps AI supports alerts from Prometheus Alertmanager or Grafana Cloud Managed Alerting:

#### A. Configure Alert Rules
The alert rules in [monitoring/prometheus/alerts.yml](file:///home/aadi/Projects/CloudOps-AI/monitoring/prometheus/alerts.yml) monitor:
- `HighHostCPU` (CPU > 80% for 30s)
- `HighHostMemory` (Memory > 85% for 30s)
- `HighHTTPErrorRate` (5xx server error rate > 5% for 30s)
- `HighP95Latency` (HTTP P95 latency > 500ms for 1m)
- `CloudOpsServerDown` (`up{job="cloudops-server"} == 0` for 15s)
- `PrometheusScrapeTargetMissing` (any target down for 1m)

#### B. Configure Webhook Delivery
In [monitoring/alertmanager/alertmanager.yml](file:///home/aadi/Projects/CloudOps-AI/monitoring/alertmanager/alertmanager.yml):
```yaml
receivers:
  - name: cloudops-backend
    webhook_configs:
      - url: "https://cloudops-ai-backend-project.onrender.com/api/incidents/webhook?token=your_secure_alertmanager_webhook_secret_here"
        send_resolved: true
        max_alerts: 50
```

#### C. Webhook Authentication Methods
Webhooks can authenticate via any of the following:
1. **Query parameter**: `?token=<secret>`
2. **HTTP Header**: `X-Webhook-Token: <secret>`
3. **Bearer Authorization**: `Authorization: Bearer <secret>`

When `ALERTMANAGER_WEBHOOK_SECRET` is configured on Render, any request lacking the valid token is rejected with `401 Unauthorized`.

---

## 4. Render Public Deployment Steps

### Step 1: Deploy Backend (`cloudops-ai-backend-project`)
1. In the **Render Dashboard**, select your Web Service: `cloudops-ai-backend-project`.
2. Go to **Environment** and verify/add:
   ```text
   NODE_ENV = production
   CLIENT_URL = https://cloudops-ai-frontend-project.onrender.com
   MONGODB_URI = mongodb+srv://<user>:<password>@<cluster>.mongodb.net/cloudops
   JWT_SECRET = <secure-32-char-random-string>
   GEMINI_API_KEY = <your-gemini-api-key>
   GEMINI_MODEL = gemini-2.5-flash
   ALERTMANAGER_WEBHOOK_SECRET = <your-webhook-secret>
   ```
3. *(Optional for direct Grafana Cloud queries)*:
   ```text
   GRAFANA_CLOUD_PROMETHEUS_URL = https://prometheus-prod-XX.../api/prom
   GRAFANA_CLOUD_PROMETHEUS_USERNAME = <instance-id>
   GRAFANA_CLOUD_PROMETHEUS_TOKEN = <glc_token>
   ```
4. Click **Manual Deploy** → **Deploy latest commit**.

### Step 2: Deploy Frontend (`cloudops-ai-frontend-project`)
1. In the **Render Dashboard**, select your Static Site: `cloudops-ai-frontend-project`.
2. Go to **Environment** and ensure:
   ```text
   VITE_API_URL = https://cloudops-ai-backend-project.onrender.com/api
   ```
3. Click **Manual Deploy** → **Deploy latest commit**.

---

## 5. Public Endpoint Verification Commands

After deployment, verify all public endpoints from your terminal:

### 1. Verify Backend Health Probe
```bash
curl -s -i https://cloudops-ai-backend-project.onrender.com/health
```
*Expected: HTTP 200 OK with `status: "healthy"` and `dependencies.database: "healthy"`.*

### 2. Verify Observability Telemetry (Connected Agent Source of Truth)
```bash
curl -s https://cloudops-ai-backend-project.onrender.com/api/observability/telemetry?connectionId=local | jq '{success, provider, dataStatus, services}'
```
*Expected: `dataStatus: "CONNECTED"`, services reporting truthful statuses for Backend API, MongoDB, Agent, and Gemini API.*

### 3. Verify Direct Grafana Cloud Diagnostics
```bash
curl -s https://cloudops-ai-backend-project.onrender.com/api/observability/telemetry?connectionId=grafana_cloud | jq '{success, provider, providerError}'
```
*Expected: When configured without metrics ingestion, returns informative note directing to remote_write setup.*

### 4. Test Authenticated Alert Webhook (Dry Run)
```bash
curl -s -X POST https://cloudops-ai-backend-project.onrender.com/api/incidents/webhook?token=your_secure_alertmanager_webhook_secret_here \
  -H "Content-Type: application/json" \
  -d '{"alerts":[]}' | jq .
```
*Expected: `{"success": true, "message": "No alerts in payload", "created": 0, "updated": 0, "resolved": 0}`.*

### 5. Verify Unauthorized Webhook Rejection
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://cloudops-ai-backend-project.onrender.com/api/incidents/webhook \
  -H "Content-Type: application/json" \
  -d '{"alerts":[]}'
```
*Expected: `401` Unauthorized when `ALERTMANAGER_WEBHOOK_SECRET` is set.*

---

## 6. Troubleshooting Guide

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **Grafana Cloud displays "No data"** | Prometheus `remote_write` is not configured on the metrics publisher | Configure `monitoring/prometheus/prometheus.cloud.yml` or Grafana Alloy to ship local TSDB metrics to your Grafana Cloud instance. |
| **Alert Webhook returns 401 Unauthorized** | Webhook is missing the secret token or using an invalid token | Pass `?token=<secret>` or add header `X-Webhook-Token: <secret>` matching `ALERTMANAGER_WEBHOOK_SECRET`. |
| **Gemini AI reports "Not configured"** | `GEMINI_API_KEY` is not set in Render Environment | Create an API key at [Google AI Studio](https://aistudio.google.com/) and paste it into Render backend environment settings. |
| **Gemini API returns 429 Resource Exhausted** | Free tier per-minute quota reached | The backend automatically throttles requests (min 250ms interval) and retries once. For higher throughput, attach a billing account to your Google Cloud project. |
| **Agent shows "STALE" or "DISCONNECTED"** | Local machine is asleep or systemd agent is stopped | Check status locally: `systemctl --user status cloudops-agent.service`. Ensure Minikube is running (`minikube status`). |
| **Frontend displays "Failed to fetch"** | CORS mismatch or missing `VITE_API_URL` | Confirm `VITE_API_URL=https://cloudops-ai-backend-project.onrender.com/api` and backend has allowed the frontend origin. |
