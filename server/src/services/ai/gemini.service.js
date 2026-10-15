const { GoogleGenAI } = require("@google/genai");
const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS
} = require("../../config/remediation.config");

// Configuration
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_EMBED_MODEL = "text-embedding-004";
const MAX_INPUT_CHARS = 30000;
const REQUEST_TIMEOUT_MS = 30000;

// Rate-limiting throttle tracking
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 250; // Max 4 requests/sec per server instance

/**
 * Format model name safely for Google GenAI SDK.
 * Strips accidental repeated "models/" prefixes to prevent paths like "models/models/..."
 */
function formatModelName(model) {
    if (!model || typeof model !== "string") return DEFAULT_MODEL;
    let trimmed = model.trim().replace(/^['"]|['"]$/g, "");
    if (!trimmed) return DEFAULT_MODEL;
    // Strip one or more leading "models/" prefixes
    trimmed = trimmed.replace(/^(models\/)+/i, "");
    return trimmed || DEFAULT_MODEL;
}

/**
 * Format embedding model name safely
 */
function formatEmbedModelName(model) {
    if (!model || typeof model !== "string") return DEFAULT_EMBED_MODEL;
    let trimmed = model.trim().replace(/^['"]|['"]$/g, "");
    if (!trimmed) return DEFAULT_EMBED_MODEL;
    trimmed = trimmed.replace(/^(models\/)+/i, "");
    return trimmed || DEFAULT_EMBED_MODEL;
}

/**
 * Check if a Gemini API key is configured
 */
function isGeminiConfigured() {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim() && key.trim() !== "your_gemini_api_key_here");
}

/**
 * Get active model name
 */
function getModelName() {
    return formatModelName(process.env.GEMINI_MODEL);
}

/**
 * Get embedding model name
 */
function getEmbedModelName() {
    return formatEmbedModelName(process.env.GEMINI_EMBED_MODEL);
}

/**
 * Classify Gemini API errors for safe handling and truthful health reporting
 */
function classifyGeminiError(err) {
    if (!err) {
        return {
            category: "UNKNOWN",
            retryable: false,
            status: 500,
            message: "Unknown Gemini error"
        };
    }

    const status = err.status || err.statusCode || (err.response && err.response.status);
    const rawMsg = String(err.message || err.details || err || "");
    const lower = rawMsg.toLowerCase();

    // 404 / Model Not Found / No longer available
    if (
        status === 404 ||
        lower.includes("not found") ||
        lower.includes("no longer available") ||
        lower.includes("is not supported") ||
        lower.includes("cannot find model")
    ) {
        return {
            category: "MODEL_NOT_FOUND",
            retryable: false,
            status: 404,
            message: `Gemini model unavailable or not found: ${rawMsg.substring(0, 150)}`
        };
    }

    // 401 / 403 / Authentication / Permission
    if (
        status === 401 ||
        status === 403 ||
        lower.includes("api_key_invalid") ||
        lower.includes("permission_denied") ||
        lower.includes("api key not valid") ||
        lower.includes("unauthenticated")
    ) {
        return {
            category: "AUTH_ERROR",
            retryable: false,
            status: status || 401,
            message: "Gemini API key is invalid or lacks necessary permissions."
        };
    }

    // 429 / Quota / Rate limit
    if (
        status === 429 ||
        lower.includes("429") ||
        lower.includes("resource_exhausted") ||
        lower.includes("quota") ||
        lower.includes("rate limit")
    ) {
        return {
            category: "RATE_LIMIT",
            retryable: true,
            status: 429,
            message: "Gemini API rate limit or quota exceeded."
        };
    }

    // Timeout
    if (
        lower.includes("timeout") ||
        lower.includes("timed out") ||
        err.code === "ETIMEDOUT" ||
        err.code === "ECONNABORTED"
    ) {
        return {
            category: "TIMEOUT",
            retryable: true,
            status: 504,
            message: `Gemini API request timed out after ${REQUEST_TIMEOUT_MS}ms.`
        };
    }

    // Upstream server errors
    if (
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        lower.includes("unavailable") ||
        lower.includes("overloaded") ||
        lower.includes("bad gateway")
    ) {
        return {
            category: "UPSTREAM_UNAVAILABLE",
            retryable: true,
            status: status || 503,
            message: "Gemini service temporarily unavailable upstream."
        };
    }

    return {
        category: "CONNECTION_ERROR",
        retryable: false,
        status: status || 500,
        message: rawMsg.substring(0, 150) || "Gemini connection error"
    };
}

/**
 * Sanitize prompt text to prevent prompt injection or leaking credentials
 */
function sanitizeInput(text) {
    if (!text || typeof text !== "string") return "";
    let sanitized = text
        .replace(/copa_[a-zA-Z0-9_-]+/g, "[REDACTED_AGENT_TOKEN]")
        .replace(/cope_[a-zA-Z0-9_-]+/g, "[REDACTED_ENROLLMENT_TOKEN]")
        .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_API_KEY]")
        .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/password\s*[:=]\s*["']?[^"'\s\n]+["']?/gi, "password: [REDACTED]");

    if (sanitized.length > MAX_INPUT_CHARS) {
        sanitized = sanitized.substring(0, MAX_INPUT_CHARS) + "\n...[truncated for token budget]";
    }
    return sanitized;
}

/**
 * Instantiate GoogleGenAI client safely
 */
function getClient() {
    if (!isGeminiConfigured()) {
        return null;
    }
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim() });
}

