const axios = require("axios");
const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS
} = require("../../config/remediation.config");
const {
    sanitizeInput,
    parseAnalysisText,
    parseDecision,
    cosineSimilarity
} = require("./gemini.service");

// Configuration defaults
const DEFAULT_MODEL = "openrouter/free";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const REQUEST_TIMEOUT_MS = 30000;

// Rate-limiting throttle & backoff state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 500; // Max 2 requests/sec to respect free tier
let rateLimitUntil = 0; // Timestamp (ms) until which 429 backoff is active

// In-memory cache for repeated incident analysis (TTL 5 minutes)
const analysisCache = new Map();
const inFlightAnalyses = new Map();
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Check if OpenRouter API key is configured
 */
function isOpenRouterConfigured() {
    const key = process.env.OPENROUTER_API_KEY;
    return Boolean(key && key.trim() && key.trim() !== "your_api_key" && key.trim() !== "your_openrouter_api_key_here");
}

/**
 * Get active OpenRouter model ID
 */
function getModelName() {
    const model = process.env.OPENROUTER_MODEL;
    if (!model || typeof model !== "string" || !model.trim()) {
        return DEFAULT_MODEL;
    }
    return model.trim().replace(/^['"]|['"]$/g, "");
}

/**
 * Check if currently in a 429 rate limit backoff window
 */
function isRateLimited() {
    return Date.now() < rateLimitUntil;
}

/**
 * Get remaining rate limit wait duration in seconds
 */
function getRateLimitWaitSeconds() {
    if (!isRateLimited()) return 0;
    return Math.max(1, Math.ceil((rateLimitUntil - Date.now()) / 1000));
}

/**
 * Set rate limit backoff expiry
 */
function setRateLimitBackoff(seconds = 30) {
    const sec = Math.max(5, Math.min(300, Number(seconds) || 30));
    rateLimitUntil = Date.now() + sec * 1000;
    console.warn(`[OPENROUTER] Rate limit active. Backing off for ${sec}s.`);
}

/**
 * Clear rate limit backoff (used in testing)
 */
function clearRateLimit() {
    rateLimitUntil = 0;
}

/**
 * Clear analysis cache (used in testing)
 */
function clearCache() {
    analysisCache.clear();
    inFlightAnalyses.clear();
}

/**
 * Classify OpenRouter API errors for safe handling and truthful health reporting
 */
function classifyOpenRouterError(err) {
    if (!err) {
        return {
            category: "UNKNOWN",
            retryable: false,
            status: 500,
            message: "Unknown OpenRouter error"
        };
    }

    const status = err.status || err.statusCode || (err.response && err.response.status);
    const data = err.response && err.response.data;
    const rawMsg = (data && data.error && data.error.message) || err.message || String(err);
    const lower = String(rawMsg).toLowerCase();

    // 429 Rate Limit / Free tier quota exhaustion
    if (status === 429 || lower.includes("rate limit") || lower.includes("quota exceeded") || lower.includes("too many requests")) {
        // Parse retry-after header if present
        let retrySeconds = 30;
        const retryHeader = err.response && err.response.headers && (err.response.headers["retry-after"] || err.response.headers["x-ratelimit-reset"]);
        if (retryHeader) {
            const parsed = parseFloat(retryHeader);
            if (!isNaN(parsed) && parsed > 0) {
                // If it's a future epoch timestamp (seconds > 1e9)
                retrySeconds = parsed > 1000000000 ? Math.max(1, Math.ceil(parsed - (Date.now() / 1000))) : Math.ceil(parsed);
            }
        }
        setRateLimitBackoff(retrySeconds);

        return {
            category: "RATE_LIMIT",
            retryable: true,
            status: 429,
            retrySeconds,
            retryAfterSeconds: retrySeconds,
            message: `OpenRouter rate limit or free-tier quota exceeded. Retry after ${retrySeconds}s.`
        };
    }

    // 401 / 403 Authentication / Permission
    if (status === 401 || status === 403 || lower.includes("unauthorized") || lower.includes("api key") || lower.includes("forbidden")) {
        return {
            category: "AUTH_ERROR",
            retryable: false,
            status: status || 401,
            message: "OpenRouter API key is invalid or lacks necessary permissions."
        };
    }

    // 402 Insufficient credits
    if (status === 402 || lower.includes("credits") || lower.includes("payment")) {
        return {
            category: "QUOTA_EXCEEDED",
            retryable: false,
            status: 402,
            message: "OpenRouter credits exhausted. Please review your OpenRouter plan."
        };
    }

    // 404 Model Not Found
    if (status === 404 || lower.includes("model not found") || lower.includes("not available")) {
        return {
            category: "MODEL_NOT_FOUND",
            retryable: false,
            status: 404,
            message: `OpenRouter model "${getModelName()}" is not available: ${rawMsg.substring(0, 150)}`
        };
    }

    // Timeout
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT" || lower.includes("timeout") || lower.includes("timed out")) {
        return {
            category: "TIMEOUT",
            retryable: true,
            status: 504,
            message: `OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms.`
        };
    }

    // 5xx Upstream provider outage
    if (status === 500 || status === 502 || status === 503 || status === 504 || lower.includes("upstream") || lower.includes("unavailable")) {
        return {
            category: "UPSTREAM_UNAVAILABLE",
            retryable: true,
            status: status || 503,
            message: "OpenRouter provider outage or service temporarily unavailable."
        };
    }

    return {
        category: "CONNECTION_ERROR",
        retryable: true,
        status: status || 500,
        message: rawMsg.substring(0, 150) || "OpenRouter connection error"
    };
}

/**
 * Throttle helper to respect rate limits
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
 * Lightweight health check for OpenRouter API.
 * Never exposes the API key. Truthfully reports: Connected | Rate Limited | Unavailable | Not Configured
 */
async function checkOpenRouterHealth() {
    const model = getModelName();
    const isMock = process.env.OPENROUTER_MOCK === "true" || process.env.AI_MOCK === "true" || process.env.GEMINI_MOCK === "true";

    if (isMock) {
        return {
            name: "AI Model",
            configured: true,
            healthy: true,
            status: "Connected",
            isMock: true,
            provider: "OpenRouter",
            providerLabel: "OpenRouter",
            model: `${model} (Mock Mode)`,
            details: "Running in mock mode for testing/development"
        };
    }

    if (isRateLimited()) {
        const remaining = getRateLimitWaitSeconds();
        return {
            name: "AI Model",
            configured: true,
            healthy: false,
            status: "Rate Limited",
            provider: "OpenRouter",
            providerLabel: "OpenRouter",
            model,
            details: `Rate limit active — retry in ${remaining}s`
        };
    }

    const configured = isOpenRouterConfigured();
    if (!configured) {
        return {
            name: "AI Model",
            configured: false,
            healthy: false,
            status: "Not Configured",
            provider: "OpenRouter",
            providerLabel: "OpenRouter",
            model,
            details: "OPENROUTER_API_KEY is not configured"
        };
    }

    try {
        const apiKey = process.env.OPENROUTER_API_KEY.trim();
        // Check API key validity using OpenRouter's lightweight key endpoint
        const response = await axios.get(OPENROUTER_KEY_URL, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://cloudops-ai.onrender.com",
                "X-Title": "CloudOps AI"
            },
            timeout: 5000
        });

        const ok = response.status >= 200 && response.status < 300;
        return {
            name: "AI Model",
            configured: true,
            healthy: ok,
            status: ok ? "Connected" : "Unavailable",
            isMock: false,
            provider: "OpenRouter",
            providerLabel: "OpenRouter",
            model,
            details: ok ? `Connected (${model})` : "Unresponsive"
        };
    } catch (err) {
        const classified = classifyOpenRouterError(err);
        let status = "Unavailable";
        if (classified.category === "RATE_LIMIT") {
            status = "Rate Limited";
        }

        return {
            name: "AI Model",
            configured: true,
            healthy: false,
            status,
            isMock: false,
            provider: "OpenRouter",
            providerLabel: "OpenRouter",
            model,
            errorCategory: classified.category,
            details: classified.message
        };
    }
}

