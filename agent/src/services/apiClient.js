const axios = require("axios");

class ApiClient {
    constructor(config) {
        this.config = config;
        this.cloudopsUrl = config.cloudopsUrl;
        this.agentId = config.agentId;
        this.agentToken = config.agentToken;
        this.isRevoked = false;

        this.client = axios.create({
            baseURL: `${this.cloudopsUrl}/api`,
            timeout: 15000
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
            const response = await this.client.post(
                "/agent/heartbeat",
                {
                    agentId: this.agentId,
                    version: this.config.version,
                    capabilities: ["METRICS", "KUBERNETES_READ", "KUBERNETES_REMEDIATION"],
                    health: healthInfo.status || "healthy",
                    metadata: healthInfo
                },
                { headers: this.getAuthHeaders() }
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
            const response = await this.client.post(
                "/agent/telemetry",
                {
                    agentId: this.agentId,
                    timestamp: new Date().toISOString(),
                    ...payload
                },
                { headers: this.getAuthHeaders() }
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
            const response = await this.client.get(
                "/agent/commands",
                { headers: this.getAuthHeaders() }
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
            const response = await this.client.post(
                "/agent/command-result",
                {
                    agentId: this.agentId,
                    ...resultPayload
                },
                { headers: this.getAuthHeaders() }
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
        const msg = error.response?.data?.message || error.message;

        if (status === 401 || status === 403) {
            console.error(`🚫 [AGENT] ${operation} rejected (${status}): ${msg}`);
            if (msg.includes("revoked") || status === 403) {
                console.error(`🔒 [AGENT] Connection has been revoked by CloudOps AI control plane. Halting further operations.`);
                this.isRevoked = true;
            }
        } else {
            console.warn(`⚠️ [AGENT] ${operation} temporary warning: ${msg}`);
        }
    }
}

module.exports = ApiClient;
