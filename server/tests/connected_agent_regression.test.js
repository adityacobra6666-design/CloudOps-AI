const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
    computeFreshStatus,
    isTelemetryFresh,
    resolveConnection
} = require("../src/controllers/infrastructure.controller");

describe("Connected Agent Regression Tests", () => {
    describe("resolveConnection logic", () => {
        it("should return null when connectionId is explicitly 'grafana_cloud'", async () => {
            const conn = await resolveConnection("grafana_cloud");
            assert.equal(conn, null);
        });

        it("should compute accurate fresh status based on lastSeenAt", () => {
            const now = Date.now();

            // Fresh connection (<35s)
            const fresh = { status: "CONNECTED", lastSeenAt: new Date(now - 10000) };
            assert.equal(computeFreshStatus(fresh), "CONNECTED");

            // Degraded connection (35s - 60s)
            const degraded = { status: "CONNECTED", lastSeenAt: new Date(now - 45000) };
            assert.equal(computeFreshStatus(degraded), "DEGRADED");

            // Disconnected connection (>60s)
            const disconnected = { status: "CONNECTED", lastSeenAt: new Date(now - 70000) };
            assert.equal(computeFreshStatus(disconnected), "DISCONNECTED");

            // Revoked connection
            const revoked = { status: "REVOKED", lastSeenAt: new Date(now - 5000) };
            assert.equal(computeFreshStatus(revoked), "REVOKED");

            // Pending connection
            const pending = { status: "PENDING", lastSeenAt: null };
            assert.equal(computeFreshStatus(pending), "PENDING");
        });

        it("should evaluate telemetry freshness correctly", () => {
            const now = Date.now();
            assert.equal(isTelemetryFresh(new Date(now - 10000)), true);
            assert.equal(isTelemetryFresh(new Date(now - 65000)), false);
            assert.equal(isTelemetryFresh(null), false);
            assert.equal(isTelemetryFresh(undefined), false);
        });
    });

    describe("Kubernetes dataStatus evaluation", () => {
        it("should compute CONNECTED and fresh data status", () => {
            const now = Date.now();
            const conn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 10000),
                k8sSummary: {
                    nodesCount: 1,
                    podsCount: 3,
                    deploymentsCount: 2,
                    clusterConnected: true,
                    k8sError: null,
                    updatedAt: new Date(now - 10000)
                }
            };

            const freshStatus = computeFreshStatus(conn);
            const telemetryFresh = isTelemetryFresh(conn.k8sSummary.updatedAt);
            const k8sConnected = conn.k8sSummary.clusterConnected !== false;
            const hasK8sError = Boolean(conn.k8sSummary.k8sError);

            assert.equal(freshStatus, "CONNECTED");
            assert.equal(telemetryFresh, true);
            assert.equal(k8sConnected, true);
            assert.equal(hasK8sError, false);

            const isConnected = freshStatus === "CONNECTED" && telemetryFresh && k8sConnected && !hasK8sError;
            assert.equal(isConnected, true);
        });

        it("should identify STALE telemetry without faking disconnected or empty cluster", () => {
            const now = Date.now();
            const conn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 10000),
                k8sSummary: {
                    nodesCount: 1,
                    podsCount: 3,
                    deploymentsCount: 2,
                    clusterConnected: true,
                    updatedAt: new Date(now - 90000)
                }
            };

            const freshStatus = computeFreshStatus(conn);
            const telemetryFresh = isTelemetryFresh(conn.k8sSummary.updatedAt);
            assert.equal(freshStatus, "CONNECTED");
            assert.equal(telemetryFresh, false);

            let dataStatus = "CONNECTED";
            if (!telemetryFresh) {
                dataStatus = "STALE";
            }
            assert.equal(dataStatus, "STALE");
        });

        it("should identify KUBERNETES_ERROR when agent reports cluster query failure", () => {
            const now = Date.now();
            const conn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 10000),
                k8sSummary: {
                    nodesCount: 0,
                    podsCount: 0,
                    deploymentsCount: 0,
                    clusterConnected: false,
                    k8sError: "connect ECONNREFUSED 192.168.49.2:8443",
                    updatedAt: new Date(now - 10000)
                }
            };

            const freshStatus = computeFreshStatus(conn);
            const telemetryFresh = isTelemetryFresh(conn.k8sSummary.updatedAt);
            const k8sConnected = conn.k8sSummary.clusterConnected !== false;
            const hasK8sError = Boolean(conn.k8sSummary.k8sError);

            let dataStatus = "CONNECTED";
            let statusMessage = "";
            if (!k8sConnected || hasK8sError) {
                dataStatus = "KUBERNETES_ERROR";
                statusMessage = conn.k8sSummary.k8sError;
            }

            assert.equal(dataStatus, "KUBERNETES_ERROR");
            assert.equal(statusMessage, "connect ECONNREFUSED 192.168.49.2:8443");
        });

        it("should identify NO_RESOURCES when cluster query succeeded but no workloads exist", () => {
            const now = Date.now();
            const conn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 10000),
                k8sSummary: {
                    nodesCount: 0,
                    podsCount: 0,
                    deploymentsCount: 0,
                    clusterConnected: true,
                    k8sError: null,
                    updatedAt: new Date(now - 10000)
                }
            };

            const freshStatus = computeFreshStatus(conn);
            const telemetryFresh = isTelemetryFresh(conn.k8sSummary.updatedAt);
            const k8sConnected = conn.k8sSummary.clusterConnected !== false;
            const hasK8sError = Boolean(conn.k8sSummary.k8sError);

            let dataStatus = "CONNECTED";
            if (
                freshStatus === "CONNECTED" &&
                telemetryFresh &&
                k8sConnected &&
                !hasK8sError &&
                conn.k8sSummary.nodesCount === 0 &&
                conn.k8sSummary.deploymentsCount === 0 &&
                conn.k8sSummary.podsCount === 0
            ) {
                dataStatus = "NO_RESOURCES";
            }

            assert.equal(dataStatus, "NO_RESOURCES");
        });
    });

    describe("Observability dataStatus evaluation", () => {
        it("should mark telemetry unavailable when Prometheus is disconnected on agent", () => {
            const now = Date.now();
            const conn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 10000),
                telemetry: {
                    recordedAt: new Date(now - 10000),
                    metrics: {
                        cpu: 0,
                        memory: 0,
                        prometheusConnected: false,
                        prometheusError: "Prometheus server is unreachable at http://localhost:9090"
                    }
                }
            };

            const freshStatus = computeFreshStatus(conn);
            const telemetryFresh = isTelemetryFresh(conn.telemetry.recordedAt);
            const metrics = conn.telemetry.metrics;
            const promConnected = metrics && metrics.prometheusConnected !== false;

            const isAvailable = freshStatus === "CONNECTED" && telemetryFresh && Boolean(metrics) && promConnected;
            assert.equal(promConnected, false);
            assert.equal(isAvailable, false);

            let dataStatus = isAvailable ? "CONNECTED" : (!promConnected ? "PROMETHEUS_UNAVAILABLE" : "STALE");
            assert.equal(dataStatus, "PROMETHEUS_UNAVAILABLE");
        });

        it("should mark telemetry available when Prometheus and agent telemetry are fresh", () => {
            const now = Date.now();
            const conn = {
                status: "CONNECTED",
                lastSeenAt: new Date(now - 10000),
                telemetry: {
                    recordedAt: new Date(now - 10000),
                    metrics: {
                        cpu: 15.2,
                        memory: 64.8,
                        requestRate: 1.25,
                        prometheusConnected: true,
                        prometheusError: null
                    }
                }
            };

            const freshStatus = computeFreshStatus(conn);
            const telemetryFresh = isTelemetryFresh(conn.telemetry.recordedAt);
            const metrics = conn.telemetry.metrics;
            const promConnected = metrics && metrics.prometheusConnected !== false;

            const isAvailable = freshStatus === "CONNECTED" && telemetryFresh && Boolean(metrics) && promConnected;
            assert.equal(isAvailable, true);
        });
    });
});