/**
 * Execute OpenRouter chat completion call with rate limit gating and timeout
 */
async function callChatCompletion(messages, options = {}) {
    if (isRateLimited()) {
        const waitSec = getRateLimitWaitSeconds();
        const err = new Error(`OpenRouter rate limit in effect. Please retry after ${waitSec}s.`);
        err.status = 429;
        err.category = "RATE_LIMIT";
        throw err;
    }

    await throttle();

    const apiKey = process.env.OPENROUTER_API_KEY.trim();
    const model = getModelName();

    const payload = {
        model,
        messages,
        temperature: options.temperature !== undefined ? options.temperature : 0.2,
        max_tokens: options.max_tokens || 800
    };

    try {
        const response = await axios.post(
            OPENROUTER_CHAT_URL,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://cloudops-ai.onrender.com",
                    "X-Title": "CloudOps AI"
                },
                timeout: REQUEST_TIMEOUT_MS
            }
        );

        const choice = response.data && response.data.choices && response.data.choices[0];
        const text = choice && choice.message ? choice.message.content : "";
        return text;
    } catch (err) {
        const classified = classifyOpenRouterError(err);
        const finalErr = new Error(`OpenRouter request failed [${classified.category}]: ${classified.message}`);
        finalErr.status = classified.status;
        finalErr.category = classified.category;
        finalErr.details = classified.message;
        throw finalErr;
    }
}