/**
 * Lightweight health check for Gemini API.
 * Never exposes the API key or claims healthy on failed real API calls.
 */
async function checkGeminiHealth() {
    const configured = isGeminiConfigured();
    const model = getModelName();
    const isMock = process.env.GEMINI_MOCK === "true";

    if (!configured) {
        if (isMock) {
            return {
                configured: true,
                healthy: true,
                isMock: true,
                model: `${model} (Mock Mode)`,
                details: "Running in mock mode for testing/development"
            };
        }
        return {
            configured: false,
            healthy: false,
            model,
            details: "GEMINI_API_KEY is not configured"
        };
    }

    if (isMock) {
        return {
            configured: true,
            healthy: true,
            isMock: true,
            model: `${model} (Mock Mode)`,
            details: "Configured (Mock Mode)"
        };
    }

    try {
        const client = module.exports.getClient ? module.exports.getClient() : getClient();
        const response = await client.models.generateContent({
            model,
            contents: "respond with 'pong' only",
            config: {
                maxOutputTokens: 10,
                temperature: 0.1
            }
        });

        const ok = response && response.text;
        return {
            configured: true,
            healthy: Boolean(ok),
            isMock: false,
            model,
            details: ok ? "Connected" : "Unresponsive"
        };
    } catch (err) {
        const classified = classifyGeminiError(err);
        return {
            configured: true,
            healthy: false,
            isMock: false,
            model,
            errorCategory: classified.category,
            details: classified.message
        };
    }
}

/**
 * Rate limiting helper
 */
async function throttle() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    lastRequestTime = Date.now();
}

/**
 * Execute call with timeout and bounded retry on retryable errors
 */
async function callWithRetry(fn, maxRetries = 1) {
    let attempt = 0;
    while (attempt <= maxRetries) {
        try {
            await throttle();
            return await Promise.race([
                fn(),
                new Promise((_, reject) =>
                    setTimeout(() => {
                        const timeoutErr = new Error(`Gemini request timed out after ${REQUEST_TIMEOUT_MS}ms`);
                        timeoutErr.code = "ETIMEDOUT";
                        reject(timeoutErr);
                    }, REQUEST_TIMEOUT_MS)
                )
            ]);
        } catch (err) {
            attempt++;
            const classified = classifyGeminiError(err);

            if (attempt <= maxRetries && classified.retryable) {
                console.warn(`[GEMINI] Transient error (${classified.category}: ${classified.message}). Retrying in 1.5s...`);
                await new Promise((resolve) => setTimeout(resolve, 1500));
            } else {
                err.category = classified.category;
                err.isRetryable = classified.retryable;
                err.classifiedMessage = classified.message;
                throw err;
            }
        }
    }
}

