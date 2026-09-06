const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const analyzeIncident = async (incident) => {
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

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(
                `🤖 AI analysis attempt ${attempt}/${maxAttempts}`
            );

            const response = await ai.models.generateContent({
                model: "gemini-3.6-flash",
                contents: prompt
            });

            console.log("✅ AI analysis successful");

            let text = response.text.trim();

            // Remove accidental markdown code fences
            text = text
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();

            const parsedAnalysis = JSON.parse(text);

            return parsedAnalysis;

        } catch (error) {
            console.error(
                `❌ AI attempt ${attempt} failed:`,
                error.message
            );

            if (attempt === maxAttempts) {
                throw new Error(
                    "AI service is temporarily unavailable. Please try again."
                );
            }

            const delay = attempt * 3000;

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