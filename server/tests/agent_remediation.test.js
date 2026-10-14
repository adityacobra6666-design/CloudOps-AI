const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { AgentRemediationExecutor, createExecutor } = require("../src/services/remediation/executor");

describe("Backend AgentRemediationExecutor Tests", () => {
    it("should select AgentRemediationExecutor when preferredType is 'agent'", () => {
        const executor = createExecutor("agent");
        assert.equal(executor.getName(), "AgentRemediationExecutor");
    });

    it("should select AgentRemediationExecutor when connectionId is provided", () => {
        const executor = createExecutor(null, { connectionId: "507f1f77bcf86cd799439011" });
        assert.equal(executor.getName(), "AgentRemediationExecutor");
    });

    it("should reject execution if connectionId is missing or local", async () => {
        const executor = new AgentRemediationExecutor();
        await assert.rejects(
            async () => {
                await executor.execute("SCALE_SERVICE", "cloudops-backend", { connectionId: "local" });
            },
            (err) => {
                assert.ok(err.message.includes("valid connectionId is required"));
                return true;
            }
        );
    });

    it("should reject execution if connection is not found in database", async () => {
        const executor = new AgentRemediationExecutor();
        await assert.rejects(
            async () => {
                await executor.execute("SCALE_SERVICE", "cloudops-backend", { connectionId: "507f1f77bcf86cd799439011" });
            },
            (err) => {
                assert.ok(err.message.includes("not found") || err.message.includes("buffering timed out"));
                return true;
            }
        );
    });
});
