const k8s = require("@kubernetes/client-node");

class RemediationExecutor {
    constructor(k8sCollector, config) {
        this.config = config || require("../config");
        this.k8sCollector = k8sCollector || new (require("../collectors/kubernetes"))(this.config?.kubeconfigPath);

        // Replay Protection Cache (stores commandId -> result)
        this.executedCommands = new Map();
        // Keep cache size bounded
        this.maxCacheEntries = 500;
    }

    /**
     * Agent-side Policy Validation (Defense in Depth)
     */
    validateCommand(command) {
        if (!command || typeof command !== "object") {
            return { valid: false, reason: "Command payload is missing or malformed" };
        }

        const { commandId, action, target, parameters } = command;

        if (!commandId || typeof commandId !== "string" || !commandId.trim()) {
            return { valid: false, reason: "Command commandId is required and must be a valid string." };
        }

        // 1. Strict Action Whitelist Check
        if (!this.config.allowedActions.includes(action)) {
            return {
                valid: false,
                reason: `Action "${action}" is NOT in the agent whitelist. Allowed actions: ${this.config.allowedActions.join(", ")}`
            };
        }

        // QUERY_CLUSTER is permitted read-only cluster inspection
        if (action === "QUERY_CLUSTER") {
            return { valid: true };
        }

        // 2. Target Check
        if (!target) {
            return { valid: false, reason: "Target specification is missing" };
        }

        const targetType = target.resourceType || target.type || "deployment";
        if (!this.config.allowedTargetTypes.includes(targetType)) {
            return {
                valid: false,
                reason: `Target type "${targetType}" is not allowed. Only deployments are supported.`
            };
        }

        if (!target.namespace || !target.namespace.trim()) {
            return { valid: false, reason: "Target namespace is required and cannot be empty." };
        }

        const namespace = target.namespace.trim();
        if (!this.config.allowedNamespaces.includes(namespace)) {
            return {
                valid: false,
                reason: `Namespace "${namespace}" is not in the agent whitelist (${this.config.allowedNamespaces.join(", ")}).`
            };
        }

        if (!target.name || !target.name.trim()) {
            return { valid: false, reason: "Target deployment name is required and cannot be empty." };
        }

        const deploymentName = target.name.trim();
        if (Array.isArray(this.config.allowedDeployments) && this.config.allowedDeployments.length > 0) {
            if (!this.config.allowedDeployments.includes(deploymentName)) {
                return {
                    valid: false,
                    reason: `Target deployment "${deploymentName}" is not in the agent whitelist (${this.config.allowedDeployments.join(", ")}).`
                };
            }
        }

        // Defense-in-depth: Prohibit scaling stateful singleton deployments (e.g., MongoDB)
        const statefulDeployments = this.config.statefulDeployments || ["cloudops-mongodb"];
        if (action === "SCALE_SERVICE" && statefulDeployments.includes(deploymentName)) {
            return {
                valid: false,
                reason: `Scaling is prohibited for stateful deployment "${deploymentName}". Single replica is enforced for data integrity.`
            };
        }

        // 3. Scale Parameters Check
        if (action === "SCALE_SERVICE") {
            const replicas = parseInt(parameters?.replicas, 10);
            if (isNaN(replicas)) {
                return { valid: false, reason: "SCALE_SERVICE requires integer 'replicas' parameter" };
            }

            if (replicas < this.config.minReplicas || replicas > this.config.maxReplicas) {
                return {
                    valid: false,
                    reason: `Requested replicas (${replicas}) outside safe bounds [${this.config.minReplicas}, ${this.config.maxReplicas}]`
                };
            }
        }

        return { valid: true };
    }

