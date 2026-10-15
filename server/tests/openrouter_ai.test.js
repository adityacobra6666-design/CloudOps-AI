const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const openrouterService = require("../src/services/ai/openrouter.service");
const aiProvider = require("../src/services/ai");
const geminiService = require("../src/services/ai/gemini.service");

const {
    DEFAULT_OPENROUTER_MODEL,
    getModelName,
    isOpenRouterConfigured,
    classifyOpenRouterError,
    sanitizeInput,
    parseAnalysisText,
    parseDecision,
    setRateLimitBackoff,
    clearRateLimitBackoff,
    isRateLimited,
    getRateLimitWaitSeconds,
    clearCache,
    generateAnalysis,
    generateRemediationDecision,
    checkOpenRouterHealth
} = openrouterService;

describe("OpenRouter AI Provider & Unified AI Engine", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.AI_PROVIDER;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.OPENROUTER_MODEL;
        delete process.env.AI_MOCK;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_MOCK;
        clearRateLimitBackoff();
        clearCache();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        clearRateLimitBackoff();
        clearCache();
    });

    describe("1. Provider Selection via AI_PROVIDER", () => {
        it("should select openrouter when AI_PROVIDER is explicitly 'openrouter'", () => {
            process.env.AI_PROVIDER = "openrouter";
            assert.equal(aiProvider.getActiveProvider(), "openrouter");
            assert.equal(aiProvider.getProviderDisplayLabel(), "OpenRouter");
        });

        it("should select gemini when AI_PROVIDER is explicitly 'gemini'", () => {
            process.env.AI_PROVIDER = "gemini";
            assert.equal(aiProvider.getActiveProvider(), "gemini");
            assert.equal(aiProvider.getProviderDisplayLabel(), "Gemini");
        });

        it("should default to openrouter when AI_PROVIDER is unset", () => {
            delete process.env.AI_PROVIDER;
            assert.equal(aiProvider.getActiveProvider(), "openrouter");
        });

        it("should auto-detect gemini if GEMINI_API_KEY is present and OPENROUTER_API_KEY is not", () => {
            delete process.env.AI_PROVIDER;
            process.env.GEMINI_API_KEY = "AIzaSyTestKey";
            assert.equal(aiProvider.getActiveProvider(), "gemini");
            assert.equal(aiProvider.getProviderDisplayLabel(), "Gemini");
        });

        it("should prioritize OpenRouter if both keys are present and AI_PROVIDER is openrouter", () => {
            process.env.AI_PROVIDER = "openrouter";
            process.env.OPENROUTER_API_KEY = "sk-or-v1-testkey";
            process.env.GEMINI_API_KEY = "AIzaSyTestKey";
            assert.equal(aiProvider.getActiveProvider(), "openrouter");
        });
    });

    describe("2. OpenRouter Model Configuration", () => {
        it("should use openrouter/free as the default model", () => {
            assert.equal(DEFAULT_OPENROUTER_MODEL, "openrouter/free");
            assert.equal(getModelName(), "openrouter/free");
        });

        it("should allow overriding model with OPENROUTER_MODEL env var", () => {
            process.env.OPENROUTER_MODEL = "anthropic/claude-3-haiku";
            assert.equal(getModelName(), "anthropic/claude-3-haiku");
        });

        it("should trim whitespace and quotes from model name", () => {
            process.env.OPENROUTER_MODEL = "  'meta-llama/llama-3.1-8b-instruct:free'  ";
            assert.equal(getModelName(), "meta-llama/llama-3.1-8b-instruct:free");
        });
    });

    describe("3. Missing API Key & Invalid Configuration Handling", () => {
        it("should report unconfigured when OPENROUTER_API_KEY is missing", async () => {
            assert.equal(isOpenRouterConfigured(), false);
            const health = await checkOpenRouterHealth();
            assert.equal(health.configured, false);
            assert.equal(health.healthy, false);
            assert.equal(health.status, "Not Configured");
            assert.equal(health.provider, "OpenRouter");
            assert.equal(health.name, "AI Model");
            assert.ok(health.details.includes("not configured"));
        });

        it("should reject generateAnalysis when OPENROUTER_API_KEY is not configured", async () => {
            await assert.rejects(
                async () => {
                    await generateAnalysis({ title: "High CPU Spike", service: "backend" });
                },
                /OPENROUTER_API_KEY is not configured/
            );
        });

        it("should reject generateRemediationDecision when not configured", async () => {
            await assert.rejects(
                async () => {
                    await generateRemediationDecision({ title: "Memory Leak", service: "backend" });
                },
                /OPENROUTER_API_KEY is not configured/
            );
        });

        it("should never expose OPENROUTER_API_KEY in health check or logs", async () => {
            process.env.OPENROUTER_API_KEY = "sk-or-v1-super-secret-key-123456789";
            process.env.AI_MOCK = "true";
            const health = await checkOpenRouterHealth();
            const stringified = JSON.stringify(health);
            assert.ok(!stringified.includes("sk-or-v1-super-secret-key-123456789"));
            assert.equal(health.apiKey, undefined);
        });
    });

    describe("4. Accurate Health Status Reporting", () => {
        it("should return status 'Not Configured' when no key is set", async () => {
            const health = await openrouterService.checkOpenRouterHealth();
            assert.equal(health.status, "Not Configured");
            assert.equal(health.healthy, false);
        });

        it("should return status 'Connected' when running in mock mode", async () => {
            process.env.AI_MOCK = "true";
            const health = await openrouterService.checkOpenRouterHealth();
            assert.equal(health.status, "Connected");
            assert.equal(health.healthy, true);
            assert.equal(health.isMock, true);
        });

        it("should return status 'Rate Limited' when rate limit backoff is active", async () => {
            setRateLimitBackoff(60, "Free tier quota exhausted (429)");
            const health = await openrouterService.checkOpenRouterHealth();
            assert.equal(health.status, "Rate Limited");
            assert.equal(health.healthy, false);
            assert.ok(health.details.includes("Rate limit active"));
        });
    });

    describe("5. HTTP 429 Handling & Retry-After Parsing (No Retry Loops)", () => {
        it("should classify 429 rate limit error with retry-after header correctly", () => {
            const err = new Error("Rate limit exceeded");
            err.response = {
                status: 429,
                headers: { "retry-after": "45" },
                data: { error: { message: "Rate limit exceeded. Please wait." } }
            };
            const classified = classifyOpenRouterError(err);
            assert.equal(classified.category, "RATE_LIMIT");
            assert.equal(classified.retryable, true);
            assert.equal(classified.retryAfterSeconds, 45);
        });

        it("should parse float or string seconds in retry-after", () => {
            const err = new Error("Too Many Requests");
            err.response = {
                status: 429,
                headers: { "retry-after": "12.5" },
                data: { error: { message: "Quota reached" } }
            };
            const classified = classifyOpenRouterError(err);
            assert.equal(classified.retryAfterSeconds, 13);
        });

        it("should parse x-ratelimit-reset epoch timestamp", () => {
            const nowSec = Math.floor(Date.now() / 1000);
            const err = new Error("Too Many Requests");
            err.response = {
                status: 429,
                headers: { "x-ratelimit-reset": String(nowSec + 30) },
                data: {}
            };
            const classified = classifyOpenRouterError(err);
            assert.ok(classified.retryAfterSeconds >= 25 && classified.retryAfterSeconds <= 35);
        });

        it("should activate backoff and prevent repetitive requests while rate-limited", async () => {
            process.env.OPENROUTER_API_KEY = "sk-or-v1-fakekey";
            setRateLimitBackoff(30, "Testing 429 backoff");
            assert.equal(isRateLimited(), true);
            assert.ok(getRateLimitWaitSeconds() > 0);

            // Attempting analysis must immediately fail with 429 info without making an HTTP request
            await assert.rejects(
                async () => {
                    await generateAnalysis({ title: "Spike", service: "backend" });
                },
                (err) => {
                    assert.equal(err.status, 429);
                    assert.ok(err.message.includes("Rate limit active"));
                    return true;
                }
            );
        });
    });

    describe("6. Provider Outages & Malformed Responses", () => {
        it("should classify 401/403 as non-retryable AUTH_ERROR", () => {
            const err = new Error("Unauthorized");
            err.response = { status: 401, data: { error: { message: "Invalid API key" } } };
            const classified = classifyOpenRouterError(err);
            assert.equal(classified.category, "AUTH_ERROR");
            assert.equal(classified.retryable, false);
        });

        it("should classify 500, 502, 503, 504 as UPSTREAM_UNAVAILABLE", () => {
            for (const status of [500, 502, 503, 504]) {
                const err = new Error("Bad Gateway");
                err.response = { status, data: "Cloudflare 502" };
                const classified = classifyOpenRouterError(err);
                assert.equal(classified.category, "UPSTREAM_UNAVAILABLE");
                assert.equal(classified.retryable, true);
            }
        });

        it("should classify network timeouts as TIMEOUT", () => {
            const err = new Error("timeout of 30000ms exceeded");
            err.code = "ECONNABORTED";
            const classified = classifyOpenRouterError(err);
            assert.equal(classified.category, "TIMEOUT");
            assert.equal(classified.retryable, true);
        });

        it("should safely parse malformed text and return fallback structure", () => {
            const parsed = parseAnalysisText("Some random unstructured text from AI");
            assert.ok(parsed.rootCause);
            assert.ok(parsed.evidence);
            assert.ok(parsed.recommendation);
            assert.equal(typeof parsed.confidence, "number");
        });

        it("should safely parse JSON with markdown code fences", () => {
            const text = '```json\n{"action":"RESTART_SERVICE","target":"cloudops-backend","reason":"OOM recovered","confidence":0.85}\n```';
            const parsed = parseDecision(text);
            assert.equal(parsed.action, "RESTART_SERVICE");
            assert.equal(parsed.target, "cloudops-backend");
            assert.equal(parsed.confidence, 0.85);
        });
    });

    describe("7. In-Memory Caching & Request Deduplication", () => {
        it("should cache successful analysis results and reuse them for identical incident hash", async () => {
            process.env.AI_MOCK = "true";
            const incident = {
                id: "inc-cache-1",
                title: "Pod CrashLoopBackOff",
                service: "cloudops-backend",
                severity: "CRITICAL",
                logs: "Error: out of memory",
                metrics: { cpu: 85, memory: 92 }
            };

            const firstResult = await generateAnalysis(incident);
            assert.ok(firstResult.rootCause);

            // Second call with same incident should hit cache
            const secondResult = await generateAnalysis(incident);
            assert.equal(secondResult.rootCause, firstResult.rootCause);
            assert.equal(secondResult.recommendation, firstResult.recommendation);
        });
    });

    describe("8. Remediation Safety Gates", () => {
        it("should REJECT actions on stateful singletons (e.g. cloudops-mongodb cannot scale)", () => {
            const jsonText = JSON.stringify({
                action: "SCALE_SERVICE",
                target: "cloudops-mongodb",
                parameters: { replicas: 3 },
                reason: "High read load"
            });
            const decision = parseDecision(jsonText);
            assert.equal(decision, null, "SCALE_SERVICE on mongodb singleton must be rejected by safety gate");
        });

        it("should REJECT unwhitelisted actions", () => {
            const jsonText = JSON.stringify({
                action: "DELETE_POD_FORCE",
                target: "cloudops-backend",
                reason: "Pod hung"
            });
            const decision = parseDecision(jsonText);
            assert.equal(decision, null, "Unwhitelisted actions must be rejected");
        });

        it("should ALLOW safe actions on stateless services", () => {
            const jsonText = JSON.stringify({
                action: "SCALE_SERVICE",
                target: "cloudops-backend",
                parameters: { replicas: 3 },
                reason: "High CPU demand",
                confidence: 0.9
            });
            const decision = parseDecision(jsonText);
            assert.ok(decision);
            assert.equal(decision.action, "SCALE_SERVICE");
            assert.equal(decision.target, "cloudops-backend");
        });
    });

    describe("9. Gemini Compatibility Retained", () => {
        it("should allow switching to Gemini when AI_PROVIDER is set to gemini", async () => {
            process.env.AI_PROVIDER = "gemini";
            process.env.GEMINI_MOCK = "true";
            assert.equal(aiProvider.getActiveProvider(), "gemini");

            const health = await aiProvider.checkAIHealth();
            assert.equal(health.provider, "Gemini");
            assert.equal(health.healthy, true);

            const result = await aiProvider.generateAnalysis({
                title: "Test Gemini Fallback",
                service: "cloudops-backend"
            });
            assert.ok(result.rootCause);
        });
    });
});
