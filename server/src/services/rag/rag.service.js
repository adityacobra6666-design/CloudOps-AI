const axios = require("axios");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const LLM_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text:latest";

/**
 * Parse Ollama text response into structured AI analysis object
 */
function parseAnalysisText(text) {
    if (!text || typeof text !== "string") {
        return {
            rootCause: "No specific root cause generated.",
            evidence: "Based on telemetry metrics & Alertmanager payload.",
            recommendation: "Scaling or restarting service instance.",
            confidence: 85,
            rawText: ""
        };
    }

    const cleanText = text.trim();
    const extractSection = (headingRegex, nextHeadingsRegex) => {
        const match = cleanText.match(new RegExp(`(?:\\*\\*|#+)?\\s*${headingRegex}\\s*(?:\\*\\*)?:?\\s*([\\s\\S]*?)(?=(?:\\*\\*|#+)?\\s*(?:${nextHeadingsRegex})\\s*(?:\\*\\*)?:?|$)`, "i"));
        return match && match[1] ? match[1].trim() : "";
    };

    const rootCause = extractSection("ROOT\\s*CAUSE", "EVIDENCE|RECOMMENDATION|CONFIDENCE");
    const evidence = extractSection("EVIDENCE", "RECOMMENDATION|CONFIDENCE");
    const recommendation = extractSection("RECOMMENDATION", "CONFIDENCE");
    const confMatch = cleanText.match(/CONFIDENCE(?:\s*SCORE)?:?\s*(\d+)%/i) || cleanText.match(/(\d+)%/);
    const confidence = confMatch ? parseInt(confMatch[1], 10) : 85;

    return {
        rootCause: rootCause || cleanText,
        evidence: evidence || "Based on telemetry metrics & Alertmanager payload.",
        recommendation: recommendation || "Review logs and scale/restart affected service.",
        confidence,
        rawText: cleanText
    };
}

/**
 * Create vector embedding for input text
 */
async function createEmbedding(text) {
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
                {
                    model,
                    input: text
                },
                { timeout: 10000 }
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

    console.warn(`[RAG] createEmbedding fallback notice: ${lastError?.message || "No vector generated"}`);
    return null;
}

/**
 * Calculate Cosine Similarity between two vectors safely
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

    if (normA === 0 || normB === 0) {
        return 0;
    }

    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return isNaN(similarity) || !isFinite(similarity) ? 0 : similarity;
}

/**
 * Generate AI Analysis using Llama 3.2
 */
async function generateAnalysis(incident, similarIncidents = []) {
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

CURRENT INCIDENT

Title:
${incident.title}

Description:
${incident.description || "N/A"}

Severity:
${incident.severity}

Category:
${incident.category || "N/A"}

Source:
${incident.source || "N/A"}

Environment:
${incident.environment || "Local / Cluster"}

Infrastructure Target:
${incident.server || "N/A"}


HISTORICAL INCIDENTS

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

    const modelsToTry = [
        LLM_MODEL,
        "llama3.2:3b",
        "llama3.2"
    ];

    let lastError = null;

    for (const model of modelsToTry) {
        try {
            const response = await axios.post(
                `${OLLAMA_URL}/api/generate`,
                {
                    model,
                    prompt,
                    stream: false
                },
                { timeout: 90000 }
            );

            if (response.data && response.data.response) {
                return parseAnalysisText(response.data.response);
            }
        } catch (err) {
            lastError = err;
            console.error(`[RAG] generateAnalysis failed for model ${model}:`, err.message);
        }
    }

    throw new Error(`Ollama AI generation failed: ${lastError?.message || "Ollama service unavailable"}`);
}

module.exports = {
    createEmbedding,
    cosineSimilarity,
    generateAnalysis,
    parseAnalysisText
};
