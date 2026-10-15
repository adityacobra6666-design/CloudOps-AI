const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const geminiService = require("../src/services/ai/gemini.service");
const {
    sanitizeInput,
    parseAnalysisText,
    parseDecision,
    cosineSimilarity,
    createEmbedding,
    generateAnalysis,
    generateRemediationDecision,
    checkGeminiHealth,
    isGeminiConfigured
} = geminiService;

describe("Gemini AI Provider & Safety Tests", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_MOCK;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe("Configuration & Health", () => {
        it("should report unconfigured when GEMINI_API_KEY is missing", async () => {
            assert.equal(isGeminiConfigured(), false);
            const health = await checkGeminiHealth();
            assert.equal(health.configured, false);
            assert.equal(health.healthy, false);
            assert.ok(health.details.includes("not configured"));
        });

        it("should report healthy in mock mode without needing a real API key", async () => {
            process.env.GEMINI_MOCK = "true";
            const health = await checkGeminiHealth();
            assert.equal(health.configured, true);
            assert.equal(health.healthy, true);
            assert.equal(health.isMock, true);
        });
    });

    describe("Input Sanitization & Secret Redaction", () => {
        it("should redact infrastructure tokens, secrets, and API keys", () => {
            const raw = `
                Agent token: copa_1d724735b58e53a7beb075d86f011173cc957d2a42ab2b1758a60babb8fea63f
                Enroll token: cope_1234567890abcdef1234567890abcdef
                Google API key: AIzaSyD9x8y7w6v5u4t3s2r1q0pOnMlKjIhGfEd
                Authorization: Bearer my_super_secret_jwt_token_12345
                Config line: password = "super_secret_password_abc"
            `;

            const sanitized = sanitizeInput(raw);
            assert.ok(!sanitized.includes("copa_1d724735"));
            assert.ok(!sanitized.includes("cope_12345678"));
            assert.ok(!sanitized.includes("AIzaSyD9"));
            assert.ok(!sanitized.includes("my_super_secret_jwt"));
            assert.ok(!sanitized.includes("super_secret_password_abc"));

            assert.ok(sanitized.includes("[REDACTED_AGENT_TOKEN]"));
            assert.ok(sanitized.includes("[REDACTED_ENROLLMENT_TOKEN]"));
            assert.ok(sanitized.includes("[REDACTED_API_KEY]"));
            assert.ok(sanitized.includes("Bearer [REDACTED]"));
        });

        it("should safely truncate oversized inputs to protect token budgets", () => {
            const hugeText = "A".repeat(40000);
            const sanitized = sanitizeInput(hugeText);
            assert.ok(sanitized.length < 35000);
            assert.ok(sanitized.includes("[truncated for token budget]"));
        });
    });

    describe("Analysis Text Parser", () => {
        it("should parse standard structured sections correctly", () => {
            const rawOutput = `
ROOT CAUSE:
Memory leak in Node.js event listener causing heap exhaustion.

EVIDENCE:
Heap usage reached 94% with garbage collection pauses exceeding 800ms.

RECOMMENDATION:
Trigger rolling restart and inspect heap snapshot in DevTools.

CONFIDENCE:
92%
`;

            const parsed = parseAnalysisText(rawOutput);
            assert.equal(parsed.rootCause, "Memory leak in Node.js event listener causing heap exhaustion.");
            assert.equal(parsed.evidence, "Heap usage reached 94% with garbage collection pauses exceeding 800ms.");
            assert.equal(parsed.recommendation, "Trigger rolling restart and inspect heap snapshot in DevTools.");
            assert.equal(parsed.confidence, 92);
        });

        it("should provide safe fallbacks for missing or malformed output", () => {
            const parsed = parseAnalysisText("");
            assert.ok(parsed.rootCause);
            assert.ok(parsed.evidence);
            assert.ok(parsed.recommendation);
            assert.equal(typeof parsed.confidence, "number");
        });
    });

    describe("Remediation Decision Parser & Safety Gates", () => {
        it("should parse valid JSON decision for stateless backend", () => {
            const jsonText = JSON.stringify({
                action: "SCALE_SERVICE",
                target: "cloudops-backend",
                reason: "Horizontal scale to relieve CPU saturation",
                confidence: 0.95
            });

            const decision = parseDecision(jsonText);
            assert.ok(decision);
            assert.equal(decision.action, "SCALE_SERVICE");
            assert.equal(decision.target, "cloudops-backend");
            assert.equal(decision.confidence, 0.95);
        });

        it("should strip markdown fences from AI output", () => {
            const fenced = "```json\n" + JSON.stringify({
                action: "RESTART_SERVICE",
                target: "cloudops-mongodb",
                reason: "Restart failed database process",
                confidence: 0.8
            }) + "\n```";

            const decision = parseDecision(fenced);
            assert.ok(decision);
            assert.equal(decision.action, "RESTART_SERVICE");
            assert.equal(decision.target, "cloudops-mongodb");
        });

        it("should REJECT invalid actions outside the whitelist", () => {
            const badAction = JSON.stringify({
                action: "DROP_DATABASE",
                target: "cloudops-backend",
                reason: "Malicious action",
                confidence: 0.9
            });

            assert.equal(parseDecision(badAction), null);
        });

        it("should REJECT actions on stateful singleton targets (cloudops-mongodb cannot scale)", () => {
            const illegalScale = JSON.stringify({
                action: "SCALE_SERVICE",
                target: "cloudops-mongodb",
                reason: "Scale database replicas",
                confidence: 0.9
            });

            assert.equal(parseDecision(illegalScale), null);
        });

        it("should return null when action is NONE", () => {
            const noneAction = JSON.stringify({
                action: "NONE",
                target: "cloudops-backend",
                reason: "No remediation required",
                confidence: 0.5
            });

            assert.equal(parseDecision(noneAction), null);
        });
    });

    describe("Mock Mode Execution", () => {
        it("should generate analysis in mock mode without throwing", async () => {
            process.env.GEMINI_MOCK = "true";
            const incident = {
                title: "High CPU Saturation Alert",
                server: "cloudops-backend",
                severity: "critical"
            };

            const analysis = await generateAnalysis(incident, []);
            assert.ok(analysis);
            assert.ok(analysis.rootCause);
            assert.ok(analysis.recommendation);
            assert.equal(analysis.isMock, true);
        });

        it("should generate remediation decision in mock mode adhering to safety rules", async () => {
            process.env.GEMINI_MOCK = "true";

            // For stateless backend -> SCALE_SERVICE
            const backendIncident = { server: "cloudops-backend", title: "CPU Spike" };
            const decision1 = await generateRemediationDecision(backendIncident, "High CPU");
            assert.ok(decision1);
            assert.equal(decision1.action, "SCALE_SERVICE");
            assert.equal(decision1.target, "cloudops-backend");

            // For stateful mongodb -> RESTART_SERVICE (never scale)
            const mongoIncident = { server: "cloudops-mongodb", title: "DB Stalled" };
            const decision2 = await generateRemediationDecision(mongoIncident, "DB Down");
            assert.ok(decision2);
            assert.equal(decision2.action, "RESTART_SERVICE");
            assert.equal(decision2.target, "cloudops-mongodb");
        });

        it("should generate embeddings and compute cosine similarity", async () => {
            process.env.GEMINI_MOCK = "true";
            const emb1 = await createEmbedding("CPU breach on backend");
            const emb2 = await createEmbedding("CPU breach on backend");
            const emb3 = await createEmbedding("Completely different topic database network");

            assert.ok(Array.isArray(emb1));
            assert.equal(emb1.length, 16);

            const simSelf = cosineSimilarity(emb1, emb2);
            assert.ok(simSelf > 0.99, `Self similarity expected ~1.0, got ${simSelf}`);

            const simDiff = cosineSimilarity(emb1, emb3);
            assert.ok(simDiff >= 0 && simDiff <= 1.0);
        });
    });
});
