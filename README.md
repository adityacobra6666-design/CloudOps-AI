# CloudOps AI — RAG-driven Autonomous Cloud Operations & Reliability Platform

CloudOps AI is an enterprise AIOps platform that combines **Prometheus Monitoring**, **Alertmanager**, **RAG (Retrieval-Augmented Generation)**, **Ollama (Llama 3.2)**, and an **Autonomous Remediation & Policy Engine** with **Native Kubernetes Orchestration**.

---

## 🏗 Target Architecture (Phase 1 & Phase 2)

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

## 🚀 Key Features

- **Autonomous Remediation (Phase 1 & Phase 2)**: Automatically reacts to Prometheus alerts (e.g. High CPU, Service Down) by executing approved actions.
- **Native Kubernetes Client Integration**: Uses `@kubernetes/client-node` for real REST API calls to cluster API servers.
- **Deterministic Policy Engine**: Fail-closed guardrails. The AI only recommends actions; the Policy Engine validates target deployment, namespace, and replica count (min: 1, max: 10).
- **Two-Stage Verification**: Confirms Kubernetes pod convergence (`availableReplicas === desiredReplicas`) and checks Prometheus recovery before marking `SUCCESS`.
- **Cloud Operations Control Center**: Single React dashboard on `http://localhost:5173` with Sky Blue + Dark Navy styling, real-time node/pod/deployment telemetry, and manual trigger controls.
- **RBAC & Local Manifests**: Clean YAML manifests for Minikube/Kind deployment.

---

## 🛠 Configuration & Environment Variables

Key backend environment variables (`server/.env` or Docker environment):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `KUBERNETES_ENABLED` | `true` | Enable/disable Kubernetes client |
| `KUBECONFIG` | `~/.kube/config` | Path to local Kubeconfig (optional, auto-detects in-cluster) |
| `KUBERNETES_NAMESPACE` | `cloudops` | Default target namespace |
| `REMEDIATION_EXECUTOR` | `kubernetes` | `kubernetes` (auto-fallbacks to `docker` if cluster unconfigured) |
| `PROMETHEUS_URL` | `http://localhost:9090` | Prometheus base URL for metric verification |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Base URL for Ollama LLM service |

---

## 📦 Kubernetes RBAC & Manifests

Manifests are located in [`k8s/manifests/`](file:///home/aadi/Projects/CloudOps-AI/k8s/manifests):

1. **[`rbac.yaml`](file:///home/aadi/Projects/CloudOps-AI/k8s/manifests/rbac.yaml)**:
   - `ServiceAccount`: `cloudops-sa`
   - `Role`: `cloudops-role` (Namespaced permissions for deployments, scale, pods, services)
   - `ClusterRole`: `cloudops-node-reader` (Cluster-wide read for node metrics)
   - `RoleBinding` & `ClusterRoleBinding`
2. **[`demo-workload.yaml`](file:///home/aadi/Projects/CloudOps-AI/k8s/manifests/demo-workload.yaml)**:
   - `Namespace`: `cloudops`
   - `Deployment`: `cloudops-backend` (initial 2 replicas)
   - `Service`: `cloudops-backend`

---

## ⚡ Local Kubernetes Demo Instructions (Minikube / Kind)

To demonstrate live Kubernetes scaling and remediation:

### Step 1: Start Local Cluster (Minikube or Kind)

```bash
# Minikube option:
minikube start

# OR Kind option:
kind create cluster --name cloudops
```

### Step 2: Deploy Demo Workload & RBAC

```bash
kubectl apply -f k8s/manifests/demo-workload.yaml
kubectl apply -f k8s/manifests/rbac.yaml
```

Verify deployment is ready:
```bash
kubectl get deployments -n cloudops
# Output: cloudops-backend   2/2     2            2
```

### Step 3: Run CloudOps AI Platform

```bash
# Terminal 1: Backend
cd server
npm run dev

# Terminal 2: Frontend
cd client
npm run dev
```

Visit **`http://localhost:5173/kubernetes`** to view live cluster topology (Nodes, Pods, Deployments, and Audit Log).

### Step 4: Demonstrate Autonomous & Manual Remediation

1. **Manual UI Trigger**:
   - Navigate to `/kubernetes` page.
   - Click **"⚡ Scale"** on `cloudops-backend`.
   - Set replicas to `4`.
   - Click **"Confirm Scale"**.
   - Observe real-time status update: `2 → 4 replicas`, K8s pod convergence verification, and audit log entry recorded.

2. **Autonomous Prometheus Flow**:
   - Post simulated CPU alert to `/api/events/alertmanager`:
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
   - CloudOps AI creates an incident, uses RAG + Ollama AI to recommend `SCALE_SERVICE cloudops-backend -> 4`, validates policy, executes scale via `@kubernetes/client-node`, verifies convergence, and resolves the incident automatically.

---

## 🧪 Unit & Integration Testing

Run the full test suite (37 tests across remediation, control center, and Kubernetes integration):

```bash
cd server
node --test tests/remediation.test.js tests/control_center.test.js tests/kubernetes.test.js
```
