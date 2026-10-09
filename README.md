# CloudOps AI

**RAG-Driven Autonomous Cloud Operations & Reliability Platform**

CloudOps AI is an AIOps platform that combines **Prometheus Monitoring**, **Alertmanager**, **RAG (Retrieval-Augmented Generation)**, **Ollama (Llama 3.2)**, and an **Autonomous Remediation & Policy Engine** with **Native Kubernetes Orchestration**.

---

## Architecture

```text
Prometheus (cAdvisor / Node Exporter / Application Metrics)
    ↓
Alertmanager (Webhook dispatch)
    ↓
CloudOps Backend (/api/events/alertmanager)
    ↓
Incident Creation & MongoDB Audit Persistence
    ↓
RAG + Ollama AI Analysis (Root Cause & Historical Incident Retrieval)
    ↓
Remediation Decision Recommendation
    ↓
Policy Engine (Whitelist Verification & Replica Bounds Check: Min 1, Max 10)
    ↓
Remediation Executor (KubernetesExecutor via @kubernetes/client-node / DockerExecutor)
    ↓
Kubernetes API Server (AppsV1Api / CoreV1Api)
    ↓
Deployment Scaling (2 → 4 Replicas) or Rolling Restarts
    ↓
Verification Engine (K8s Ready Replica Convergence + Prometheus Metrics Recovery)
    ↓
Remediation Status Update (SUCCESS / FAILED) & Complete Audit Trail
```

---

## Tech Stack

| Layer | Technology |
|:---|:---|
| **Frontend** | React 19, Vite, Recharts, OGL (WebGL background) |
| **Backend** | Node.js, Express |
| **Database** | MongoDB (Mongoose ODM) |
| **AI / LLM** | Ollama (Llama 3.2:3b), Google Gemini (Flash) |
| **RAG** | Nomic Embed Text + Cosine Similarity |
| **Monitoring** | Prometheus, Grafana, Alertmanager, cAdvisor, Node Exporter |
| **Container Orchestration** | Docker Compose, Kubernetes (Minikube/Kind) |
| **Security** | JWT + bcrypt auth, Helmet, CORS, Rate Limiting |

---

## Key Features

- **Autonomous Remediation**: Automatically reacts to Prometheus alerts (High CPU, Service Down) by executing approved remediation actions.
- **Native Kubernetes Client Integration**: Uses `@kubernetes/client-node` for real REST API calls to cluster API servers.
- **Deterministic Policy Engine**: Fail-closed guardrails — the AI recommends, the Policy Engine validates target deployment, namespace, and replica count (min: 1, max: 10).
- **Two-Stage Verification**: Confirms Kubernetes pod convergence (`availableReplicas === desiredReplicas`) + Prometheus metric recovery before marking `SUCCESS`.
- **RAG-Powered Incident Analysis**: Embeds incident text with `nomic-embed-text`, retrieves similar historical incidents via cosine similarity, and generates AI root cause analysis.
- **Cloud Operations Control Center**: React dashboard with real-time observability, incident management, Kubernetes topology, and remediation audit trail.
- **Full Observability Pipeline**: CPU, memory, request rate, error rate, P95 latency, and network I/O — all from Prometheus with time-series visualization.

---

## Prerequisites

- **Docker** & **Docker Compose** (v2+)
- **Node.js** 20+ (for local development)
- **Minikube** or **Kind** (optional, for Kubernetes features)

---

## Quick Start (One Command Startup)

### 1. One Command Full Startup

Start the entire platform including real **Minikube Kubernetes cluster**, **Docker Compose infrastructure**, and **Backend Connectivity** with a single command:

```bash
./scripts/start.sh
# or using npm:
npm run start:all
```

This command automatically:
1. Verifies Docker, Minikube, and kubectl prerequisites.
2. Starts Minikube if stopped and waits until the Kubernetes node is `Ready`.
3. Launches all Docker Compose services (`cloudops-server`, `cloudops-client`, `mongodb`, `prometheus`, `grafana`, `alertmanager`, `ollama`, `cadvisor`, `node-exporter`).
4. Verifies backend HTTP health and backend Kubernetes API connectivity.
5. Displays the full service URLs summary.