/**
 * Parse text response into structured AI analysis object
 */
function parseAnalysisText(text) {
    if (!text || typeof text !== "string") {
        return {
            rootCause: "No specific root cause generated.",
            evidence: "Based on telemetry metrics & Alertmanager payload.",
            recommendation: "Review logs and scale/restart affected service.",
            confidence: 85,
            rawText: ""
        };
    }

    const cleanText = text.trim();
    const extractSection = (headingRegex, nextHeadingsRegex) => {
        const match = cleanText.match(
            new RegExp(
                `(?:\\*\\*|#+)?\\s*${headingRegex}\\s*(?:\\*\\*)?:?\\s*([\\s\\S]*?)(?=(?:\\*\\*|#+)?\\s*(?:${nextHeadingsRegex})\\s*(?:\\*\\*)?:?|$)`,
                "i"
            )
        );
        return match && match[1] ? match[1].trim() : "";
    };

    const rootCause = extractSection("ROOT\\s*CAUSE", "EVIDENCE|RECOMMENDATION|CONFIDENCE");
    const evidence = extractSection("EVIDENCE", "RECOMMENDATION|CONFIDENCE");
    const recommendation = extractSection("RECOMMENDATION", "CONFIDENCE");
    const confMatch = cleanText.match(/CONFIDENCE(?:\s*SCORE)?:?\s*(\d+)%/i) || cleanText.match(/(\d+)%/);
    const confidence = confMatch ? parseInt(confMatch[1], 10) : 85;

    return {
        rootCause: rootCause || cleanText,
        evidence: evidence || "Based on telemetry metrics & incident details.",
        recommendation: recommendation || "Review logs and scale or restart affected workload.",
        confidence: Math.min(100, Math.max(10, confidence)),
        rawText: cleanText
    };
}

/**
 * Parse remediation decision JSON safely
 */
function parseDecision(raw) {
    try {
        if (!raw || typeof raw !== "string") {
            return null;
        }

        let text = raw.trim();
        text = text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("❌ No JSON object found in AI remediation response");
            return null;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.action || !parsed.target) {
            console.error("❌ AI response missing required action or target");
            return null;
        }

        if (parsed.action === "NONE" || parsed.action === "none") {
            console.log("ℹ️ AI recommends no remediation action (NONE)");
            return null;
        }

        if (!ALLOWED_ACTIONS.includes(parsed.action)) {
            console.error(`❌ AI returned invalid action: "${parsed.action}". Must be in: ${ALLOWED_ACTIONS.join(", ")}`);
            return null;
        }

        if (!(parsed.target in ALLOWED_TARGETS)) {
            console.error(`❌ AI returned invalid target: "${parsed.target}". Must be in: ${Object.keys(ALLOWED_TARGETS).join(", ")}`);
            return null;
        }

        // Additional target-specific safety: stateful targets cannot be scaled
        const targetConfig = ALLOWED_TARGETS[parsed.target];
        if (targetConfig && targetConfig.allowedActions && !targetConfig.allowedActions.includes(parsed.action)) {
            console.error(`❌ Target "${parsed.target}" does not permit action "${parsed.action}"`);
            return null;
        }

        let confidence = parseFloat(parsed.confidence);
        if (isNaN(confidence) || confidence < 0 || confidence > 1) {
            confidence = 0.5;
        }

        const decision = {
            action: parsed.action,
            target: parsed.target,
            reason: String(parsed.reason || "AI recommended action based on incident symptoms").substring(0, 500),
            confidence
        };

        return decision;
    } catch (err) {
        console.error("❌ Failed to parse AI remediation decision:", err.message);
        return null;
    }
}

/**
 * Generate AI Incident Analysis using Gemini API
 */
