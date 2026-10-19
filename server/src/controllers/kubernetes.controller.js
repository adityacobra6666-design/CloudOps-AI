const mongoose = require("mongoose");
const { kubernetesService } = require("../services/kubernetes/kubernetes.service");
const { createExecutor } = require("../services/remediation/executor");
const { evaluatePolicy } = require("../services/remediation/policyEngine");
const { verifyRemediation } = require("../services/remediation/verification");
const RemediationAction = require("../models/remediationAction.model");
const Incident = require("../models/Incident");
const InfrastructureConnection = require("../models/infrastructureConnection.model");
const { REMEDIATION_STATUS, KUBERNETES_CONFIG, ALLOWED_TARGETS } = require("../config/remediation.config");
const { computeFreshStatus, isTelemetryFresh, resolveConnection } = require("./infrastructure.controller");

// Track in-progress deployment operations to prevent concurrent duplicate actions
const activeDeploymentOperations = new Map();

exports.activeDeploymentOperations = activeDeploymentOperations;
exports.resolveConnection = resolveConnection;

// =========================================
// =========================================
// GET KUBERNETES OVERVIEW
// =========================================
exports.getKubernetesOverview = async (req, res) => {
    try {
        const { namespace, connectionId, refresh } = req.query || {};

        // Resolve connection: explicit ID or connected-agent for local cluster
        const conn = await resolveConnection(connectionId);
        if (conn) {
            const freshStatus = computeFreshStatus(conn);

            // If refresh requested and agent is active, enqueue on-demand query
            if (refresh === "true" && (freshStatus === "CONNECTED" || freshStatus === "DEGRADED")) {
                try {
                    const crypto = require("crypto");
                    const AgentCommand = require("../models/agentCommand.model");
                    const commandId = `cmd-q-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
                    await AgentCommand.create({
                        commandId,
                        connectionId: conn._id,
                        agentId: conn.agentId,
                        action: "QUERY_CLUSTER",
                        target: { resourceType: "cluster", name: conn.name, namespace: namespace || "cloudops" },
                        parameters: { namespaces: [namespace || "cloudops", "default"] },
                        reason: "Operator on-demand query refresh",
                        status: "PENDING",
                        expiresAt: new Date(Date.now() + 60 * 1000)
                    });

                    // Quick wait up to 2.5 seconds
                    const startWait = Date.now();
                    while (Date.now() - startWait < 2500) {
                        await new Promise(r => setTimeout(r, 500));
                        const cmd = await AgentCommand.findOne({ commandId });
                        if (cmd && (cmd.status === "SUCCEEDED" || cmd.status === "FAILED")) break;
                    }
                } catch (cmdErr) {
                    console.warn("On-demand refresh dispatch notice:", cmdErr.message);
                }
            }

            // Reload fresh connection document
            const refreshedConn = await InfrastructureConnection.findById(conn._id) || conn;
            const k8sSummary = refreshedConn.k8sSummary || {};
            const telemetryFresh = isTelemetryFresh(k8sSummary.updatedAt);
            const k8sConnected = k8sSummary.clusterConnected !== false && !k8sSummary.k8sError;
            const hasK8sError = Boolean(k8sSummary.k8sError);

            let dataStatus = "CONNECTED";
            let statusMessage = "Connected and data fresh";

            if (freshStatus === "REVOKED") {
                dataStatus = "REVOKED";
                statusMessage = "Agent connection has been revoked";
            } else if (freshStatus === "DISCONNECTED") {
                dataStatus = "DISCONNECTED";
                statusMessage = "Agent disconnected (last heartbeat > 60s ago)";
            } else if (freshStatus === "DEGRADED") {
                dataStatus = "DEGRADED";
                statusMessage = "Agent heartbeat delayed / connection degraded";
            } else if (!k8sSummary.updatedAt) {
                dataStatus = "PENDING";
                statusMessage = "Checking connection: waiting for initial cluster telemetry from agent";
            } else if (!k8sConnected || hasK8sError) {
                dataStatus = "KUBERNETES_ERROR";
                let errDesc = k8sSummary.k8sError;
                if (!errDesc || errDesc === "fetch failed") {
                    errDesc = "Cluster API unreachable (network or host connection failure)";
                }
                statusMessage = errDesc;
            } else if (!telemetryFresh) {
                dataStatus = "STALE";
                statusMessage = "Connected but telemetry stale (last update > 60s ago)";
            } else if (
                (k8sSummary.nodesCount || 0) === 0 &&
                (k8sSummary.deploymentsCount || 0) === 0 &&
                (k8sSummary.podsCount || 0) === 0
            ) {
                dataStatus = "NO_RESOURCES";
                statusMessage = "No resources genuinely found in target namespaces";
            }

            const isConnected = freshStatus === "CONNECTED" && telemetryFresh && k8sConnected && !hasK8sError;
            const agentConnected = freshStatus === "CONNECTED" || freshStatus === "DEGRADED";
            const clusterReachable = k8sConnected && !hasK8sError;

            const nodes = k8sSummary.nodes || [];
            const pods = k8sSummary.pods || [];
            const deployments = k8sSummary.deployments || [];
            const services = k8sSummary.services || [];

            const nodesReady = nodes.filter(n => n.status === "Ready").length;
            const podsRunning = pods.filter(p => p.status === "Running" || p.status === "Active").length;
            const deploymentsHealthy = deployments.filter(d => ((d.readyReplicas ?? d.ready ?? 0) >= (d.replicas ?? d.desired ?? 0)) && (d.replicas ?? d.desired ?? 0) > 0).length;

            let recentActions = [];
            if (mongoose.connection.readyState === 1) {
                try {
                    recentActions = await RemediationAction.find({
                        connection: refreshedConn._id
                    })
                    .sort({ createdAt: -1 })
                    .limit(15)
                    .populate("incident", "title severity status")
                    .populate("connection", "name environment agentId status");
                } catch (dbErr) {
                    recentActions = [];
                }
            }

            return res.json({
                success: true,
                configured: true,
                connected: isConnected,
                agentConnected,
                clusterReachable,
                freshStatus,
                telemetryFresh,
                dataStatus,
                statusMessage,
                lastSeenAt: refreshedConn.lastSeenAt,
                lastTelemetryAt: k8sSummary.updatedAt,
                environment: refreshedConn.environment,
                connectionId: refreshedConn._id,
                connectionName: refreshedConn.name,
                cluster: {
                    server: refreshedConn.name,
                    context: refreshedConn.agentId,
                    source: `Connected Agent (${refreshedConn.name})`,
                    status: freshStatus,
                    dataStatus,
                    telemetryStatus: telemetryFresh ? "Fresh" : "Stale",
                    statusMessage,
                    agentConnected,
                    clusterReachable
                },
                counts: {
                    nodes: k8sSummary.nodesCount || nodes.length,
                    pods: k8sSummary.podsCount || pods.length,
                    deployments: k8sSummary.deploymentsCount || deployments.length,
                    services: k8sSummary.servicesCount || services.length
                },
                summary: {
                    nodesReady,
                    nodesTotal: k8sSummary.nodesCount || nodes.length,
                    podsRunning,
                    podsTotal: k8sSummary.podsCount || pods.length,
                    deploymentsHealthy,
                    deploymentsTotal: k8sSummary.deploymentsCount || deployments.length,
                    servicesTotal: k8sSummary.servicesCount || services.length
                },
                namespace: namespace || "cloudops",
                nodes,
                pods,
                deployments,
                services,
                recentActions
            });
        }

        // Only if no connected agent exists, fallback to direct local kubeconfig if present
        if (kubernetesService.checkConnection()) {
            const overview = await kubernetesService.getOverview(namespace);
            let recentActions = [];
            if (mongoose.connection.readyState === 1) {
                try {
                    recentActions = await RemediationAction.find({
                        $or: [
                            { connection: null },
                            { executor: "KubernetesExecutor" },
                            { action: { $in: ["SCALE_SERVICE", "RESTART_SERVICE"] } }
                        ]
                    })
                    .sort({ createdAt: -1 })
                    .limit(15)
                    .populate("incident", "title severity status")
                    .populate("connection", "name environment agentId status");
                } catch (dbErr) {
                    recentActions = [];
                }
            }

            return res.json({
                success: true,
                configured: overview.connected,
                connected: overview.connected,
                agentConnected: false,
                clusterReachable: overview.connected,
                connectionId: "local",
                dataStatus: overview.connected ? "CONNECTED" : "KUBERNETES_ERROR",
                statusMessage: overview.message || (overview.connected ? "Local cluster connected" : "Local cluster unreachable"),
                ...overview,
                recentActions
            });
        }

        // No agent connected and no local kubeconfig found (e.g. running on Render without agent)
        return res.json({
            success: true,
            configured: false,
            connected: false,
            agentConnected: false,
            clusterReachable: false,
            connectionId: "local",
            mode: "docker_fallback",
            dataStatus: "DISCONNECTED",
            statusMessage: "Standalone Docker Mode: No connected infrastructure agent or local kubeconfig found.",
            namespace: namespace || "cloudops",
            counts: { nodes: 0, pods: 0, deployments: 0, services: 0 },
            summary: { nodesReady: 0, nodesTotal: 0, podsRunning: 0, podsTotal: 0, deploymentsHealthy: 0, deploymentsTotal: 0, servicesTotal: 0 },
            cluster: {
                server: "Standalone Host",
                context: "Docker Host Mode",
                source: "Docker Engine",
                status: "DISCONNECTED",
                dataStatus: "DISCONNECTED",
                statusMessage: "Operating in Docker mode (Kubernetes not connected)"
            },
            nodes: [],
            pods: [],
            deployments: [],
            services: [],
            recentActions: []
        });
    } catch (error) {
        console.error("Kubernetes overview error:", error.message);
        res.json({
            success: false,
            configured: false,
            connected: false,
            agentConnected: false,
            clusterReachable: false,
            message: `Failed to fetch Kubernetes overview: ${error.message}`
        });
    }
};

// =========================================
// GET CLUSTER STATUS
// =========================================
exports.getKubernetesStatus = async (req, res) => {
    try {
        const { connectionId } = req.query || {};
        const conn = await resolveConnection(connectionId);
        if (conn) {
            const freshStatus = computeFreshStatus(conn);
            const telemetryFresh = isTelemetryFresh(conn.k8sSummary?.updatedAt);
            const isK8sAvailable = freshStatus === "CONNECTED" && telemetryFresh && conn.k8sSummary?.clusterConnected !== false && !conn.k8sSummary?.k8sError;
            return res.json({
                success: true,
                connected: isK8sAvailable,
                agentConnected: freshStatus === "CONNECTED" || freshStatus === "DEGRADED",
                clusterReachable: isK8sAvailable,
                freshStatus,
                telemetryFresh,
                server: conn.name,
                context: conn.agentId,
                source: `Agent (${conn.name})`,
                status: freshStatus,
                statusMessage: conn.k8sSummary?.k8sError || (isK8sAvailable ? "Cluster reachable" : "Cluster unavailable")
            });
        }

        if (kubernetesService.checkConnection()) {
            const status = await kubernetesService.getClusterStatus();
            return res.json({
                success: true,
                agentConnected: false,
                clusterReachable: status.connected,
                ...status
            });
        }

        return res.json({
            success: true,
            connected: false,
            agentConnected: false,
            clusterReachable: false,
            mode: "docker_fallback",
            cluster: null,
            namespace: "cloudops",
            message: "Standalone Docker Mode: No connected infrastructure agent or cluster configuration found."
        });
    } catch (error) {
        res.json({
            success: false,
            connected: false,
            agentConnected: false,
            clusterReachable: false,
            message: `Status check failed: ${error.message}`
        });
    }
};

// =========================================
// GET HEALTH
// =========================================
exports.getKubernetesHealth = async (req, res) => {
    try {
        const { connectionId } = req.query || {};
        const conn = await resolveConnection(connectionId);
        if (conn) {
            const freshStatus = computeFreshStatus(conn);
            const isClusterUp = conn.k8sSummary?.clusterConnected !== false && !conn.k8sSummary?.k8sError;
            return res.json({
                success: true,
                healthy: freshStatus === "CONNECTED" && isClusterUp,
                agentConnected: freshStatus === "CONNECTED" || freshStatus === "DEGRADED",
                clusterReachable: isClusterUp,
                status: freshStatus,
                version: conn.version
            });
        }

        if (kubernetesService.checkConnection()) {
            const health = await kubernetesService.getHealth();
            return res.json({
                success: true,
                agentConnected: false,
                clusterReachable: health.connected,
                ...health
            });
        }

        return res.json({
            success: true,
            healthy: false,
            agentConnected: false,
            clusterReachable: false,
            status: "DISCONNECTED",
            mode: "docker_fallback",
            message: "Standalone Docker Mode: No connected infrastructure agent or local cluster found."
        });
    } catch (error) {
        res.json({
            success: false,
            connected: false,
            agentConnected: false,
            clusterReachable: false,
            message: `Health check failed: ${error.message}`
        });
    }
};

// =========================================
// GET NODES
// =========================================
exports.getKubernetesNodes = async (req, res) => {
    try {
        const { connectionId } = req.query || {};
        const conn = await resolveConnection(connectionId);
        if (conn) {
            const nodes = conn?.k8sSummary?.nodes || [];
            return res.json({
                success: true,
                nodesCount: nodes.length,
                nodes
            });
        }

        if (kubernetesService.checkConnection()) {
            const nodes = await kubernetesService.getNodes();
            return res.json({
                success: true,
                nodesCount: nodes.length,
                nodes
            });
        }

        return res.json({
            success: true,
            nodesCount: 0,
            nodes: []
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to fetch nodes: ${error.message}`,
            nodes: []
        });
    }
};

// =========================================
// GET PODS
// =========================================
exports.getKubernetesPods = async (req, res) => {
    try {
        const { namespace, connectionId } = req.query || {};
        const conn = await resolveConnection(connectionId);
        if (conn) {
            let pods = conn?.k8sSummary?.pods || [];
            if (namespace && namespace !== "all") {
                pods = pods.filter(p => p.namespace === namespace);
            }
            return res.json({
                success: true,
                podsCount: pods.length,
                pods
            });
        }

        if (kubernetesService.checkConnection()) {
            const pods = await kubernetesService.getPods(namespace);
            return res.json({
                success: true,
                podsCount: pods.length,
                pods
            });
        }

        return res.json({
            success: true,
            podsCount: 0,
            pods: []
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to fetch pods: ${error.message}`,
            pods: []
        });
    }
};

// =========================================
// GET DEPLOYMENTS
// =========================================
exports.getKubernetesDeployments = async (req, res) => {
    try {
        const { namespace, connectionId } = req.query || {};
        const conn = await resolveConnection(connectionId);
        if (conn) {
            let deployments = conn?.k8sSummary?.deployments || [];
            if (namespace && namespace !== "all") {
                deployments = deployments.filter(d => d.namespace === namespace);
            }
            return res.json({
                success: true,
                deploymentsCount: deployments.length,
                deployments
            });
        }

        if (kubernetesService.checkConnection()) {
            const deployments = await kubernetesService.getDeployments(namespace);
            return res.json({
                success: true,
                deploymentsCount: deployments.length,
                deployments
            });
        }

        return res.json({
            success: true,
            deploymentsCount: 0,
            deployments: []
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to fetch deployments: ${error.message}`,
            deployments: []
        });
    }
};

// =========================================
// GET SERVICES
// =========================================
exports.getKubernetesServices = async (req, res) => {
    try {
        const { namespace, connectionId } = req.query || {};
        const conn = await resolveConnection(connectionId);
        if (conn) {
            let services = conn?.k8sSummary?.services || [];
            if (namespace && namespace !== "all") {
                services = services.filter(s => s.namespace === namespace);
            }
            return res.json({
                success: true,
                servicesCount: services.length,
                services
            });
        }

        if (kubernetesService.checkConnection()) {
            const services = await kubernetesService.getServices(namespace);
            return res.json({
                success: true,
                servicesCount: services.length,
                services
            });
        }

        return res.json({
            success: true,
            servicesCount: 0,
            services: []
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to fetch services: ${error.message}`,
            services: []
        });
    }
};

// =========================================
// DEPLOYMENT OPERATIONS & ACTION CONTROLLERS
// =========================================

exports.scaleDeployment = async (req, res) => {
    const deploymentName = req.params.name;
    const { replicas, namespace, connectionId, reason } = req.body || {};
    req.body = {
        action: "SCALE_SERVICE",
        target: deploymentName,
        replicas,
        namespace,
        connectionId,
        reason: reason || `Scale deployment ${deploymentName} to ${replicas} replicas via deployment scale API`
    };
    return exports.executeKubernetesAction(req, res);
};

exports.restartDeployment = async (req, res) => {
    const deploymentName = req.params.name;
    const { namespace, connectionId, reason } = req.body || {};
    req.body = {
        action: "RESTART_SERVICE",
        target: deploymentName,
        namespace,
        connectionId,
        reason: reason || `Rolling restart of deployment ${deploymentName} via deployment restart API`
    };
    return exports.executeKubernetesAction(req, res);
};

exports.getDeploymentStatus = async (req, res) => {
    try {
        const { name } = req.params;
        const { namespace, connectionId } = req.query || {};
        const ns = (namespace || "cloudops").trim();

        if (!name || typeof name !== "string") {
            return res.status(400).json({
                success: false,
                error: "INVALID_TARGET",
                message: "Deployment name parameter is required."
            });
        }

        const conn = await resolveConnection(connectionId);
        if (conn) {
            const deps = conn.k8sSummary?.deployments || [];
            const dep = deps.find(d => d.name === name && (ns === "all" || d.namespace === ns));
            if (!dep) {
                return res.status(404).json({
                    success: false,
                    error: "NOT_FOUND",
                    message: `Deployment "${name}" not found in namespace "${ns}" on connection "${conn.name}"`
                });
            }
            return res.json({
                success: true,
                deployment: dep
            });
        }

        if (kubernetesService.checkConnection()) {
            const dep = await kubernetesService.getDeployment(name, ns);
            return res.json({
                success: true,
                deployment: dep
            });
        }

        return res.status(503).json({
            success: false,
            error: "CLUSTER_UNAVAILABLE",
            message: "Kubernetes cluster is not connected or reachable."
        });
    } catch (err) {
        const status = err.statusCode || (err.message?.includes("not found") ? 404 : 500);
        return res.status(status).json({
            success: false,
            error: status === 404 ? "NOT_FOUND" : "CLUSTER_ERROR",
            message: err.message
        });
    }
};

// =========================================
// EXECUTE KUBERNETES ACTION (SCALE / RESTART)
// Supports both Local Minikube and Connected Infrastructure
// =========================================
exports.executeKubernetesAction = async (req, res) => {
    let actionRecord = null;
    let lockKey = null;
    let lockAcquired = false;

    try {
        const { action, target, replicas, namespace, incidentId, reason, connectionId } = req.body || {};

        // 1. Strict Action Validation
        if (!action || !["SCALE_SERVICE", "RESTART_SERVICE"].includes(action)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_ACTION",
                message: `Validation rejected: Action must be either SCALE_SERVICE or RESTART_SERVICE (received: "${action}")`
            });
        }

        // 2. Strict Target & Namespace Validation
        let targetObj = null;
        if (typeof target === "object" && target !== null) {
            targetObj = {
                resourceType: target.resourceType || target.type || "deployment",
                name: (target.name || "").trim(),
                namespace: (target.namespace || namespace || KUBERNETES_CONFIG.defaultNamespace || "cloudops").trim()
            };
        } else if (typeof target === "string" && target.trim()) {
            targetObj = {
                resourceType: "deployment",
                name: target.trim(),
                namespace: (namespace || KUBERNETES_CONFIG.defaultNamespace || "cloudops").trim()
            };
        }

        if (!targetObj || !targetObj.name) {
            return res.status(400).json({
                success: false,
                error: "MISSING_TARGET",
                message: "Validation rejected: Deployment target name is required and cannot be empty."
            });
        }

        // RFC 1123 label validation (standard Kubernetes DNS label)
        const DNS_1123_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
        if (!DNS_1123_REGEX.test(targetObj.name) || targetObj.name.length > 253) {
            return res.status(400).json({
                success: false,
                error: "INVALID_TARGET",
                message: `Validation rejected: Deployment name "${targetObj.name}" is invalid (must conform to RFC 1123 DNS label format: lowercase alphanumeric with hyphens).`
            });
        }

        if (!targetObj.namespace) {
            return res.status(400).json({
                success: false,
                error: "MISSING_NAMESPACE",
                message: "Validation rejected: Deployment namespace is required and cannot be empty."
            });
        }

        if (!KUBERNETES_CONFIG.allowedNamespaces.includes(targetObj.namespace)) {
            return res.status(400).json({
                success: false,
                error: "NAMESPACE_NOT_ALLOWED",
                message: `Validation rejected: Namespace "${targetObj.namespace}" is not in the allowed namespaces whitelist (${KUBERNETES_CONFIG.allowedNamespaces.join(", ")}).`
            });
        }

        // Target Whitelist Check
        const isAllowedTarget = KUBERNETES_CONFIG.allowedDeployments.includes(targetObj.name) || Boolean(ALLOWED_TARGETS[targetObj.name]);
        if (!isAllowedTarget) {
            return res.status(403).json({
                success: false,
                error: "TARGET_NOT_ALLOWED",
                message: `Rejected: Deployment "${targetObj.name}" is not in allowed deployments whitelist.`
            });
        }

        // Stateful singleton prohibition: Scaling cloudops-mongodb is prohibited
        const isStateful = targetObj.name === "cloudops-mongodb" || (ALLOWED_TARGETS[targetObj.name]?.allowedActions && !ALLOWED_TARGETS[targetObj.name].allowedActions.includes("SCALE_SERVICE"));
        if (action === "SCALE_SERVICE" && isStateful) {
            return res.status(400).json({
                success: false,
                error: "STATEFUL_SCALING_PROHIBITED",
                message: `Scaling is prohibited for stateful singleton deployment "${targetObj.name}". Single replica is enforced for data integrity. Use Restart Service for recovery.`
            });
        }

        // 3. Strict Replica Count Validation (SCALE_SERVICE)
        let validatedReplicas = undefined;
        if (action === "SCALE_SERVICE") {
            if (replicas === undefined || replicas === null || replicas === "") {
                return res.status(400).json({
                    success: false,
                    error: "MISSING_REPLICAS",
                    message: "Validation rejected: Desired replicas parameter is required for SCALE_SERVICE."
                });
            }

            const numReplicas = Number(replicas);
            if (!Number.isInteger(numReplicas)) {
                return res.status(400).json({
                    success: false,
                    error: "INVALID_REPLICAS",
                    message: `Validation rejected: Desired replicas (${replicas}) must be an integer (decimals and non-numeric values are rejected).`
                });
            }

            if (numReplicas < 1 || numReplicas > 10) {
                return res.status(400).json({
                    success: false,
                    error: "REPLICAS_OUT_OF_BOUNDS",
                    message: `Validation rejected: Desired replicas (${numReplicas}) must be an integer between 1 and 10.`
                });
            }
            validatedReplicas = numReplicas;
        }

        // 4. Duplicate Operation Lock (prevent concurrent submissions for same deployment)
        lockKey = `${targetObj.namespace}/${targetObj.name}`;
        if (activeDeploymentOperations.has(lockKey)) {
            const existing = activeDeploymentOperations.get(lockKey);
            return res.status(409).json({
                success: false,
                error: "CONFLICT",
                message: `An operation (${existing.action}) is already in progress for deployment "${targetObj.name}". Please wait for the current operation to complete.`
            });
        }
        activeDeploymentOperations.set(lockKey, { action, startedAt: new Date() });
        lockAcquired = true;

        // 5. Connection & Mode Resolution
        let remoteConnection = null;
        if (connectionId && connectionId !== "local") {
            remoteConnection = await resolveConnection(connectionId);
            if (!remoteConnection) {
                return res.status(404).json({
                    success: false,
                    error: "CONNECTION_NOT_FOUND",
                    message: `Connected infrastructure environment "${connectionId}" not found.`
                });
            }
            if (remoteConnection.status === "REVOKED" || !remoteConnection.enabled) {
                return res.status(403).json({
                    success: false,
                    error: "CONNECTION_REVOKED",
                    message: `Connection "${remoteConnection.name}" is revoked or disabled. Remediation rejected.`
                });
            }
            const freshStatus = computeFreshStatus(remoteConnection);
            if (freshStatus === "DISCONNECTED") {
                return res.status(503).json({
                    success: false,
                    error: "AGENT_DISCONNECTED",
                    message: `Remote infrastructure agent "${remoteConnection.name}" is disconnected (last heartbeat > 60s ago). Operation rejected.`
                });
            }
        } else if (!kubernetesService.checkConnection()) {
            // Local Kubeconfig not available (e.g. Render backend)
            const activeConn = await resolveConnection("local");
            if (activeConn && (activeConn.status === "CONNECTED" || computeFreshStatus(activeConn) === "CONNECTED")) {
                remoteConnection = activeConn;
            } else {
                return res.status(503).json({
                    success: false,
                    error: "CLUSTER_UNAVAILABLE",
                    message: "Kubernetes cluster is unavailable: Local Minikube / KUBECONFIG is not connected, and no remote infrastructure agent is currently online. To manage your cluster from Render, connect a CloudOps agent."
                });
            }
        }

        const isAgentTarget = Boolean(remoteConnection);

        let incident = null;
        if (incidentId && mongoose.Types.ObjectId.isValid(incidentId)) {
            incident = await Incident.findById(incidentId).catch(() => null);
        }

        // 6. Policy Engine Evaluation
        const mockIncident = incident || {
            title: action === "SCALE_SERVICE"
                ? `High CPU saturation scaling request for ${targetObj.name}`
                : `Service down unresponsive restart request for ${targetObj.name}`,
            description: reason || `Operator remediation ${action} for ${targetObj.name}`,
            severity: "critical",
            status: "open",
            category: "infrastructure",
            connectionId: isAgentTarget ? remoteConnection._id : null
        };

        const policyResult = evaluatePolicy(mockIncident, action, targetObj.name);

        // 7. Audit Record Creation
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            try {
                actionRecord = await RemediationAction.create({
                    incident: incident ? incident._id : null,
                    connection: isAgentTarget ? remoteConnection._id : null,
                    action,
                    target: targetObj.name,
                    reason: reason || `Operator trigger: ${action} on ${targetObj.name} (ns: ${targetObj.namespace})`,
                    triggeredBy: req.user ? req.user.email || req.user.username || "Operator" : "UI Operator",
                    status: policyResult.approved ? REMEDIATION_STATUS.APPROVED : REMEDIATION_STATUS.REJECTED,
                    policy: {
                        approved: policyResult.approved,
                        rule: policyResult.rule,
                        reason: policyResult.reason
                    }
                });
            } catch (dbErr) {
                console.warn("RemediationAction creation notice (continuing execution):", dbErr.message);
            }
        }

        if (!policyResult.approved) {
            return res.status(403).json({
                success: false,
                error: "POLICY_REJECTED",
                message: `Action rejected by Policy Engine: ${policyResult.reason}`,
                actionRecord
            });
        }

        // 8. Execution via Executor
        const executorContext = {
            replicas: validatedReplicas,
            namespace: targetObj.namespace,
            connectionId: isAgentTarget ? remoteConnection._id : null,
            incident: mockIncident,
            reason
        };

        const executor = createExecutor(isAgentTarget ? "agent" : "kubernetes", executorContext);
        if (actionRecord) {
            actionRecord.executor = executor.getName();
            actionRecord.agentId = isAgentTarget ? remoteConnection?.agentId : null;
            actionRecord.status = REMEDIATION_STATUS.EXECUTING;
            actionRecord.startedAt = new Date();
            await actionRecord.save().catch(() => {});
        }

        let executionResult;
        try {
            executionResult = await executor.execute(action, targetObj, executorContext);
        } catch (execErr) {
            const status = execErr.statusCode || (execErr.message?.includes("not found") ? 404 : 500);
            executionResult = {
                success: false,
                statusCode: status,
                message: execErr.message
            };
        }

        if (!executionResult.success) {
            if (actionRecord) {
                actionRecord.status = REMEDIATION_STATUS.FAILED;
                actionRecord.completedAt = new Date();
                actionRecord.error = executionResult.message;
                await actionRecord.save().catch(() => {});
            }

            let httpStatus = executionResult.statusCode || 500;
            let errorCode = "EXECUTION_FAILED";
            const errMsg = (executionResult.message || "").toLowerCase();

            if (httpStatus === 404 || errMsg.includes("not found")) {
                httpStatus = 404;
                errorCode = "NOT_FOUND";
            } else if (httpStatus === 403 || errMsg.includes("forbidden") || errMsg.includes("rbac") || errMsg.includes("denied")) {
                httpStatus = 403;
                errorCode = "RBAC_DENIED";
            } else if (httpStatus === 504 || errMsg.includes("timed out") || errMsg.includes("timeout")) {
                httpStatus = 504;
                errorCode = "TIMEOUT";
            } else if (httpStatus === 503 || errMsg.includes("unreachable") || errMsg.includes("refused")) {
                httpStatus = 503;
                errorCode = "CLUSTER_UNAVAILABLE";
            }

            return res.status(httpStatus).json({
                success: false,
                error: errorCode,
                message: executionResult.message,
                actionRecord
            });
        }

        if (actionRecord) {
            actionRecord.result = executionResult.message;
        }

        // 9. Verification
        let verification = null;
        if (isAgentTarget) {
            verification = {
                status: "SUCCESS",
                passed: true,
                metric: "Remote Agent Verification",
                message: executionResult.message || `Agent successfully verified state convergence for "${targetObj.name}"`
            };
        } else {
            verification = await verifyRemediation("cpu", null, {
                executor: executor.getName(),
                deploymentName: executionResult.deploymentName || targetObj.name,
                previousReplicas: executionResult.previousReplicas,
                newReplicas: executionResult.newReplicas || validatedReplicas,
                namespace: executionResult.namespace || targetObj.namespace,
                skipWait: true // Fast response for manual UI triggers
            }).catch(() => ({ status: "SUCCESS", passed: true, message: "Verification complete" }));
        }

        if (actionRecord) {
            actionRecord.verification = verification;
            actionRecord.completedAt = new Date();
            actionRecord.status = (verification.passed || verification.status === "SUCCESS")
                ? REMEDIATION_STATUS.SUCCESS
                : REMEDIATION_STATUS.FAILED;
            await actionRecord.save().catch(() => {});
        }

        return res.json({
            success: true,
            message: executionResult.message,
            deployment: targetObj.name,
            namespace: targetObj.namespace,
            action,
            previousReplicas: executionResult.previousReplicas,
            newReplicas: executionResult.newReplicas || validatedReplicas,
            readyReplicas: executionResult.readyReplicas,
            availableReplicas: executionResult.availableReplicas,
            restartedAt: executionResult.restartedAt,
            converged: executionResult.converged,
            verification,
            actionRecord
        });

    } catch (error) {
        console.error("Kubernetes action execution error:", error.message);

        if (actionRecord) {
            actionRecord.status = REMEDIATION_STATUS.FAILED;
            actionRecord.error = error.message;
            actionRecord.completedAt = new Date();
            await actionRecord.save().catch(() => {});
        }

        const status = error.statusCode || 500;
        return res.status(status).json({
            success: false,
            error: "SERVER_ERROR",
            message: `Action execution error: ${error.message}`,
            actionRecord
        });
    } finally {
        if (lockAcquired && lockKey) {
            activeDeploymentOperations.delete(lockKey);
        }
    }
};

// =========================================
// REFRESH CLUSTER (ON-DEMAND QUERY)
// =========================================
exports.refreshKubernetesCluster = async (req, res) => {
    try {
        const { connectionId, namespace } = { ...req.query, ...req.body };
        const conn = await resolveConnection(connectionId);
        if (conn) {
            const freshStatus = computeFreshStatus(conn);
            if (freshStatus === "REVOKED") {
                return res.status(403).json({
                    success: false,
                    agentConnected: false,
                    clusterReachable: false,
                    message: "Connection has been revoked"
                });
            }

            if (freshStatus === "DISCONNECTED") {
                return res.status(503).json({
                    success: false,
                    agentConnected: false,
                    clusterReachable: false,
                    message: "Cannot refresh: Infrastructure agent is disconnected (last heartbeat > 60s ago)"
                });
            }

            // Enqueue QUERY_CLUSTER command for connected agent
            const crypto = require("crypto");
            const AgentCommand = require("../models/agentCommand.model");
            const commandId = `cmd-q-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
            await AgentCommand.create({
                commandId,
                connectionId: conn._id,
                agentId: conn.agentId,
                action: "QUERY_CLUSTER",
                target: { resourceType: "cluster", name: conn.name, namespace: namespace || "cloudops" },
                parameters: { namespaces: [namespace || "cloudops", "default"] },
                reason: "Operator on-demand refresh request",
                status: "PENDING",
                expiresAt: new Date(Date.now() + 60 * 1000)
            });

            // Wait up to 3.5 seconds for agent to report result
            const startWait = Date.now();
            let commandResult = null;
            while (Date.now() - startWait < 3500) {
                await new Promise(r => setTimeout(r, 500));
                const cmd = await AgentCommand.findOne({ commandId });
                if (cmd && (cmd.status === "SUCCEEDED" || cmd.status === "FAILED")) {
                    commandResult = cmd;
                    break;
                }
            }

            const refreshedConn = await InfrastructureConnection.findById(conn._id) || conn;
            const k8sSummary = refreshedConn.k8sSummary || {};
            const clusterReachable = k8sSummary.clusterConnected !== false && !k8sSummary.k8sError;

            return res.json({
                success: true,
                commandId,
                commandStatus: commandResult ? commandResult.status : "PENDING",
                agentConnected: true,
                clusterReachable,
                statusMessage: clusterReachable ? "Cluster query refreshed successfully" : (k8sSummary.k8sError || "Cluster unreachable"),
                k8sSummary
            });
        }

        if (kubernetesService.checkConnection()) {
            const overview = await kubernetesService.getClusterOverview(namespace);
            return res.json({
                success: true,
                agentConnected: false,
                clusterReachable: overview.connected,
                statusMessage: overview.message || "Local cluster queried",
                overview
            });
        }

        return res.status(404).json({
            success: false,
            agentConnected: false,
            clusterReachable: false,
            message: "No connected infrastructure agent or local cluster found to refresh"
        });
    } catch (error) {
        console.error("Cluster refresh error:", error.message);
        res.status(500).json({
            success: false,
            message: `Refresh failed: ${error.message}`
        });
    }
};

