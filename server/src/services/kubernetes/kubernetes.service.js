const k8s = require("@kubernetes/client-node");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { KUBERNETES_CONFIG } = require("../../config/remediation.config");

class KubernetesService {
    constructor() {
        this.kc = new k8s.KubeConfig();
        this.isInitialized = false;
        this.configSource = "none";
        this.initError = null;
        this.coreApi = null;
        this.appsApi = null;

        this.initClient();
    }

    initClient() {
        try {
            const customKubeconfig = process.env.KUBECONFIG;
            const userKubeconfig = path.join(os.homedir(), ".kube", "config");
            const rootKubeconfig = "/root/.kube/config";
            const inClusterToken = "/var/run/secrets/kubernetes.io/serviceaccount/token";

            let configLoaded = false;

            const loadAdjustedKubeconfig = (filePath) => {
                const rawContent = fs.readFileSync(filePath, "utf8");
                const containerHome = os.homedir();
                const adjustedContent = rawContent
                    .replace(/\/home\/[^\/]+\/\.minikube/g, `${containerHome}/.minikube`)
                    .replace(/~\/\.minikube/g, `${containerHome}/.minikube`);
                this.kc.loadFromString(adjustedContent);
            };

            // 1. Prefer custom KUBECONFIG if file exists
            if (customKubeconfig && fs.existsSync(customKubeconfig)) {
                loadAdjustedKubeconfig(customKubeconfig);
                configLoaded = true;
                this.configSource = `KUBECONFIG (${customKubeconfig})`;
            }
            // 2. Try container root user config (/root/.kube/config)
            else if (fs.existsSync(rootKubeconfig)) {
                loadAdjustedKubeconfig(rootKubeconfig);
                configLoaded = true;
                this.configSource = `Root Kubeconfig (${rootKubeconfig})`;
            }
            // 3. Try standard user home config (~/.kube/config)
            else if (fs.existsSync(userKubeconfig)) {
                loadAdjustedKubeconfig(userKubeconfig);
                configLoaded = true;
                this.configSource = `User Kubeconfig (${userKubeconfig})`;
            }
            // 4. Try in-cluster service account token if running inside Kubernetes pod
            else if (fs.existsSync(inClusterToken)) {
                this.kc.loadFromCluster();
                configLoaded = true;
                this.configSource = "In-Cluster ServiceAccount";
            }
            // 5. Try loadFromDefault fallback
            else {
                try {
                    this.kc.loadFromDefault();
                    if (this.kc.currentContext && this.kc.currentContext !== "loaded-context") {
                        configLoaded = true;
                        this.configSource = "loadFromDefault";
                    }
                } catch (e) {
                    configLoaded = false;
                }
            }

            if (!configLoaded) {
                this.isInitialized = false;
                this.initError = "No valid Kubernetes kubeconfig found (~/.kube/config or KUBECONFIG env var) and not running inside a Kubernetes cluster.";
                console.log(`⚠️ Kubernetes service client: ${this.initError}`);
                return;
            }

            const isDocker = fs.existsSync("/.dockerenv") || process.env.IS_DOCKER === "true";
            const containerHome = os.homedir();

            // Process Cluster Endpoints & Host Resolution
            if (this.kc.clusters) {
                this.kc.clusters.forEach((cluster) => {
                    if (cluster.caFile) {
                        const rewritten = cluster.caFile.replace(/\/home\/[^\/]+\/\.minikube/g, `${containerHome}/.minikube`).replace(/^~\/\.minikube/g, `${containerHome}/.minikube`);
                        if (fs.existsSync(rewritten)) {
                            cluster.caFile = rewritten;
                        } else {
                            cluster.caFile = undefined;
                            cluster.skipTLSVerify = true;
                        }
                    }

                    if (cluster.server) {
                        // Inside Docker containers, 127.0.0.1 / localhost points to the container itself.
                        // Rewrite 127.0.0.1 / localhost to host.docker.internal (or KUBERNETES_SERVER_HOST)
                        // to reach the host system's Kubernetes API server (Minikube / Kind).
                        if (isDocker && (cluster.server.includes("127.0.0.1") || cluster.server.includes("localhost"))) {
                            const targetHost = process.env.KUBERNETES_SERVER_HOST || "host.docker.internal";
                            const oldServer = cluster.server;
                            cluster.server = cluster.server
                                .replace("127.0.0.1", targetHost)
                                .replace("localhost", targetHost);
                            console.log(`🐳 Docker host resolution rewrite: ${oldServer} → ${cluster.server}`);

                            if (process.env.KUBERNETES_SKIP_TLS !== "false") {
                                cluster.skipTLSVerify = true;
                            }
                        }

                        // For plain http:// URLs, client-node requires skipTLSVerify = true
                        if (cluster.server.startsWith("http://")) {
                            if (cluster.skipTLSVerify === undefined || cluster.skipTLSVerify === null) {
                                cluster.skipTLSVerify = true;
                            }
                        }
                    }
                });
            }

            if (this.kc.users) {
                this.kc.users.forEach((u) => {
                    if (u.certFile) {
                        u.certFile = u.certFile.replace(/\/home\/[^\/]+\/\.minikube/g, `${containerHome}/.minikube`).replace(/^~\/\.minikube/g, `${containerHome}/.minikube`);
                    }
                    if (u.keyFile) {
                        u.keyFile = u.keyFile.replace(/\/home\/[^\/]+\/\.minikube/g, `${containerHome}/.minikube`).replace(/^~\/\.minikube/g, `${containerHome}/.minikube`);
                    }
                    if (u.user && u.user["client-certificate"]) {
                        u.user["client-certificate"] = u.user["client-certificate"].replace(/\/home\/[^\/]+\/\.minikube/g, `${containerHome}/.minikube`).replace(/^~\/\.minikube/g, `${containerHome}/.minikube`);
                    }
                    if (u.user && u.user["client-key"]) {
                        u.user["client-key"] = u.user["client-key"].replace(/\/home\/[^\/]+\/\.minikube/g, `${containerHome}/.minikube`).replace(/^~\/\.minikube/g, `${containerHome}/.minikube`);
                    }
                });
            }

            this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
            this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
            this.isInitialized = true;
            this.initError = null;
            console.log(`✅ Kubernetes service client initialized using ${this.configSource} (Context: "${this.kc.currentContext || "default"}")`);
        } catch (err) {
            this.isInitialized = false;
            this.initError = `Failed to initialize Kubernetes client: ${err.message}`;
            console.log(`⚠️ Kubernetes service client init warning: ${err.message}`);
        }
    }