    /**
     * Execute structured action safely
     */
    async executeCommand(command) {
        const { commandId, action, target, parameters } = command || {};

        // 1. Replay Protection: Check if already executed
        if (commandId && this.executedCommands.has(commandId)) {
            console.log(`🛡️ [AGENT EXEC] Replay protection: command ${commandId} already executed. Returning previous result.`);
            return this.executedCommands.get(commandId);
        }

        const startedAt = new Date().toISOString();

        // 2. Defense-in-depth policy check
        const policyCheck = this.validateCommand(command);
        if (!policyCheck.valid) {
            const effectiveId = commandId || "unknown";
            console.error(`🚫 [AGENT EXEC] Policy REJECTED command ${effectiveId}: ${policyCheck.reason}`);
            const rejectResult = {
                commandId: effectiveId,
                startedAt,
                completedAt: new Date().toISOString(),
                status: "REJECTED",
                message: `Agent-side security policy rejected command: ${policyCheck.reason}`,
                error: policyCheck.reason
            };
            if (commandId) this.cacheResult(commandId, rejectResult);
            return rejectResult;
        }

        if (action === "QUERY_CLUSTER") {
            try {
                console.log(`🔍 [AGENT EXEC] Executing read-only cluster query (commandId: ${commandId})...`);
                const requestedNs = parameters?.namespaces || (target?.namespace ? [target.namespace] : null) || this.config.allowedNamespaces || ["cloudops", "default"];
                const clusterData = await this.k8sCollector.collectClusterData(requestedNs);
                const queryResult = {
                    commandId,
                    startedAt,
                    completedAt: new Date().toISOString(),
                    status: clusterData.clusterConnected ? "SUCCEEDED" : "FAILED",
                    message: clusterData.clusterConnected
                        ? `Cluster query completed: ${clusterData.nodesCount} nodes, ${clusterData.podsCount} pods, ${clusterData.deploymentsCount} deployments`
                        : `Cluster query failed: ${clusterData.k8sError || "Cluster unreachable"}`,
                    resultingState: clusterData,
                    error: clusterData.k8sError || null
                };
                this.cacheResult(commandId, queryResult);
                return queryResult;
            } catch (err) {
                const failResult = {
                    commandId,
                    startedAt,
                    completedAt: new Date().toISOString(),
                    status: "FAILED",
                    message: `Cluster query error: ${err.message}`,
                    error: err.message
                };
                this.cacheResult(commandId, failResult);
                return failResult;
            }
        }

        if (!this.k8sCollector.isInitialized) {
            const failResult = {
                commandId,
                startedAt,
                completedAt: new Date().toISOString(),
                status: "FAILED",
                message: "Kubernetes client is not initialized on this agent",
                error: "Kubernetes client unavailable"
            };
            this.cacheResult(commandId, failResult);
            return failResult;
        }

        const deploymentName = target?.name ? target.name.trim() : "unknown";
        const namespace = target?.namespace ? target.namespace.trim() : "cloudops";

        console.log(`⚡ [AGENT EXEC] Executing ${action} on ${deploymentName} (namespace: ${namespace}, commandId: ${commandId})...`);

        try {
            let execResult = null;

            if (action === "SCALE_SERVICE") {
                execResult = await this.executeScale(deploymentName, namespace, parseInt(parameters.replicas, 10));
            } else if (action === "RESTART_SERVICE") {
                execResult = await this.executeRestart(deploymentName, namespace);
            }

            const finalResult = {
                commandId,
                startedAt,
                completedAt: new Date().toISOString(),
                status: execResult.success ? "SUCCEEDED" : "FAILED",
                message: execResult.message,
                resultingState: execResult.state,
                error: execResult.success ? null : execResult.message
            };

            this.cacheResult(commandId, finalResult);
            return finalResult;
        } catch (error) {
            console.error(`❌ [AGENT EXEC] Execution failed for ${commandId}: ${error.message}`);
            const errorResult = {
                commandId,
                startedAt,
                completedAt: new Date().toISOString(),
                status: "FAILED",
                message: `Execution failed: ${error.message}`,
                error: error.message
            };
            this.cacheResult(commandId, errorResult);
            return errorResult;
        }
    }

    extractErrorMessage(error) {
        if (!error) return null;
        if (error.body) {
            try {
                const b = typeof error.body === "string" ? JSON.parse(error.body) : error.body;
                if (b?.message) return b.message;
            } catch (e) {}
        }
        return error.message || String(error);
    }