### 2. Stopping CloudOps AI

To safely stop all Docker services while keeping your Minikube Kubernetes cluster preserved:

```bash
./scripts/stop.sh
# or using npm:
npm run stop:all
```

### 3. Deploy Kubernetes Workloads (Optional)

```bash
kubectl apply -f k8s/manifests/demo-workload.yaml
kubectl apply -f k8s/manifests/rbac.yaml
kubectl get deployments -n cloudops
```

### 4. Access the Platform

| Service | URL |
|:---|:---|
| **Frontend (Control Center)** | http://localhost:5173 |
| **Backend API** | http://localhost:5000 |
| **Health Check** | http://localhost:5000/health |
| **Prometheus Metrics** | http://localhost:5000/metrics |
| **Prometheus UI** | http://localhost:9090 |
| **Grafana** | http://localhost:3000 |
| **Alertmanager** | http://localhost:9093 |

---

## Local Development (Without Docker)

```bash
# Terminal 1: Backend
cd server
npm install
npm run dev

# Terminal 2: Frontend
cd client
npm install
npm run dev
```

Requires a local MongoDB instance at `mongodb://localhost:27017/cloudops`.

---

## Environment Variables

Key backend environment variables (set in `server/.env`):

| Variable | Default | Description |
|:---|:---|:---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `5000` | Backend server port |
| `MONGO_URI` | `mongodb://mongo:27017/cloudops` | MongoDB connection string |
| `JWT_SECRET` | *(required)* | JWT signing secret — **must be set** |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama LLM service URL |
| `OLLAMA_MODEL` | `llama3.2:3b` | Default LLM model for analysis |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text:latest` | Embedding model for RAG |
| `PROMETHEUS_URL` | `http://prometheus:9090` | Prometheus instance URL |
| `GRAFANA_URL` | `http://grafana:3000` | Grafana instance URL |
| `ALERTMANAGER_URL` | `http://alertmanager:9093` | Alertmanager instance URL |
| `CORS_ORIGINS` | *(localhost defaults)* | Comma-separated allowed origins |
| `FRONTEND_PUBLIC_URL` | `http://localhost:5173` | Public URL for email links |
| `KUBERNETES_ENABLED` | `true` | Enable Kubernetes integration |
| `KUBECONFIG` | `~/.kube/config` | Path to kubeconfig |

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Login and receive JWT |
| `GET` | `/api/auth/me` | Get current user session |
| `POST` | `/api/auth/logout` | Logout |

### Incidents
| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/api/incidents` | List all incidents |
| `POST` | `/api/incidents` | Create an incident |
| `PUT` | `/api/incidents/:id` | Update an incident |
| `DELETE` | `/api/incidents/:id` | Delete an incident |
| `POST` | `/api/incidents/:id/analyze` | Trigger AI analysis |
| `GET` | `/api/incidents/:id/activity` | Get incident activity log |
| `POST` | `/api/incidents/webhook` | Alertmanager webhook receiver |

### Remediation
| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/api/remediation/:id/execute` | Execute autonomous remediation |
| `GET` | `/api/remediation/:id/history` | Get remediation history |
| `GET` | `/api/remediation/actions` | List all remediation actions |
| `GET` | `/api/remediation/actions/:id` | Get specific action |

### Metrics & Observability
| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/api/metrics/overview` | Dashboard overview metrics |
| `GET` | `/api/metrics/services` | Service health status |
| `GET` | `/api/metrics/system-health` | System health summary |
| `GET` | `/api/observability/telemetry` | Full observability telemetry |
| `GET` | `/api/reliability/overview` | Reliability overview |

### Kubernetes
| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/api/kubernetes/overview` | Cluster overview |
| `GET` | `/api/kubernetes/status` | Connection status |
| `GET` | `/api/kubernetes/health` | Cluster health |
| `GET` | `/api/kubernetes/nodes` | List nodes |
| `GET` | `/api/kubernetes/pods` | List pods |
| `GET` | `/api/kubernetes/deployments` | List deployments |
| `GET` | `/api/kubernetes/services` | List services |
| `POST` | `/api/kubernetes/action` | Execute K8s action |