async function generateAnalysis(incident, similarIncidents = []) {
    const isMock = process.env.GEMINI_MOCK === "true" || (process.env.NODE_ENV === "test" && !isGeminiConfigured());

    if (isMock) {
        return {
            rootCause: `High CPU saturation on ${incident.server || "cloudops-server"} detected by automated monitoring.`,
            evidence: `Observed metric spike exceeding operational threshold in ${incident.title || "incident"}.`,
            recommendation: "Scale deployment replicas or restart unhealthy pods to restore capacity.",
            confidence: 88,
            rawText: "Mock Gemini analysis output for automated testing.",
            isMock: true
        };
    }

    if (!isGeminiConfigured()) {
        throw new Error("GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your environment.");
    }

    const context = Array.isArray(similarIncidents) && similarIncidents.length > 0
        ? similarIncidents.slice(0, 3).map((item, index) => {
            const rc = typeof item.aiAnalysis === "object" ? item.aiAnalysis?.rootCause : item.aiAnalysis;
            const rec = typeof item.aiAnalysis === "object" ? item.aiAnalysis?.recommendation : "N/A";
            return `
Historical Incident ${index + 1}:
Title: ${sanitizeInput(item.title)}
Description: ${sanitizeInput(item.description || "N/A")}
Severity: ${item.severity}
Root Cause: ${sanitizeInput(rc || "N/A")}
Recommendation: ${sanitizeInput(rec || "N/A")}
`;
        }).join("\n")
        : "No prior similar historical incidents recorded.";

    const prompt = `
You are CloudOps AI, an expert Site Reliability Engineer (SRE) assistant.
Analyze the following infrastructure incident and provide a concise, technical root cause analysis.

CURRENT INCIDENT:
Title: ${sanitizeInput(incident.title)}
Description: ${sanitizeInput(incident.description || "N/A")}
Severity: ${incident.severity || "warning"}
Category: ${incident.category || "infrastructure"}
Source: ${incident.source || "monitoring"}
Target: ${sanitizeInput(incident.server || "cloudops-server")}

HISTORICAL CONTEXT:
${context}

You MUST structure your response with exactly these four headers:

ROOT CAUSE:
[Explain the primary technical trigger and failure mechanism in 2-3 sentences]

EVIDENCE:
[List concrete telemetry indicators, error signatures, or symptoms confirming this hypothesis]

RECOMMENDATION:
[Provide actionable remediation steps, such as horizontal scaling or rolling restart]

CONFIDENCE:
[State confidence percentage between 50% and 99%, e.g., 85%]
`;

    const client = module.exports.getClient ? module.exports.getClient() : getClient();
    const model = getModelName();

    const result = await callWithRetry(async () => {
        return await client.models.generateContent({
            model,
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 600
            }
        });
    });

    const responseText = result && result.text ? result.text : "";
    return parseAnalysisText(responseText);
}

/**
 * Generate Remediation Decision using Gemini API
 */
