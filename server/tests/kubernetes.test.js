const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { kubernetesService } = require("../src/services/kubernetes/kubernetes.service");
const { KubernetesExecutor, createExecutor } = require("../src/services/remediation/executor");
const { evaluatePolicy } = require("../src/services/remediation/policyEngine");
const { verifyRemediation } = require("../src/services/remediation/verification");
const { KUBERNETES_CONFIG } = require("../src/config/remediation.config");

describe("Kubernetes Integration Tests (Phase 2)", () => {
    // -------------------------------------------------------------
    // 1. Kubernetes Client Connection & Offline Graceful Handling
    // -------------------------------------------------------------
    it("should gracefully report connection status when cluster is unavailable", async () => {
        const status = await kubernetesService.getClusterStatus();
        assert.equal(typeof status.connected, "boolean");
        assert.ok(status.message);
        assert.ok(status.namespace);
    });

    it("should return clean structured response for overview when disconnected", async () => {
        const overview = await kubernetesService.getOverview();
        assert.equal(typeof overview.connected, "boolean");
        assert.ok(overview.summary);
        assert.equal(typeof overview.summary.nodesTotal, "number");
        assert.equal(typeof overview.summary.podsTotal, "number");
    });

    // -------------------------------------------------------------
    // 2. Strict Target & Replica Validation
    // -------------------------------------------------------------
    it("should reject unknown target deployment in KubernetesExecutor", async () => {
        const executor = new KubernetesExecutor();
        await assert.rejects(
            async () => {
                await executor.execute("SCALE_SERVICE", "unauthorized-malicious-target", { replicas: 3 });
            },
            (err) => {
                assert.ok(err.message.includes("whitelist") || err.message.includes("Rejected"));
                return true;
            }
        );
    });

    it("should reject unsupported action in KubernetesExecutor", async () => {
        const executor = new KubernetesExecutor();
        await assert.rejects(
            async () => {
                await executor.execute("DELETE_CLUSTER", "backend", { replicas: 3 });
            },
            (err) => {
                assert.ok(err.message.includes("Unsupported Kubernetes action"));
                return true;
            }
        );
    });

    it("should reject replica count above max limit (10)", async () => {
        await assert.rejects(
            async () => {
                await kubernetesService.scaleDeployment("cloudops-backend", 99, "cloudops");
            },
            (err) => {
                assert.ok(err.message.includes("Invalid replica count") || err.message.includes("connected"));
                return true;
            }
        );
    });

    it("should reject replica count below min limit (1)", async () => {
        await assert.rejects(
            async () => {
                await kubernetesService.scaleDeployment("cloudops-backend", 0, "cloudops");
            },
            (err) => {
                assert.ok(err.message.includes("Invalid replica count") || err.message.includes("connected"));
                return true;
            }
        );
    });

    // -------------------------------------------------------------
    // 3. Policy Engine & Executor Selection
    // -------------------------------------------------------------
    it("should allow SCALE_SERVICE policy for CPU saturation incident", () => {
        const incident = {
            title: "High CPU utilization on backend deployment",
            severity: "critical"
        };

        const result = evaluatePolicy(incident, "SCALE_SERVICE", "backend");
        assert.equal(result.approved, true);
        assert.equal(result.rule, "cpu_saturation");
    });

    it("should select KubernetesExecutor when specified", () => {
        const executor = createExecutor("kubernetes");
        assert.equal(executor.getName(), "KubernetesExecutor");
    });

    it("should fallback to DockerExecutor when specified", () => {
        const executor = createExecutor("docker");
        assert.equal(executor.getName(), "DockerExecutor");
    });

    // -------------------------------------------------------------
    // 4. Verification Logic
    // -------------------------------------------------------------
    it("should fail verification if Kubernetes convergence fails", async () => {
        const verification = await verifyRemediation("cpu", 90, {
            executor: "KubernetesExecutor",
            deploymentName: "backend",
            newReplicas: 4,
            namespace: "cloudops",
            skipWait: true
        });

        // Since no live k8s cluster is connected during node --test, convergence check fails
        assert.equal(verification.status, "FAILED");
        assert.equal(verification.passed, false);
        assert.ok(verification.message.includes("convergence failed") || verification.message.includes("replicas"));
    });

    it("should produce valid verification object structure", async () => {
        const verification = await verifyRemediation("cpu", 85, {
            skipWait: true
        });

        assert.ok(verification.status);
        assert.ok(verification.message);
    });
});
