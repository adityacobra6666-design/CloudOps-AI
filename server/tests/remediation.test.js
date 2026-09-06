const { describe, it } = require("node:test");
const assert = require("node:assert/strict");


// =========================================
// IMPORT MODULES UNDER TEST
// =========================================

const {
    evaluatePolicy,
    isValidAction,
    isValidTarget
} = require("../src/services/remediation/policyEngine");

const {
    parseDecision
} = require("../src/services/remediation/aiDecision");

const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS,
    REMEDIATION_STATUS
} = require("../src/config/remediation.config");


// =========================================
// 1. POLICY ENGINE TESTS
// =========================================

describe("Policy Engine", () => {

    // -----------------------------------------
    // Valid action + target accepted
    // -----------------------------------------

    it("should accept valid action and target for CPU incident", () => {

        const incident = {
            title: "High CPU usage on backend",
            description: "CPU utilization exceeded 90%",
            severity: "critical",
            category: "infrastructure"
        };

        const result = evaluatePolicy(
            incident,
            "RESTART_SERVICE",
            "cloudops-server"
        );

        assert.equal(result.approved, true);
        assert.ok(result.rule);
        assert.ok(result.reason);
    });


    // -----------------------------------------
    // Invalid action rejected
    // -----------------------------------------

    it("should reject invalid action", () => {

        const incident = {
            title: "Some incident",
            severity: "critical"
        };

        const result = evaluatePolicy(
            incident,
            "DELETE_DATABASE",
            "cloudops-server"
        );

        assert.equal(result.approved, false);
        assert.ok(
            result.reason.includes("not in the allowed actions")
        );
    });


    // -----------------------------------------
    // Invalid target rejected
    // -----------------------------------------

    it("should reject invalid target", () => {

        const incident = {
            title: "High CPU usage",
            severity: "critical"
        };

        const result = evaluatePolicy(
            incident,
            "RESTART_SERVICE",
            "production-database"
        );

        assert.equal(result.approved, false);
        assert.ok(
            result.reason.includes("not in the allowed targets")
        );
    });


    // -----------------------------------------
    // No matching rule rejects
    // -----------------------------------------

    it("should reject when no policy rule matches", () => {

        const incident = {
            title: "Unrelated log noise",
            description: "Some informational message",
            severity: "info",
            category: "misc"
        };

        const result = evaluatePolicy(
            incident,
            "RESTART_SERVICE",
            "cloudops-server"
        );

        assert.equal(result.approved, false);
        assert.ok(
            result.reason.includes("No policy rule")
        );
    });


    // -----------------------------------------
    // Action whitelist validation
    // -----------------------------------------

    it("should validate allowed actions", () => {

        assert.equal(
            isValidAction("RESTART_SERVICE"),
            true
        );

        assert.equal(
            isValidAction("SCALE_SERVICE"),
            true
        );

        assert.equal(
            isValidAction("EXEC_SHELL"),
            false
        );

        assert.equal(
            isValidAction("rm -rf /"),
            false
        );
    });


    // -----------------------------------------
    // Target whitelist validation
    // -----------------------------------------

    it("should validate allowed targets", () => {

        assert.equal(
            isValidTarget("cloudops-server"),
            true
        );

        assert.equal(
            isValidTarget("random-server"),
            false
        );

        assert.equal(
            isValidTarget(""),
            false
        );
    });
});


// =========================================
// 2. AI DECISION PARSER TESTS
// =========================================

describe("AI Decision Parser", () => {

    // -----------------------------------------
    // Valid JSON parsed correctly
    // -----------------------------------------

    it("should parse valid JSON decision", () => {

        const raw = JSON.stringify({
            action: "RESTART_SERVICE",
            target: "cloudops-server",
            reason: "Service is unresponsive",
            confidence: 0.85
        });

        const decision = parseDecision(raw);

        assert.ok(decision);
        assert.equal(decision.action, "RESTART_SERVICE");
        assert.equal(decision.target, "cloudops-server");
        assert.equal(decision.confidence, 0.85);
    });


    // -----------------------------------------
    // JSON with markdown fences
    // -----------------------------------------

    it("should parse JSON wrapped in markdown code fences", () => {

        const raw = '```json\n{"action":"RESTART_SERVICE","target":"cloudops-server","reason":"test","confidence":0.9}\n```';

        const decision = parseDecision(raw);

        assert.ok(decision);
        assert.equal(decision.action, "RESTART_SERVICE");
    });


    // -----------------------------------------
    // Invalid action returns null
    // -----------------------------------------

    it("should return null for invalid action", () => {

        const raw = JSON.stringify({
            action: "DROP_TABLE",
            target: "cloudops-server",
            reason: "test",
            confidence: 0.9
        });

        const decision = parseDecision(raw);

        assert.equal(decision, null);
    });


    // -----------------------------------------
    // Invalid target returns null
    // -----------------------------------------

    it("should return null for invalid target", () => {

        const raw = JSON.stringify({
            action: "RESTART_SERVICE",
            target: "evil-server",
            reason: "test",
            confidence: 0.9
        });

        const decision = parseDecision(raw);

        assert.equal(decision, null);
    });


    // -----------------------------------------
    // Malformed text returns null
    // -----------------------------------------

    it("should return null for malformed output", () => {

        const decision = parseDecision(
            "I think you should restart the server maybe?"
        );

        assert.equal(decision, null);
    });


    // -----------------------------------------
    // NONE action returns null
    // -----------------------------------------

    it("should return null for NONE action", () => {

        const raw = JSON.stringify({
            action: "NONE",
            target: "cloudops-server",
            reason: "No action needed",
            confidence: 0.1
        });

        const decision = parseDecision(raw);

        assert.equal(decision, null);
    });


    // -----------------------------------------
    // Clamps invalid confidence
    // -----------------------------------------

    it("should normalize invalid confidence", () => {

        const raw = JSON.stringify({
            action: "RESTART_SERVICE",
            target: "cloudops-server",
            reason: "test",
            confidence: "very high"
        });

        const decision = parseDecision(raw);

        assert.ok(decision);
        assert.equal(decision.confidence, 0.5);
    });
});