    checkConnection() {
        if (!this.isInitialized || !this.coreApi || !this.appsApi) {
            this.initClient();
        }
        return this.isInitialized;
    }

    getDefaultNamespace() {
        return process.env.KUBERNETES_NAMESPACE || KUBERNETES_CONFIG.defaultNamespace || "all";
    }

    sanitizeError(error) {
        if (!error) return "Unknown Kubernetes API error";
        let msg = error.message || String(error);
        if (error.cause && error.cause.message) {
            msg += ` (${error.cause.message})`;
        }
        // Redact any tokens or raw sensitive paths
        return msg.replace(/(Bearer\s+)[A-Za-z0-9\-\._~\+\/]+=*/g, "$1[REDACTED]")
                  .replace(/(\/home\/[^\/]+)/g, "~");
    }

    // =========================================
    // CLUSTER STATUS
    // =========================================
    async getClusterStatus() {
        if (!this.checkConnection()) {
            return {
                success: true,
                connected: false,
                mode: "unconfigured",
                cluster: null,
                namespace: this.getDefaultNamespace(),
                message: this.initError || "Kubernetes configuration not found. Set KUBECONFIG or place config in ~/.kube/config."
            };
        }

        try {
            const currentContext = this.kc.getCurrentContext();
            const currentCluster = this.kc.getCurrentCluster();
            const serverUrl = currentCluster ? currentCluster.server : "unknown";

            // Test actual connection to cluster API server via listNode
            const nodesRes = await this.coreApi.listNode();
            const items = nodesRes?.body?.items || nodesRes?.items || [];
            const nodeCount = items.length;

            return {
                success: true,
                connected: true,
                mode: "kubernetes",
                cluster: currentContext || "k8s-cluster",
                server: serverUrl,
                namespace: this.getDefaultNamespace(),
                nodeCount,
                message: `Kubernetes cluster "${currentContext || "k8s-cluster"}" connected successfully (${serverUrl})`
            };
        } catch (error) {
            const currentCluster = this.kc.getCurrentCluster();
            const serverUrl = currentCluster ? currentCluster.server : "unknown";
            const sanitizedMsg = this.sanitizeError(error);

            return {
                success: true,
                connected: false,
                mode: "unreachable",
                cluster: this.kc.getCurrentContext() || null,
                server: serverUrl,
                namespace: this.getDefaultNamespace(),
                message: `Kubernetes API connection failed (${serverUrl}). Check cluster status: ${sanitizedMsg}`
            };
        }
    }

