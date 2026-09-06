const { kubernetesService } = require("../services/kubernetes/kubernetes.service");
const { createExecutor } = require("../services/remediation/executor");
const { evaluatePolicy } = require("../services/remediation/policyEngine");
const { verifyRemediation } = require("../services/remediation/verification");
const RemediationAction = require("../models/remediationAction.model");
const Incident = require("../models/Incident");
const { REMEDIATION_STATUS } = require("../config/remediation.config");

// =========================================
// GET KUBERNETES OVERVIEW
// =========================================
exports.getKubernetesOverview = async (req, res) => {
    try {
        const namespace = req.query?.namespace;
        const overview = await kubernetesService.getOverview(namespace);
        
        // Include recent Kubernetes remediation history
        let recentActions = [];
        try {
            recentActions = await RemediationAction.find({
                $or: [
                    { executor: "KubernetesExecutor" },
                    { action: { $in: ["SCALE_SERVICE", "RESTART_SERVICE"] } }
                ]
            })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate("incident", "title severity status");
        } catch (dbErr) {
            // In unit tests without MongoDB connection
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
        const namespace = req.query.namespace;
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
        const namespace = req.query.namespace;
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
        const namespace = req.query.namespace;
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
// Via Policy Engine & Executor Abstraction
// =========================================
exports.executeKubernetesAction = async (req, res) => {
    try {
        const { action, target, replicas, namespace, incidentId, reason } = req.body;

        if (!action || !target) {
            return res.status(400).json({
                success: false,
                message: "Missing required parameters: action and target"
            });
        }

        // Validate action
        if (!["SCALE_SERVICE", "RESTART_SERVICE"].includes(action)) {
            return res.status(400).json({
                success: false,
                message: `Unsupported action "${action}". Only SCALE_SERVICE and RESTART_SERVICE are allowed.`
            });
        }

        let incident = null;
        if (incidentId) {
            incident = await Incident.findById(incidentId);
        }

        // 1. Policy validation
        const mockIncident = incident || {
            title: `Manual ${action} request for ${target}`,
            severity: "warning",
            status: "open"
        };

        const policyResult = evaluatePolicy(mockIncident, action, target);

        // 2. Audit record creation
        const actionRecord = await RemediationAction.create({
            incident: incident ? incident._id : null,
            action,
            target,
            reason: reason || `Manual UI trigger: ${action} on ${target}`,
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

        // 3. Execution via Executor
        actionRecord.status = REMEDIATION_STATUS.EXECUTING;
        actionRecord.startedAt = new Date();
        await actionRecord.save();

        const executor = createExecutor("kubernetes");
        const executionResult = await executor.execute(action, target, {
            replicas,
            namespace,
            incident: mockIncident
        });

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

        // 4. Verification
        const verification = await verifyRemediation("cpu", null, {
            executor: "KubernetesExecutor",
            deploymentName: executionResult.deploymentName || target,
            previousReplicas: executionResult.previousReplicas,
            newReplicas: executionResult.newReplicas || replicas,
            namespace: executionResult.namespace || namespace,
            skipWait: true // Fast response for manual UI triggers
        });

        actionRecord.verification = verification;
        actionRecord.completedAt = new Date();
        actionRecord.status = verification.passed || verification.status === "SUCCESS"
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
        res.status(500).json({
            success: false,
            message: `Action execution error: ${error.message}`
        });
    }
};
