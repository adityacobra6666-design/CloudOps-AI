const axios = require("axios");
const geminiService = require("../ai/gemini.service");
const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS
} = require("../../config/remediation.config");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const LLM_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

/**
 * Generate remediation decision using Gemini API (with optional local Ollama fallback)
 */
async function generateRemediationDecision(incident, analysisText) {
    console.log("🤖 Generating remediation decision...");

    // Primary path: Gemini API
    if (geminiService.isGeminiConfigured() || process.env.GEMINI_MOCK === "true" || process.env.NODE_ENV === "test") {
        return await geminiService.generateRemediationDecision(incident, analysisText);
    }

    // Secondary path: local Ollama
    const allowedActionsList = ALLOWED_ACTIONS.join(", ");
    const allowedTargetsList = Object.keys(ALLOWED_TARGETS).join(", ");

    const prompt = `
You are CloudOps AI, an SRE remediation assistant.
Based on the following incident and analysis, recommend a single remediation action.

INCIDENT:
Title: ${incident.title || "N/A"}
Description: ${incident.description || "N/A"}
Severity: ${incident.severity || "N/A"}
Category: ${incident.category || "N/A"}
Source: ${incident.source || "N/A"}

ANALYSIS:
${typeof analysisText === "object" ? `${analysisText.rootCause || ""} ${analysisText.recommendation || ""}` : (analysisText || "No analysis available.")}

ALLOWED ACTIONS (you MUST pick one of these or NONE):
${allowedActionsList}

ALLOWED TARGETS (you MUST pick one of these):
${allowedTargetsList}

Return ONLY valid JSON with exactly this structure:
{
  "action": "RESTART_SERVICE",
  "target": "cloudops-server",
  "reason": "Brief explanation of why this action is recommended",
  "confidence": 0.85
}

Rules:
1. action MUST be one of: ${allowedActionsList}, or "NONE" if no action is appropriate.
2. target MUST be one of: ${allowedTargetsList}.
3. confidence MUST be a number between 0.0 and 1.0.
4. reason MUST be a brief practical explanation.
5. Do NOT add markdown, code blocks, or extra text.
6. Return ONLY the JSON object.
`;

    try {
        const response = await axios.post(
            `${OLLAMA_URL}/api/generate`,
            {
                model: LLM_MODEL,
                prompt,
                stream: false
            },
            { timeout: 15000 }
        );

        const raw = response.data?.response || "";
        console.log("📝 Raw AI remediation response received from Ollama fallback");
        return parseDecision(raw);
    } catch (error) {
        console.error("❌ AI remediation decision failed:", error.message);
        return null;
    }
}

/**
 * Parse decision from LLM output (delegated to geminiService for unified validation)
 */
function parseDecision(raw) {
    return geminiService.parseDecision(raw);
}

module.exports = {
    generateRemediationDecision,
    parseDecision
};