/**
 * Generate cache key for deduplicating incident analysis
 */
function getAnalysisCacheKey(incident) {
    const id = incident._id || incident.id || incident.title || "temp";
    const status = incident.status || "active";
    const severity = incident.severity || "warning";
    const updated = incident.updatedAt ? new Date(incident.updatedAt).getTime() : "";
    return `${id}_${status}_${severity}_${updated}`;
}

/**
 * Generate AI Incident Analysis using OpenRouter API
 */
async function generateAnalysis(incident, similarIncidents = []) {
    const isMock = process.env.OPENROUTER_MOCK === "true" || process.env.AI_MOCK === "true";

    if (isMock) {
        return {
            rootCause: `High CPU saturation on ${incident.server || "cloudops-server"} detected by automated monitoring.`,
            evidence: `Observed metric spike exceeding operational threshold in ${incident.title || "incident"}.`,
            recommendation: "Scale deployment replicas or restart unhealthy pods to restore capacity.",
            confidence: 88,
            rawText: "Mock OpenRouter analysis output for automated testing.",
            isMock: true
        };
    }

    if (isRateLimited()) {
        const waitSec = getRateLimitWaitSeconds();
        const err = new Error(`Rate limit active: OpenRouter free-tier quota exhausted. Retry after ${waitSec}s.`);
        err.status = 429;
        err.category = "RATE_LIMIT";
        err.retryAfterSeconds = waitSec;
        throw err;
    }

    if (!isOpenRouterConfigured()) {
        throw new Error("OPENROUTER_API_KEY is not configured on the server. Please set OPENROUTER_API_KEY in your environment.");
    }

    const cacheKey = getAnalysisCacheKey(incident);

    // 1. Check in-memory cache for repeated analysis of identical incident
    const cached = analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL_MS) {
        return cached.data;
    }

    // 2. In-flight deduplication: return ongoing promise if identical request is pending
    if (inFlightAnalyses.has(cacheKey)) {
        return await inFlightAnalyses.get(cacheKey);
    }

    const analysisPromise = (async () => {
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

        const messages = [
            {
                role: "system",
                content: "You are CloudOps AI, an autonomous SRE expert. Return concise, technically rigorous root cause diagnoses adhering strictly to the requested four sections."
            },
            {
                role: "user",
                content: prompt
            }
        ];

        const text = await callChatCompletion(messages, { temperature: 0.2, max_tokens: 700 });
        const parsed = parseAnalysisText(text);

        analysisCache.set(cacheKey, {
            data: parsed,
            timestamp: Date.now()
        });

        return parsed;
    })();

    inFlightAnalyses.set(cacheKey, analysisPromise);

    try {
        return await analysisPromise;
    } finally {
        inFlightAnalyses.delete(cacheKey);
    }
}

