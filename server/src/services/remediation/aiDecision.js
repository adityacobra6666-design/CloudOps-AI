const axios = require("axios");

const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS
} = require("../../config/remediation.config");


const OLLAMA_URL =
    process.env.OLLAMA_URL || "http://ollama:11434";

const LLM_MODEL =
    process.env.OLLAMA_MODEL || "llama3.2:3b";


// =========================================
// GENERATE REMEDIATION DECISION
// =========================================

async function generateRemediationDecision(
    incident,
    analysisText
) {

    console.log(
        "🤖 Generating remediation decision..."
    );


    const allowedActionsList =
        ALLOWED_ACTIONS.join(", ");

    const allowedTargetsList =
        Object.keys(ALLOWED_TARGETS).join(", ");


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
${analysisText || "No analysis available."}

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
            }
        );


        const raw =
            response.data.response || "";

        console.log(
            "📝 Raw AI remediation response received"
        );


        return parseDecision(raw);


    } catch (error) {

        console.error(
            "❌ AI remediation decision failed:",
            error.message
        );

        return null;
    }
}


// =========================================
// PARSE DECISION FROM LLM OUTPUT
// =========================================

function parseDecision(raw) {

    try {

        // Strip markdown code fences
        let text = raw.trim();

        text = text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();


        // Try to extract JSON object
        const jsonMatch =
            text.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {

            console.error(
                "❌ No JSON object found in AI response"
            );

            return null;
        }


        const parsed = JSON.parse(jsonMatch[0]);


        // Validate required fields
        if (!parsed.action || !parsed.target) {

            console.error(
                "❌ AI response missing action or target"
            );

            return null;
        }


        // NONE means no action recommended
        if (
            parsed.action === "NONE" ||
            parsed.action === "none"
        ) {

            console.log(
                "ℹ️ AI recommends no remediation action"
            );

            return null;
        }


        // Validate action is in allowed list
        if (!ALLOWED_ACTIONS.includes(parsed.action)) {

            console.error(
                `❌ AI returned invalid action: "${parsed.action}"`
            );

            return null;
        }


        // Validate target is in allowed list
        if (!(parsed.target in ALLOWED_TARGETS)) {

            console.error(
                `❌ AI returned invalid target: "${parsed.target}"`
            );

            return null;
        }


        // Normalize confidence
        let confidence =
            parseFloat(parsed.confidence);

        if (
            isNaN(confidence) ||
            confidence < 0 ||
            confidence > 1
        ) {
            confidence = 0.5;
        }


        const decision = {
            action: parsed.action,
            target: parsed.target,
            reason:
                String(parsed.reason || "AI recommended action").substring(0, 500),
            confidence
        };


        console.log(
            `✅ Remediation decision: ${decision.action} → ${decision.target} (confidence: ${decision.confidence})`
        );


        return decision;


    } catch (error) {

        console.error(
            "❌ Failed to parse AI remediation decision:",
            error.message
        );

        return null;
    }
}


module.exports = {
    generateRemediationDecision,
    parseDecision
};
