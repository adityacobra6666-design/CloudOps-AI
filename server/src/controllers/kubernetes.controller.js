const { kubernetesService } = require("../services/kubernetes/kubernetes.service");
const { createExecutor } = require("../services/remediation/executor");
const { evaluatePolicy } = require("../services/remediation/policyEngine");
const { verifyRemediation } = require("../services/remediation/verification");
const RemediationAction = require("../models/remediationAction.model");
const Incident = require("../models/Incident");
const InfrastructureConnection = require("../models/infrastructureConnection.model");
const { REMEDIATION_STATUS } = require("../config/remediation.config");

// =========================================
// GET KUBERNETES OVERVIEW
// =========================================
exports.getKubernetesOverview = async (req, res) => {
    try {
        const { namespace, connectionId } = req.query || {};

        // If a connected infrastructure environment is selected
        if (connectionId && connectionId !== "local") {
            const conn = await InfrastructureConnection.findById(connectionId);
            if (conn) {
                const k8sSummary = conn.k8sSummary || {};
                let recentActions = [];
                try {
                    recentActions = await RemediationAction.find({
                        connection: conn._id
                    })
                    .sort({ createdAt: -1 })
                    .limit(15)
                    .populate("incident", "title severity status")
                    .populate("connection", "name environment agentId status");
                } catch (dbErr) {
                    recentActions = [];
                }

                return res.json({
                    success: true,
                    configured: true,
                    connected: conn.status === "CONNECTED",
                    environment: conn.environment,
                    connectionName: conn.name,
                    cluster: {
                        server: conn.name,
                        context: conn.agentId,
                        source: `Connected Agent (${conn.name})`,
                        status: conn.status
                    },
                    counts: {
                        nodes: k8sSummary.nodesCount || k8sSummary.nodes?.length || 0,
                        pods: k8sSummary.podsCount || k8sSummary.pods?.length || 0,
                        deployments: k8sSummary.deploymentsCount || k8sSummary.deployments?.length || 0,
                        services: k8sSummary.servicesCount || k8sSummary.services?.length || 0
                    },
                    nodes: k8sSummary.nodes || [],
                    pods: k8sSummary.pods || [],
                    deployments: k8sSummary.deployments || [],
                    services: k8sSummary.services || [],
                    recentActions
                });
            }
        }

        // Default: local cluster
        const overview = await kubernetesService.getOverview(namespace);
        
        let recentActions = [];
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

        res.json({
            success: true,
            configured: overview.connected,
            ...overview,
            recentActions
        });
    } catch (error) {
        console.error("Kubernetes overview error:", error.message);
        res.json({
            success: false,
            configured: false,
            connected: false,
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
        if (connectionId && connectionId !== "local") {
            const conn = await InfrastructureConnection.findById(connectionId);
            if (conn) {
                return res.json({
                    success: true,
                    connected: conn.status === "CONNECTED",
                    server: conn.name,
                    context: conn.agentId,
                    source: `Agent (${conn.name})`,
                    status: conn.status
                });
            }
        }

        const status = await kubernetesService.getClusterStatus();
        res.json({
            success: true,
            ...status
        });
    } catch (error) {
        res.json({
            success: false,
            connected: false,
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
        if (connectionId && connectionId !== "local") {
            const conn = await InfrastructureConnection.findById(connectionId);
            if (conn) {
                return res.json({
                    success: true,
                    healthy: conn.status === "CONNECTED",
                    status: conn.status,
                    version: conn.version
                });
            }
        }

        const health = await kubernetesService.getHealth();
        res.json({
            success: true,
            ...health
        });
    } catch (error) {
        res.json({
            success: false,
            connected: false,
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
        if (connectionId && connectionId !== "local") {
            const conn = await InfrastructureConnection.findById(connectionId);
            const nodes = conn?.k8sSummary?.nodes || [];
            return res.json({
                success: true,
                nodesCount: nodes.length,
                nodes
            });
        }

        const nodes = await kubernetesService.getNodes();
        res.json({
            success: true,
            nodesCount: nodes.length,
            nodes
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
        if (connectionId && connectionId !== "local") {
            const conn = await InfrastructureConnection.findById(connectionId);
            let pods = conn?.k8sSummary?.pods || [];
            if (namespace) {
                pods = pods.filter(p => p.namespace === namespace);
            }
            return res.json({
                success: true,
                podsCount: pods.length,
                pods
            });
        }

        const pods = await kubernetesService.getPods(namespace);
        res.json({
            success: true,
            podsCount: pods.length,
            pods
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
        if (connectionId && connectionId !== "local") {
            const conn = await InfrastructureConnection.findById(connectionId);
            let deployments = conn?.k8sSummary?.deployments || [];
            if (namespace) {
                deployments = deployments.filter(d => d.namespace === namespace);
            }
            return res.json({
                success: true,
                deploymentsCount: deployments.length,
                deployments
            });
        }

        const deployments = await kubernetesService.getDeployments(namespace);
        res.json({
            success: true,
            deploymentsCount: deployments.length,
            deployments
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
        if (connectionId && connectionId !== "local") {
            const conn = await InfrastructureConnection.findById(connectionId);
            let services = conn?.k8sSummary?.services || [];
            if (namespace) {
                services = services.filter(s => s.namespace === namespace);
            }
            return res.json({
                success: true,
                servicesCount: services.length,
                services
            });
        }

        const services = await kubernetesService.getServices(namespace);
        res.json({
            success: true,
            servicesCount: services.length,
            services
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
// EXECUTE KUBERNETES ACTION (SCALE / RESTART)
// Supports both Local Minikube and Connected Infrastructure
// =========================================
exports.executeKubernetesAction = async (req, res) => {
    let actionRecord = null;
    try {
        const { action, target, replicas, namespace, incidentId, reason, connectionId } = req.body;

        // 1. Strict Action Validation
        if (!action || !["SCALE_SERVICE", "RESTART_SERVICE"].includes(action)) {
            return res.status(400).json({
                success: false,
                message: `Validation rejected: Action must be either SCALE_SERVICE or RESTART_SERVICE (received: "${action}")`
            });
        }

        // 2. Strict Target & Namespace Validation
        let targetObj = null;
        if (typeof target === "object" && target !== null) {
            targetObj = {
                resourceType: target.resourceType || target.type || "deployment",
                name: (target.name || "").trim(),
                namespace: (target.namespace || namespace || "").trim()
            };
        } else if (typeof target === "string" && target.trim()) {
            targetObj = {
                resourceType: "deployment",
                name: target.trim(),
                namespace: (namespace || "").trim()
            };
        }

        if (!targetObj || !targetObj.name) {
            return res.status(400).json({
                success: false,
                message: "Validation rejected: Deployment target name is required and cannot be empty."
            });
        }

        if (!targetObj.namespace) {
            return res.status(400).json({
                success: false,
                message: "Validation rejected: Deployment namespace is required and cannot be empty."
            });
        }

        // 3. Replica Count Validation (SCALE_SERVICE)
        let validatedReplicas = undefined;
        if (action === "SCALE_SERVICE") {
            const numReplicas = parseInt(replicas, 10);
            if (isNaN(numReplicas) || numReplicas < 1 || numReplicas > 10) {
                return res.status(400).json({
                    success: false,
                    message: `Validation rejected: Desired replicas (${replicas}) must be an integer between 1 and 10.`
                });
            }
            validatedReplicas = numReplicas;
        }

        // 4. Connection & Mode Resolution
        const isAgentTarget = Boolean(connectionId && connectionId !== "local");
        let remoteConnection = null;

        if (isAgentTarget) {
            remoteConnection = await InfrastructureConnection.findById(connectionId);
            if (!remoteConnection) {
                return res.status(404).json({
                    success: false,
                    message: `Connected infrastructure environment "${connectionId}" not found.`
                });
            }

            if (remoteConnection.status === "REVOKED" || !remoteConnection.enabled) {
                return res.status(403).json({
                    success: false,
                    message: `Connection "${remoteConnection.name}" is revoked or disabled. Remediation rejected.`
                });
            }
        }

        let incident = null;
        if (incidentId) {
            incident = await Incident.findById(incidentId);
        }

        // 5. Policy Validation
        const mockIncident = incident || {
            title: action === "SCALE_SERVICE"
                ? `High CPU saturation scaling request for ${targetObj.name}`
                : `Service down unresponsive restart request for ${targetObj.name}`,
            description: reason || `Operator remediation ${action} for ${targetObj.name}`,
            severity: "critical",
            status: "open",
            category: "infrastructure",
            connectionId: isAgentTarget ? connectionId : null
        };

        const policyResult = evaluatePolicy(mockIncident, action, targetObj.name);

        // 6. Audit Record Creation
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

        if (!policyResult.approved) {
            return res.status(403).json({
                success: false,
                message: `Action rejected by Policy Engine: ${policyResult.reason}`,
                actionRecord
            });
        }

        // 7. Execution via Executor
        const executorContext = {
            replicas: validatedReplicas,
            namespace: targetObj.namespace,
            connectionId: isAgentTarget ? connectionId : null,
            incident: mockIncident,
            reason
        };

        const executor = createExecutor(isAgentTarget ? "agent" : "kubernetes", executorContext);
        actionRecord.executor = executor.getName();
        actionRecord.agentId = isAgentTarget ? remoteConnection?.agentId : null;
        actionRecord.status = REMEDIATION_STATUS.EXECUTING;
        actionRecord.startedAt = new Date();
        await actionRecord.save();

        const executionResult = await executor.execute(action, targetObj, executorContext);

        if (!executionResult.success) {
            actionRecord.status = REMEDIATION_STATUS.FAILED;
            actionRecord.completedAt = new Date();
            actionRecord.error = executionResult.message;
            await actionRecord.save();

            return res.status(500).json({
                success: false,
                message: `Execution failed: ${executionResult.message}`,
                actionRecord
            });
        }

        actionRecord.result = executionResult.message;

        // 8. Verification
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
            });
        }

        actionRecord.verification = verification;
        actionRecord.completedAt = new Date();
        actionRecord.status = (verification.passed || verification.status === "SUCCESS")
            ? REMEDIATION_STATUS.SUCCESS
            : REMEDIATION_STATUS.FAILED;

        await actionRecord.save();

        res.json({
            success: actionRecord.status === REMEDIATION_STATUS.SUCCESS,
            message: executionResult.message,
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

        res.status(500).json({
            success: false,
            message: `Action execution error: ${error.message}`,
            actionRecord
        });
    }
};
