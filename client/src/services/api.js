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

export const getKubernetesOverview = async (namespace) => {
    const url = namespace ? `/kubernetes/overview?namespace=${namespace}` : "/kubernetes/overview";
    return apiFetch(url);
};

export const getKubernetesStatus = async () => {
    return apiFetch("/kubernetes/status");
};

export const getKubernetesHealth = async () => {
    return apiFetch("/kubernetes/health");
};

export const getKubernetesNodes = async () => {
    return apiFetch("/kubernetes/nodes");
};

export const getKubernetesPods = async (namespace) => {
    const url = namespace ? `/kubernetes/pods?namespace=${namespace}` : "/kubernetes/pods";
    return apiFetch(url);
};

export const getKubernetesDeployments = async (namespace) => {
    const url = namespace ? `/kubernetes/deployments?namespace=${namespace}` : "/kubernetes/deployments";
    return apiFetch(url);
};

export const getKubernetesServices = async (namespace) => {
    const url = namespace ? `/kubernetes/services?namespace=${namespace}` : "/kubernetes/services";
    return apiFetch(url);
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

export const getObservabilityTelemetry = async (range = "30m", signal = null) => {
    const token = localStorage.getItem("token");
    const response = await fetch(`${API_URL}/observability/telemetry?range=${range}`, {
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