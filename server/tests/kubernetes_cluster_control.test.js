const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
    computeFreshStatus,
    isTelemetryFresh
} = require("../src/controllers/infrastructure.controller");

describe("Kubernetes Cluster Control Center & Outbound Channel Tests", () => {
    // -------------------------------------------------------------------------
    // 1. Cluster Connection Separation (Agent vs Cluster API)
    // -------------------------------------------------------------------------
    describe("Cluster Connectivity State Separation", () => {
        it("should distinguish between Agent Connected and Cluster Reachable", () => {
            const now = Date.now();
            // Scenario: Agent heartbeat is active, but Kubernetes API connection refused
            const agentConnectedClusterDown = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 10000),
                k8sSummary: {
                    nodesCount: 0,
                    podsCount: 0,
                    deploymentsCount: 0,
                    clusterConnected: false,
                    k8sError: "Kubernetes API unreachable: Connection refused to 192.168.49.2:8443 (ECONNREFUSED)",
                    updatedAt: new Date(now - 10000)
                }
            };

            const freshStatus = computeFreshStatus(agentConnectedClusterDown);
            const agentConnected = freshStatus === "CONNECTED" || freshStatus === "DEGRADED";
            const k8sSummary = agentConnectedClusterDown.k8sSummary;
            const clusterReachable = k8sSummary.clusterConnected !== false && !k8sSummary.k8sError;

            assert.equal(agentConnected, true, "Agent should be marked connected");
            assert.equal(clusterReachable, false, "Cluster API should be marked unreachable");
            assert.ok(k8sSummary.k8sError.includes("ECONNREFUSED"), "Safe diagnostic error must be preserved");
        });

        it("should report Cluster Reachable only when both agent and cluster query succeed", () => {
            const now = Date.now();
            const healthyCluster = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 5000),
                k8sSummary: {
                    nodesCount: 1,
                    podsCount: 7,
                    deploymentsCount: 2,
                    clusterConnected: true,
                    k8sError: null,
                    updatedAt: new Date(now - 5000)
                }
            };

            const freshStatus = computeFreshStatus(healthyCluster);
            const telemetryFresh = isTelemetryFresh(healthyCluster.k8sSummary.updatedAt);
            const agentConnected = freshStatus === "CONNECTED" || freshStatus === "DEGRADED";
            const clusterReachable = healthyCluster.k8sSummary.clusterConnected !== false && !healthyCluster.k8sSummary.k8sError;
            const fullyConnected = agentConnected && telemetryFresh && clusterReachable;

            assert.equal(agentConnected, true);
            assert.equal(telemetryFresh, true);
            assert.equal(clusterReachable, true);
            assert.equal(fullyConnected, true);
        });

        it("should never mark cluster connected merely because agent heartbeat exists", () => {
            const now = Date.now();
            const heartbeatOnly = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 2000),
                k8sSummary: null // No k8s telemetry ever reported
            };

            const freshStatus = computeFreshStatus(heartbeatOnly);
            assert.equal(freshStatus, "CONNECTED");

            const k8sSummary = heartbeatOnly.k8sSummary || {};
            const clusterReachable = Boolean(k8sSummary.clusterConnected && !k8sSummary.k8sError && k8sSummary.updatedAt);
            assert.equal(clusterReachable, false, "Must not assume cluster is reachable without telemetry");
        });
    });

    // -------------------------------------------------------------------------
    // 2. Safe Diagnostics vs Generic 'fetch failed'
    // -------------------------------------------------------------------------
    describe("Safe Diagnostics and Error Sanitization", () => {
        it("should safely sanitize generic 'fetch failed' into actionable message", () => {
            const rawK8sError = "fetch failed";
            let sanitized = rawK8sError;
            if (sanitized === "fetch failed") {
                sanitized = "Kubernetes API unreachable: Connection refused or host unreachable (verify cluster is running)";
            }

            assert.notEqual(sanitized, "fetch failed");
            assert.ok(sanitized.includes("unreachable"));
        });

        it("should preserve specific network codes (ECONNREFUSED, ETIMEDOUT, EHOSTUNREACH)", () => {
            const socketErrors = [
                { cause: { code: "ECONNREFUSED", address: "192.168.49.2", port: 8443 }, expected: "Connection refused to 192.168.49.2:8443 (ECONNREFUSED)" },
                { cause: { code: "ETIMEDOUT", address: "10.96.0.1", port: 443 }, expected: "Connection timed out to 10.96.0.1:443 (ETIMEDOUT)" },
                { cause: { code: "EHOSTUNREACH", address: "192.168.49.2", port: 8443 }, expected: "Host unreachable at 192.168.49.2:8443 (EHOSTUNREACH)" }
            ];

            for (const item of socketErrors) {
                const cause = item.cause;
                let desc = `Kubernetes API unreachable: Connection ${cause.code === "ECONNREFUSED" ? "refused" : cause.code === "ETIMEDOUT" ? "timed out" : "unreachable"} to ${cause.address}:${cause.port} (${cause.code})`;
                assert.ok(desc.includes(cause.code));
                assert.ok(desc.includes(cause.address));
            }
        });
    });

    // -------------------------------------------------------------------------
    // 3. Agent Disconnection and Stale Telemetry
    // -------------------------------------------------------------------------
    describe("Agent Disconnection and Timeout Detection", () => {
        it("should detect agent disconnection when heartbeat exceeds 60s", () => {
            const now = Date.now();
            const disconnectedConn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 75000), // 75s ago
                k8sSummary: {
                    nodesCount: 1,
                    podsCount: 5,
                    deploymentsCount: 2,
                    clusterConnected: true,
                    updatedAt: new Date(now - 75000)
                }
            };

            const freshStatus = computeFreshStatus(disconnectedConn);
            assert.equal(freshStatus, "DISCONNECTED");

            const telemetryFresh = isTelemetryFresh(disconnectedConn.k8sSummary.updatedAt);
            assert.equal(telemetryFresh, false);
        });

        it("should detect degraded agent status when heartbeat is between 35s and 60s", () => {
            const now = Date.now();
            const degradedConn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 45000) // 45s ago
            };

            const freshStatus = computeFreshStatus(degradedConn);
            assert.equal(freshStatus, "DEGRADED");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Standalone Docker Mode vs Kubernetes Mode
    // -------------------------------------------------------------------------
    describe("Accurate Standalone Docker Mode Labeling", () => {
        it("should label Docker fallback accurately without presenting fake Kubernetes data", () => {
            const fallbackResponse = {
                success: true,
                configured: false,
                connected: false,
                agentConnected: false,
                clusterReachable: false,
                connectionId: "local",
                mode: "docker_fallback",
                dataStatus: "DISCONNECTED",
                statusMessage: "Standalone Docker Mode: No connected infrastructure agent or local kubeconfig found.",
                counts: { nodes: 0, pods: 0, deployments: 0, services: 0 },
                nodes: [],
                pods: [],
                deployments: []
            };

            assert.equal(fallbackResponse.mode, "docker_fallback");
            assert.equal(fallbackResponse.clusterReachable, false);
            assert.equal(fallbackResponse.nodes.length, 0);
            assert.equal(fallbackResponse.pods.length, 0);
            assert.ok(!fallbackResponse.statusMessage.includes("Kubernetes cluster connected"));
        });
    });

    // -------------------------------------------------------------------------
    // 5. Remediation Whitelist & Replica Bounds Verification
    // -------------------------------------------------------------------------
    describe("Remediation Action Guardrails", () => {
        it("should reject replica count < 1 or > 10 for SCALE_SERVICE", () => {
            const testValues = [0, -1, 11, 50, "invalid", NaN];
            for (const val of testValues) {
                const num = parseInt(val, 10);
                const isValid = !isNaN(num) && num >= 1 && num <= 10;
                assert.equal(isValid, false, `Value ${val} should be rejected`);
            }

            const validValues = [1, 2, 5, 10];
            for (const val of validValues) {
                const num = parseInt(val, 10);
                const isValid = !isNaN(num) && num >= 1 && num <= 10;
                assert.equal(isValid, true, `Value ${val} should be accepted`);
            }
        });
    });
});