/**
 * Generate Remediation Decision using OpenRouter API
 */
async function generateRemediationDecision(incident, analysis) {
    const isMock = process.env.OPENROUTER_MOCK === "true" || process.env.AI_MOCK === "true";

    if (isMock) {
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

    if (!isOpenRouterConfigured()) {
        throw new Error("OPENROUTER_API_KEY is not configured on the server. Please set OPENROUTER_API_KEY in your environment.");
    }

    if (isRateLimited()) {
        console.warn("[OPENROUTER] Rate limit active. Skipping automated remediation decision.");
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

    const messages = [
        {
            role: "system",
            content: "You are CloudOps AI autonomous remediation safety gate. Respond ONLY with raw valid JSON."
        },
        {
            role: "user",
            content: prompt
        }
    ];

    try {
        const rawText = await callChatCompletion(messages, { temperature: 0.1, max_tokens: 250 });
        return parseDecision(rawText);
    } catch (err) {
        console.error(`❌ OpenRouter remediation decision failed [${err.category || "ERROR"}]:`, err.message);
        return null;
    }
}

/**
 * Create vector embedding using OpenRouter or pseudo-embedding
 */
async function createEmbedding(text) {
    if (!text || typeof text !== "string") return null;

    const isMock = process.env.OPENROUTER_MOCK === "true" ||
        process.env.GEMINI_MOCK === "true" ||
        (process.env.NODE_ENV === "test" && !isOpenRouterConfigured());

    if (isMock) {
        const dim = 16;
        const vec = new Array(dim).fill(0);
        for (let i = 0; i < text.length; i++) {
            vec[i % dim] += text.charCodeAt(i) / 1000;
        }
        return vec;
    }

    if (!isOpenRouterConfigured()) {
        return null;
    }

    try {
        const apiKey = process.env.OPENROUTER_API_KEY.trim();
        const embedModel = process.env.OPENROUTER_EMBED_MODEL || "openai/text-embedding-3-small";
        const sanitized = sanitizeInput(text).substring(0, 2048);

        const response = await axios.post(
            OPENROUTER_EMBED_URL,
            {
                model: embedModel,
                input: sanitized
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://cloudops-ai.onrender.com",
                    "X-Title": "CloudOps AI"
                },
                timeout: 10000
            }
        );

        if (response.data && response.data.data && Array.isArray(response.data.data) && response.data.data[0]) {
            return response.data.data[0].embedding;
        }
        return null;
    } catch (err) {
        console.warn(`[OPENROUTER] createEmbedding notice: ${err.message}`);
        return null;
    }
}

module.exports = {
    DEFAULT_MODEL,
    DEFAULT_OPENROUTER_MODEL: DEFAULT_MODEL,
    OPENROUTER_CHAT_URL,
    OPENROUTER_KEY_URL,
    isOpenRouterConfigured,
    getModelName,
    classifyOpenRouterError,
    isRateLimited,
    getRateLimitWaitSeconds,
    setRateLimitBackoff,
    clearRateLimit,
    clearRateLimitBackoff: clearRateLimit,
    clearCache,
    checkOpenRouterHealth,
    generateAnalysis,
    generateRemediationDecision,
    createEmbedding,
    cosineSimilarity,
    parseAnalysisText,
    parseDecision,
    sanitizeInput,
    callChatCompletion
};