    async executeScale(deploymentName, namespace, desiredReplicas) {
        const appsApi = this.k8sCollector.appsApi;

        // Fetch current deployment state (fail fast if deployment does not exist)
        let depRes;
        try {
            depRes = await appsApi.readNamespacedDeployment({
                name: deploymentName,
                namespace
            });
        } catch (err) {
            const msg = this.extractErrorMessage(err) || `Deployment "${deploymentName}" not found in namespace "${namespace}"`;
            throw new Error(msg);
        }

        const currentDeployment = depRes.body || depRes;
        const previousReplicas = currentDeployment.spec?.replicas || 0;

        console.log(`📈 [AGENT EXEC] Scaling "${deploymentName}" from ${previousReplicas} to ${desiredReplicas} replicas`);

        // Patch deployment replicas via RFC 6902 JSON patch
        try {
            await appsApi.patchNamespacedDeployment({
                name: deploymentName,
                namespace,
                body: [
                    { op: "replace", path: "/spec/replicas", value: desiredReplicas }
                ]
            });
        } catch (err) {
            const msg = this.extractErrorMessage(err) || `Failed to scale deployment "${deploymentName}": ${err.message}`;
            throw new Error(msg);
        }

        // Wait up to 25 seconds for convergence
        let readyReplicas = previousReplicas;
        let availableReplicas = previousReplicas;
        for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                const checkRes = await appsApi.readNamespacedDeployment({
                    name: deploymentName,
                    namespace
                });
                const checkDep = checkRes.body || checkRes;
                readyReplicas = checkDep.status?.readyReplicas || 0;
                availableReplicas = checkDep.status?.availableReplicas ?? readyReplicas;
                const updated = checkDep.status?.updatedReplicas;
                const updatedSatisfied = updated === undefined || updated === desiredReplicas;
                const availableSatisfied = checkDep.status?.availableReplicas === undefined || availableReplicas === desiredReplicas;
                if (readyReplicas === desiredReplicas && availableSatisfied && updatedSatisfied) {
                    break;
                }
            } catch (e) {}
        }

        return {
            success: true,
            message: `Successfully scaled deployment "${deploymentName}" from ${previousReplicas} to ${desiredReplicas} replicas (${readyReplicas}/${desiredReplicas} ready)`,
            state: {
                deploymentName,
                namespace,
                previousReplicas,
                newReplicas: desiredReplicas,
                readyReplicas,
                availableReplicas
            }
        };
    }

    async executeRestart(deploymentName, namespace) {
        const appsApi = this.k8sCollector.appsApi;

        console.log(`🔄 [AGENT EXEC] Triggering rolling restart for "${deploymentName}" in namespace "${namespace}"`);

        let depRes;
        try {
            depRes = await appsApi.readNamespacedDeployment({
                name: deploymentName,
                namespace
            });
        } catch (err) {
            const msg = this.extractErrorMessage(err) || `Deployment "${deploymentName}" not found in namespace "${namespace}"`;
            throw new Error(msg);
        }

        const currentDeployment = depRes.body || depRes;
        const initialGeneration = currentDeployment.metadata?.generation || 1;
        const existingAnnotations = currentDeployment.spec?.template?.metadata?.annotations || {};
        const hasAnnotations = Boolean(currentDeployment.spec?.template?.metadata?.annotations);
        const restartedAt = new Date().toISOString();

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
            await appsApi.patchNamespacedDeployment({
                name: deploymentName,
                namespace,
                body: patch
            });
        } catch (err) {
            const msg = this.extractErrorMessage(err) || `Failed to restart deployment "${deploymentName}": ${err.message}`;
            throw new Error(msg);
        }

        // Wait for rolling restart pod cycle and rollout completion
        await new Promise(r => setTimeout(r, 2000));
        let readyReplicas = 0;
        let availableReplicas = 0;
        let desired = currentDeployment.spec?.replicas || 1;

        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                const checkRes = await appsApi.readNamespacedDeployment({
                    name: deploymentName,
                    namespace
                });
                const checkDep = checkRes.body || checkRes;
                const observedGen = checkDep.status?.observedGeneration;
                const currentGen = checkDep.metadata?.generation ?? (initialGeneration + 1);
                const updated = checkDep.status?.updatedReplicas;
                readyReplicas = checkDep.status?.readyReplicas || 0;
                availableReplicas = checkDep.status?.availableReplicas ?? readyReplicas;
                desired = checkDep.spec?.replicas || desired;

                const genSatisfied = observedGen === undefined || observedGen >= currentGen;
                const updatedSatisfied = updated === undefined || updated === desired;
                const readySatisfied = readyReplicas === desired;
                const availableSatisfied = checkDep.status?.availableReplicas === undefined || availableReplicas === desired;

                if (genSatisfied && updatedSatisfied && readySatisfied && availableSatisfied) {
                    break;
                }
            } catch (e) {}
        }

        return {
            success: true,
            message: `Successfully triggered rolling restart for deployment "${deploymentName}" (${readyReplicas}/${desired} ready)`,
            state: {
                deploymentName,
                namespace,
                restartedAt,
                readyReplicas,
                availableReplicas,
                desiredReplicas: desired
            }
        };
    }

    cacheResult(commandId, result) {
        if (this.executedCommands.size >= this.maxCacheEntries) {
            const oldestKey = this.executedCommands.keys().next().value;
            this.executedCommands.delete(oldestKey);
        }
        this.executedCommands.set(commandId, result);
    }
}

module.exports = RemediationExecutor;