    // =========================================
    // NODES
    // =========================================
    async getNodes() {
        if (!this.checkConnection()) return [];

        try {
            const res = await this.coreApi.listNode();
            const items = res?.body?.items || res?.items || [];

            return items.map((node) => {
                const conditions = node.status?.conditions || [];
                const readyCondition = conditions.find((c) => c.type === "Ready");
                const isReady = readyCondition?.status === "True";

                const labels = node.metadata?.labels || {};
                const roles = Object.keys(labels)
                    .filter((k) => k.startsWith("node-role.kubernetes.io/"))
                    .map((k) => k.replace("node-role.kubernetes.io/", ""))
                    .join(", ") || "worker";

                return {
                    name: node.metadata?.name || "unknown",
                    status: isReady ? "Ready" : "NotReady",
                    roles,
                    kubeletVersion: node.status?.nodeInfo?.kubeletVersion || "N/A",
                    osImage: node.status?.nodeInfo?.osImage || "N/A",
                    containerRuntime: node.status?.nodeInfo?.containerRuntimeVersion || "N/A",
                    cpu: node.status?.capacity?.cpu || "N/A",
                    memory: node.status?.capacity?.memory || "N/A",
                    creationTimestamp: node.metadata?.creationTimestamp
                };
            });
        } catch (error) {
            console.error("Failed to fetch Kubernetes nodes:", this.sanitizeError(error));
            return [];
        }
    }

    // =========================================
    // PODS
    // =========================================
    async getPods(namespace) {
        if (!this.checkConnection()) return [];
        const ns = namespace || this.getDefaultNamespace();

        try {
            let res;
            if (ns === "all") {
                res = await this.coreApi.listPodForAllNamespaces();
            } else {
                res = await this.coreApi.listNamespacedPod({ namespace: ns }).catch(() => this.coreApi.listNamespacedPod(ns));
            }

            const items = res?.body?.items || res?.items || [];

            return items.map((pod) => {
                const containerStatuses = pod.status?.containerStatuses || [];
                const totalContainers = pod.spec?.containers?.length || 0;
                const readyContainers = containerStatuses.filter((c) => c.ready).length;
                const restarts = containerStatuses.reduce((acc, c) => acc + (c.restartCount || 0), 0);

                let status = pod.status?.phase || "Unknown";
                const waitingContainer = containerStatuses.find((c) => c.state?.waiting);
                if (waitingContainer?.state?.waiting?.reason) {
                    status = waitingContainer.state.waiting.reason;
                }

                return {
                    name: pod.metadata?.name || "unknown",
                    namespace: pod.metadata?.namespace || ns,
                    status,
                    ready: `${readyContainers}/${totalContainers}`,
                    readyCount: readyContainers,
                    totalCount: totalContainers,
                    restarts,
                    node: pod.spec?.nodeName || "unassigned",
                    ip: pod.status?.podIP || "N/A",
                    creationTimestamp: pod.metadata?.creationTimestamp
                };
            });
        } catch (error) {
            console.error("Failed to fetch Kubernetes pods:", this.sanitizeError(error));
            return [];
        }
    }

