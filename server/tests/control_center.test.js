const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const metricsRoutes = require("../src/routes/metrics.routes");
const reliabilityRoutes = require("../src/routes/reliability.routes");
const kubernetesRoutes = require("../src/routes/kubernetes.routes");

describe("Control Center Endpoints", () => {
    const app = express();
    app.use(express.json());
    app.use("/api/metrics", metricsRoutes);
    app.use("/api/reliability", reliabilityRoutes);
    app.use("/api/kubernetes", kubernetesRoutes);

    it("should load metrics overview endpoint logic", async () => {
        const req = {};
        const res = {
            json(data) {
                assert.equal(data.success, true);
                assert.ok(data.metrics.cpu);
                assert.ok(data.metrics.memory);
                assert.ok(data.metrics.requestRate);
            }
        };
        const controller = require("../src/controllers/metrics.controller");
        await controller.getOverviewMetrics(req, res);
    });

    it("should load service health status", async () => {
        const req = {};
        const res = {
            json(data) {
                assert.equal(data.success, true);
                assert.ok(Array.isArray(data.services));
                assert.ok(data.globalStatus);
            }
        };
        const controller = require("../src/controllers/metrics.controller");
        await controller.getServicesHealth(req, res);
    });

    it("should load kubernetes overview endpoint", async () => {
        const req = {};
        const res = {
            json(data) {
                assert.equal(data.success, true);
                assert.equal(typeof data.configured, "boolean");
            }
        };
        const controller = require("../src/controllers/kubernetes.controller");
        await controller.getKubernetesOverview(req, res);
    });
});
