const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { alertWebhook } = require("../src/controllers/incidentController");
const Incident = require("../src/models/Incident");

describe("Alert Webhook Security & Idempotency Tests", () => {
    const originalEnv = { ...process.env };
    const TEST_SECRET = "test_webhook_secret_key_98765";

    beforeEach(() => {
        delete process.env.ALERTMANAGER_WEBHOOK_SECRET;
        delete process.env.ALERT_WEBHOOK_SECRET;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe("Webhook Authentication Middleware", () => {
        it("should reject requests when secret is configured but token is missing", async () => {
            process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;

            const req = {
                headers: {},
                body: { alerts: [] }
            };
            let responseStatus = null;
            let responseBody = null;
            const res = {
                status(code) {
                    responseStatus = code;
                    return this;
                },
                json(data) {
                    responseBody = data;
                    return this;
                }
            };

            await alertWebhook(req, res);
            assert.equal(responseStatus, 401);
            assert.equal(responseBody.success, false);
            assert.ok(responseBody.message.includes("Invalid or missing webhook token"));
        });

        it("should reject requests with invalid token", async () => {
            process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;

            const req = {
                headers: { "x-webhook-token": "wrong_token_123" },
                body: { alerts: [] }
            };
            let responseStatus = null;
            const res = {
                status(code) {
                    responseStatus = code;
                    return this;
                },
                json() { return this; }
            };

            await alertWebhook(req, res);
            assert.equal(responseStatus, 401);
        });

        it("should accept requests with valid X-Webhook-Token header", async () => {
            process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;

            const req = {
                headers: { "x-webhook-token": TEST_SECRET },
                body: { alerts: [] }
            };
            let responseStatus = null;
            let responseBody = null;
            const res = {
                status(code) {
                    responseStatus = code;
                    return this;
                },
                json(data) {
                    responseBody = data;
                    return this;
                }
            };

            await alertWebhook(req, res);
            assert.equal(responseStatus, 200);
            assert.equal(responseBody.success, true);
        });

        it("should accept requests with valid Authorization Bearer token", async () => {
            process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;

            const req = {
                headers: { authorization: `Bearer ${TEST_SECRET}` },
                body: { alerts: [] }
            };
            let responseStatus = null;
            const res = {
                status(code) {
                    responseStatus = code;
                    return this;
                },
                json() { return this; }
            };

            await alertWebhook(req, res);
            assert.equal(responseStatus, 200);
        });

        it("should accept requests with valid query parameter token", async () => {
            process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;

            const req = {
                headers: {},
                query: { token: TEST_SECRET },
                body: { alerts: [] }
            };
            let responseStatus = null;
            const res = {
                status(code) {
                    responseStatus = code;
                    return this;
                },
                json() { return this; }
            };

            await alertWebhook(req, res);
            assert.equal(responseStatus, 200);
        });

        it("should permit requests in development mode when no secret is configured", async () => {
            const req = {
                headers: {},
                body: { alerts: [] }
            };
            let responseStatus = null;
            const res = {
                status(code) {
                    responseStatus = code;
                    return this;
                },
                json() { return this; }
            };

            await alertWebhook(req, res);
            assert.equal(responseStatus, 200);
        });
    });

    describe("Alert Payload Handling & Deduplication Logic", () => {
        it("should handle empty alert arrays gracefully", async () => {
            const req = { headers: {}, body: { alerts: [] } };
            let responseData = null;
            const res = {
                status() { return this; },
                json(data) { responseData = data; return this; }
            };

            await alertWebhook(req, res);
            assert.equal(responseData.success, true);
            assert.equal(responseData.created, 0);
            assert.equal(responseData.updated, 0);
            assert.equal(responseData.resolved, 0);
        });

        it("should create incident on firing alert and deduplicate on repeat notification", async () => {
            // Mock Mongoose Incident operations
            const store = new Map();
            const originalFindOne = Incident.findOne;
            const originalCreate = Incident.create;

            Incident.findOne = async ({ $or }) => {
                const fp = $or[0]?.alertFingerprint;
                const statusQuery = $or[0]?.status?.$in || [];
                for (const item of store.values()) {
                    if (item.alertFingerprint === fp && statusQuery.includes(item.status)) {
                        return item;
                    }
                }
                return null;
            };

            Incident.create = async (doc) => {
                const id = `inc-${Date.now()}-${Math.random()}`;
                const created = {
                    ...doc,
                    _id: id,
                    save: async function() { return this; }
                };
                store.set(id, created);
                return created;
            };

            try {
                const alertPayload = {
                    alerts: [
                        {
                            status: "firing",
                            labels: {
                                alertname: "HighHostCPU",
                                severity: "warning",
                                instance: "node-exporter:9100",
                                category: "infrastructure"
                            },
                            annotations: {
                                summary: "High Host CPU Utilization",
                                description: "CPU usage crossed 80%"
                            },
                            fingerprint: "fp-cpu-test-123",
                            startsAt: new Date().toISOString()
                        }
                    ]
                };

                let res1Data = null;
                const res1 = {
                    status() { return this; },
                    json(data) { res1Data = data; return this; }
                };

                // First delivery -> CREATED
                await alertWebhook({ headers: {}, body: alertPayload }, res1);
                assert.equal(res1Data.created, 1);
                assert.equal(res1Data.updated, 0);
                assert.equal(store.size, 1);

                // Second delivery with same fingerprint -> UPDATED (Idempotent Deduplication)
                let res2Data = null;
                const res2 = {
                    status() { return this; },
                    json(data) { res2Data = data; return this; }
                };

                await alertWebhook({ headers: {}, body: alertPayload }, res2);
                assert.equal(res2Data.created, 0);
                assert.equal(res2Data.updated, 1);
                assert.equal(store.size, 1); // No duplicate incident created

                // Third delivery with resolved status -> RESOLVED
                const resolvedPayload = {
                    alerts: [{
                        ...alertPayload.alerts[0],
                        status: "resolved",
                        endsAt: new Date().toISOString()
                    }]
                };

                let res3Data = null;
                const res3 = {
                    status() { return this; },
                    json(data) { res3Data = data; return this; }
                };

                await alertWebhook({ headers: {}, body: resolvedPayload }, res3);
                assert.equal(res3Data.resolved, 1);

                const item = Array.from(store.values())[0];
                assert.equal(item.status, "resolved");
                assert.ok(item.endsAt);
            } finally {
                Incident.findOne = originalFindOne;
                Incident.create = originalCreate;
            }
        });
    });
});
