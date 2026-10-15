const openrouterService = require("./openrouter.service");
const geminiService = require("./gemini.service");

/**
 * Determine the active AI provider based on AI_PROVIDER environment variable
 * Defaults to "openrouter" unless explicitly configured as "gemini" or only Gemini is configured.
 */
function getActiveProvider() {
    const specified = (process.env.AI_PROVIDER || "").toLowerCase().trim();
    if (specified === "gemini") {
        return "gemini";
    }
    if (specified === "openrouter") {
        return "openrouter";
    }

    // Auto-selection if AI_PROVIDER is omitted:
    if (openrouterService.isOpenRouterConfigured()) {
        return "openrouter";
    }
    if (geminiService.isGeminiConfigured()) {
        return "gemini";
    }

    return "openrouter"; // Default per user requirements
}

/**
 * Human-readable provider label
 */
function getProviderDisplayLabel() {
    const provider = getActiveProvider();
    return provider === "gemini" ? "Gemini" : "OpenRouter";
}

/**
 * Active provider module reference
 */
function getProviderModule() {
    return getActiveProvider() === "gemini" ? geminiService : openrouterService;
}

/**
 * Check if the active AI provider has an API key configured
 */
function isAIConfigured() {
    const provider = getActiveProvider();
    return provider === "gemini"
        ? geminiService.isGeminiConfigured()
        : openrouterService.isOpenRouterConfigured();
}

/**
 * Unified health check across active AI provider.
 * Returns provider-neutral "AI Model" status with dynamic provider, model, and truthful health status.
 */
async function checkAIHealth() {
    const provider = getActiveProvider();
    if (provider === "gemini") {
        return await geminiService.checkGeminiHealth();
    }
    return await openrouterService.checkOpenRouterHealth();
}

/**
 * Generate AI Incident Analysis using active provider
 */
async function generateAnalysis(incident, similarIncidents = []) {
    const providerModule = getProviderModule();
    return await providerModule.generateAnalysis(incident, similarIncidents);
}

/**
 * Generate Remediation Decision using active provider
 */
async function generateRemediationDecision(incident, analysis) {
    const providerModule = getProviderModule();
    return await providerModule.generateRemediationDecision(incident, analysis);
}

/**
 * Unified analyzeIncident method matching incident.controller.js schema:
 * { rootCause, impact, recommendedFix, prevention, severityAssessment }
 */
async function analyzeIncident(incident) {
    const provider = getActiveProvider();
    const isMock = process.env.OPENROUTER_MOCK === "true" ||
        process.env.GEMINI_MOCK === "true" ||
        (process.env.NODE_ENV === "test" && !isAIConfigured());

    if (isMock) {
        return {
            rootCause: `High resource saturation on ${incident.server || "cloudops-server"}.`,
            impact: "Potential degradation of dependent system processes.",
            recommendedFix: [
                "Scale deployment replicas to restore capacity",
                "Inspect error logs for unhandled exceptions",
                "Verify upstream network connectivity"
            ],
            prevention: [
                "Configure horizontal autoscaling policies",
                "Calibrate alerting thresholds",
                "Review memory and CPU resource limits"
            ],
            severityAssessment: {
                appropriate: true,
                level: incident.severity ? String(incident.severity).toUpperCase() : "HIGH",
                reason: "Incident severity aligns with observed resource pressure."
            }
        };
    }

    if (!isAIConfigured()) {
        const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";
        throw new Error(`${keyName} is not configured on the server. Please set ${keyName} in your environment.`);
    }

    const prompt = `
You are an expert CloudOps and DevOps incident analyst.

Analyze the following production incident:

Title: ${incident.title}
Description: ${incident.description || "N/A"}
Severity: ${incident.severity || "warning"}
Server: ${incident.server || "cloudops-server"}
Status: ${incident.status || "active"}

Return ONLY valid JSON.
Do not use markdown.
Do not use code blocks.
Do not add any text before or after the JSON.

Use exactly this structure:
{
  "rootCause": "Most likely root cause",
  "impact": "Impact on system and users",
  "recommendedFix": [
    "Immediate action 1",
    "Immediate action 2",
    "Immediate action 3"
  ],
  "prevention": [
    "Prevention step 1",
    "Prevention step 2",
    "Prevention step 3"
  ],
  "severityAssessment": {
    "appropriate": true,
    "level": "CRITICAL",
    "reason": "Explain why current severity is or is not appropriate"
  }
}

Rules:
1. rootCause must be concise and practical.
2. impact must explain possible system and user impact.
3. recommendedFix must contain practical immediate actions.
4. prevention must contain practical long-term prevention steps.
5. severityAssessment.level must be one of: LOW, MEDIUM, HIGH, CRITICAL.
6. severityAssessment.appropriate must be true or false.
`;

    if (provider === "openrouter") {
        const messages = [
            {
                role: "system",
                content: "You are an expert CloudOps incident analyst. Return ONLY raw valid JSON adhering to the specified schema."
            },
            {
                role: "user",
                content: prompt
            }
        ];

        const rawText = await openrouterService.callChatCompletion(messages, { temperature: 0.1, max_tokens: 600 });
        let text = (rawText || "").trim()
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        return JSON.parse(text);
    } else {
        const client = geminiService.getClient();
        const model = geminiService.getModelName();
        const response = await client.models.generateContent({
            model,
            contents: prompt
        });

        let text = (response && response.text ? response.text : "").trim()
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        return JSON.parse(text);
    }
}

/**
 * Create vector embedding using available provider (OpenRouter or Gemini)
 */
async function createEmbedding(text) {
    if (!text || typeof text !== "string") return null;

    const isMock = process.env.OPENROUTER_MOCK === "true" ||
        process.env.GEMINI_MOCK === "true" ||
        (process.env.NODE_ENV === "test" && !isAIConfigured());

    if (isMock) {
        const dim = 16;
        const vec = new Array(dim).fill(0);
        for (let i = 0; i < text.length; i++) {
            vec[i % dim] += text.charCodeAt(i) / 1000;
        }
        return vec;
    }

    const provider = getActiveProvider();
    if (provider === "openrouter") {
        const vec = await openrouterService.createEmbedding(text);
        if (vec) return vec;
        // Fallback to Gemini if key exists
        if (geminiService.isGeminiConfigured()) {
            return await geminiService.createEmbedding(text);
        }
        return null;
    } else {
        return await geminiService.createEmbedding(text);
    }
}

module.exports = {
    getActiveProvider,
    getProviderDisplayLabel,
    isAIConfigured,
    checkAIHealth,
    generateAnalysis,
    generateRemediationDecision,
    analyzeIncident,
    createEmbedding,
    cosineSimilarity: geminiService.cosineSimilarity,
    parseAnalysisText: geminiService.parseAnalysisText,
    parseDecision: geminiService.parseDecision,
    sanitizeInput: geminiService.sanitizeInput,
    openrouterService,
    geminiService
};
