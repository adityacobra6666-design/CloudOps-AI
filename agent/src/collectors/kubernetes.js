const k8s = require("@kubernetes/client-node");
const fs = require("fs");

class KubernetesCollector {
    constructor(kubeconfigPath) {
        this.kc = new k8s.KubeConfig();
        this.isInitialized = false;

        this.initClient(kubeconfigPath);
    }

    initClient(kubeconfigPath) {
        try {
            const inClusterToken = "/var/run/secrets/kubernetes.io/serviceaccount/token";

            if (fs.existsSync(inClusterToken)) {
                this.kc.loadFromCluster();
                this.isInitialized = true;
                console.log("☸️ [AGENT K8S] Initialized client via In-Cluster ServiceAccount");
            } else if (kubeconfigPath && fs.existsSync(kubeconfigPath)) {
                this.kc.loadFromFile(kubeconfigPath);
                this.isInitialized = true;
                console.log(`☸️ [AGENT K8S] Initialized client via Kubeconfig (${kubeconfigPath})`);
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
                k8sError: "Kubernetes client not initialized"
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
                lastError = nodeErr.message;
                console.log(`ℹ️ [AGENT K8S] Node read restricted or omitted: ${nodeErr.message}`);
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
                    lastError = e.message;
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
                    lastError = e.message;
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
                    lastError = e.message;
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
            console.error(`❌ [AGENT K8S] Error collecting cluster data: ${error.message}`);
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
                k8sError: error.message
            };
        }
    }
}

module.exports = KubernetesCollector;
