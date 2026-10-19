const k8s = require("@kubernetes/client-node");
const fs = require("fs");
const path = require("path");
const os = require("os");

function resolveKubeconfigPath(p) {
    if (!p) return path.join(os.homedir(), ".kube", "config");
    if (p.startsWith("~/") || p === "~") {
        return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
}

function extractDiagnosticError(err) {
    if (!err) return "Unknown cluster error";
    let msg = err.message || String(err);
    if (msg === "fetch failed" || err.name === "TypeError") {
        const cause = err.cause;
        if (cause) {
            const causeCode = cause.code || "";
            const causeAddr = cause.address ? `${cause.address}${cause.port ? `:${cause.port}` : ""}` : "";
            if (causeCode === "ECONNREFUSED" || cause.message?.includes("ECONNREFUSED")) {
                return `Cluster API connection refused${causeAddr ? ` at ${causeAddr}` : ""} (apiserver not responding or Minikube stopped)`;
            }
            if (causeCode === "EHOSTUNREACH" || cause.message?.includes("EHOSTUNREACH")) {
                return `Cluster API host unreachable${causeAddr ? ` at ${causeAddr}` : ""} (Minikube host is down or IP changed)`;
            }
            if (causeCode === "ENETUNREACH" || cause.message?.includes("ENETUNREACH")) {
                return `Cluster API network unreachable${causeAddr ? ` at ${causeAddr}` : ""}`;
            }
            if (causeCode === "ETIMEDOUT" || cause.message?.includes("ETIMEDOUT")) {
                return `Cluster API connection timed out${causeAddr ? ` at ${causeAddr}` : ""}`;
            }
            if (cause.message) {
                return `Cluster API request failed: ${cause.message}`;
            }
        }
        return "Cluster API request failed (network or host connection failure)";
    }
    if (err.cause && err.cause.message && !msg.includes(err.cause.message)) {
        msg += ` (${err.cause.message})`;
    }
    return msg.replace(/(Bearer\s+)[A-Za-z0-9\-\._~\+\/]+=*/g, "$1[REDACTED]")
              .replace(/(\/home\/[^\/]+)/g, "~");
}

class KubernetesCollector {
    constructor(kubeconfigPath) {
        this.kc = new k8s.KubeConfig();
        this.isInitialized = false;
        this.kubeconfigPath = kubeconfigPath;

        this.initClient(kubeconfigPath);
    }

    initClient(kubeconfigPath) {
        try {
            const inClusterToken = "/var/run/secrets/kubernetes.io/serviceaccount/token";
            const targetPath = resolveKubeconfigPath(kubeconfigPath || this.kubeconfigPath);

            if (fs.existsSync(inClusterToken)) {
                this.kc.loadFromCluster();
                this.isInitialized = true;
                console.log("☸️ [AGENT K8S] Initialized client via In-Cluster ServiceAccount");
            } else if (targetPath && fs.existsSync(targetPath)) {
                this.kc.loadFromFile(targetPath);
                this.isInitialized = true;
                console.log(`☸️ [AGENT K8S] Initialized client via Kubeconfig (${targetPath})`);
            } else {
                try {
                    this.kc.loadFromDefault();
                    this.isInitialized = true;
                    console.log("☸️ [AGENT K8S] Initialized client via default Kubeconfig");
                } catch (e) {
                    this.isInitialized = false;
                    console.warn(`⚠️ [AGENT K8S] Kubernetes client not available: ${e.message}`);
                }
            }

            if (this.isInitialized) {
                this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
                this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
            }
        } catch (error) {
            this.isInitialized = false;
            console.warn(`⚠️ [AGENT K8S] Failed to initialize Kubernetes client: ${error.message}`);
        }
    }

    async collectClusterData(namespaces = ["cloudops", "default"]) {
        if (!this.isInitialized || !this.coreApi || !this.appsApi) {
            this.initClient(this.kubeconfigPath);
        }

        if (!this.isInitialized) {
            return {
                nodesCount: 0,
                podsCount: 0,
                deploymentsCount: 0,
                servicesCount: 0,
                nodes: [],
                pods: [],
                deployments: [],
                services: [],
                clusterConnected: false,
                k8sError: "Kubernetes client not initialized: verify ~/.kube/config or KUBECONFIG"
            };
        }

        let clusterConnected = true;
        let lastError = null;
        let successfulQueries = 0;

        try {
            // 1. Nodes
            let nodesList = [];
            try {
                const nodesRes = await this.coreApi.listNode();
                const nodeItems = nodesRes.body?.items || nodesRes.items || [];
                nodesList = nodeItems.map(node => {
                    const readyCond = node.status?.conditions?.find(c => c.type === "Ready");
                    return {
                        name: node.metadata?.name,
                        status: readyCond?.status === "True" ? "Ready" : "NotReady",
                        kubeletVersion: node.status?.nodeInfo?.kubeletVersion || "unknown",
                        os: node.status?.nodeInfo?.osImage || "linux",
                        cpu: node.status?.capacity?.cpu || "N/A",
                        memory: node.status?.capacity?.memory || "N/A"
                    };
                });
                successfulQueries++;
            } catch (nodeErr) {
                // If RBAC role is scoped to namespace only (least-privilege) or cluster is down
                lastError = extractDiagnosticError(nodeErr);
                console.log(`ℹ️ [AGENT K8S] Node read restricted or omitted: ${lastError}`);
            }

            // 2. Pods across namespaces
            const podsList = [];
            for (const ns of namespaces) {
                try {
                    const podsRes = await this.coreApi.listNamespacedPod({ namespace: ns });
                    const podItems = podsRes.body?.items || podsRes.items || [];
                    for (const pod of podItems) {
                        const restartCount = (pod.status?.containerStatuses || []).reduce(
                            (acc, c) => acc + (c.restartCount || 0), 0
                        );
                        podsList.push({
                            name: pod.metadata?.name,
                            namespace: ns,
                            status: pod.status?.phase || "Unknown",
                            ready: (pod.status?.containerStatuses || []).every(c => c.ready) ? "Ready" : "NotReady",
                            restarts: restartCount,
                            ip: pod.status?.podIP || "Pending",
                            createdAt: pod.metadata?.creationTimestamp
                        });
                    }
                    successfulQueries++;
                } catch (e) {
                    lastError = extractDiagnosticError(e);
                }
            }

            // 3. Deployments
            const deploymentsList = [];
            for (const ns of namespaces) {
                try {
                    const depRes = await this.appsApi.listNamespacedDeployment({ namespace: ns });
                    const depItems = depRes.body?.items || depRes.items || [];
                    for (const dep of depItems) {
                        deploymentsList.push({
                            name: dep.metadata?.name,
                            namespace: ns,
                            replicas: dep.spec?.replicas || 0,
                            readyReplicas: dep.status?.readyReplicas || 0,
                            availableReplicas: dep.status?.availableReplicas || 0,
                            updatedReplicas: dep.status?.updatedReplicas || 0,
                            image: dep.spec?.template?.spec?.containers?.[0]?.image || "unknown"
                        });
                    }
                    successfulQueries++;
                } catch (e) {
                    lastError = extractDiagnosticError(e);
                }
            }

            // 4. Services
            const servicesList = [];
            for (const ns of namespaces) {
                try {
                    const svcRes = await this.coreApi.listNamespacedService({ namespace: ns });
                    const svcItems = svcRes.body?.items || svcRes.items || [];
                    for (const svc of svcItems) {
                        servicesList.push({
                            name: svc.metadata?.name,
                            namespace: ns,
                            type: svc.spec?.type || "ClusterIP",
                            clusterIP: svc.spec?.clusterIP || "None",
                            ports: (svc.spec?.ports || []).map(p => `${p.port}/${p.protocol}`).join(", ")
                        });
                    }
                    successfulQueries++;
                } catch (e) {
                    lastError = extractDiagnosticError(e);
                }
            }

            // If zero queries succeeded and an error occurred, cluster is unreachable
            if (successfulQueries === 0 && lastError) {
                clusterConnected = false;
            }

            return {
                nodesCount: nodesList.length,
                podsCount: podsList.length,
                deploymentsCount: deploymentsList.length,
                servicesCount: servicesList.length,
                nodes: nodesList,
                pods: podsList,
                deployments: deploymentsList,
                services: servicesList,
                clusterConnected,
                k8sError: clusterConnected ? null : (lastError || "Kubernetes cluster query failed")
            };
        } catch (error) {
            const diagError = extractDiagnosticError(error);
            console.error(`❌ [AGENT K8S] Error collecting cluster data: ${diagError}`);
            return {
                nodesCount: 0,
                podsCount: 0,
                deploymentsCount: 0,
                servicesCount: 0,
                nodes: [],
                pods: [],
                deployments: [],
                services: [],
                clusterConnected: false,
                k8sError: diagError
            };
        }
    }
}

KubernetesCollector.extractDiagnosticError = extractDiagnosticError;
KubernetesCollector.resolveKubeconfigPath = resolveKubeconfigPath;

module.exports = KubernetesCollector;