    // =========================================
    // DEPLOYMENTS
    // =========================================
    async getDeployments(namespace) {
        if (!this.checkConnection()) return [];
        const ns = namespace || this.getDefaultNamespace();

        try {
            let res;
            if (ns === "all") {
                res = await this.appsApi.listDeploymentForAllNamespaces();
            } else {
                res = await this.appsApi.listNamespacedDeployment({ namespace: ns }).catch(() => this.appsApi.listNamespacedDeployment(ns));
            }

            const items = res?.body?.items || res?.items || [];

            return items.map((dep) => {
                const desired = dep.spec?.replicas ?? 0;
                const current = dep.status?.replicas ?? 0;
                const ready = dep.status?.readyReplicas ?? 0;
                const available = dep.status?.availableReplicas ?? 0;

                const isHealthy = ready === desired && desired > 0;

                const containers = dep.spec?.template?.spec?.containers || [];
                const images = containers.map((c) => c.image);

                return {
                    name: dep.metadata?.name || "unknown",
                    namespace: dep.metadata?.namespace || ns,
                    desired,
                    current,
                    ready,
                    available,
                    status: isHealthy ? "HEALTHY" : (ready === 0 && desired > 0 ? "FAILED" : "DEGRADED"),
                    images,
                    creationTimestamp: dep.metadata?.creationTimestamp
                };
            });
        } catch (error) {
            console.error("Failed to fetch Kubernetes deployments:", this.sanitizeError(error));
            return [];
        }
    }

    // =========================================
    // SERVICES
    // =========================================
    async getServices(namespace) {
        if (!this.checkConnection()) return [];
        const ns = namespace || this.getDefaultNamespace();

        try {
            let res;
            if (ns === "all") {
                res = await this.coreApi.listServiceForAllNamespaces();
            } else {
                res = await this.coreApi.listNamespacedService({ namespace: ns }).catch(() => this.coreApi.listNamespacedService(ns));
            }

            const items = res?.body?.items || res?.items || [];

            return items.map((svc) => {
                const ports = (svc.spec?.ports || [])
                    .map((p) => `${p.port}${p.targetPort ? ":" + p.targetPort : ""}/${p.protocol || "TCP"}`)
                    .join(", ");

                return {
                    name: svc.metadata?.name || "unknown",
                    namespace: svc.metadata?.namespace || ns,
                    type: svc.spec?.type || "ClusterIP",
                    clusterIP: svc.spec?.clusterIP || "None",
                    ports: ports || "N/A",
                    creationTimestamp: svc.metadata?.creationTimestamp
                };
            });
        } catch (error) {
            console.error("Failed to fetch Kubernetes services:", this.sanitizeError(error));
            return [];
        }
    }

    // =========================================
    // OPERATIONAL OVERVIEW
    // =========================================
    async getOverview(namespace) {
        const ns = namespace || this.getDefaultNamespace();
        const status = await this.getClusterStatus();

        if (!status.connected) {
            return {
                success: true,
                connected: false,
                mode: status.mode || "unconfigured",
                cluster: status.cluster,
                server: status.server,
                namespace: ns,
                message: status.message,
                nodes: [],
                pods: [],
                deployments: [],
                services: [],
                summary: {
                    nodesReady: 0,
                    nodesTotal: 0,
                    podsRunning: 0,
                    podsTotal: 0,
                    deploymentsHealthy: 0,
                    deploymentsTotal: 0,
                    servicesTotal: 0
                }
            };
        }

        const [nodes, pods, deployments, services] = await Promise.all([
            this.getNodes(),
            this.getPods(ns),
            this.getDeployments(ns),
            this.getServices(ns)
        ]);

        const nodesReady = nodes.filter((n) => n.status === "Ready").length;
        const podsRunning = pods.filter((p) => p.status === "Running").length;
        const deploymentsHealthy = deployments.filter((d) => d.status === "HEALTHY").length;

        return {
            success: true,
            connected: true,
            mode: "kubernetes",
            cluster: status.cluster,
            server: status.server,
            namespace: ns,
            nodes,
            pods,
            deployments,
            services,
            summary: {
                nodesReady,
                nodesTotal: nodes.length,
                podsRunning,
                podsTotal: pods.length,
                deploymentsHealthy,
                deploymentsTotal: deployments.length,
                servicesTotal: services.length
            }
        };
    }

