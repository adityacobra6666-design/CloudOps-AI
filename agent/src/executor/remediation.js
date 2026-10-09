const k8s = require("@kubernetes/client-node");

class RemediationExecutor {
    constructor(k8sCollector, config) {
        this.k8sCollector = k8sCollector;
        this.config = config;

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

        const { action, target, parameters } = command;

        // 1. Strict Action Whitelist Check
        if (!this.config.allowedActions.includes(action)) {
            return {
                valid: false,
                reason: `Action "${action}" is NOT in the agent whitelist. Allowed actions: ${this.config.allowedActions.join(", ")}`
            };
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
        const { commandId, action, target, parameters } = command;

        // 1. Replay Protection: Check if already executed
        if (this.executedCommands.has(commandId)) {
            console.log(`🛡️ [AGENT EXEC] Replay protection: command ${commandId} already executed. Returning previous result.`);
            return this.executedCommands.get(commandId);
        }

        const startedAt = new Date().toISOString();

        // 2. Defense-in-depth policy check
        const policyCheck = this.validateCommand(command);
        if (!policyCheck.valid) {
            console.error(`🚫 [AGENT EXEC] Policy REJECTED command ${commandId}: ${policyCheck.reason}`);
            const rejectResult = {
                commandId,
                startedAt,
                completedAt: new Date().toISOString(),
                status: "REJECTED",
                message: `Agent-side security policy rejected command: ${policyCheck.reason}`,
                error: policyCheck.reason
            };
            this.cacheResult(commandId, rejectResult);
            return rejectResult;
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

        const deploymentName = target.name.trim();
        const namespace = target.namespace.trim();

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

    async executeScale(deploymentName, namespace, desiredReplicas) {
        const appsApi = this.k8sCollector.appsApi;

        // Fetch current deployment state
        const depRes = await appsApi.readNamespacedDeployment({
            name: deploymentName,
            namespace
        });

        const currentDeployment = depRes.body || depRes;
        const previousReplicas = currentDeployment.spec?.replicas || 0;

        console.log(`📈 [AGENT EXEC] Scaling "${deploymentName}" from ${previousReplicas} to ${desiredReplicas} replicas`);

        // Patch deployment replicas via RFC 6902 JSON patch
        await appsApi.patchNamespacedDeployment({
            name: deploymentName,
            namespace,
            body: [
                { op: "replace", path: "/spec/replicas", value: desiredReplicas }
            ]
        });

        // Wait up to 15 seconds for convergence
        let readyReplicas = previousReplicas;
        for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                const checkRes = await appsApi.readNamespacedDeployment({
                    name: deploymentName,
                    namespace
                });
                const checkDep = checkRes.body || checkRes;
                readyReplicas = checkDep.status?.readyReplicas || 0;
                if (readyReplicas === desiredReplicas) break;
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
                readyReplicas
            }
        };
    }

    async executeRestart(deploymentName, namespace) {
        const appsApi = this.k8sCollector.appsApi;

        console.log(`🔄 [AGENT EXEC] Triggering rolling restart for "${deploymentName}" in namespace "${namespace}"`);

        const depRes = await appsApi.readNamespacedDeployment({
            name: deploymentName,
            namespace
        });
        const currentDeployment = depRes.body || depRes;
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

        await appsApi.patchNamespacedDeployment({
            name: deploymentName,
            namespace,
            body: patch
        });

        // Wait for rolling restart pod cycle
        await new Promise(r => setTimeout(r, 2000));
        let readyReplicas = 0;
        let desired = currentDeployment.spec?.replicas || 1;
        for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                const checkRes = await appsApi.readNamespacedDeployment({
                    name: deploymentName,
                    namespace
                });
                const checkDep = checkRes.body || checkRes;
                readyReplicas = checkDep.status?.readyReplicas || 0;
                desired = checkDep.spec?.replicas || desired;
                if (readyReplicas === desired) break;
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
