const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const axios = require("axios");
const prometheusService = require("../src/services/prometheus.service");
const app = require("../src/app");

describe("Kubernetes Health & Readiness Probe (/health & /api/health)", () => {
    let server;
    let baseUrl;
    let originalReadyState;

    before(async () => {
        // Start ephemeral HTTP server for probe tests
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
        originalReadyState = mongoose.connection.readyState;
    });

    after(async () => {
        // Restore connection state and close server
        Object.defineProperty(mongoose.connection, "readyState", {
            value: originalReadyState,
            configurable: true
        });
        await new Promise((resolve) => server.close(resolve));
    });

    it("should respond within 100ms on /health (lightweight probe)", async () => {
        Object.defineProperty(mongoose.connection, "readyState", {
            value: 1,
            configurable: true
        });

        const start = performance.now();
        const response = await fetch(`${baseUrl}/health`);
        const duration = performance.now() - start;

        assert.equal(response.status, 200);
        assert.ok(duration < 100, `Expected duration < 100ms, got ${duration.toFixed(2)}ms`);

        const data = await response.json();
        assert.equal(data.success, true);
        assert.equal(data.status, "healthy");
        assert.ok(data.timestamp);
        assert.deepEqual(data.dependencies, {
            database: "healthy",
            prometheus: "not_checked",
            ollama: "not_checked"
        });
    });

    it("should respond on /api/health with identical backward-compatible structure", async () => {
        Object.defineProperty(mongoose.connection, "readyState", {
            value: 1,
            configurable: true
        });

        const response = await fetch(`${baseUrl}/api/health`);
        assert.equal(response.status, 200);

        const data = await response.json();
        assert.equal(data.success, true);
        assert.equal(data.status, "healthy");
        assert.ok(data.timestamp);
        assert.equal(data.dependencies.database, "healthy");
        assert.equal(data.dependencies.prometheus, "not_checked");
        assert.equal(data.dependencies.ollama, "not_checked");
    });

    it("should return HTTP 503 when MongoDB is disconnected", async () => {
        Object.defineProperty(mongoose.connection, "readyState", {
            value: 0,
            configurable: true
        });

        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 503);

        const data = await response.json();
        assert.equal(data.success, false);
        assert.equal(data.status, "unhealthy");
        assert.equal(data.dependencies.database, "unhealthy");
        assert.equal(data.dependencies.prometheus, "not_checked");
        assert.equal(data.dependencies.ollama, "not_checked");
    });

    it("must not perform network calls to Prometheus or Ollama during health checks", async () => {
        Object.defineProperty(mongoose.connection, "readyState", {
            value: 1,
            configurable: true
        });

        let axiosCalled = false;
        let promHealthCalled = false;

        const originalAxiosGet = axios.get;
        const originalCheckPrometheus = prometheusService.checkPrometheusHealth;

        axios.get = async (...args) => {
            axiosCalled = true;
            return originalAxiosGet.apply(axios, args);
        };

        if (prometheusService.checkPrometheusHealth) {
            prometheusService.checkPrometheusHealth = async (...args) => {
                promHealthCalled = true;
                return originalCheckPrometheus.apply(prometheusService, args);
            };
        }

        try {
            await fetch(`${baseUrl}/health`);
            await fetch(`${baseUrl}/api/health`);

            assert.equal(axiosCalled, false, "axios.get should not be called by /health probe");
            assert.equal(promHealthCalled, false, "checkPrometheusHealth should not be called by /health probe");
        } finally {
            axios.get = originalAxiosGet;
            if (prometheusService.checkPrometheusHealth) {
                prometheusService.checkPrometheusHealth = originalCheckPrometheus;
            }
        }
    });
});