    // =========================================
    // HEALTH ENDPOINT PAYLOAD
    // =========================================
    async getHealth() {
        const overview = await this.getOverview();
        if (!overview.connected) {
            return {
                success: true,
                connected: false,
                mode: overview.mode,
                message: overview.message,
                nodesReady: 0,
                nodesTotal: 0,
                podsRunning: 0,
                podsTotal: 0,
                deploymentsHealthy: 0,
                deploymentsTotal: 0
            };
        }

        return {
            success: true,
            connected: true,
            mode: "kubernetes",
            cluster: overview.cluster,
            namespace: overview.namespace,
            nodesReady: overview.summary.nodesReady,
            nodesTotal: overview.summary.nodesTotal,
            podsRunning: overview.summary.podsRunning,
            podsTotal: overview.summary.podsTotal,
            deploymentsHealthy: overview.summary.deploymentsHealthy,
            deploymentsTotal: overview.summary.deploymentsTotal
        };
    }

    // =========================================
    // READ SPECIFIC DEPLOYMENT
    // =========================================
    async getDeployment(name, namespace) {
        if (!this.checkConnection()) throw new Error("Kubernetes client not initialized");
        const ns = namespace || this.getDefaultNamespace();

        let res;
        try {
            if (this.appsApi.readNamespacedDeployment.length === 1) {
                res = await this.appsApi.readNamespacedDeployment({ name, namespace: ns });
            } else {
                res = await this.appsApi.readNamespacedDeployment(name, ns);
            }
        } catch (err) {
            res = await this.appsApi.readNamespacedDeployment({ name, namespace: ns }).catch(() => null)
                || await this.appsApi.readNamespacedDeployment(name, ns).catch(() => null);
        }

        const dep = res?.body || res;
        if (!dep) {
            throw new Error(`Deployment "${name}" not found in namespace "${ns}"`);
        }

        return {
            name: dep.metadata?.name || name,
            namespace: dep.metadata?.namespace || ns,
            desired: dep.spec?.replicas ?? 0,
            current: dep.status?.replicas ?? 0,
            ready: dep.status?.readyReplicas ?? 0,
            available: dep.status?.availableReplicas ?? 0
        };
    }

    // =========================================
    // SCALE DEPLOYMENT
    // =========================================
    async scaleDeployment(name, newReplicas, namespace) {
        const ns = namespace || this.getDefaultNamespace();
        const min = KUBERNETES_CONFIG.minReplicas || 1;
        const max = KUBERNETES_CONFIG.maxReplicas || 10;

        const targetReplicas = Number(newReplicas);

        if (isNaN(targetReplicas) || targetReplicas < min || targetReplicas > max) {
            throw new Error(`Invalid replica count (${newReplicas}). Must be between ${min} and ${max}.`);
        }

        if (!this.checkConnection()) {
            throw new Error("Kubernetes client is not initialized");
        }

        console.log(`☸️ Scaling deployment "${name}" in namespace "${ns}" to ${targetReplicas} replicas`);

        const currentDep = await this.getDeployment(name, ns).catch(() => ({ desired: 1 }));
        const previousReplicas = currentDep.desired;

        const patch = {
            spec: {
                replicas: targetReplicas
            }
        };

        const contentType = k8s.PatchUtils?.PATCH_FORMAT_STRATEGIC_MERGE_PATCH || "application/strategic-merge-patch+json";
        const options = { headers: { "Content-Type": contentType } };

        try {
            if (this.appsApi.patchNamespacedDeployment.length === 1) {
                await this.appsApi.patchNamespacedDeployment({ name, namespace: ns, body: patch, options });
            } else {
                await this.appsApi.patchNamespacedDeployment(name, ns, patch, undefined, undefined, undefined, undefined, undefined, options);
            }
        } catch (patchErr) {
            await this.appsApi.patchNamespacedDeployment({ name, namespace: ns, body: patch, options });
        }

        return {
            success: true,
            deployment: name,
            namespace: ns,
            previousReplicas,
            newReplicas: targetReplicas,
            message: `Successfully updated deployment "${name}" replicas from ${previousReplicas} to ${targetReplicas}`
        };
    }

