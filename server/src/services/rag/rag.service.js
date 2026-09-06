const axios = require("axios");

const OLLAMA_URL =
    process.env.OLLAMA_URL || "http://ollama:11434";

const LLM_MODEL =
    process.env.OLLAMA_MODEL || "llama3.2:3b";

const EMBED_MODEL =
    process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";


// ==========================================
// CREATE EMBEDDING
// ==========================================

async function createEmbedding(text) {

    const response = await axios.post(
        `${OLLAMA_URL}/api/embed`,
        {
            model: EMBED_MODEL,
            input: text
        }
    );

    return response.data.embeddings[0];
}


// ==========================================
// COSINE SIMILARITY
// ==========================================

function cosineSimilarity(a, b) {

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {

        dot += a[i] * b[i];

        normA += a[i] * a[i];

        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (
        Math.sqrt(normA) *
        Math.sqrt(normB)
    );
}


// ==========================================
// GENERATE AI ANALYSIS
// ==========================================

async function generateAnalysis(
    incident,
    similarIncidents
) {

    const context = similarIncidents
        .map((item, index) => {

            return `
Historical Incident ${index + 1}

Title:
${item.title}

Description:
${item.description || "N/A"}

Severity:
${item.severity}

Category:
${item.category || "N/A"}

AI Root Cause:
${item.aiRootCause || "Not available"}

AI Recommendation:
${item.aiRecommendation || "Not available"}
`;

        })
        .join("\n");


    const prompt = `
You are CloudOps AI, an SRE assistant.

Analyze this infrastructure incident using the
incident information and historical incidents.

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


HISTORICAL INCIDENTS

${context || "No similar historical incidents found."}


Return exactly these sections:

ROOT CAUSE:
Give the most likely technical root cause.

EVIDENCE:
Give the evidence supporting your diagnosis.

RECOMMENDATION:
Give practical remediation steps.

CONFIDENCE:
Give a confidence percentage.

Do not invent facts that are not supported by
the incident or historical context.
`;


    const response = await axios.post(
        `${OLLAMA_URL}/api/generate`,
        {
            model: LLM_MODEL,
            prompt,
            stream: false
        }
    );


    return response.data.response;
}


module.exports = {
    createEmbedding,
    cosineSimilarity,
    generateAnalysis
};
