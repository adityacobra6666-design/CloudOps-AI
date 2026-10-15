const {
    getClient,
    getModelName,
    isGeminiConfigured,
    classifyGeminiError
} = require("./ai/gemini.service");

const sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const analyzeIncident = async (incident) => {
    const isMock = process.env.GEMINI_MOCK === "true" || (process.env.NODE_ENV === "test" && !isGeminiConfigured());

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

    if (!isGeminiConfigured()) {
        throw new Error("GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your environment.");
    }

    const prompt = `
You are an expert CloudOps and DevOps incident analyst.

Analyze the following production incident:

Title: ${incident.title}

Description: ${incident.description}

Severity: ${incident.severity}

Server: ${incident.server}

Status: ${incident.status}

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
    "reason": "Explain why the current severity is or is not appropriate"
  }
}

Rules:

1. rootCause must be concise and practical.
2. impact must explain possible system and user impact.
3. recommendedFix must contain practical immediate actions.
4. prevention must contain practical long-term prevention steps.
5. severityAssessment.level must be one of:
   LOW
   MEDIUM
   HIGH
   CRITICAL
6. severityAssessment.appropriate must be true or false.
7. Do not invent specific metrics, infrastructure details, logs, or facts that were not provided.
8. If the information is insufficient to determine an exact root cause, clearly say that it is the most likely cause based on the available information.
9. Keep the response concise and useful for a DevOps engineer.
`;

    const client = getClient();
    const model = getModelName();
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(
                `🤖 AI analysis attempt ${attempt}/${maxAttempts} (model: ${model})`
            );

            const response = await client.models.generateContent({
                model,
                contents: prompt
            });

            console.log("✅ AI analysis successful");

            let text = response && response.text ? response.text.trim() : "";

            // Remove accidental markdown code fences
            text = text
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();

            const parsedAnalysis = JSON.parse(text);
            return parsedAnalysis;

        } catch (error) {
            const classified = classifyGeminiError(error);
            console.error(
                `❌ AI attempt ${attempt} failed [${classified.category}]:`,
                classified.message
            );

            if (attempt === maxAttempts || !classified.retryable) {
                const finalErr = new Error(
                    `AI service failure: ${classified.message}`
                );
                finalErr.status = classified.status;
                finalErr.category = classified.category;
                throw finalErr;
            }

            const delay = attempt * 2000;
            console.log(
                `⏳ Retrying in ${delay / 1000} seconds...`
            );
            await sleep(delay);
        }
    }
};

module.exports = {
    analyzeIncident
};