    // =========================================
    // RESTART DEPLOYMENT (Rolling Restart)
    // =========================================
    async restartDeployment(name, namespace) {
        if (!this.checkConnection()) {
            throw new Error("Kubernetes client is not initialized");
        }

        const ns = namespace || this.getDefaultNamespace();

        console.log(`☸️ Triggering rolling restart for deployment "${name}" in namespace "${ns}"`);

        const patch = {
            spec: {
                template: {
                    metadata: {
                        annotations: {
                            "kubectl.kubernetes.io/restartedAt": new Date().toISOString()
                        }
                    }
                }
            }
        };

        const contentType = k8s.PatchUtils?.PATCH_FORMAT_STRATEGIC_MERGE_PATCH || "application/strategic-merge-patch+json";
        const options = { headers: { "Content-Type": contentType } };

        try {
            if (this.appsApi.patchNamespacedDeployment.length === 1) {
                await this.appsApi.patchNamespacedDeployment({ name, namespace: ns, body: patch, options });
            } else {
                await this.appsApi.patchNamespacedDeployment(name, ns, patch, undefined, undefined, undefined, undefined, undefined, options);
            }
        } catch (patchErr) {
            await this.appsApi.patchNamespacedDeployment({ name, namespace: ns, body: patch, options });
        }

        return {
            success: true,
            deployment: name,
            namespace: ns,
            restartedAt: new Date().toISOString(),
            message: `Rolling restart initiated for deployment "${name}" in namespace "${ns}"`
        };
    }

    // =========================================
    // CONVERGENCE VERIFICATION
    // =========================================
    async waitForDeploymentConvergence(name, expectedReplicas, namespace, maxWaitMs = 30000, pollIntervalMs = 2000) {
        const ns = namespace || this.getDefaultNamespace();
        const startTime = Date.now();

        if (!this.checkConnection()) {
            return {
                converged: false,
                readyReplicas: 0,
                availableReplicas: 0,
                desiredReplicas: expectedReplicas,
                elapsedMs: 0,
                message: "Kubernetes client not initialized"
            };
        }

        console.log(`⏳ Waiting for deployment "${name}" to converge to ${expectedReplicas} ready replicas...`);

        while (Date.now() - startTime < maxWaitMs) {
            try {
                const status = await this.getDeployment(name, ns);
                if (status.ready === expectedReplicas && status.available === expectedReplicas) {
                    console.log(`✅ Deployment "${name}" converged: ${status.ready}/${expectedReplicas} replicas ready.`);
                    return {
                        converged: true,
                        readyReplicas: status.ready,
                        availableReplicas: status.available,
                        desiredReplicas: expectedReplicas,
                        elapsedMs: Date.now() - startTime
                    };
                }
            } catch (err) {
                console.warn(`Polling deployment "${name}" status:`, this.sanitizeError(err));
                return {
                    converged: false,
                    readyReplicas: 0,
                    availableReplicas: 0,
                    desiredReplicas: expectedReplicas,
                    elapsedMs: Date.now() - startTime,
                    message: `Kubernetes convergence check failed: ${this.sanitizeError(err)}`
                };
            }

            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        const finalStatus = await this.getDeployment(name, ns).catch(() => ({ ready: 0, available: 0 }));
        return {
            converged: false,
            readyReplicas: finalStatus.ready,
            availableReplicas: finalStatus.available,
            desiredReplicas: expectedReplicas,
            elapsedMs: Date.now() - startTime
        };
    }
}

// Singleton instance export
const kubernetesService = new KubernetesService();

module.exports = {
    KubernetesService,
    kubernetesService
};