### Infrastructure
| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/health` | Health check with dependency status |
| `GET` | `/metrics` | Prometheus metrics (OpenMetrics format) |

---

## Kubernetes RBAC & Manifests

Manifests are in `k8s/manifests/`:

- **`rbac.yaml`**: ServiceAccount, Role, ClusterRole, and Bindings for the `cloudops` namespace.
- **`demo-workload.yaml`**: Namespace, Deployment (2 replicas), and Service for demo.

---

## Demo: Autonomous Remediation

### Manual UI Trigger
1. Navigate to `/kubernetes` page
2. Click **"⚡ Scale"** on `cloudops-backend`
3. Set replicas to `4` and confirm
4. Watch real-time convergence and audit trail

### Autonomous Prometheus Flow
```bash
curl -X POST http://localhost:5000/api/events/alertmanager \
  -H "Content-Type: application/json" \
  -d '{
    "alerts": [{
      "labels": {
        "alertname": "HighCPUUsage",
        "severity": "critical",
        "service": "cloudops-backend"
      },
      "annotations": {
        "summary": "High CPU utilization detected on cloudops-backend"
      }
    }]
  }'
```

CloudOps AI creates an incident → RAG + Ollama AI recommends `SCALE_SERVICE cloudops-backend → 4` → Policy Engine validates → Kubernetes executes → Verification confirms → Incident resolved.

---

## Testing

```bash
cd server
node --test tests/remediation.test.js tests/control_center.test.js tests/kubernetes.test.js
```

---

---

## Infrastructure Connections (Remote Agent Architecture)

CloudOps AI supports two operational modes:

### Operational Modes

- **MODE 1: Local Development (Docker + Minikube)**
  The control plane connects directly to the local Docker daemon and Minikube cluster running on the host system via local Kubeconfig and Docker sockets.
- **MODE 2: Connected Infrastructure (CloudOps Agent + Customer Clusters)**
  Users securely connect their own private Kubernetes clusters and Prometheus instances to CloudOps AI without exposing any internal APIs to the public internet.

```text
+-------------------------------------------------------------------------------+
|                       CLOUDOPS AI CONTROL PLANE                               |
|                                                                               |
|   React Frontend  <--->  Node/Express API  <--->  MongoDB                     |
|                                 |                                             |
|                     Policy Engine & RAG (Ollama)                              |
+-------------------------------------------------------------------------------+
                                      ^
                                      | OUTBOUND HTTPS ONLY
                                      | (Heartbeat / Telemetry / Command Polling)
