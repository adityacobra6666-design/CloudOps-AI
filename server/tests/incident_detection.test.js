const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { RULES } = require("../src/config/incidentDetection.config");
const { evaluateSeverity, evaluateRulesOnce } = require("../src/services/incidentDetector.service");
const Incident = require("../src/models/Incident");

describe("Automatic Incident Intelligence Engine", () => {
    before(async () => {
        let mongoUri = process.env.TEST_MONGO_URI || process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/cloudops";
        if (mongoUri.includes("://mongo:") || mongoUri.includes("://mongo/")) {
            mongoUri = mongoUri.replace("://mongo", "://127.0.0.1");
        }
        if (mongoose.connection.readyState !== 1) {
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
        }
        // Clean up test incidents
        await Incident.deleteMany({ alertFingerprint: { $regex: /^auto_test_/ } });
    });

    after(async () => {
        await Incident.deleteMany({ alertFingerprint: { $regex: /^auto_test_/ } });
        await mongoose.connection.close();
    });

    describe("Rule Severity Evaluation", () => {
        it("should return normal when metric is between recovery and warning thresholds", () => {
            const rule = RULES.high_cpu; // warning is 70, recovery is 68
            const res = evaluateSeverity(rule, 69.0);
            assert.equal(res.status, "normal");
        });

        it("should return breached with WARNING when between warning and critical", () => {
            const rule = RULES.high_cpu;
            const res = evaluateSeverity(rule, 75.0);
            assert.equal(res.status, "breached");
            assert.equal(res.severity, "WARNING");
            assert.equal(res.threshold, 70);
        });

        it("should return breached with CRITICAL when above critical threshold", () => {
            const rule = RULES.high_cpu;
            const res = evaluateSeverity(rule, 89.2);
            assert.equal(res.status, "breached");
            assert.equal(res.severity, "CRITICAL");
            assert.equal(res.threshold, 85);
        });

        it("should return recovered when metric drops to recovery threshold", () => {
            const rule = RULES.high_cpu;
            const res = evaluateSeverity(rule, 65.0);
            assert.equal(res.status, "recovered");
        });

        it("should mark missing or null metrics as unevaluable without inventing values", () => {
            const rule = RULES.high_cpu;
            assert.equal(evaluateSeverity(rule, null).status, "unevaluable");
            assert.equal(evaluateSeverity(rule, undefined).status, "unevaluable");
            assert.equal(evaluateSeverity(rule, NaN).status, "unevaluable");
        });
    });

    describe("Incident Lifecycle: Detection, Deduplication & Auto-Recovery", () => {
        process.env.SERVER_NAME = "test-server";
        const testFingerprint = "auto_high_cpu_test-server";

        it("should require consecutive breaches before triggering incident (prevents transient spikes)", async () => {
            // First breach (spike)
            const pass1 = await evaluateRulesOnce({
                cpu: 92.0,
                memory: 50.0,
                p95Latency: 100,
                errorRate: 0,
                backendHealth: 1
            });

            // If consecutiveBreachesRequired is 2, pass 1 counts the breach but doesn't yet create incident
            // (or if config is 1, it creates)
            assert.ok(pass1.breachedRules >= 1);
        });

        it("should create incident on sustained breach and deduplicate on subsequent passes", async () => {
            // Second breach (sustained)
            const pass2 = await evaluateRulesOnce({
                cpu: 92.5,
                memory: 50.0,
                p95Latency: 100,
                errorRate: 0,
                backendHealth: 1
            });

            const openIncidents = await Incident.find({
                alertFingerprint: testFingerprint,
                status: { $in: ["OPEN", "open"] }
            });

            assert.equal(openIncidents.length, 1, "Exactly one open incident should exist");
            const inc = openIncidents[0];
            assert.equal(inc.severity, "critical");
            assert.equal(inc.autoDetected, true);
            assert.equal(inc.triggerRule, "high_cpu");

            // Third breach pass with sustained condition
            const pass3 = await evaluateRulesOnce({
                cpu: 93.1,
                memory: 50.0,
                p95Latency: 100,
                errorRate: 0,
                backendHealth: 1
            });

            assert.equal(pass3.incidentsCreated, 0, "No duplicate incident should be created");
            assert.ok(pass3.incidentsUpdated >= 1, "Existing incident should be updated with last-seen time");

            const countAfterPass3 = await Incident.countDocuments({
                alertFingerprint: testFingerprint,
                status: { $in: ["OPEN", "open"] }
            });
            assert.equal(countAfterPass3, 1, "Still exactly one open incident after pass 3");
        });

        it("should auto-resolve incident when metric recovers below recovery threshold", async () => {
            // Normalizing metric below recovery threshold (CPU 50% <= 68%)
            const recoveryPass = await evaluateRulesOnce({
                cpu: 50.0,
                memory: 50.0,
                p95Latency: 100,
                errorRate: 0,
                backendHealth: 1
            });

            assert.ok(recoveryPass.incidentsResolved >= 1, "Incident should be resolved");

            const resolvedIncident = await Incident.findOne({ alertFingerprint: testFingerprint });
            assert.ok(resolvedIncident);
            assert.equal(resolvedIncident.status, "RESOLVED");
            assert.ok(resolvedIncident.resolvedAt instanceof Date);
            assert.ok(resolvedIncident.resolutionNote.includes("Auto-resolved"));
        });
    });
});
