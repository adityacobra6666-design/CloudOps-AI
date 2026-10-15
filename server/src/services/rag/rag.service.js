const axios = require("axios");
const geminiService = require("../ai/gemini.service");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const LLM_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text:latest";

/**
 * Parse text response into structured AI analysis object
 */
function parseAnalysisText(text) {
    return geminiService.parseAnalysisText(text);
}

/**
 * Calculate Cosine Similarity between two vectors safely
 */
function cosineSimilarity(a, b) {
    return geminiService.cosineSimilarity(a, b);
}

/**
 * Create vector embedding for input text
 * Prefers Gemini text-embedding, falls back to Ollama if configured
 */
async function createEmbedding(text) {
    if (geminiService.isGeminiConfigured() || process.env.GEMINI_MOCK === "true" || process.env.NODE_ENV === "test") {
        const vec = await geminiService.createEmbedding(text);
        if (vec) return vec;
    }

    // Secondary fallback: local Ollama if explicitly available
    const modelsToTry = [
        EMBED_MODEL,
        "nomic-embed-text:latest",
        "nomic-embed-text"
    ];

    let lastError = null;
    for (const model of modelsToTry) {
        try {
            const response = await axios.post(
                `${OLLAMA_URL}/api/embed`,
                { model, input: text },
                { timeout: 5000 }
            );

            if (
                response.data &&
                response.data.embeddings &&
                Array.isArray(response.data.embeddings) &&
                response.data.embeddings.length > 0
            ) {
                const vec = response.data.embeddings[0];
                if (Array.isArray(vec) && vec.length > 0) {
                    return vec;
                }
            }
        } catch (err) {
            lastError = err;
        }
    }

    console.warn(`[RAG] createEmbedding notice: ${lastError?.message || "No vector generated"}`);
    return null;
}

/**
 * Generate AI Analysis using Gemini API (with optional local Ollama fallback)
 */
async function generateAnalysis(incident, similarIncidents = []) {
    // Primary path: Gemini API
    if (geminiService.isGeminiConfigured() || process.env.GEMINI_MOCK === "true" || process.env.NODE_ENV === "test") {
        return await geminiService.generateAnalysis(incident, similarIncidents);
    }

    // Secondary path: local Ollama if running locally without Gemini key
    const context = Array.isArray(similarIncidents) && similarIncidents.length > 0
        ? similarIncidents.map((item, index) => {
            const rc = typeof item.aiAnalysis === "object" ? item.aiAnalysis?.rootCause : item.aiAnalysis;
            const rec = typeof item.aiAnalysis === "object" ? item.aiAnalysis?.recommendation : "N/A";
            return `
Historical Incident ${index + 1}
Title: ${item.title}
Description: ${item.description || "N/A"}
Severity: ${item.severity}
Category: ${item.category || "N/A"}
AI Root Cause: ${rc || "Not available"}
AI Recommendation: ${rec || "Not available"}
`;
        }).join("\n")
        : "No similar historical incidents found.";

    const prompt = `
You are CloudOps AI, an SRE assistant.
Analyze this infrastructure incident using the incident information and historical incidents.

CURRENT INCIDENT:
Title: ${incident.title}
Description: ${incident.description || "N/A"}
Severity: ${incident.severity}
Category: ${incident.category || "N/A"}
Source: ${incident.source || "N/A"}
Target: ${incident.server || "N/A"}

HISTORICAL INCIDENTS:
${context}

Return exactly these sections:

ROOT CAUSE:
Give the most likely technical root cause.

EVIDENCE:
Give the evidence supporting your diagnosis.

RECOMMENDATION:
Give practical remediation steps.

CONFIDENCE:
Give a confidence percentage (e.g. 85%).
`;

    const modelsToTry = [LLM_MODEL, "llama3.2:3b", "llama3.2"];
    let lastError = null;

    for (const model of modelsToTry) {
        try {
            const response = await axios.post(
                `${OLLAMA_URL}/api/generate`,
                { model, prompt, stream: false },
                { timeout: 15000 }
            );

            if (response.data && response.data.response) {
                return parseAnalysisText(response.data.response);
            }
        } catch (err) {
            lastError = err;
        }
    }

    throw new Error(`AI incident analysis unavailable: GEMINI_API_KEY is not configured and Ollama is unreachable (${lastError?.message || "No AI provider available"})`);
}

module.exports = {
    createEmbedding,
    cosineSimilarity,
    generateAnalysis,
    parseAnalysisText
};