async function generateRemediationDecision(incident, analysis) {
    const isMock = process.env.GEMINI_MOCK === "true" || (process.env.NODE_ENV === "test" && !isGeminiConfigured());

    if (isMock) {
        // Return a valid allowed decision for testing
        const target = incident.server && (incident.server in ALLOWED_TARGETS) ? incident.server : "cloudops-backend";
        const action = target === "cloudops-mongodb" ? "RESTART_SERVICE" : "SCALE_SERVICE";
        return {
            action,
            target,
            reason: `Automated remediation recommended for ${target} based on incident evaluation.`,
            confidence: 0.9,
            isMock: true
        };
    }

    if (!isGeminiConfigured()) {
        console.warn("[GEMINI] GEMINI_API_KEY not configured. Skipping automated AI remediation recommendation.");
        return null;
    }

    const analysisText = typeof analysis === "object"
        ? `${analysis.rootCause || ""} ${analysis.recommendation || ""}`
        : String(analysis || "");

    const allowedActionsList = ALLOWED_ACTIONS.join(", ");
    const allowedTargetsList = Object.keys(ALLOWED_TARGETS).join(", ");

    const prompt = `
You are CloudOps AI, an autonomous SRE remediation engine.
Recommend a single corrective action for this incident.

INCIDENT:
Title: ${sanitizeInput(incident.title)}
Description: ${sanitizeInput(incident.description || "N/A")}
Target: ${sanitizeInput(incident.server || "N/A")}
Severity: ${incident.severity || "warning"}

ANALYSIS:
${sanitizeInput(analysisText)}

ALLOWED ACTIONS (Choose one or "NONE"):
${allowedActionsList}

ALLOWED TARGETS (Choose one):
${allowedTargetsList}

SAFETY RULES:
1. cloudops-mongodb is a stateful singleton. It CANNOT be scaled (only RESTART_SERVICE is permitted).
2. cloudops-backend is a stateless deployment. It supports SCALE_SERVICE and RESTART_SERVICE.
3. If no action is safe, choose action "NONE".

Return ONLY a raw JSON object with no markdown fences, matching:
{
  "action": "SCALE_SERVICE",
  "target": "cloudops-backend",
  "reason": "Brief technical explanation",
  "confidence": 0.85
}
`;

    const client = module.exports.getClient ? module.exports.getClient() : getClient();
    const model = getModelName();

    try {
        const result = await callWithRetry(async () => {
            return await client.models.generateContent({
                model,
                contents: prompt,
                config: {
                    temperature: 0.1,
                    maxOutputTokens: 200
                }
            });
        });

        const raw = result && result.text ? result.text : "";
        return parseDecision(raw);
    } catch (err) {
        const classified = classifyGeminiError(err);
        console.error(`❌ Gemini remediation decision failed [${classified.category}]:`, classified.message);
        return null;
    }
}

/**
 * Create vector embedding using Gemini API
 */
async function createEmbedding(text) {
    if (!text || typeof text !== "string") return null;

    const isMock = process.env.GEMINI_MOCK === "true" || (process.env.NODE_ENV === "test" && !isGeminiConfigured());
    if (isMock) {
        // Deterministic pseudo-embedding for testing
        const dim = 16;
        const vec = new Array(dim).fill(0);
        for (let i = 0; i < text.length; i++) {
            vec[i % dim] += text.charCodeAt(i) / 1000;
        }
        return vec;
    }

    if (!isGeminiConfigured()) {
        return null;
    }

    try {
        const client = module.exports.getClient ? module.exports.getClient() : getClient();
        const embedModel = getEmbedModelName();
        const sanitized = sanitizeInput(text).substring(0, 2048);

        const result = await callWithRetry(async () => {
            return await client.models.embedContent({
                model: embedModel,
                contents: sanitized
            });
        });

        if (result && result.embedding && Array.isArray(result.embedding.values)) {
            return result.embedding.values;
        }
        return null;
    } catch (err) {
        console.warn(`[GEMINI] createEmbedding notice: ${err.message}`);
        return null;
    }
}

/**
 * Calculate Cosine Similarity safely
 */
function cosineSimilarity(a, b) {
    if (!a || !b || !Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        const valA = Number(a[i]) || 0;
        const valB = Number(b[i]) || 0;
        dot += valA * valB;
        normA += valA * valA;
        normB += valB * valB;
    }

    if (normA === 0 || normB === 0) return 0;
    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return isNaN(similarity) || !isFinite(similarity) ? 0 : similarity;
}

module.exports = {
    DEFAULT_MODEL,
    DEFAULT_EMBED_MODEL,
    formatModelName,
    formatEmbedModelName,
    classifyGeminiError,
    getClient,
    isGeminiConfigured,
    checkGeminiHealth,
    generateAnalysis,
    generateRemediationDecision,
    createEmbedding,
    cosineSimilarity,
    parseAnalysisText,
    parseDecision,
    sanitizeInput,
    getModelName,
    getEmbedModelName
};
