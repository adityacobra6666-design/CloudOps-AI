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

            const resolveExistingPath = (filePath) => {
                if (!filePath) return undefined;
                if (fs.existsSync(filePath)) return filePath;
                const containerHome = os.homedir();
                const rewritten = filePath
                    .replace(/\/home\/[^\/]+\/\.minikube/g, `${containerHome}/.minikube`)
                    .replace(/^~\/\.minikube/g, `${containerHome}/.minikube`);
                if (fs.existsSync(rewritten)) return rewritten;
                return undefined;
            };

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

            // Process Cluster Endpoints & Host Resolution
            if (this.kc.clusters) {
                this.kc.clusters.forEach((cluster) => {
                    if (cluster.caFile) {
                        const validPath = resolveExistingPath(cluster.caFile);
                        if (validPath) {
                            cluster.caFile = validPath;
                        } else {
                            cluster.caFile = undefined;
                            cluster.skipTLSVerify = true;
                        }
                    }

                    if (cluster.server) {
                        // Inside Docker containers, 127.0.0.1 / localhost points to the container itself.
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
                        u.certFile = resolveExistingPath(u.certFile);
                    }
                    if (u.keyFile) {
                        u.keyFile = resolveExistingPath(u.keyFile);
                    }
                    if (u.user && u.user["client-certificate"]) {
                        u.user["client-certificate"] = resolveExistingPath(u.user["client-certificate"]);
                    }
                    if (u.user && u.user["client-key"]) {
                        u.user["client-key"] = resolveExistingPath(u.user["client-key"]);
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

    extractStatusCode(error) {
        if (!error) return null;
        if (typeof error.statusCode === "number") return error.statusCode;
        if (error.response && typeof error.response.statusCode === "number") return error.response.statusCode;
        if (error.body) {
            try {
                const b = typeof error.body === "string" ? JSON.parse(error.body) : error.body;
                if (typeof b?.code === "number") return b.code;
            } catch (e) {}
        }
        const match = (error.message || "").match(/HTTP-Code:\s*(\d+)/i);
        if (match) return parseInt(match[1], 10);
        return null;
    }

    extractErrorMessage(error) {
        if (!error) return null;
        if (error.body) {
            try {
                const b = typeof error.body === "string" ? JSON.parse(error.body) : error.body;
                if (b?.message) return b.message;
            } catch (e) {}
        }
        return null;
    }

    sanitizeError(error) {
        if (!error) return "Unknown Kubernetes API error";
        let parsedBody = null;
        if (error.body) {
            try {
                parsedBody = typeof error.body === "string" ? JSON.parse(error.body) : error.body;
            } catch (e) {}
        }
        if (parsedBody && parsedBody.message) {
            return parsedBody.message;
        }

        let msg = error.message || String(error);
        if (msg === "fetch failed" || error.name === "TypeError") {
            const cause = error.cause;
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
            return "Cluster API request failed (network or host unreachable)";
        }
        if (error.cause && error.cause.message && !msg.includes(error.cause.message)) {
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
                    replicas: desired,
                    current,
                    ready,
                    readyReplicas: ready,
                    available,
                    availableReplicas: available,
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
        if (!name || typeof name !== "string" || !name.trim()) {
            const err = new Error("Invalid deployment name provided to getDeployment");
            err.statusCode = 400;
            throw err;
        }
        if (!this.checkConnection()) {
            const err = new Error("Kubernetes client not initialized or cluster unreachable");
            err.statusCode = 503;
            throw err;
        }
        const trimmedName = name.trim();
        const ns = (namespace || this.getDefaultNamespace()).trim();

        try {
            const res = await this.appsApi.readNamespacedDeployment({ name: trimmedName, namespace: ns });
            const dep = res?.body || res;
            if (!dep) {
                const err = new Error(`Deployment "${trimmedName}" not found in namespace "${ns}"`);
                err.statusCode = 404;
                throw err;
            }

            return {
                name: dep.metadata?.name || trimmedName,
                namespace: dep.metadata?.namespace || ns,
                desired: dep.spec?.replicas ?? 0,
                replicas: dep.spec?.replicas ?? 0,
                current: dep.status?.replicas ?? 0,
                ready: dep.status?.readyReplicas ?? 0,
                readyReplicas: dep.status?.readyReplicas ?? 0,
                available: dep.status?.availableReplicas ?? 0,
                availableReplicas: dep.status?.availableReplicas ?? 0,
                updated: dep.status?.updatedReplicas ?? 0,
                generation: dep.metadata?.generation ?? 1,
                observedGeneration: dep.status?.observedGeneration ?? 0,
                conditions: dep.status?.conditions || [],
                raw: dep
            };
        } catch (err) {
            if (err.statusCode) throw err;
            const status = this.extractStatusCode(err) || (err.message?.includes("not found") ? 404 : 500);
            const message = this.extractErrorMessage(err) || `Deployment "${trimmedName}" not found in namespace "${ns}"`;
            const customErr = new Error(message);
            customErr.statusCode = status;
            throw customErr;
        }
    }

    // =========================================
    // SCALE DEPLOYMENT
    // =========================================
    async scaleDeployment(name, newReplicas, namespace) {
        if (!name || typeof name !== "string" || !name.trim()) {
            const err = new Error("Invalid deployment name provided for scaleDeployment");
            err.statusCode = 400;
            throw err;
        }
        const trimmedName = name.trim();
        const ns = (namespace || this.getDefaultNamespace()).trim();
        const min = KUBERNETES_CONFIG.minReplicas || 1;
        const max = KUBERNETES_CONFIG.maxReplicas || 10;

        const numReplicas = Number(newReplicas);
        if (newReplicas === undefined || newReplicas === null || newReplicas === "" || !Number.isInteger(numReplicas) || numReplicas < min || numReplicas > max) {
            const err = new Error(`Invalid replica count (${newReplicas}). Must be an integer between ${min} and ${max}.`);
            err.statusCode = 400;
            throw err;
        }

        if (!this.checkConnection()) {
            const err = new Error("Kubernetes client is not initialized or cluster is unreachable");
            err.statusCode = 503;
            throw err;
        }

        console.log(`☸️ Scaling deployment "${trimmedName}" in namespace "${ns}" to ${numReplicas} replicas`);

        // Read current deployment state (throws 404 if not found)
        const currentDep = await this.getDeployment(trimmedName, ns);
        const previousReplicas = currentDep.desired;

        // Apply RFC 6902 JSON Patch on /spec/replicas
        const patch = [
            { op: "replace", path: "/spec/replicas", value: numReplicas }
        ];

        try {
            await this.appsApi.patchNamespacedDeployment({
                name: trimmedName,
                namespace: ns,
                body: patch
            });
        } catch (err) {
            const status = this.extractStatusCode(err) || 500;
            const message = this.extractErrorMessage(err) || this.sanitizeError(err);
            const customErr = new Error(`Failed to scale deployment "${trimmedName}": ${message}`);
            customErr.statusCode = status;
            throw customErr;
        }

        // Wait for state convergence
        const convergence = await this.waitForDeploymentConvergence(trimmedName, numReplicas, ns, 25000, 1500);

        if (!convergence.converged) {
            return {
                success: false,
                converged: false,
                statusCode: 504,
                deployment: trimmedName,
                namespace: ns,
                previousReplicas,
                newReplicas: numReplicas,
                desiredReplicas: numReplicas,
                readyReplicas: convergence.readyReplicas,
                availableReplicas: convergence.availableReplicas,
                message: `Scaling requested for "${trimmedName}" (${previousReplicas} ➔ ${numReplicas}), but rollout verification timed out (${convergence.readyReplicas}/${numReplicas} ready)`
            };
        }

        return {
            success: true,
            converged: true,
            deployment: trimmedName,
            namespace: ns,
            previousReplicas,
            newReplicas: numReplicas,
            desiredReplicas: numReplicas,
            readyReplicas: convergence.readyReplicas,
            availableReplicas: convergence.availableReplicas,
            message: `Successfully scaled deployment "${trimmedName}" replicas from ${previousReplicas} to ${numReplicas} (${convergence.readyReplicas}/${numReplicas} ready)`
        };
    }

    // =========================================
    // RESTART DEPLOYMENT (Rolling Restart)
    // =========================================
    async restartDeployment(name, namespace) {
        if (!name || typeof name !== "string" || !name.trim()) {
            const err = new Error("Invalid deployment name provided for restartDeployment");
            err.statusCode = 400;
            throw err;
        }
        if (!this.checkConnection()) {
            const err = new Error("Kubernetes client is not initialized or cluster is unreachable");
            err.statusCode = 503;
            throw err;
        }

        const trimmedName = name.trim();
        const ns = (namespace || this.getDefaultNamespace()).trim();
        console.log(`☸️ Triggering rolling restart for deployment "${trimmedName}" in namespace "${ns}"`);

        const currentDepState = await this.getDeployment(trimmedName, ns);
        const dep = currentDepState.raw;
        const initialGeneration = dep.metadata?.generation ?? 1;
        const desiredReplicas = dep.spec?.replicas ?? 1;
        const existingAnnotations = dep.spec?.template?.metadata?.annotations || {};
        const hasAnnotations = Boolean(dep.spec?.template?.metadata?.annotations);
        const restartedAt = new Date().toISOString();

        // Standard Kubernetes rolling restart: update restartedAt pod-template annotation
        const patch = [
            {
                op: hasAnnotations ? "replace" : "add",
                path: "/spec/template/metadata/annotations",
                value: {
                    ...existingAnnotations,
                    "kubectl.kubernetes.io/restartedAt": restartedAt
                }
            }
        ];

        try {
            await this.appsApi.patchNamespacedDeployment({
                name: trimmedName,
                namespace: ns,
                body: patch
            });
        } catch (err) {
            const status = this.extractStatusCode(err) || 500;
            const message = this.extractErrorMessage(err) || this.sanitizeError(err);
            const customErr = new Error(`Failed to trigger rolling restart for "${trimmedName}": ${message}`);
            customErr.statusCode = status;
            throw customErr;
        }

        // Verify pod rollout and convergence
        const convergence = await this.waitForRestartConvergence(trimmedName, ns, initialGeneration, desiredReplicas, 35000, 1500);

        if (!convergence.converged) {
            return {
                success: false,
                converged: false,
                statusCode: 504,
                deployment: trimmedName,
                namespace: ns,
                restartedAt,
                readyReplicas: convergence.readyReplicas,
                availableReplicas: convergence.availableReplicas,
                desiredReplicas,
                message: `Rolling restart initiated for "${trimmedName}", but rollout verification timed out (${convergence.readyReplicas}/${desiredReplicas} ready)`
            };
        }

        return {
            success: true,
            converged: true,
            deployment: trimmedName,
            namespace: ns,
            restartedAt,
            readyReplicas: convergence.readyReplicas,
            availableReplicas: convergence.availableReplicas,
            desiredReplicas,
            message: `Rolling restart completed successfully for deployment "${trimmedName}" in namespace "${ns}" (${convergence.readyReplicas}/${desiredReplicas} ready)`
        };
    }

    // =========================================
    // CONVERGENCE VERIFICATION FOR SCALE
    // =========================================
    async waitForDeploymentConvergence(name, expectedReplicas, namespace, maxWaitMs = 30000, pollIntervalMs = 1500) {
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
                const updatedSatisfied = status.updated === undefined || status.updated === expectedReplicas;
                const availableSatisfied = status.available === undefined || status.available === expectedReplicas;
                if (status.desired === expectedReplicas &&
                    status.ready === expectedReplicas &&
                    availableSatisfied &&
                    updatedSatisfied) {
                    console.log(`✅ Deployment "${name}" converged: ${status.ready}/${expectedReplicas} replicas ready.`);
                    return {
                        converged: true,
                        readyReplicas: status.ready,
                        availableReplicas: status.available ?? status.ready,
                        desiredReplicas: expectedReplicas,
                        elapsedMs: Date.now() - startTime
                    };
                }
            } catch (err) {
                console.warn(`Transient polling notice for deployment "${name}":`, this.sanitizeError(err));
            }

            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        const finalStatus = await this.getDeployment(name, ns).catch(() => ({ ready: 0, available: 0, desired: expectedReplicas }));
        const isConverged = finalStatus.ready === expectedReplicas && (finalStatus.available === undefined || finalStatus.available === expectedReplicas);
        return {
            converged: isConverged,
            readyReplicas: finalStatus.ready,
            availableReplicas: finalStatus.available ?? finalStatus.ready,
            desiredReplicas: expectedReplicas,
            elapsedMs: Date.now() - startTime
        };
    }

    // =========================================
    // CONVERGENCE VERIFICATION FOR RESTART
    // =========================================
    async waitForRestartConvergence(name, namespace, initialGeneration, desiredReplicas, maxWaitMs = 35000, pollIntervalMs = 1500) {
        const ns = namespace || this.getDefaultNamespace();
        const startTime = Date.now();

        if (!this.checkConnection()) {
            return {
                converged: false,
                readyReplicas: 0,
                availableReplicas: 0,
                desiredReplicas,
                elapsedMs: 0,
                message: "Kubernetes client not initialized"
            };
        }

        console.log(`⏳ Waiting for deployment "${name}" rolling restart rollout to complete (initial gen: ${initialGeneration})...`);

        // Give deployment controller a moment to start cycling pods
        await new Promise((r) => setTimeout(r, 2000));

        while (Date.now() - startTime < maxWaitMs) {
            try {
                const depState = await this.getDeployment(name, ns);
                const dep = depState.raw;
                const observedGen = dep?.status?.observedGeneration;
                const currentGen = dep?.metadata?.generation ?? (initialGeneration + 1);
                const updatedReplicas = dep?.status?.updatedReplicas;
                const readyReplicas = dep?.status?.readyReplicas ?? depState.ready ?? 0;
                const availableReplicas = dep?.status?.availableReplicas ?? depState.available ?? readyReplicas;
                const replicas = dep?.spec?.replicas ?? depState.desired ?? desiredReplicas;

                const genSatisfied = observedGen === undefined || observedGen >= currentGen;
                const updatedSatisfied = updatedReplicas === undefined || updatedReplicas === replicas;
                const readySatisfied = readyReplicas === replicas;
                const availableSatisfied = dep?.status?.availableReplicas === undefined || availableReplicas === replicas;

                if (genSatisfied && updatedSatisfied && readySatisfied && availableSatisfied) {
                    console.log(`✅ Deployment "${name}" restart rollout completed: ${readyReplicas}/${replicas} ready.`);
                    return {
                        converged: true,
                        observedGeneration: observedGen ?? currentGen,
                        readyReplicas,
                        availableReplicas,
                        desiredReplicas: replicas,
                        elapsedMs: Date.now() - startTime
                    };
                }
            } catch (err) {
                console.warn(`Transient restart poll notice for "${name}":`, this.sanitizeError(err));
            }

            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        const finalStatus = await this.getDeployment(name, ns).catch(() => ({ ready: 0, available: 0, desired: desiredReplicas }));
        const isConverged = finalStatus.ready === finalStatus.desired && (finalStatus.available === undefined || finalStatus.available === finalStatus.desired);
        return {
            converged: isConverged,
            readyReplicas: finalStatus.ready,
            availableReplicas: finalStatus.available ?? finalStatus.ready,
            desiredReplicas: finalStatus.desired,
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
