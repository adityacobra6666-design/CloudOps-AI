const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const RemediationExecutor = require("../src/executor/remediation");
const ApiClient = require("../src/services/apiClient");

describe("Agent Remediation Executor & Safety Tests", () => {
    const mockConfig = {
        allowedActions: ["RESTART_SERVICE", "SCALE_SERVICE"],
        allowedTargetTypes: ["deployment"],
        allowedNamespaces: ["cloudops", "default"],
        allowedDeployments: ["backend", "cloudops-backend", "cloudops-server"],
        minReplicas: 1,
        maxReplicas: 10
    };

    const mockK8sCollector = {
        isInitialized: true,
        appsApi: {
            readNamespacedDeployment: async () => ({
                spec: { replicas: 2 },
                status: { readyReplicas: 2 }
            }),
            patchNamespacedDeployment: async () => ({})
        }
    };

    it("should approve valid SCALE_SERVICE command", () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            commandId: "cmd-test-1",
            action: "SCALE_SERVICE",
            target: {
                resourceType: "deployment",
                name: "cloudops-backend",
                namespace: "cloudops"
            },
            parameters: { replicas: 3 }
        };

        const check = executor.validateCommand(command);
        assert.equal(check.valid, true);
    });

    it("should reject command missing commandId", () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            action: "SCALE_SERVICE",
            target: {
                resourceType: "deployment",
                name: "cloudops-backend",
                namespace: "cloudops"
            },
            parameters: { replicas: 3 }
        };

        const check = executor.validateCommand(command);
        assert.equal(check.valid, false);
        assert.ok(check.reason.includes("commandId"));
    });

    it("should reject unsupported action", () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            commandId: "cmd-test-2",
            action: "DELETE_PODS",
            target: {
                name: "cloudops-backend",
                namespace: "cloudops"
            }
        };

        const check = executor.validateCommand(command);
        assert.equal(check.valid, false);
        assert.ok(check.reason.includes("NOT in the agent whitelist"));
    });

    it("should reject disallowed target namespace", () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            commandId: "cmd-test-3",
            action: "SCALE_SERVICE",
            target: {
                name: "cloudops-backend",
                namespace: "kube-system"
            },
            parameters: { replicas: 2 }
        };

        const check = executor.validateCommand(command);
        assert.equal(check.valid, false);
        assert.ok(check.reason.includes("not in the agent whitelist"));
    });

    it("should reject target deployment not in allowlist", () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            commandId: "cmd-test-4",
            action: "SCALE_SERVICE",
            target: {
                name: "unauthorized-deployment",
                namespace: "cloudops"
            },
            parameters: { replicas: 2 }
        };

        const check = executor.validateCommand(command);
        assert.equal(check.valid, false);
        assert.ok(check.reason.includes("not in the agent whitelist"));
    });

    it("should reject replicas exceeding maximum bound (10)", () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            commandId: "cmd-test-5",
            action: "SCALE_SERVICE",
            target: {
                name: "cloudops-backend",
                namespace: "cloudops"
            },
            parameters: { replicas: 15 }
        };

        const check = executor.validateCommand(command);
        assert.equal(check.valid, false);
        assert.ok(check.reason.includes("outside safe bounds"));
    });

    it("should reject replicas below minimum bound (1)", () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            commandId: "cmd-test-6",
            action: "SCALE_SERVICE",
            target: {
                name: "cloudops-backend",
                namespace: "cloudops"
            },
            parameters: { replicas: 0 }
        };

        const check = executor.validateCommand(command);
        assert.equal(check.valid, false);
        assert.ok(check.reason.includes("outside safe bounds"));
    });

    it("should enforce replay protection and return cached result for duplicate commandId", async () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const command = {
            commandId: "cmd-replay-test",
            action: "RESTART_SERVICE",
            target: {
                resourceType: "deployment",
                name: "cloudops-backend",
                namespace: "cloudops"
            }
        };

        // Cache a result simulating earlier execution
        const cachedResult = {
            commandId: "cmd-replay-test",
            status: "SUCCEEDED",
            message: "Previously executed"
        };
        executor.cacheResult("cmd-replay-test", cachedResult);

        const result = await executor.executeCommand(command);
        assert.equal(result.status, "SUCCEEDED");
        assert.equal(result.message, "Previously executed");
    });

    it("should return REJECTED status when policy validation fails during executeCommand", async () => {
        const executor = new RemediationExecutor(mockK8sCollector, mockConfig);
        const invalidCommand = {
            commandId: "cmd-reject-test",
            action: "INVALID_ACTION",
            target: {
                name: "cloudops-backend",
                namespace: "cloudops"
            }
        };

        const result = await executor.executeCommand(invalidCommand);
        assert.equal(result.status, "REJECTED");
        assert.ok(result.error);
        assert.equal(result.commandId, "cmd-reject-test");
    });
});

describe("Agent ApiClient Error & Revocation Handling", () => {
    it("should NOT revoke agent on transient 403 without revoked/disabled message", () => {
        const client = new ApiClient({
            cloudopsUrl: "http://localhost:5000",
            agentId: "test-agent",
            agentToken: "test-token"
        });

        assert.equal(client.isRevoked, false);
        client.handleApiError("Heartbeat", {
            response: {
                status: 403,
                data: { message: "Rate limit exceeded or temporary forbidden" }
            }
        });
        assert.equal(client.isRevoked, false);
    });

    it("should mark agent as revoked on 403 when message explicitly indicates revoked", () => {
        const client = new ApiClient({
            cloudopsUrl: "http://localhost:5000",
            agentId: "test-agent",
            agentToken: "test-token"
        });

        assert.equal(client.isRevoked, false);
        client.handleApiError("Command Poll", {
            response: {
                status: 403,
                data: { message: "Access forbidden: Infrastructure connection has been revoked or disabled." }
            }
        });
        assert.equal(client.isRevoked, true);
    });
});
