const axios = require("axios");
const http = require("http");
const https = require("https");

const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 10,
    maxFreeSockets: 5,
    timeout: 30000,
    keepAliveMsecs: 15000
});

const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 10,
    maxFreeSockets: 5,
    timeout: 30000,
    keepAliveMsecs: 15000
});

class ApiClient {
    constructor(config) {
        this.config = config;
        this.cloudopsUrl = config.cloudopsUrl;
        this.agentId = config.agentId;
        this.agentToken = config.agentToken;
        this.isRevoked = false;

        this.client = axios.create({
            baseURL: `${this.cloudopsUrl}/api`,
            timeout: 15000,
            httpAgent,
            httpsAgent
        });
    }

    setCredentials(agentId, agentToken) {
        this.agentId = agentId;
        this.agentToken = agentToken;
    }

    getAuthHeaders() {
        return {
            "Authorization": `Bearer ${this.agentToken}`,
            "x-agent-id": this.agentId,
            "Content-Type": "application/json"
        };
    }

    async executeWithRetry(fn, maxRetries = 2) {
        let attempt = 0;
        while (true) {
            try {
                return await fn();
            } catch (error) {
                const code = error.code || "";
                const status = error.response?.status;
                const isRetryable =
                    code === "ECONNRESET" ||
                    code === "ETIMEDOUT" ||
                    code === "EAI_AGAIN" ||
                    code === "ENETUNREACH" ||
                    status === 502 ||
                    status === 503 ||
                    status === 504 ||
                    error.message?.includes("socket disconnected");

                if (isRetryable && attempt < maxRetries && !this.isRevoked) {
                    attempt++;
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                throw error;
            }
        }
    }

    // =========================================
    // ENROLLMENT & REGISTRATION
    // =========================================
    async register(enrollmentToken, metadata = {}) {
        try {
            console.log(`📡 [AGENT] Enrolling with CloudOps AI at ${this.cloudopsUrl}...`);
            const response = await this.client.post("/agent/register", {
                enrollmentToken,
                version: this.config.version,
                capabilities: ["METRICS", "KUBERNETES_READ", "KUBERNETES_REMEDIATION"],
                environment: this.config.agentEnvironment,
                metadata: {
                    agentName: this.config.agentName,
                    hostname: require("os").hostname(),
                    platform: process.platform,
                    arch: process.arch,
                    ...metadata
                }
            });

            if (response.data && response.data.success) {
                this.setCredentials(response.data.agentId, response.data.agentToken);
                console.log(`✅ [AGENT] Enrolled successfully! Assigned Agent ID: ${this.agentId}`);
                return response.data;
            }
            throw new Error(response.data?.message || "Registration failed");
        } catch (error) {
            const msg = error.response?.data?.message || error.message;
            console.error(`❌ [AGENT] Registration failed: ${msg}`);
            throw new Error(`Enrollment failed: ${msg}`);
        }
    }

    // =========================================
    // HEARTBEAT
    // =========================================
    async sendHeartbeat(healthInfo = {}) {
        if (!this.agentToken || this.isRevoked) return null;

        try {
            const response = await this.executeWithRetry(() =>
                this.client.post(
                    "/agent/heartbeat",
                    {
                        agentId: this.agentId,
                        version: this.config.version,
                        capabilities: ["METRICS", "KUBERNETES_READ", "KUBERNETES_REMEDIATION"],
                        health: healthInfo.status || "healthy",
                        metadata: healthInfo
                    },
                    { headers: this.getAuthHeaders() }
                )
            );

            return response.data;
        } catch (error) {
            this.handleApiError("Heartbeat", error);
            return null;
        }
    }

    // =========================================
    // INGEST TELEMETRY
    // =========================================
    async sendTelemetry(payload) {
        if (!this.agentToken || this.isRevoked) return null;

        try {
            const response = await this.executeWithRetry(() =>
                this.client.post(
                    "/agent/telemetry",
                    {
                        agentId: this.agentId,
                        timestamp: new Date().toISOString(),
                        ...payload
                    },
                    { headers: this.getAuthHeaders() }
                )
            );

            return response.data;
        } catch (error) {
            this.handleApiError("Telemetry", error);
            return null;
        }
    }

    // =========================================
    // POLL COMMANDS
    // =========================================
    async pollCommands() {
        if (!this.agentToken || this.isRevoked) return null;

        try {
            const response = await this.executeWithRetry(() =>
                this.client.get(
                    "/agent/commands",
                    { headers: this.getAuthHeaders() }
                )
            );

            return response.data?.command || null;
        } catch (error) {
            this.handleApiError("Command Poll", error);
            return null;
        }
    }

    // =========================================
    // SUBMIT COMMAND RESULT
    // =========================================
    async submitCommandResult(resultPayload) {
        if (!this.agentToken || this.isRevoked) return null;

        try {
            const response = await this.executeWithRetry(() =>
                this.client.post(
                    "/agent/command-result",
                    {
                        agentId: this.agentId,
                        ...resultPayload
                    },
                    { headers: this.getAuthHeaders() }
                )
            );

            return response.data;
        } catch (error) {
            this.handleApiError("Submit Command Result", error);
            return null;
        }
    }

    // =========================================
    // ERROR HANDLING & REVOCATION DETECTION
    // =========================================
    handleApiError(operation, error) {
        const status = error.response?.status;
        const msg = String(error.response?.data?.message || error.message || "");
	const requestId =
    error.response?.headers?.["x-request-id"] ||
    error.response?.headers?.["rndr-id"] ||
    error.response?.headers?.["cf-ray"];

if (status >= 500) {
    console.error("[AGENT] Control-plane error details:", {
        operation,
        status,
        code: error.code || null,
        requestId: requestId || null,
        response: error.response?.data ?? null
    });
}

        if (status === 401 || status === 403) {
            console.error(`🚫 [AGENT] ${operation} rejected (${status}): ${msg}`);
            const lowerMsg = msg.toLowerCase();
            if (status === 403 && (lowerMsg.includes("revoked") || lowerMsg.includes("disabled"))) {
                console.error(`🔒 [AGENT] Connection has been revoked or disabled by CloudOps AI control plane. Halting further operations.`);
                this.isRevoked = true;
            }
        } else {
            console.warn(`⚠️ [AGENT] ${operation} temporary warning: ${msg}`);
        }
    }
}

module.exports = ApiClient;