// =========================================
// 3. CONFIG TESTS
// =========================================

describe("Remediation Config", () => {

    it("should have valid allowed actions", () => {

        assert.ok(Array.isArray(ALLOWED_ACTIONS));
        assert.ok(ALLOWED_ACTIONS.length > 0);
        assert.ok(ALLOWED_ACTIONS.includes("RESTART_SERVICE"));
        assert.ok(ALLOWED_ACTIONS.includes("SCALE_SERVICE"));
    });


    it("should have valid allowed targets", () => {

        assert.ok(typeof ALLOWED_TARGETS === "object");
        assert.ok("cloudops-server" in ALLOWED_TARGETS);
        assert.ok(ALLOWED_TARGETS["cloudops-server"].container);
    });


    it("should have valid status enum", () => {

        assert.ok(REMEDIATION_STATUS.PENDING);
        assert.ok(REMEDIATION_STATUS.APPROVED);
        assert.ok(REMEDIATION_STATUS.REJECTED);
        assert.ok(REMEDIATION_STATUS.EXECUTING);
        assert.ok(REMEDIATION_STATUS.SUCCESS);
        assert.ok(REMEDIATION_STATUS.FAILED);
        assert.ok(REMEDIATION_STATUS.UNVERIFIED);
    });
});


// =========================================
// 4. EXECUTOR SAFETY TESTS
// =========================================

describe("Executor Safety", () => {

    const { DockerExecutor } = require(
        "../src/services/remediation/executor"
    );


    it("should reject unknown action", async () => {

        const executor = new DockerExecutor();

        await assert.rejects(
            async () => {
                await executor.execute(
                    "DELETE_ALL",
                    "cloudops-server",
                    {}
                );
            },
            {
                message: /Unsupported action/
            }
        );
    });


    it("should reject unknown target", async () => {

        const executor = new DockerExecutor();

        await assert.rejects(
            async () => {
                await executor.execute(
                    "RESTART_SERVICE",
                    "evil-target",
                    {}
                );
            },
            {
                message: /Unknown target/
            }
        );
    });


    it("should return failure for SCALE_SERVICE in Docker mode", async () => {

        const executor = new DockerExecutor();

        const result = await executor.execute(
            "SCALE_SERVICE",
            "cloudops-server",
            {}
        );

        assert.equal(result.success, false);
        assert.ok(result.message.includes("Kubernetes"));
    });
});


// =========================================
// 5. VERIFICATION LOGIC TESTS
// =========================================

describe("Verification Logic", () => {

    it("should handle null metric gracefully", async () => {

        // We can't easily test actual Prometheus queries
        // but we can test that the module exports correctly
        const {
            captureMetric
        } = require("../src/services/remediation/verification");

        // Unknown metric should return null
        const value = await captureMetric("nonexistent_metric");

        assert.equal(value, null);
    });
});


// =========================================
// 6. INTEGRATION SAFETY TESTS
// =========================================

describe("Security Constraints", () => {

    it("should not allow arbitrary shell commands as actions", () => {

        assert.equal(
            isValidAction("bash -c 'rm -rf /'"),
            false
        );

        assert.equal(
            isValidAction("docker exec rm"),
            false
        );

        assert.equal(
            isValidAction("kubectl delete pods"),
            false
        );
    });


    it("should not allow arbitrary targets", () => {

        assert.equal(
            isValidTarget("../../etc/passwd"),
            false
        );

        assert.equal(
            isValidTarget("production-db"),
            false
        );
    });


    it("should reject AI output with shell injection", () => {

        const raw = JSON.stringify({
            action: "RESTART_SERVICE; rm -rf /",
            target: "cloudops-server",
            reason: "test",
            confidence: 0.9
        });

        const decision = parseDecision(raw);

        assert.equal(decision, null);
    });
});