+-------------------------------------------------------------------------------+
|                       CUSTOMER INFRASTRUCTURE                                 |
|                                                                               |
|   Local Prometheus (Private :9090)                                            |
|   Local Kubernetes Cluster (Private :6443)                                    |
|          ^                         ^                                          |
|          | (PromQL Whitelist)      | (Least-Privilege RBAC)                   |
|          +------------+------------+                                          |
|                       |                                                       |
|             CLOUDOPS AGENT (agent/)                                           |
+-------------------------------------------------------------------------------+
```

### Why the Connector Exists

Traditional SaaS monitoring and remediation platforms require customers to expose their internal Kubernetes API (:6443) or Prometheus server (:9090) over public endpoints or complex VPNs. CloudOps AI eliminates this security risk through an **outbound-only** agent:
- The customer infrastructure makes **outbound HTTPS requests only** to the CloudOps control plane.
- The control plane **never initiates inbound connections** to customer networks.
- Customer infrastructure services remain completely private and unreachable from the internet.

### Enrollment Flow

1. **Create Connection**: In the CloudOps AI UI (**Infrastructure Connections** -> **+ Add Infrastructure**), generate a connection.
2. **One-Time Enrollment Token**: The control plane generates a cryptographically secure, high-entropy enrollment token (`cope_...`). Only a SHA-256 hash is stored in MongoDB with a 24-hour expiry; the raw token is shown once to the user.
3. **Agent Registration**: The agent starts with `CLOUDOPS_URL` and `ENROLLMENT_TOKEN`. It calls `POST /api/agent/register` outbound.
4. **Credential Exchange**: The control plane verifies the token hash, marks the enrollment token as single-use, and issues a unique `agentId` and long-lived operational token (`copa_...`).
5. **Operational State**: The agent saves the operational token and begins periodic outbound loops. The connection transitions to `CONNECTED`.

### Agent Operations

- **Heartbeat (~20s)**: Agent sends health state to `POST /api/agent/heartbeat`. If heartbeat is missed for >60s, connection state updates to `DISCONNECTED`.
- **Telemetry (~10s)**: Agent queries local Prometheus using a strict whitelist of PromQL queries and inspects local Kubernetes resources, sending normalized telemetry to `POST /api/agent/telemetry`.
- **Command Polling (~5s)**: Agent polls `GET /api/agent/commands` for approved remediation actions.
- **Remediation Execution**: Agent executes approved actions and returns execution state to `POST /api/agent/command-result`.
- **Revocation**: Admins can click **Revoke Connection** in the UI to immediately revoke access, which invalidates agent tokens and blocks all future agent communications.

### Security Model & Guardrails

- **No Public API Inbound Ports**: Customer cluster remains behind private firewall/VPC.
- **Strict PromQL Whitelist**: Only controlled metrics (CPU, Memory, Request Rate, Error Rate, P95, Network) are queried. Arbitrary PromQL injection is blocked.
- **Strict Remediation Action Whitelist**: Only `RESTART_SERVICE` and `SCALE_SERVICE` on deployments in allowed namespaces are permitted. Arbitrary shell commands and kubectl scripts are strictly rejected.
- **Defense in Depth**: Both the backend Policy Engine AND the agent-side executor independently enforce whitelist checks, namespace constraints, and replica limits (`min: 1, max: 10`).
- **Replay Protection**: Every command has a unique `commandId`. The agent caches executed IDs and refuses duplicate executions.
- **Least-Privilege Kubernetes RBAC**: The agent runs under a scoped `ServiceAccount` with permissions only to read topology and patch deployments in specific namespaces (`cloudops`). No `cluster-admin`.
- **Two-Stage Verification**: State convergence is verified both locally on the agent and independently on the control plane.
- **Audit Logging**: Every remediation action and agent command is persisted in `RemediationAction` and `AgentCommand` collections.

---

## Security

- **Authentication**: JWT + bcrypt with httpOnly cookie support
- **Agent Security**: Outbound Bearer token authentication with SHA-256 token hashing
- **CORS**: Strict origin whitelist, configurable via `CORS_ORIGINS`
- **Rate Limiting**: Granular rate limiters for agent heartbeat, telemetry, registration, and polling
- **Helmet**: Security headers (CSP, HSTS, etc.)
- **Policy Engine**: Fail-closed — only whitelisted actions/targets/namespaces allowed
- **Input Validation**: Field whitelisting on create/update operations
- **Secret Management**: All secrets via environment variables, never hardcoded


---

## Project Structure

```
CloudOps-AI/
├── client/                     # React + Vite frontend
│   ├── src/
│   │   ├── pages/              # Overview, Incidents, AI Ops, K8s, etc.
│   │   ├── components/         # Layout, Sidebar, DarkVeil, Charts
│   │   ├── context/            # AuthContext, ThemeContext
│   │   ├── services/api.js     # API client
│   │   └── hooks/              # Custom React hooks
│   └── Dockerfile
├── server/                     # Express backend
│   ├── src/
│   │   ├── controllers/        # Auth, Incident, K8s, Metrics, etc.
│   │   ├── services/           # RAG, AI, Prometheus, Remediation, K8s
│   │   ├── middleware/         # Auth, Role-based access
│   │   ├── models/             # Mongoose schemas
│   │   ├── routes/             # Express routes
│   │   └── config/             # DB, Remediation policy config
│   └── Dockerfile
├── monitoring/
│   ├── prometheus/             # prometheus.yml, alerts.yml
│   └── alertmanager/           # alertmanager.yml
├── k8s/manifests/              # RBAC, demo workload
└── docker-compose.yml          # Full stack orchestration
```

---

## License

MIT
