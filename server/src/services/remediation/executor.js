const http = require("http");

const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS,
    KUBERNETES_CONFIG
} = require("../../config/remediation.config");
const { kubernetesService } = require("../kubernetes/kubernetes.service");

// =========================================
// DOCKER ENGINE API CLIENT
// Uses the Docker Engine REST API via
// Unix socket /var/run/docker.sock
// =========================================

function dockerRequest(method, path) {
    return new Promise((resolve, reject) => {
        const options = {
            socketPath: "/var/run/docker.sock",
            path,
            method,
            headers: {
                "Content-Type": "application/json"
            }
        };

        const req = http.request(options, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        statusCode: res.statusCode,
                        data
                    });
                } else {
                    reject(
                        new Error(
                            `Docker API ${method} ${path} returned ${res.statusCode}: ${data}`
                        )
                    );
                }
            });
        });

        req.on("error", (error) => {
            reject(
                new Error(
                    `Docker API connection failed: ${error.message}`
                )
            );
        });

        req.setTimeout(30000, () => {
            req.destroy();
            reject(
                new Error("Docker API request timed out")
            );
        });

        req.end();
    });
}

// =========================================
// BASE EXECUTOR
// =========================================

class RemediationExecutor {
    async execute(action, target, context) {
        throw new Error(
            "execute() must be implemented by subclass"
        );
    }

    getName() {
        return "BaseExecutor";
    }
}

// =========================================
// DOCKER EXECUTOR
// =========================================

class DockerExecutor extends RemediationExecutor {
    getName() {
        return "DockerExecutor";
    }

    async execute(action, target, context) {
        console.log(
            `🐳 DockerExecutor: ${action} → ${target}`
        );

        // Validate target exists
        const targetConfig = ALLOWED_TARGETS[target];

        if (!targetConfig) {
            throw new Error(
                `Unknown target: "${target}"`
            );
        }

        const containerName = targetConfig.container;

        switch (action) {
            case "RESTART_SERVICE":
                return await this.restartService(
                    containerName,
                    target
                );

            case "SCALE_SERVICE":
                return this.scaleService(
                    containerName,
                    target
                );

            default:
                throw new Error(
                    `Unsupported action: "${action}"`
                );
        }
    }

    // -----------------------------------------
    // RESTART SERVICE
    // -----------------------------------------

    async restartService(containerName, target) {
        console.log(
            `🔄 Restarting container: ${containerName}`
        );

        try {
            await dockerRequest(
                "POST",
                `/containers/${containerName}/restart?t=10`
            );

            console.log(
                `✅ Container ${containerName} restart initiated`
            );

            return {
                success: true,
                message:
                    `Container "${containerName}" restart command sent successfully`,
                executor: this.getName(),
                containerName
            };
        } catch (error) {
            console.error(
                `❌ Failed to restart ${containerName}:`,
                error.message
            );

            throw new Error(
                `Failed to restart "${containerName}": ${error.message}`
            );
        }
    }

    // -----------------------------------------
    // SCALE SERVICE
    // -----------------------------------------

    scaleService(containerName, target) {
        console.log(
            `⚠️ SCALE_SERVICE is not fully supported in Docker mode`
        );

        return {
            success: false,
            message:
                `SCALE_SERVICE requires Kubernetes (Phase 2). ` +
                `Container "${containerName}" cannot be scaled in Docker Compose mode.`,
            executor: this.getName(),
            containerName
        };
    }
}

// =========================================
// KUBERNETES EXECUTOR
// =========================================

class KubernetesExecutor extends RemediationExecutor {
    getName() {
        return "KubernetesExecutor";
    }

    async execute(action, target, context = {}) {
        console.log(`☸️ KubernetesExecutor: ${action} → ${target}`);

        const targetConfig = ALLOWED_TARGETS[target];
        const deploymentName = targetConfig?.deployment || target;
        const namespace = context.namespace || KUBERNETES_CONFIG.defaultNamespace;

        // Strict target validation
        const isAllowedTarget = KUBERNETES_CONFIG.allowedDeployments.includes(deploymentName) || Boolean(targetConfig);
        if (!isAllowedTarget) {
            throw new Error(`Rejected: Target "${target}" (${deploymentName}) is not in allowed deployments whitelist.`);
        }

        const isAllowedNs = KUBERNETES_CONFIG.allowedNamespaces.includes(namespace);
        if (!isAllowedNs) {
            throw new Error(`Rejected: Namespace "${namespace}" is not in allowed namespaces whitelist.`);
        }

        switch (action) {
            case "SCALE_SERVICE": {
                const requestedReplicas = context.replicas || context.desiredReplicas || 4;
                const scaleResult = await kubernetesService.scaleDeployment(deploymentName, requestedReplicas, namespace);
                return {
                    success: scaleResult.success,
                    message: scaleResult.message,
                    executor: this.getName(),
                    previousReplicas: scaleResult.previousReplicas,
                    newReplicas: scaleResult.newReplicas,
                    deploymentName,
                    namespace
                };
            }

            case "RESTART_SERVICE": {
                const restartResult = await kubernetesService.restartDeployment(deploymentName, namespace);
                return {
                    success: restartResult.success,
                    message: restartResult.message,
                    executor: this.getName(),
                    deploymentName,
                    namespace
                };
            }

            default:
                throw new Error(`Unsupported Kubernetes action: "${action}"`);
        }
    }
}

// =========================================
// EXECUTOR FACTORY
// =========================================

function createExecutor(preferredType) {
    const type = preferredType || process.env.REMEDIATION_EXECUTOR;

    if (type === "docker") {
        return new DockerExecutor();
    }

    if (type === "kubernetes" || type === "k8s") {
        return new KubernetesExecutor();
    }

    // Auto-detect: if Kubernetes is connected, use KubernetesExecutor, else fallback to DockerExecutor
    if (kubernetesService.checkConnection()) {
        const status = kubernetesService.kc?.contexts?.length > 0;
        if (status) {
            return new KubernetesExecutor();
        }
    }

    return new DockerExecutor();
}

module.exports = {
    RemediationExecutor,
    DockerExecutor,
    KubernetesExecutor,
    createExecutor
};
