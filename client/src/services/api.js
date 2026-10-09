const rawBaseUrl = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").trim().replace(/\/+$/, "");
const API_URL = rawBaseUrl.endsWith("/api") ? rawBaseUrl : `${rawBaseUrl}/api`;

const apiFetch = async (endpoint, options = {}) => {
    const token = localStorage.getItem("token");
    const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
    };

    const timeoutMs = options.timeout || 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
            credentials: "include",
            signal: options.signal || controller.signal
        });
        clearTimeout(timeoutId);

        const result = await response.json().catch(() => ({ success: false, message: "Server returned non-JSON response" }));

        if (!response.ok) {
            const err = new Error(result.message || `Request failed with status ${response.status}`);
            err.status = response.status;
            err.data = result;
            throw err;
        }

        return result;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
            throw new Error("Request timed out after 60 seconds. Please try again.");
        }
        throw err;
    }
};

// =========================================
// AUTHENTICATION APIs
// =========================================

export const loginUser = async (userData) => {
    return apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({
            ...userData,
            email: userData.email ? userData.email.trim().toLowerCase() : ""
        })
    });
};

export const registerUser = async (userData) => {
    return apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
            ...userData,
            email: userData.email ? userData.email.trim().toLowerCase() : "",
            role: userData.role ? userData.role.toUpperCase() : "VIEWER"
        })
    });
};

export const getCurrentUser = async () => {
    return apiFetch("/auth/me");
};

export const logoutUser = async () => {
    return apiFetch("/auth/logout", { method: "POST" });
};

export const forgotPassword = async (email) => {
    return apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
    });
};

export const resetPassword = async (token, password) => {
    return apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password })
    });
};

// =========================================
// INCIDENT APIs
// =========================================

export const getIncidents = async () => {
    return apiFetch("/incidents");
};

export const createIncident = async (incidentData) => {
    return apiFetch("/incidents", {
        method: "POST",
        body: JSON.stringify(incidentData)
    });
};

export const updateIncident = async (incidentId, incidentData) => {
    return apiFetch(`/incidents/${incidentId}`, {
        method: "PUT",
        body: JSON.stringify(incidentData)
    });
};

export const deleteIncident = async (incidentId) => {
    return apiFetch(`/incidents/${incidentId}`, {
        method: "DELETE"
    });
};

export const analyzeIncident = async (incidentId) => {
    return apiFetch(`/incidents/${incidentId}/analyze`, {
        method: "POST"
    });
};

export const getIncidentActivity = async (incidentId) => {
    return apiFetch(`/incidents/${incidentId}/activity`);
};

// =========================================
// REMEDIATION APIs
// =========================================

export const executeRemediation = async (incidentId) => {
    return apiFetch(`/remediation/${incidentId}/execute`, {
        method: "POST"
    });
};

export const getRemediationHistory = async (incidentId) => {
    return apiFetch(`/remediation/${incidentId}/history`);
};

export const getRemediationStatus = async (actionId) => {
    return apiFetch(`/remediation/actions/${actionId}`);
};

export const getAllRemediationActions = async () => {
    return apiFetch("/remediation/actions");
};

// =========================================
// METRICS & RELIABILITY APIs
// =========================================

export const getOverviewMetrics = async () => {
    return apiFetch("/metrics/overview");
};

export const getServicesHealth = async () => {
    return apiFetch("/metrics/services");
};

export const getSystemHealth = async () => {
    return apiFetch("/metrics/system-health");
};

export const getReliabilityOverview = async () => {
    return apiFetch("/reliability/overview");
};

// =========================================
// KUBERNETES APIs
// =========================================

export const getKubernetesOverview = async (namespace, connectionId) => {
    const params = new URLSearchParams();
    if (namespace) params.append("namespace", namespace);
    if (connectionId && connectionId !== "local") params.append("connectionId", connectionId);
    const qs = params.toString();
    return apiFetch(qs ? `/kubernetes/overview?${qs}` : "/kubernetes/overview");
};

export const getKubernetesStatus = async (connectionId) => {
    return apiFetch(connectionId && connectionId !== "local" ? `/kubernetes/status?connectionId=${encodeURIComponent(connectionId)}` : "/kubernetes/status");
};

export const getKubernetesHealth = async (connectionId) => {
    return apiFetch(connectionId && connectionId !== "local" ? `/kubernetes/health?connectionId=${encodeURIComponent(connectionId)}` : "/kubernetes/health");
};

export const getKubernetesNodes = async (connectionId) => {
    return apiFetch(connectionId && connectionId !== "local" ? `/kubernetes/nodes?connectionId=${encodeURIComponent(connectionId)}` : "/kubernetes/nodes");
};

export const getKubernetesPods = async (namespace, connectionId) => {
    const params = new URLSearchParams();
    if (namespace) params.append("namespace", namespace);
    if (connectionId && connectionId !== "local") params.append("connectionId", connectionId);
    const qs = params.toString();
    return apiFetch(qs ? `/kubernetes/pods?${qs}` : "/kubernetes/pods");
};

export const getKubernetesDeployments = async (namespace, connectionId) => {
    const params = new URLSearchParams();
    if (namespace) params.append("namespace", namespace);
    if (connectionId && connectionId !== "local") params.append("connectionId", connectionId);
    const qs = params.toString();
    return apiFetch(qs ? `/kubernetes/deployments?${qs}` : "/kubernetes/deployments");
};

export const getKubernetesServices = async (namespace, connectionId) => {
    const params = new URLSearchParams();
    if (namespace) params.append("namespace", namespace);
    if (connectionId && connectionId !== "local") params.append("connectionId", connectionId);
    const qs = params.toString();
    return apiFetch(qs ? `/kubernetes/services?${qs}` : "/kubernetes/services");
};

export const executeKubernetesAction = async (actionData) => {
    return apiFetch("/kubernetes/action", {
        method: "POST",
        body: JSON.stringify(actionData)
    });
};

// =========================================
// OBSERVABILITY APIs
// =========================================

export const getObservabilityTelemetry = async (range = "30m", signal = null, connectionId = null) => {
    const token = localStorage.getItem("token");
    let url = `${API_URL}/observability/telemetry?range=${range}`;
    if (connectionId && connectionId !== "local") {
        url += `&connectionId=${encodeURIComponent(connectionId)}`;
    }
    const response = await fetch(url, {
        signal,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
    });
    const result = await response.json().catch(() => ({ success: false, message: "Server returned non-JSON response" }));
    if (!response.ok) {
        throw new Error(result.message || "Failed to fetch observability telemetry");
    }
    return result;
};

// =========================================
// INFRASTRUCTURE CONNECTION APIs
// =========================================

export const getInfrastructureConnections = async () => {
    return apiFetch("/infrastructure/connections");
};

export const getInfrastructureConnectionById = async (id) => {
    return apiFetch(`/infrastructure/connections/${id}`);
};

export const createInfrastructureConnection = async (connectionData) => {
    return apiFetch("/infrastructure/connections", {
        method: "POST",
        body: JSON.stringify(connectionData)
    });
};

export const revokeInfrastructureConnection = async (id) => {
    return apiFetch(`/infrastructure/connections/${id}/revoke`, {
        method: "POST"
    });
};

export const deleteInfrastructureConnection = async (id) => {
    return apiFetch(`/infrastructure/connections/${id}`, {
        method: "DELETE"
    });
};